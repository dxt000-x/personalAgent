import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const PROJECT_REF = "uuktbpywrzflrdbxnzfx";
export const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_STORAGE_ERROR_BYTES = 64 * 1024;
const MAX_CHUNKS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DOCUMENT_SELECT = "id,user_id,storage_path,status,byte_size,chunk_count";
const CHUNK_SELECT = "document_id,user_id,chunk_index";

export class CheckFailure extends Error {
  constructor(code, stage) {
    super(code);
    this.code = code;
    this.stage = stage;
  }
}

function check(value, code, stage) {
  if (!value) throw new CheckFailure(code, stage);
}

export function validateFixture(documentId, storagePath) {
  check(UUID.test(documentId), "INVALID_DOCUMENT_ID", "FIXTURE");
  const pattern = new RegExp(`^[0-9a-f-]{36}/${documentId}/source\\.(pdf|txt|md)$`, "iu");
  check(pattern.test(storagePath), "INVALID_STORAGE_PATH", "FIXTURE");
  const [ownerId] = storagePath.split("/");
  check(UUID.test(ownerId), "INVALID_STORAGE_PATH", "FIXTURE");
  return { documentId, storagePath, ownerId };
}

// Fail closed at the HTTP boundary: Auth password exchange is the sole POST.
// Knowledge tables, Storage and RPC endpoints never admit a write method.
export function createReadOnlyFetch(fetchImpl, fixture = () => null, storageEvents = []) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = String(init.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET")).toUpperCase();
    check(url.origin === PROJECT_URL, "PROJECT_MISMATCH", "HTTP_GUARD");
    let allowed = false;
    if (url.pathname === "/auth/v1/token" && url.search === "?grant_type=password") allowed = method === "POST";
    if (url.pathname === "/auth/v1/user" && url.search === "") allowed = method === "GET";
    const active = fixture();
    if (url.pathname === "/rest/v1/knowledge_documents" || url.pathname === "/rest/v1/knowledge_chunks") {
      const documents = url.pathname.endsWith("knowledge_documents");
      const expected = documents
        ? { select: DOCUMENT_SELECT, id: `eq.${active?.documentId}`, limit: "1" }
        : { select: CHUNK_SELECT, document_id: `eq.${active?.documentId}`, limit: ["1", String(MAX_CHUNKS + 1)] };
      if (!documents && url.searchParams.has("order")) expected.order = "chunk_index.asc";
      allowed = method === "GET" && Boolean(active)
        && [...url.searchParams.keys()].length === Object.keys(expected).length
        && Object.entries(expected).every(([key, value]) =>
          url.searchParams.getAll(key).length === 1
          && (Array.isArray(value) ? value.includes(url.searchParams.get(key)) : url.searchParams.get(key) === value))
        && (documents || (url.searchParams.has("order") === (url.searchParams.get("limit") === String(MAX_CHUNKS + 1))));
    }
    const storage = Boolean(active) && url.pathname === `/storage/v1/object/knowledge-files/${active.storagePath}`;
    if (storage) {
      allowed = method === "GET" && url.search === "";
    }
    check(allowed, "REQUEST_NOT_READ_ONLY", "HTTP_GUARD");
    const timeout = AbortSignal.timeout(15_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const event = storage ? { sent: true, received: false, status: null } : null;
    if (event) storageEvents.push(event);
    // The final override also defeats a caller-supplied redirect: "follow".
    // In particular, never forward an Auth password POST to a Location header.
    const response = await fetchImpl(input, { ...init, signal, redirect: "error" });
    check(response.status < 300 || response.status >= 400, "REDIRECT_NOT_ALLOWED", "HTTP_GUARD");
    if (event) {
      event.received = true;
      event.status = response.status;
      {
        const maxBytes = response.ok ? MAX_BYTES : MAX_STORAGE_ERROR_BYTES;
        const tooLargeCode = response.ok ? "FILE_TOO_LARGE" : "STORAGE_ERROR_TOO_LARGE";
        const rawLength = response.headers.get("content-length");
        const length = rawLength === null ? null : Number(rawLength);
        check(length === null || (Number.isInteger(length) && length >= 0 && length <= maxBytes),
          tooLargeCode, "STORAGE_TRANSFER");
        const reader = response.body?.getReader();
        if (!reader) {
          check(!response.ok, "INVALID_STORAGE_RESPONSE", "STORAGE_TRANSFER");
          return response;
        }
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
              await reader.cancel().catch(() => {});
              throw new CheckFailure(tooLargeCode, "STORAGE_TRANSFER");
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        return new Response(new Blob(chunks), { status: response.status, statusText: response.statusText,
          headers: response.headers });
      }
    }
    return response;
  };
}

