/**
 * Relay for finished study sessions: stores each submission in KV first (durable,
 * nothing is lost if mail fails), then emails the CSV to the study inbox via
 * Mailgun. The Mailgun key lives here as a Worker secret — never in the page.
 *
 * POST /submit  { participant_id, submitted_at, n_prompts, n_rated, csv }
 * GET  /health
 */

const MAX_BODY_BYTES = 1_000_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function cors(env, extra = {}) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Study-Token",
    ...extra,
  };
}

function json(env, status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: cors(env, { "Content-Type": "application/json" }),
  });
}

async function sendMail(env, payload) {
  const form = new FormData();
  form.append("from", env.MAIL_FROM || `LARP study <study@${env.MAILGUN_DOMAIN}>`);
  form.append("to", env.MAIL_TO);
  form.append("subject", `LARP RQ2 - ${payload.participant_id}`);
  form.append("text", `Participant ${payload.participant_id} finished at ${payload.submitted_at}: `
    + `${payload.n_rated}/${payload.n_prompts} prompts rated. CSV attached.`);
  form.append("attachment", new Blob([payload.csv], { type: "text/csv" }),
    `larp_${payload.participant_id}.csv`);
  const base = env.MAILGUN_API_BASE || "https://api.eu.mailgun.net";   // EU region default
  const res = await fetch(`${base}/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`api:${env.MAILGUN_API_KEY}`) },
    body: form,
  });
  if (!res.ok) throw new Error(`mailgun ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    if (request.method === "GET" && url.pathname === "/health") return json(env, 200, { ok: true });
    if (request.method !== "POST" || url.pathname !== "/submit") return json(env, 404, { error: "not found" });

    if (env.STUDY_TOKEN && request.headers.get("X-Study-Token") !== env.STUDY_TOKEN) {
      return json(env, 403, { error: "bad token" });
    }
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_BODY_BYTES) return json(env, 413, { error: "too large" });

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json(env, 400, { error: "invalid JSON" });
    }
    if (!payload || !ID_PATTERN.test(String(payload.participant_id || ""))
        || typeof payload.csv !== "string" || !payload.csv.length
        || payload.csv.length > MAX_BODY_BYTES) {
      return json(env, 400, { error: "invalid payload" });
    }

    // Durable first: a submission is safe the moment this write succeeds.
    const key = `${payload.participant_id}/${payload.submitted_at || "unknown"}`;
    await env.RESULTS.put(key, JSON.stringify(payload), {
      metadata: { n_rated: payload.n_rated, n_prompts: payload.n_prompts },
    });

    let mail = "sent";
    try {
      await sendMail(env, payload);
    } catch (err) {
      // Stored but not mailed: still a success for the participant; the copy is
      // in KV and the failure is visible in the Worker logs.
      console.error("mail failed", key, String(err));
      mail = "stored_only";
    }
    return json(env, 200, { ok: true, key, mail });
  },
};
