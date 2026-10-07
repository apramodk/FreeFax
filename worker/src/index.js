// CrowdFax API: validates a fax request and forwards the PDF to Telnyx.
// Privacy: the document is streamed through memory only. Nothing is written to storage,
// logged, or stored with the provider (store_media=false). Only anonymous counters are kept.

const TELNYX = "https://api.telnyx.com/v2";
const MAX_BYTES = 10 * 1024 * 1024;
const E164 = /^\+[1-9]\d{7,14}$/;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/send") return json(await send(request, env), cors);
      if (request.method === "GET" && url.pathname === "/status") return json(await status(url, env), cors);
      if (request.method === "GET" && url.pathname === "/balance") return json(await balance(env), cors);
      return json({ ok: false, error: "not_found" }, cors, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ ok: false, error: err.code, message: err.message }, cors, err.status);
      return json({ ok: false, error: "server_error", message: "Something went wrong. Please try again." }, cors, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function json(body, cors, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...cors },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = env.ALLOWED_ORIGIN;
  const h = { vary: "origin" };
  if (origin && origin === allowed) {
    h["access-control-allow-origin"] = allowed;
    h["access-control-allow-methods"] = "GET, POST, OPTIONS";
    h["access-control-allow-headers"] = "content-type";
  }
  return h;
}

async function send(request, env) {
  if (request.headers.get("origin") !== env.ALLOWED_ORIGIN) throw new HttpError(403, "forbidden", "Request not allowed.");

  const form = await request.formData().catch(() => { throw new HttpError(400, "bad_request", "Invalid form data."); });
  const file = form.get("pdf");
  const number = String(form.get("number") || "").replace(/[\s().-]/g, "");
  const token = String(form.get("cf-turnstile-response") || "");

  if (!(file instanceof File)) throw new HttpError(400, "no_file", "Choose a PDF to send.");
  if (file.size === 0 || file.size > MAX_BYTES) throw new HttpError(400, "bad_size", "The PDF must be under 10 MB.");
  if (!E164.test(number)) throw new HttpError(400, "bad_number", "Enter a valid fax number with country code.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(bytes)) throw new HttpError(400, "not_pdf", "That file is not a PDF.");
  const pages = roughPageCount(bytes);
  const maxPages = Number(env.MAX_PAGES || 10);
  if (pages > maxPages) throw new HttpError(400, "too_many_pages", `Please keep faxes to ${maxPages} pages or fewer.`);

  await verifyTurnstile(token, request, env);
  await enforceLimits(request, env);

  const body = new FormData();
  body.set("connection_id", env.TELNYX_CONNECTION_ID);
  body.set("from", env.TELNYX_FROM);
  body.set("to", number);
  body.set("quality", "normal");
  body.set("monochrome", "true");
  body.set("store_media", "false");
  body.set("store_preview", "false");
  body.set("contents", new Blob([bytes], { type: "application/pdf" }), "fax.pdf");

  const res = await fetch(`${TELNYX}/faxes`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.TELNYX_API_KEY}` },
    body,
  });
  if (!res.ok) {
    // Provider error details can contain numbers or account info, so they are not forwarded or logged.
    throw new HttpError(res.status === 402 || res.status === 403 ? 503 : 502, "provider_error",
      res.status === 402 || res.status === 403
        ? "The fund is empty right now. Please try again later."
        : "The fax service could not accept this fax. Please try again.");
  }
  const data = (await res.json()).data || {};
  return { ok: true, id: data.id, status: data.status || "queued" };
}

async function status(url, env) {
  const id = url.searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "bad_id", "Invalid fax id.");
  const res = await fetch(`${TELNYX}/faxes/${id}`, { headers: { authorization: `Bearer ${env.TELNYX_API_KEY}` } });
  if (!res.ok) throw new HttpError(404, "not_found", "Fax not found.");
  const d = (await res.json()).data || {};
  // Only the status is returned: no numbers, no document, no failure details.
  return { ok: true, status: d.status, failed: d.status === "failed" };
}

async function balance(env) {
  const res = await fetch(`${TELNYX}/balance`, { headers: { authorization: `Bearer ${env.TELNYX_API_KEY}` } });
  if (!res.ok) throw new HttpError(502, "provider_error", "Balance unavailable.");
  const d = (await res.json()).data || {};
  return { ok: true, balance: Number(d.available_credit ?? d.balance ?? 0), currency: d.currency || "USD" };
}

function isPdf(bytes) {
  // %PDF- header within the first 1 KB, as the spec allows.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

// Best effort only: counts /Type /Page objects. PDFs with compressed object streams can undercount,
// so the daily fax cap and Telnyx's own limits are the real safeguards.
function roughPageCount(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  const m = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return m ? m.length : 1;
}

async function verifyTurnstile(token, request, env) {
  if (!token) throw new HttpError(400, "captcha", "Please complete the human check.");
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET);
  body.set("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const out = await res.json().catch(() => ({}));
  if (!out.success) throw new HttpError(400, "captcha", "Human check failed. Please try again.");
}

async function enforceLimits(request, env) {
  const day = new Date().toISOString().slice(0, 10);
  const perIp = Number(env.MAX_FAXES_PER_IP_DAY || 3);
  const perDay = Number(env.MAX_FAXES_PER_DAY || 40);

  // IPs are hashed with a secret salt and only live for a day; the raw address is never stored.
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ipKey = `ip:${day}:${await sha256(`${env.IP_SALT}:${ip}`)}`;
  const dayKey = `day:${day}`;

  const [ipCount, dayCount] = await Promise.all([env.RATE.get(ipKey), env.RATE.get(dayKey)]);
  if (Number(dayCount || 0) >= perDay) throw new HttpError(429, "daily_cap", "We've reached today's free fax limit. Please try again tomorrow.");
  if (Number(ipCount || 0) >= perIp) throw new HttpError(429, "ip_cap", "You've reached the daily limit. Please try again tomorrow.");

  await Promise.all([
    env.RATE.put(ipKey, String(Number(ipCount || 0) + 1), { expirationTtl: 86400 }),
    env.RATE.put(dayKey, String(Number(dayCount || 0) + 1), { expirationTtl: 86400 }),
  ]);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
