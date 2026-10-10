import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  PROJECT_URL, createReadOnlyFetch, runChecks, validateFixture, authenticate, makeClient, terminalPrompt,
} from "./verify-knowledge-readonly-production.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${A}/${ID}/source.txt`;
const doc = { id: ID, user_id: A, storage_path: PATH, status: "ready", byte_size: 4, chunk_count: 1 };

function fakeClient({ owner = false, bCanRead = false, bCanDownload = false, ownDownload = true,
  bStatus = 404, bCode, secondDownload = "test" } = {}) {
  const calls = [];
  const storageEvents = [];
  let downloads = 0;
  return {
    calls,
    storageEvents,
    auth: { getUser: async () => ({ data: { user: { id: owner ? A : B } }, error: null }) },
    from(table) {
      calls.push(table);
      return {
        select(columns) {
          expect(columns).not.toContain("content");
          return {
            eq(column, id) {
              expect(id).toBe(ID);
              expect(column).toBe(table === "knowledge_documents" ? "id" : "document_id");
              const data = table === "knowledge_documents" ? owner ? [doc] : []
                : owner || bCanRead ? [{ document_id: ID, user_id: A, chunk_index: 0 }] : [];
              const query = { limit: async () => ({ data, error: null }) };
              query.order = () => query;
              return query;
            },
          };
        },
      };
    },
    storage: {
      from(bucket) {
        expect(bucket).toBe("knowledge-files");
        return { async download(path) {
          calls.push("download");
          expect(path).toBe(PATH);
          downloads += 1;
          if (owner) {
            const success = ownDownload && (downloads === 1 || secondDownload !== null);
            storageEvents.push({ sent: true, received: true, status: success ? 200 : 404 });
            return success ? { data: new Blob([downloads === 1 ? "test" : secondDownload]), error: null }
              : { data: null, error: { status: 404 } };
          }
          storageEvents.push({ sent: true, received: true, status: bCanDownload ? 200 : bStatus });
          return bCanDownload ? { data: new Blob(["test"]), error: null }
            : { data: null, error: { status: bStatus, code: bCode } };
        } };
      },
    },
  };
}

function checks(a, b, extra = {}) {
  return runChecks({ clientA: a, clientB: b, storageEventsA: a.storageEvents,
    storageEventsB: b.storageEvents, userAId: A, userBId: B,
    documentId: ID, storagePath: PATH, ...extra });
}