export function makeClient(key, fetchImpl) {
  check(typeof key === "string", "INVALID_PUBLIC_KEY", "CONFIG");
  if (key.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      check(payload.role === "anon", "INVALID_PUBLIC_KEY", "CONFIG");
    } catch { throw new CheckFailure("INVALID_PUBLIC_KEY", "CONFIG"); }
  } else {
    check(/^sb_publishable_[A-Za-z0-9_-]+$/u.test(key), "INVALID_PUBLIC_KEY", "CONFIG");
  }
  return createClient(PROJECT_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });
}

export async function authenticate(client, email, password, label) {
  const stage = `${label}_AUTH`;
  check(email.length > 0 && password.length > 0, "EMPTY_CREDENTIALS", stage);
  const signed = await client.auth.signInWithPassword({ email, password });
  check(!signed.error && signed.data?.session, "AUTH_FAILED", stage);
  const verified = await client.auth.getUser();
  check(!verified.error && UUID.test(verified.data?.user?.id ?? ""), "AUTH_VERIFY_FAILED", stage);
  check(signed.data.user?.id === verified.data.user.id, "AUTH_ID_MISMATCH", stage);
  return verified.data.user.id;
}

export async function runChecks({ clientA, clientB, storageEventsA, storageEventsB,
  userAId, userBId, documentId, storagePath, report = () => {} }) {
  const fixture = validateFixture(documentId, storagePath);
  check(UUID.test(userAId) && UUID.test(userBId) && userAId !== userBId, "USERS_NOT_DISTINCT", "IDENTITY");
  check(fixture.ownerId === userAId, "OWNER_MISMATCH", "FIXTURE");
  const docResult = await clientA.from("knowledge_documents")
    .select(DOCUMENT_SELECT)
    .eq("id", documentId).limit(1);
  check(!docResult.error, "DOCUMENT_QUERY_FAILED", "A_DOCUMENT");
  const doc = docResult.data?.[0];
  check(doc && docResult.data.length === 1, "DOCUMENT_NOT_FOUND", "A_DOCUMENT");
  check(doc.user_id === userAId && doc.id === documentId && doc.storage_path === storagePath && doc.status === "ready"
    && Number.isInteger(doc.byte_size) && doc.byte_size > 0 && doc.byte_size <= MAX_BYTES
    && Number.isInteger(doc.chunk_count) && doc.chunk_count > 0 && doc.chunk_count <= MAX_CHUNKS,
  "DOCUMENT_MISMATCH", "A_DOCUMENT");

  const aChunks = await clientA.from("knowledge_chunks").select(CHUNK_SELECT)
    .eq("document_id", documentId).order("chunk_index").limit(MAX_CHUNKS + 1);
  check(!aChunks.error, "CHUNK_QUERY_FAILED", "A_CHUNKS");
  check(aChunks.data?.length >= 1 && aChunks.data.length === doc.chunk_count && aChunks.data.length <= MAX_CHUNKS
    && aChunks.data.every((row, i) => row.document_id === documentId && row.user_id === userAId && row.chunk_index === i),
  "CHUNK_MISMATCH", "A_CHUNKS");
  report(`A_CHUNKS PASS count=${aChunks.data.length}`);

  const bChunks = await clientB.from("knowledge_chunks").select(CHUNK_SELECT)
    .eq("document_id", documentId).limit(1);
  check(!bChunks.error, "CHUNK_QUERY_FAILED", "B_CHUNKS");
  check(Array.isArray(bChunks.data) && bChunks.data.length === 0, "CROSS_USER_CHUNK_READ", "B_CHUNKS");
  report("B_CHUNKS PASS count=0");

  const aBefore = storageEventsA.length;
  const aDownload = await clientA.storage.from("knowledge-files").download(storagePath);
  check(storageEventsA.length === aBefore + 1 && storageEventsA.at(-1).sent
    && storageEventsA.at(-1).received && storageEventsA.at(-1).status === 200,
  "OWN_STORAGE_RESPONSE_INVALID", "A_STORAGE");
  check(!aDownload.error && aDownload.data, "OWN_DOWNLOAD_FAILED", "A_STORAGE");
  check(aDownload.data.size > 0 && aDownload.data.size <= MAX_BYTES && aDownload.data.size === doc.byte_size,
    "FILE_SIZE_MISMATCH", "A_STORAGE");
  const bytes = await aDownload.data.arrayBuffer();
  const digest = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  report(`A_STORAGE PASS bytes=${aDownload.data.size} sha256=${digest}`);

  const bBefore = storageEventsB.length;
  let bDownload;
  try { bDownload = await clientB.storage.from("knowledge-files").download(storagePath); }
  catch { throw new CheckFailure("B_STORAGE_REQUEST_FAILED", "B_STORAGE"); }
  check(storageEventsB.length === bBefore + 1 && storageEventsB.at(-1).sent
    && storageEventsB.at(-1).received, "B_STORAGE_NO_HTTP_RESPONSE", "B_STORAGE");
  const status = storageEventsB.at(-1).status;
  check(!bDownload.data, "CROSS_USER_FILE_READ", "B_STORAGE");
  // Storage SDK 2.117.2 exposes the response body's code as StorageApiError.code.
  // A bare 400 is ambiguous; only the exact NoSuchKey code can join 403/404
  // as a candidate. B's identity and A's file are rechecked below.
  const denied = status === 403 || status === 404
    || (status === 400 && bDownload.error?.code === "NoSuchKey");
  check(denied && bDownload.error && Number(bDownload.error.status) === status,
    "B_STORAGE_NOT_DENIED", "B_STORAGE");
  const bVerified = await clientB.auth.getUser();
  check(!bVerified.error && bVerified.data?.user?.id === userBId,
    "B_AUTH_RECHECK_FAILED", "B_AUTH_RECHECK");

  const aAgainBefore = storageEventsA.length;
  const aAgain = await clientA.storage.from("knowledge-files").download(storagePath);
  check(storageEventsA.length === aAgainBefore + 1 && storageEventsA.at(-1).sent
    && storageEventsA.at(-1).received && storageEventsA.at(-1).status === 200
    && !aAgain.error && aAgain.data && aAgain.data.size === aDownload.data.size,
  "OWNER_RECHECK_FAILED", "A_STORAGE_RECHECK");
  const againDigest = createHash("sha256").update(Buffer.from(await aAgain.data.arrayBuffer())).digest("hex");
  check(againDigest === digest, "OWNER_FILE_CHANGED", "A_STORAGE_RECHECK");
  report(`B_STORAGE PASS http=${status}; A_STORAGE_RECHECK PASS bytes=${aAgain.data.size} sha256=${againDigest}`);
  return { chunks: aChunks.data.length, bytes: aDownload.data.size, sha256: digest, deniedHttpStatus: status };
}

