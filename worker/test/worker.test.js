import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const ORIGIN = "https://crowdfax.apramodk.com";

class MemKV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.get(k) ?? null; }
  async put(k, v) { this.m.set(k, v); }
}

function makeEnv(over = {}) {
  return {
    ALLOWED_ORIGIN: ORIGIN, MAX_FAXES_PER_IP_DAY: "2", MAX_FAXES_PER_DAY: "3", MAX_PAGES: "3",
    TELNYX_API_KEY: "key", TELNYX_CONNECTION_ID: "conn", TELNYX_FROM: "+15550001111",
    TURNSTILE_SECRET: "ts", IP_SALT: "salt", RATE: new MemKV(), ...over,
  };
}

const pdfBytes = (pages = 1) =>
  new TextEncoder().encode("%PDF-1.4\n" + "<< /Type /Page >>\n".repeat(pages) + "<< /Type /Pages >>\n%%EOF");

function sendReq({ file = pdfBytes(), number = "+1 555 123 4567", token = "tok", origin = ORIGIN, ip = "1.2.3.4" } = {}) {
  const fd = new FormData();
  if (file) fd.set("pdf", new File([file], "x.pdf", { type: "application/pdf" }));
  fd.set("number", number);
  fd.set("name", "Someone");
  if (token) fd.set("cf-turnstile-response", token);
  return new Request("https://api.test/send", { method: "POST", body: fd, headers: { origin, "cf-connecting-ip": ip } });
}

function mockFetch({ turnstile = true, telnyxStatus = 202 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("turnstile")) return Response.json({ success: turnstile });
    if (String(url).endsWith("/faxes") && init.method === "POST") {
      return telnyxStatus === 202
        ? Response.json({ data: { id: "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0", status: "queued" } }, { status: 202 })
        : new Response("{}", { status: telnyxStatus });
    }
    if (String(url).includes("/faxes/")) return Response.json({ data: { status: "delivered", to: "+15551234567" } });
    if (String(url).endsWith("/balance")) return Response.json({ data: { available_credit: "12.5", currency: "USD" } });
    return new Response("nope", { status: 500 });
  };
  return calls;
}

test("sends a valid fax to Telnyx without storing media", async () => {
  const calls = mockFetch();
  const res = await worker.fetch(sendReq(), makeEnv());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "queued");
  const telnyx = calls.find((c) => c.url.endsWith("/faxes"));
  assert.equal(telnyx.init.body.get("to"), "+15551234567");
  assert.equal(telnyx.init.body.get("store_media"), "false");
  assert.equal(telnyx.init.body.get("store_preview"), "false");
  assert.equal(telnyx.init.headers.authorization, "Bearer key");
});

test("rejects wrong origin, non-PDF, bad number, oversize, too many pages", async () => {
  mockFetch();
  assert.equal((await worker.fetch(sendReq({ origin: "https://evil.example" }), makeEnv())).status, 403);
  assert.equal((await worker.fetch(sendReq({ file: new TextEncoder().encode("hello") }), makeEnv())).status, 400);
  assert.equal((await worker.fetch(sendReq({ number: "12345" }), makeEnv())).status, 400);
  assert.equal((await worker.fetch(sendReq({ file: new Uint8Array(10 * 1024 * 1024 + 1) }), makeEnv())).status, 400);
  assert.equal((await worker.fetch(sendReq({ file: pdfBytes(9) }), makeEnv())).status, 400);
});

test("never calls Telnyx when validation or captcha fails", async () => {
  const calls = mockFetch({ turnstile: false });
  const res = await worker.fetch(sendReq(), makeEnv());
  assert.equal(res.status, 400);
  assert.equal(calls.filter((c) => c.url.endsWith("/faxes")).length, 0);
  const noTok = await worker.fetch(sendReq({ token: "" }), makeEnv());
  assert.equal(noTok.status, 400);
});

test("per-IP and global daily caps", async () => {
  mockFetch();
  const env = makeEnv();
  assert.equal((await worker.fetch(sendReq({ ip: "9.9.9.9" }), env)).status, 200);
  assert.equal((await worker.fetch(sendReq({ ip: "9.9.9.9" }), env)).status, 200);
  assert.equal((await worker.fetch(sendReq({ ip: "9.9.9.9" }), env)).status, 429); // per-IP cap of 2
  assert.equal((await worker.fetch(sendReq({ ip: "8.8.8.8" }), env)).status, 200); // 3rd of the day
  assert.equal((await worker.fetch(sendReq({ ip: "7.7.7.7" }), env)).status, 429); // global cap of 3
});

test("stores only hashed IPs in the counter store", async () => {
  mockFetch();
  const env = makeEnv();
  await worker.fetch(sendReq({ ip: "203.0.113.5" }), env);
  for (const k of env.RATE.m.keys()) assert.equal(k.includes("203.0.113.5"), false);
});

test("provider errors are generic and funds-empty maps to 503", async () => {
  mockFetch({ telnyxStatus: 402 });
  const res = await worker.fetch(sendReq(), makeEnv());
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "provider_error");
  assert.equal(JSON.stringify(body).includes("5551234567"), false);
});

test("status endpoint returns only status, balance endpoint returns number", async () => {
  mockFetch();
  const env = makeEnv();
  const s = await (await worker.fetch(new Request("https://api.test/status?id=0ccc7b54-4df3-4bca-a65a-3da1ecc777f0"), env)).json();
  assert.deepEqual(s, { ok: true, status: "delivered", failed: false });
  assert.equal((await worker.fetch(new Request("https://api.test/status?id=bad"), env)).status, 400);
  const b = await (await worker.fetch(new Request("https://api.test/balance"), env)).json();
  assert.equal(b.balance, 12.5);
});

test("CORS only for the allowed origin", async () => {
  mockFetch();
  const ok = await worker.fetch(new Request("https://api.test/balance", { headers: { origin: ORIGIN } }), makeEnv());
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  const bad = await worker.fetch(new Request("https://api.test/balance", { headers: { origin: "https://evil.example" } }), makeEnv());
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});