describe("production read-only Knowledge Base acceptance", () => {
  it("accepts four positive/negative controls on one exact fixture without exposing content", async () => {
    const a = fakeClient({ owner: true });
    const b = fakeClient();
    const logs = [];
    const result = await checks(a, b, { report: (line) => logs.push(line) });
    expect(result).toMatchObject({ chunks: 1, bytes: 4, deniedHttpStatus: 404 });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(logs.join("\n")).not.toContain("test");
    expect(a.calls).toEqual(["knowledge_documents", "knowledge_chunks", "download", "download"]);
    expect(b.calls).toEqual(["knowledge_chunks", "download"]);
  });

  it("stops if B sees any chunk, before Storage", async () => {
    const b = fakeClient({ bCanRead: true });
    await expect(checks(fakeClient({ owner: true }), b)).rejects.toMatchObject({ code: "CROSS_USER_CHUNK_READ" });
    expect(b.calls).toEqual(["knowledge_chunks"]);
  });

  it("stops if B downloads A file", async () => {
    await expect(checks(fakeClient({ owner: true }), fakeClient({ bCanDownload: true })))
      .rejects.toMatchObject({ code: "CROSS_USER_FILE_READ" });
  });

  it("rejects missing own file, same identity and incorrect fixed path", async () => {
    await expect(checks(fakeClient({ owner: true, ownDownload: false }), fakeClient()))
      .rejects.toMatchObject({ code: "OWN_STORAGE_RESPONSE_INVALID" });
    await expect(checks(fakeClient({ owner: true }), fakeClient(), { userBId: A }))
      .rejects.toMatchObject({ code: "USERS_NOT_DISTINCT" });
    expect(() => validateFixture(ID, `${B}/${ID}/wrong.txt`)).toThrow();
  });

  it("requires verified, distinct Auth identity", async () => {
    const client = { auth: {
      signInWithPassword: vi.fn(async () => ({ data: { session: {}, user: { id: A } }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: A } }, error: null })),
    } };
    await expect(authenticate(client, "a@example.test", "fake", "A")).resolves.toBe(A);
    client.auth.getUser.mockResolvedValue({ data: { user: { id: B } }, error: null });
    await expect(authenticate(client, "a@example.test", "fake", "A")).rejects.toMatchObject({ code: "AUTH_ID_MISMATCH" });
  });

  it("HTTP guard admits exact reads and Auth exchange, denies all knowledge writes and other projects", async () => {
    const transport = vi.fn(async () => new Response("ok", { status: 200 }));
    const guarded = createReadOnlyFetch(transport, () => ({ documentId: ID, storagePath: PATH }));
    await guarded(`${PROJECT_URL}/auth/v1/token?grant_type=password`, { method: "POST" });
    await guarded(`${PROJECT_URL}/auth/v1/user`, { method: "GET" });
    await guarded(`${PROJECT_URL}/rest/v1/knowledge_chunks?select=document_id%2Cuser_id%2Cchunk_index&document_id=eq.${ID}&limit=1`, { method: "GET" });
    await guarded(`${PROJECT_URL}/storage/v1/object/knowledge-files/${PATH}`, { method: "GET" });
    expect(transport).toHaveBeenCalledTimes(4);
    expect(transport.mock.calls.every(([, options]) => options.redirect === "error")).toBe(true);
    await guarded(`${PROJECT_URL}/auth/v1/token?grant_type=password`, { method: "POST", redirect: "follow" });
    expect(transport.mock.lastCall[1].redirect).toBe("error");
    for (const [url, method] of [
      [`${PROJECT_URL}/rest/v1/knowledge_chunks?select=document_id%2Cuser_id%2Cchunk_index&document_id=eq.${ID}&limit=1`, "POST"],
      [`${PROJECT_URL}/rest/v1/rpc/complete_knowledge_document`, "POST"],
      [`${PROJECT_URL}/storage/v1/object/knowledge-files/${PATH}`, "DELETE"],
      [`${PROJECT_URL}/storage/v1/object/knowledge-files/${PATH}`, "PUT"],
      [`https://pxfaqcepztzqyqtmbdrf.supabase.co/auth/v1/user`, "GET"],
      [`${PROJECT_URL}/rest/v1/knowledge_chunks?document_id=eq.${B}`, "GET"],
      [`${PROJECT_URL}/rest/v1/knowledge_chunks?select=content&document_id=eq.${ID}&limit=1`, "GET"],
      [`${PROJECT_URL}/rest/v1/knowledge_chunks?select=document_id%2Cuser_id%2Cchunk_index&document_id=eq.${ID}&limit=1&or=(user_id.eq.${A})`, "GET"],
      [`${PROJECT_URL}/rest/v1/knowledge_chunks?select=document_id%2Cuser_id%2Cchunk_index&document_id=eq.${ID}&document_id=eq.${B}&limit=1`, "GET"],
    ]) {
      await expect(guarded(url, { method })).rejects.toMatchObject({ code: expect.any(String) });
    }
    expect(transport).toHaveBeenCalledTimes(5);
  });

  it("rejects redirects without forwarding Auth credentials or changing origin", async () => {
    const requests = [];
    const redirectingFetch = vi.fn(async (input, options) => {
      requests.push({ url: input, redirect: options.redirect });
      if (options.redirect === "error") throw new TypeError("redirect blocked");
      throw new Error("unsafe redirect follow");
    });
    const guarded = createReadOnlyFetch(redirectingFetch, () => ({ documentId: ID, storagePath: PATH }));
    for (const [url, method] of [
      [`${PROJECT_URL}/auth/v1/token?grant_type=password`, "POST"],
      [`${PROJECT_URL}/auth/v1/user`, "GET"],
      [`${PROJECT_URL}/rest/v1/knowledge_documents?select=id%2Cuser_id%2Cstorage_path%2Cstatus%2Cbyte_size%2Cchunk_count&id=eq.${ID}&limit=1`, "GET"],
      [`${PROJECT_URL}/storage/v1/object/knowledge-files/${PATH}`, "GET"],
    ]) {
      await expect(guarded(url, { method, redirect: "follow" })).rejects.toThrow("redirect blocked");
    }
    expect(requests).toHaveLength(4);
    expect(requests.every((request) => request.redirect === "error"
      && new URL(request.url).origin === PROJECT_URL)).toBe(true);
    await expect(guarded("https://attacker.invalid/auth/v1/token?grant_type=password", { method: "POST" }))
      .rejects.toMatchObject({ code: "PROJECT_MISMATCH" });
    expect(requests).toHaveLength(4);
  });

  it.each([301, 302, 303, 307, 308])("fails closed if a custom fetch returns HTTP %i", async (status) => {
    const transport = vi.fn(async () => new Response(null, {
      status, headers: { location: "https://attacker.invalid/collect" },
    }));
    const guarded = createReadOnlyFetch(transport);
    await expect(guarded(`${PROJECT_URL}/auth/v1/token?grant_type=password`,
      { method: "POST", redirect: "follow" })).rejects.toMatchObject({ code: "REDIRECT_NOT_ALLOWED" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.lastCall[1].redirect).toBe("error");
  });

  it.each([400, 401, 429, 500, 0])("does not accept B Storage status %i as isolation", async (status) => {
    const b = fakeClient({ bStatus: status });
    await expect(checks(fakeClient({ owner: true }), b)).rejects.toMatchObject({ code: "B_STORAGE_NOT_DENIED" });
  });

  it("accepts only HTTP 400 with explicit SDK NoSuchKey, followed by B and A rechecks", async () => {
    const a = fakeClient({ owner: true });
    const b = fakeClient({ bStatus: 400, bCode: "NoSuchKey" });
    await expect(checks(a, b)).resolves.toMatchObject({ deniedHttpStatus: 400 });
    expect(a.calls.filter((call) => call === "download")).toHaveLength(2);
    for (const code of [undefined, "", "AccessDenied", "InvalidJWT", "NoSuchKey "]) {
      await expect(checks(fakeClient({ owner: true }), fakeClient({ bStatus: 400, bCode: code })))
        .rejects.toMatchObject({ code: "B_STORAGE_NOT_DENIED" });
    }
  });

  it("rejects a B network failure or local guard interception without HTTP response", async () => {
    for (const scenario of ["network", "guard"]) {
      const b = fakeClient();
      b.storage.from = () => ({ download: async () => {
        if (scenario === "network") b.storageEvents.push({ sent: true, received: false, status: null });
        throw new Error("fake network or guard error");
      } });
      await expect(checks(fakeClient({ owner: true }), b)).rejects.toMatchObject({ code: "B_STORAGE_REQUEST_FAILED" });
    }
  });

  it("rejects missing or changed A file after B denial", async () => {
    await expect(checks(fakeClient({ owner: true, secondDownload: null }), fakeClient()))
      .rejects.toMatchObject({ code: "OWNER_RECHECK_FAILED" });
    await expect(checks(fakeClient({ owner: true, secondDownload: "evil" }), fakeClient()))
      .rejects.toMatchObject({ code: "OWNER_FILE_CHANGED" });
  });

  it("does not accept denial when B session has expired", async () => {
    const b = fakeClient();
    b.auth.getUser = async () => ({ data: null, error: { status: 401 } });
    await expect(checks(fakeClient({ owner: true }), b))
      .rejects.toMatchObject({ code: "B_AUTH_RECHECK_FAILED" });
    const noSuchKey = fakeClient({ bStatus: 400, bCode: "NoSuchKey" });
    noSuchKey.auth.getUser = async () => ({ data: null, error: { status: 401 } });
    await expect(checks(fakeClient({ owner: true }), noSuchKey))
      .rejects.toMatchObject({ code: "B_AUTH_RECHECK_FAILED" });
  });

  it("stops a body larger than 4 MiB even without Content-Length", async () => {
    const events = [];
    const guarded = createReadOnlyFetch(async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1)),
      () => ({ documentId: ID, storagePath: PATH }), events);
    await expect(guarded(`${PROJECT_URL}/storage/v1/object/knowledge-files/${PATH}`, { method: "GET" }))
      .rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(events).toEqual([{ sent: true, received: true, status: 200 }]);
  });

  it("rejects oversized Storage error bodies with and without Content-Length", async () => {
    for (const headers of [{}, { "content-length": "65537" }]) {
      const guarded = createReadOnlyFetch(async () => new Response(new Uint8Array(65 * 1024),
        { status: 404, headers }), () => ({ documentId: ID, storagePath: PATH }));
      await expect(guarded(`${PROJECT_URL}/storage/v1/object/knowledge-files/${PATH}`, { method: "GET" }))
        .rejects.toMatchObject({ code: "STORAGE_ERROR_TOO_LARGE" });
    }
  });

  it("uses actual installed Supabase SDK request paths and a fake-only transport", async () => {
    const seen = [];
    const mockFetch = vi.fn(async (input, init) => {
      const url = new URL(input);
      seen.push({ path: url.pathname, search: url.search, method: init.method ?? "GET", redirect: init.redirect });
      const json = (value, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { "content-type": "application/json" },
      });
      if (url.pathname === "/auth/v1/token") return json({ access_token: "fake.access.token", token_type: "bearer",
        expires_in: 3600, refresh_token: "fake-refresh", user: { id: A, aud: "authenticated" } });
      if (url.pathname === "/auth/v1/user") return json({ id: A, aud: "authenticated" });
      if (url.pathname === "/rest/v1/knowledge_documents") return json([doc]);
      if (url.pathname === "/rest/v1/knowledge_chunks") return json([{ document_id: ID, user_id: A, chunk_index: 0 }]);
      if (url.pathname === `/storage/v1/object/knowledge-files/${PATH}`) return new Response("test", { status: 200 });
      throw new Error("Unexpected SDK URL");
    });
    const fixture = () => ({ documentId: ID, storagePath: PATH });
    const guarded = createReadOnlyFetch(mockFetch, fixture, []);
    const client = makeClient("sb_publishable_offlinefake", guarded);
    const sign = await client.auth.signInWithPassword({ email: "a@example.test", password: "fake-only" });
    expect(sign.error).toBeNull();
    const user = await client.auth.getUser();
    expect(user.error).toBeNull();
    expect((await client.from("knowledge_documents").select("id,user_id,storage_path,status,byte_size,chunk_count")
      .eq("id", ID).limit(1)).error).toBeNull();
    expect((await client.from("knowledge_chunks").select("document_id,user_id,chunk_index")
      .eq("document_id", ID).order("chunk_index").limit(201)).error).toBeNull();
    expect((await client.storage.from("knowledge-files").download(PATH)).error).toBeNull();
    expect(seen).toHaveLength(5);
    expect(seen.every((request) => request.redirect === "error")).toBe(true);
    expect(seen.map(({ path, method }) => [path, method])).toEqual([
      ["/auth/v1/token", "POST"], ["/auth/v1/user", "GET"],
      ["/rest/v1/knowledge_documents", "GET"], ["/rest/v1/knowledge_chunks", "GET"],
      [`/storage/v1/object/knowledge-files/${PATH}`, "GET"],
    ]);
    expect(seen[0].search).toBe("?grant_type=password");
    expect(new URLSearchParams(seen[2].search)).toEqual(new URLSearchParams({
      select: "id,user_id,storage_path,status,byte_size,chunk_count", id: `eq.${ID}`, limit: "1",
    }));
    expect(new URLSearchParams(seen[3].search)).toEqual(new URLSearchParams({
      select: "document_id,user_id,chunk_index", document_id: `eq.${ID}`,
      order: "chunk_index.asc", limit: "201",
    }));
    expect(seen.at(-1).search).toBe("");
    for (const status of [403, 404]) {
      const deniedEvents = [];
      const denied = makeClient("sb_publishable_offlinefake", createReadOnlyFetch(async () =>
        new Response(JSON.stringify({ statusCode: String(status), error: "access_denied", message: "denied" }),
          { status, headers: { "content-type": "application/json" } }), fixture, deniedEvents));
      const deniedResult = await denied.storage.from("knowledge-files").download(PATH);
      expect(deniedResult.data).toBeNull();
      expect(deniedResult.error.status).toBe(status);
      expect(deniedEvents).toEqual([{ sent: true, received: true, status }]);
    }
    for (const payload of [
      { statusCode: "400", code: "NoSuchKey", message: "Object not found" },
      { statusCode: "NoSuchKey", message: "Object not found" },
    ]) {
      const events = [];
      const client400 = makeClient("sb_publishable_offlinefake", createReadOnlyFetch(async () =>
        new Response(JSON.stringify(payload), { status: 400,
          headers: { "content-type": "application/json" } }), fixture, events));
      const result = await client400.storage.from("knowledge-files").download(PATH);
      expect(result.data).toBeNull();
      expect(result.error.status).toBe(400);
      expect(result.error.code).toBe(payload.code);
      expect(events).toEqual([{ sent: true, received: true, status: 400 }]);
    }
  });

  it("rejects service-role JWTs and secret keys before client creation", () => {
    const jwt = (role) => `eyJ.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.fake`;
    expect(() => makeClient(jwt("service_role"), vi.fn())).toThrow();
    expect(() => makeClient("sb_secret_not_allowed", vi.fn())).toThrow();
    expect(() => makeClient(jwt("anon"), vi.fn())).not.toThrow();
  });

  it("reads hidden TTY input without echoing or truncating it", async () => {
    const input = new EventEmitter();
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = vi.fn((raw) => { input.isRaw = raw; });
    input.resume = vi.fn();
    input.pause = vi.fn();
    const written = [];
    const output = { isTTY: true, write: (s) => written.push(s) };
    const pending = terminalPrompt(input, output)("secret: ", true);
    input.emit("data", Buffer.from("ab"));
    input.emit("data", Buffer.from("cd\r"));
    await expect(pending).resolves.toBe("abcd");
    expect(written.join("")).toBe("secret: \n");
    expect(input.isRaw).toBe(false);
  });
});
