import { createClient } from "npm:@supabase/supabase-js@2";

const TRIAL_DAYS = 14;
const MAX_ATTEMPTS = 5; // per IP
const WINDOW_MINUTES = 60; // per hour

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const STATUS: Record<string, number> = {
  rate_limited: 429, already_registered: 409, has_invite: 409, invalid_input: 400,
};

function viaOAuth(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Array.isArray(payload.amr) && payload.amr.some((a: any) => a.method === "oauth");
  } catch {
    return false;
  }
}

// 9840011223, 09840011223, 919840011223 or +919840011223 -> +919840011223
function normalisePhone(raw: string): string | null {
  const s = raw.replace(/[\s()-]/g, "");
  if (/^\+[0-9]{8,15}$/.test(s)) return s;
  if (/^0?[6-9][0-9]{9}$/.test(s)) return "+91" + s.slice(-10);
  if (/^91[6-9][0-9]{9}$/.test(s)) return "+" + s;
  return null;
}

// A person signed in with Google registers their own business: they become its owner and get a trial licence.
// Every outcome (including refusals) is written to event_log; business data changes land in audit_log.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const request_id = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const ua = req.headers.get("user-agent");
  const log = (event: string, outcome: string, reason: string | null, user_id: string | null = null, detail: unknown = null) =>
    admin.rpc("app_log_event", {
      p_event: event, p_outcome: outcome, p_reason: reason, p_user_id: user_id, p_ip: ip,
      p_user_agent: ua, p_request_id: request_id, p_detail: detail,
    });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: authData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !authData.user) {
      await log("register.attempt", "denied", "unauthorized");
      return json({ error: "Unauthorized" }, 401);
    }
    const user = authData.user;
    if (!viaOAuth(token)) {
      await log("register.attempt", "denied", "not_google", user.id);
      return json({ error: "Please sign in with Google" }, 401);
    }
    const email = (user.email ?? "").toLowerCase();
    if (!email || !user.email_confirmed_at) {
      await log("register.attempt", "denied", "email_not_verified", user.id);
      return json({ error: "Your Google email is not verified" }, 403);
    }

    const { data: rl, error: rlErr } = await admin.rpc("app_rate_limit", {
      p_bucket: "register", p_key: ip, p_limit: MAX_ATTEMPTS, p_window_minutes: WINDOW_MINUTES,
    });
    if (rlErr) throw rlErr;
    if (!rl.ok) {
      await log("register.attempt", "blocked", "rate_limited", user.id);
      return json({ error: "Too many attempts. Please try again in an hour." }, 429);
    }

    let body: any;
    try { body = await req.json(); } catch {
      await log("register.attempt", "failed", "invalid_json", user.id);
      return json({ error: "Invalid JSON" }, 400);
    }
    const businessName = String(body.business_name ?? "").trim();
    const meta: any = user.user_metadata ?? {};
    const name = String(body.name ?? meta.full_name ?? meta.name ?? email.split("@")[0]).trim();
    if (!businessName || !name || name.length > 100 || businessName.length > 100) {
      await log("register.attempt", "failed", "invalid_input", user.id);
      return json({ error: "Business name and your name are required (max 100 characters)" }, 400);
    }
    const phone = normalisePhone(String(body.phone ?? ""));
    if (!phone) {
      await log("register.attempt", "failed", "invalid_phone", user.id);
      return json({ error: "Enter a valid phone number, for example 9840011223 or +919840011223" }, 400);
    }

    const { data, error } = await admin.rpc("app_register_business", {
      p_user_id: user.id, p_name: name, p_email: email, p_phone: phone, p_business_name: businessName,
      p_trial_days: TRIAL_DAYS, p_ip: ip, p_request_id: request_id, p_user_agent: ua,
    });
    if (error) throw error;
    if (!data.ok) return json({ error: data.message, code: data.code }, STATUS[data.code] ?? 400);
    return json(data, 201);
  } catch (e) {
    await log("register.attempt", "failed", "internal_error", null, { message: String((e as any)?.message ?? e) });
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
