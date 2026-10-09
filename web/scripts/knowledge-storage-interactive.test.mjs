import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import tls from "node:tls";
import {
  PROJECT_NAME, PROJECT_REF, PROJECT_URL, TEST_WEB_DIRECTORY,
  assertTestWorktree, createTerminalPrompt, runInteractiveStorage, validateCaPem,
  validatePublishableKey, validateWriterConnection,
} from "./knowledge-storage-interactive.mjs";

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const docA = "11111111-1111-4111-8111-111111111111";
const docB = "22222222-2222-4222-8222-222222222222";
const ca = tls.rootCertificates[0];
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
        if (actor === userA && options.authError) return { error: options.authError };
        if (actor === userA && options.authThrow) throw options.authThrow;
        if (actor === userB && options.authErrorB) return { error: options.authErrorB };
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
      connect: async () => {
        events.push("writer-connect");
        if (options.failWriterConnect) throw options.failWriterConnect;
      },
      query: async (sql, parameters = []) => {
        if (sql.includes("has_function_privilege")) {
          events.push("writer-permissions");
          return { rows: [{ mark_allowed: !options.denyWriterPermission,
            finish_allowed: !options.denyWriterPermission }] };
        }
        const [userId, id] = parameters;
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
      createSupabase, createWriter, readCertificate: async () => {
        if (options.failCaRead) throw options.failCaRead;
        return options.invalidCa ? "not a PEM certificate" : ca;
      } }),
  };
}

