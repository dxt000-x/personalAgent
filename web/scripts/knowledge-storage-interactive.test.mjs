import { describe, expect, it } from "vitest";
import {
  PROJECT_NAME, PROJECT_REF, PROJECT_URL, TEST_WEB_DIRECTORY,
  assertTestWorktree, runInteractiveStorage, validatePublishableKey, validateWriterConnection,
} from "./knowledge-storage-interactive.mjs";

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const docA = "11111111-1111-4111-8111-111111111111";
const docB = "22222222-2222-4222-8222-222222222222";
const ca = "-----BEGIN CERTIFICATE-----\nFAKE-TEST-CA\n-----END CERTIFICATE-----";
const writerUrl = `postgresql://knowledge_writer_login.${PROJECT_REF}:fake-test-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

function harness(options = {}) {
  const documents = new Map();
  const objects = new Map();
  const events = [];
  const reports = [];
  const prompts = [PROJECT_NAME, "sb_publishable_fake-test-only", "a@test.invalid", "fake-a-password",
    "b@test.invalid", "fake-b-password", "CONFIRM TEST FILES", writerUrl, "D:\\codex\\temp\\test-ca.pem"];
  for (const [id, userId, label] of [[docA, userA, "A"], [docB, userB, "B"]]) {
    const file = Buffer.from(`disposable ${label} fixture`);
    const doc = { id, user_id: userId, file_name: `kb-isolation-test-${label}.txt`,
      file_type: "txt", byte_size: file.length, storage_path: `${userId}/${id}/source.txt`, status: "ready" };
    documents.set(id, doc);
    objects.set(doc.storage_path, file);
  }
  const clients = [userA, userB].map((actor) => ({
    auth: {
      signInWithPassword: async ({ email, password }) => {
        events.push(`login:${actor}`);
        expect(email).toMatch(/@test\.invalid$/u);
        expect(password).toMatch(/^fake-/u);
        return { error: null };
      },
      getUser: async () => ({ data: { user: { id: actor } }, error: null }),
    },
    from: (table) => {
      expect(table).toBe("knowledge_documents");
      return {
        select: () => ({
          then: (resolve) => resolve({ data: [...documents.values()].filter((d) => d.user_id === actor), error: null }),
          eq: async (_column, id) => ({ data: [...documents.values()].filter((d) => d.id === id && d.user_id === actor), error: null }),
        }),
        insert: (row) => ({ select: () => ({ single: async () => {
          const doc = { ...row, storage_path: `${row.user_id}/${row.id}/source.${row.file_type}`,
            status: "uploading" };
          documents.set(row.id, doc);
          events.push(`insert:${row.id}`);
          return { data: doc, error: null };
        } }) }),
      };
    },
    storage: { from: (name) => {
      expect(name).toBe("knowledge-files");
      return {
        download: async (path) => {
          events.push(`download:${actor}:${path}`);
          const owner = documents.get(path.split("/")[1])?.user_id;
          const bytes = objects.get(path);
          if (!bytes || (actor !== owner && !options.allowCrossDownload)) return { error: { status: 404 } };
          return { data: new Blob([bytes]), error: null };
        },
        remove: async (paths) => {
          const path = paths[0];
          events.push(`remove:${actor}:${path}`);
          const owner = documents.get(path.split("/")[1])?.user_id;
          if (actor !== owner && !options.allowCrossDelete) return { error: { status: 403 } };
          if (actor === owner && documents.get(path.split("/")[1])?.status !== "deleting") {
            return { error: { status: 403 } };
          }
          if (!objects.has(path) && options.missingRemovalError) return { error: { status: 404 } };
          objects.delete(path);
          return { data: [{ name: path }], error: null };
        },
        upload: async (path, bytes) => {
          events.push(`upload:${actor}:${path}`);
          const owner = documents.get(path.split("/")[1])?.user_id;
          if (actor !== owner && !options.allowCrossUpload) return { error: { status: 403 } };
          objects.set(path, Buffer.from(bytes));
          return { data: { path }, error: null };
        },
      };
    } },
  }));
  let nextClient = 0;
  const createSupabase = (url, key, config) => {
    expect(url).toBe(PROJECT_URL);
    expect(key).toBe("sb_publishable_fake-test-only");
    expect(config.auth.persistSession).toBe(false);
    expect(config.auth.autoRefreshToken).toBe(false);
    return clients[nextClient++];
  };
  const createWriter = (config) => {
    expect(config.user).toBe(`knowledge_writer_login.${PROJECT_REF}`);
    expect(config.ssl.rejectUnauthorized).toBe(true);
    return {
      connect: async () => { events.push("writer-connect"); },
      query: async (sql, [userId, id]) => {
        expect(userId).toBe(userB);
        events.push(sql.includes("mark_knowledge_deleting") ? "mark" : "finish");
        if (sql.includes("mark_knowledge_deleting")) {
          if (options.failCleanup) throw new Error("fake cleanup failure with fake-secret");
          documents.get(id).status = "deleting";
          return { rows: [{ value: true }] };
        }
        if (objects.has(`${userB}/${id}/source.txt`)) return { rows: [{ value: false }] };
        documents.delete(id);
        return { rows: [{ value: true }] };
      },
      end: async () => { events.push("writer-end"); },
    };
  };
  const prompt = { ask: async (_label, hidden) => {
    events.push(hidden ? "hidden-prompt" : "visible-prompt");
    return prompts.shift();
  } };
  return {
    documents, objects, events, reports, prompts,
    run: () => runInteractiveStorage({ prompt, report: (message) => reports.push(message),
      cwd: TEST_WEB_DIRECTORY, resolvePath: (value) => value,
      createSupabase, createWriter, readCertificate: async () => ca }),
  };
}

describe("interactive Storage acceptance safeguards", () => {
  it("pins the test Worktree and rejects service-role or wrong-project credentials", () => {
    expect(() => assertTestWorktree("D:\\龙虾\\Codex\\PersonalAgent\\web", (value) => value)).toThrow();
    expect(() => validatePublishableKey("sb_secret_fake")).toThrow();
    expect(() => validateWriterConnection(writerUrl.replace(PROJECT_REF, "otherproject"), ca)).toThrow();
    expect(() => validateWriterConnection(writerUrl, "not a certificate")).toThrow();
    expect(validateWriterConnection(writerUrl, ca).ssl.rejectUnauthorized).toBe(true);
  });

  it("checks both real owner downloads, both cross-user reads/deletes, and cleans only its new fixture", async () => {
    const h = harness();
    expect(await h.run()).toBe(true);
    expect([...h.documents.keys()].sort()).toEqual([docA, docB]);
    expect(h.objects.size).toBe(2);
    expect(h.events.filter((item) => item.startsWith("upload:")).length).toBe(1);
    expect(h.events.filter((item) => item === "mark" || item === "finish")).toEqual(["mark", "finish"]);
    expect(h.reports.filter((item) => item.endsWith(": PASS")).length).toBeGreaterThanOrEqual(8);
    expect(h.reports.join(" ")).not.toMatch(/fake-(?:a-password|b-password|test-password|secret)/u);
  });

  it("fails and stops before uploading if a cross-account delete actually removes B's fixture", async () => {
    const h = harness({ allowCrossDelete: true });
    expect(await h.run()).toBe(false);
    expect(h.events.some((item) => item.startsWith("upload:"))).toBe(false);
    expect(h.reports.some((item) => item.includes("A 无法删除 B: FAIL"))).toBe(true);
  });

  it("never attacks an unmarked learning document", async () => {
    const h = harness();
    h.documents.get(docB).file_name = "personal-learning-notes.txt";
    expect(await h.run()).toBe(false);
    expect(h.events.some((item) => item.startsWith("remove:") || item.startsWith("upload:"))).toBe(false);
  });

  it("stops before deletion if a cross-account download succeeds", async () => {
    const h = harness({ allowCrossDownload: true });
    expect(await h.run()).toBe(false);
    expect(h.events.some((item) => item.startsWith("remove:") || item.startsWith("upload:"))).toBe(false);
  });

  it("fails an unexpectedly accepted cross-account upload and cleans the disposable object", async () => {
    const h = harness({ allowCrossUpload: true });
    expect(await h.run()).toBe(false);
    expect([...h.documents.keys()].sort()).toEqual([docA, docB]);
    expect(h.objects.size).toBe(2);
    expect(h.reports.some((item) => item === "一次性夹具清理: PASS")).toBe(true);
  });

  it("finishes metadata cleanup when the rejected upload left no Storage object", async () => {
    const h = harness({ missingRemovalError: true });
    expect(await h.run()).toBe(true);
    expect([...h.documents.keys()].sort()).toEqual([docA, docB]);
    expect(h.reports).toContain("一次性夹具清理: PASS");
  });

  it("returns failure and reports only the object ID when cleanup fails", async () => {
    const h = harness({ failCleanup: true });
    expect(await h.run()).toBe(false);
    expect(h.reports.some((item) => /^须人工检查测试对象 ID：[0-9a-f-]+$/u.test(item))).toBe(true);
    expect(h.reports.join(" ")).not.toContain("fake-secret");
  });

  it("refuses a CA path in the original development checkout before any attack", async () => {
    const h = harness();
    h.prompts[h.prompts.length - 1] = "D:\\龙虾\\Codex\\PersonalAgent\\web\\test-ca.pem";
    expect(await h.run()).toBe(false);
    expect(h.events.some((item) => item.startsWith("remove:") || item.startsWith("upload:"))).toBe(false);
    expect(h.reports.join(" ")).not.toContain("fake-test-password");
  });
});
