import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const STATUS: Record<string, number> = {
  forbidden: 403, read_only: 403, not_found: 404, already_user: 409, already_invited: 409, invalid_email: 400,
};

function viaOAuth(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Array.isArray(payload.amr) && payload.amr.some((a: any) => a.method === "oauth");
  } catch {
    return false;
  }
}

// Invites a person by email. They join the business when they sign in with Google.
// Permission and licence rules live in the database (app_create_invite); this function only authenticates.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const request_id = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const ua = req.headers.get("user-agent");
  const log = (event: string, outcome: string, reason: string | null, actor: string | null = null, detail: unknown = null) =>
    admin.rpc("app_log_event", {
      p_event: event, p_outcome: outcome, p_reason: reason, p_actor_id: actor, p_ip: ip,
      p_user_agent: ua, p_request_id: request_id, p_detail: detail,
    });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: authData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !authData.user) {
      await log("enrol.attempt", "denied", "unauthorized");
      return json({ error: "Unauthorized" }, 401);
    }
    if (!viaOAuth(token)) {
      await log("enrol.attempt", "denied", "not_google", authData.user.id);
      return json({ error: "Please sign in with Google" }, 401);
    }

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const name = String(body.name ?? "").trim();
    if (!name || name.length > 100) return json({ error: "A name (max 100 characters) is required" }, 400);

    // Owners always enrol into their own business; the database ignores a business_id they pass.
    const { data: caller } = await admin.from("users").select("role, business_id").eq("id", authData.user.id).is("deleted_at", null).maybeSingle();
    const businessId = caller?.role === "business_owner" ? caller.business_id : String(body.business_id ?? "");
    if (!businessId) return json({ error: "business_id is required" }, 400);

    const { data, error } = await admin.rpc("app_create_invite", {
      p_actor: authData.user.id, p_business_id: businessId, p_email: String(body.email ?? ""), p_name: name,
      p_phone: body.phone ? String(body.phone).trim() : null,
      p_role: body.role === "business_owner" ? "business_owner" : "user",
      p_ip: ip, p_request_id: request_id, p_user_agent: ua,
    });
    if (error) throw error;
    if (!data.ok) return json({ error: data.message, code: data.code }, STATUS[data.code] ?? 400);
    return json(data, 201);
  } catch (e) {
    await log("enrol.attempt", "failed", "internal_error", null, { message: String((e as any)?.message ?? e) });
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