describe("interactive Storage acceptance safeguards", () => {
  it("preserves fragmented UTF-8 and bracketed Windows paste without echoing a hidden password", async () => {
    const input = new EventEmitter();
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (raw) => { input.isRaw = raw; };
    input.resume = () => {};
    input.pause = () => {};
    const writes = [];
    const output = { isTTY: true, write: (value) => writes.push(value) };
    const result = createTerminalPrompt(input, output).ask("密码：", true);
    const bytes = Buffer.from("\u001b[200~fake-中文🔒 pass\u001b[201~\r\n");
    for (const byte of bytes) input.emit("data", Buffer.from([byte]));
    expect(await result).toBe("fake-中文🔒 pass");
    expect(input.isRaw).toBe(false);
    expect(writes.join("")).toBe("密码：\n");
  });

  it("ignores Windows special keys and edits a hidden input without leaking it", async () => {
    const input = new EventEmitter();
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (raw) => { input.isRaw = raw; };
    input.resume = () => {};
    input.pause = () => {};
    const writes = [];
    const result = createTerminalPrompt(input, { isTTY: true, write: (value) => writes.push(value) })
      .ask("密码：", true);
    input.emit("data", Buffer.from("fake-abc\u001b[D\u0000K\bX\r"));
    expect(await result).toBe("fake-abX");
    expect(writes.join("")).toBe("密码：\n");
  });

  it("reports terminal read failure separately without exposing partial input", async () => {
    const input = new EventEmitter();
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (raw) => { input.isRaw = raw; };
    input.resume = () => {};
    input.pause = () => {};
    const writes = [];
    const result = createTerminalPrompt(input, { isTTY: true, write: (value) => writes.push(value) })
      .ask("密码：", true);
    input.emit("data", Buffer.from("fake-partial-secret"));
    input.emit("error", new Error("fake-partial-secret"));
    await expect(result).rejects.toThrow("终端读取失败");
    expect(input.isRaw).toBe(false);
    expect(writes.join("")).not.toContain("fake-partial-secret");
  });

  it.each([
    [{ status: 400, code: "invalid_credentials", message: "fake-secret" }, "账号或密码错误", "HTTP: 400; Auth code: invalid_credentials"],
    [{ status: 401, code: "invalid_api_key", message: "fake-secret" }, "API Key 错误", "HTTP: 401; Auth code: invalid_api_key"],
    [{ name: "AuthRetryableFetchError", cause: { code: "ENOTFOUND" }, message: "fake-secret" }, "网络失败", "Network code: ENOTFOUND"],
  ])("reports only safe login diagnostics for A", async (authError, kind, field) => {
    const h = harness({ authError });
    expect(await h.run()).toBe(false);
    expect(h.reports).toContain("A 账号登录: FAIL");
    expect(h.reports.join(" ")).toContain(`分类: ${kind}`);
    expect(h.reports.join(" ")).toContain(field);
    expect(h.reports.join(" ")).not.toContain("fake-secret");
    expect(h.events).not.toContain(`login:${userB}`);
  });

  it("identifies B when the second login fails", async () => {
    const h = harness({ authErrorB: { status: 400, code: "invalid_credentials", message: "fake-secret" } });
    expect(await h.run()).toBe(false);
    expect(h.reports).toContain("B 账号登录: FAIL");
    expect(h.reports.join(" ")).toContain("账号: B; 阶段: signInWithPassword");
    expect(h.reports.join(" ")).not.toContain("fake-secret");
  });

  it("pins the test Worktree and rejects service-role or wrong-project credentials", () => {
    expect(() => assertTestWorktree("D:\\龙虾\\Codex\\PersonalAgent\\web", (value) => value)).toThrow();
    expect(() => validatePublishableKey("sb_secret_fake")).toThrow();
    expect(() => validateWriterConnection(writerUrl.replace(PROJECT_REF, "otherproject"), ca)).toThrow();
    expect(() => validateWriterConnection(writerUrl, "not a certificate")).toThrow();
    expect(validateCaPem(ca)).toContain("-----BEGIN CERTIFICATE-----");
    expect(validateWriterConnection(writerUrl, ca).ssl.rejectUnauthorized).toBe(true);
  });

  it("checks both real owner downloads, both cross-user reads/deletes, and cleans only its new fixture", async () => {
    const h = harness();
    expect(await h.run()).toBe(true);
    expect([...h.documents.keys()].sort()).toEqual([docA, docB]);
    expect(h.objects.size).toBe(2);
    expect(h.events.filter((item) => item.startsWith("upload:")).length).toBe(1);
    expect(h.events.filter((item) => item === "mark" || item === "finish")).toEqual(["mark", "finish"]);
    expect(h.events).toContain("writer-permissions");
    expect(h.reports.filter((item) => item.endsWith(": PASS")).length).toBeGreaterThanOrEqual(8);
    expect(h.reports.join(" ")).not.toMatch(/fake-(?:a-password|b-password|test-password|secret)/u);
  });

  it.each([
    [{ failCaRead: Object.assign(new Error("fake-secret"), { code: "ENOENT" }) },
      "TLS CA 文件加载: FAIL", "code: ENOENT"],
    [{ invalidCa: true }, "TLS CA PEM 解析: FAIL", "分类: CA 文件或证书错误"],
    [{ failWriterConnect: Object.assign(new Error("fake-secret"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }) },
      "受限数据库连接与 TLS: FAIL", "code: UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
    [{ denyWriterPermission: true }, "受限数据库权限验证: FAIL", "分类: 数据库权限错误"],
    [{ failWriterConnect: Object.assign(new Error("fake-secret"), { code: "fake-secret-code" }) },
      "受限数据库连接与 TLS: FAIL", "code: 无"],
  ])("labels a failure after both owner downloads accurately", async (options, failure, detail) => {
    const h = harness(options);
    expect(await h.run()).toBe(false);
    expect(h.reports).toContain("B 本人下载与大小校验: PASS");
    expect(h.reports).toContain(failure);
    expect(h.reports.join(" ")).toContain(detail);
    expect(h.reports).toContain("本轮未创建一次性测试对象，无需清理");
    expect(h.events.some((item) => item.startsWith("remove:") || item.startsWith("upload:"))).toBe(false);
    expect(h.reports.join(" ")).not.toContain("fake-secret");
  });

  it("attributes an invalid Pooler URL to configuration after both download checks", async () => {
    const h = harness();
    h.prompts[7] = "not-a-database-url";
    expect(await h.run()).toBe(false);
    expect(h.reports).toContain("B 本人下载与大小校验: PASS");
    expect(h.reports).toContain("受限数据库连接配置校验: FAIL");
    expect(h.reports).toContain("本轮未创建一次性测试对象，无需清理");
    expect(h.reports.join(" ")).not.toContain("not-a-database-url");
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
    expect(h.reports).toContain("一次性夹具清理状态转换: FAIL");
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