class InputFailure extends Error {}

// Raw TTY input prevents shell history and echo. No credentials are read from argv/env/files.
export function terminalPrompt(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") throw new InputFailure();
  return (label, hidden = false) => new Promise((resolve, reject) => {
    let value = "";
    let done = false;
    const priorRaw = input.isRaw;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let skip = false;
    let escape = "";
    const finish = (error) => {
      if (done) return;
      done = true;
      input.off("data", onData); input.off("end", onEnd); input.off("error", onError);
      try { input.setRawMode(Boolean(priorRaw)); } catch { error = new InputFailure(); }
      input.pause(); output.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const onEnd = () => finish(new InputFailure());
    const onError = () => finish(new InputFailure());
    const onData = (chunk) => {
      try {
        for (const char of decoder.decode(chunk, { stream: true })) {
          if (skip) { skip = false; continue; }
          if (char === "\u0000") { skip = true; continue; }
          if (escape) {
            escape += char;
            if (escape === "\u001b[" || /^\u001b\[[0-9;]*$/u.test(escape)) continue;
            escape = ""; continue;
          }
          if (char === "\u001b") { escape = char; continue; }
          if (char === "\r" || char === "\n") { finish(); return; }
          if (char === "\u0003") { finish(new InputFailure()); return; }
          if (char === "\b" || char === "\u007f") {
            value = Array.from(value).slice(0, -1).join("");
            if (!hidden) output.write("\b \b");
          } else if (char >= " ") {
            value += char;
            if (!hidden) output.write(char);
          }
        }
      } catch { finish(new InputFailure()); }
    };
    try {
      output.write(label); input.setRawMode(true);
      input.on("data", onData); input.on("end", onEnd); input.on("error", onError); input.resume();
    } catch { finish(new InputFailure()); }
  });
}

export async function main(args = process.argv.slice(2), fetchImpl = globalThis.fetch) {
  if (args.length === 1 && args[0] === "--dry-run") {
    console.log(`OFFLINE DRY RUN: ${PROJECT_REF}; Auth password POST, Auth user GET, exact document/chunk GET, exact Storage GET. No network.`);
    return;
  }
  check(args.length === 1 && args[0] === "--execute-readonly", "INVALID_ARGUMENTS", "START");
  const ask = terminalPrompt();
  const confirmation = await ask("确认生产项目名称 personal-ai-assistant（完整输入）：");
  check(confirmation === "personal-ai-assistant", "PROJECT_NOT_CONFIRMED", "START");
  const documentId = (await ask("预登记文档 ID：")).trim();
  const storagePath = (await ask("预登记 Storage 路径：")).trim();
  const fixture = validateFixture(documentId, storagePath);
  const key = await ask("生产 publishable/anon key（隐藏）：", true);
  let active = fixture;
  const storageEventsA = [];
  const storageEventsB = [];
  const clientA = makeClient(key, createReadOnlyFetch(fetchImpl, () => active, storageEventsA));
  const clientB = makeClient(key, createReadOnlyFetch(fetchImpl, () => active, storageEventsB));
  const aEmail = (await ask("A 邮箱（隐藏）：", true)).trim();
  const aPassword = await ask("A 密码（隐藏）：", true);
  const userAId = await authenticate(clientA, aEmail, aPassword, "A");
  check(userAId === fixture.ownerId, "OWNER_MISMATCH", "A_AUTH");
  const bEmail = (await ask("B 邮箱（隐藏）：", true)).trim();
  const bPassword = await ask("B 密码（隐藏）：", true);
  const userBId = await authenticate(clientB, bEmail, bPassword, "B");
  check(userAId !== userBId, "USERS_NOT_DISTINCT", "IDENTITY");
  await runChecks({ clientA, clientB, storageEventsA, storageEventsB,
    userAId, userBId, documentId, storagePath, report: console.log });
  active = null;
  console.log("READONLY_ACCEPTANCE PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const stage = error instanceof CheckFailure ? error.stage : error instanceof InputFailure ? "TERMINAL" : "REQUEST";
    const code = error instanceof CheckFailure ? error.code : error instanceof InputFailure ? "INPUT_FAILED" : "REQUEST_FAILED";
    console.error(`READONLY_ACCEPTANCE FAIL stage=${stage} code=${code}`);
    process.exitCode = 1;
  });
}
