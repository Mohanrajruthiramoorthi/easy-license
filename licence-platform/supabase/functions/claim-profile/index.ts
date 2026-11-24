import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function viaOAuth(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Array.isArray(payload.amr) && payload.amr.some((a: any) => a.method === "oauth");
  } catch {
    return false;
  }
}

// After a Google sign-in: if the person was invited, create their profile and mark the invite claimed.
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
      await log("invite.claim", "denied", "unauthorized");
      return json({ error: "Unauthorized" }, 401);
    }
    const user = authData.user;
    if (!viaOAuth(token)) {
      await log("invite.claim", "denied", "not_google", user.id);
      return json({ error: "Please sign in with Google" }, 401);
    }
    const email = (user.email ?? "").toLowerCase();
    if (!email || !user.email_confirmed_at) {
      await log("invite.claim", "denied", "email_not_verified", user.id);
      return json({ error: "Your Google email is not verified" }, 403);
    }

    const { data: existing } = await admin.from("users").select("*").eq("id", user.id).is("deleted_at", null).maybeSingle();
    if (existing) return json({ status: "exists", user: existing });

    const meta: any = user.user_metadata ?? {};
    const { data, error } = await admin.rpc("app_claim_invite", {
      p_user_id: user.id, p_email: email, p_name: String(meta.full_name ?? meta.name ?? ""), p_phone: null,
      p_ip: ip, p_request_id: request_id, p_user_agent: ua,
    });
    if (error) throw error;
    if (!data.ok) return json({ status: "none" });

    const { data: row } = await admin.from("users").select("*").eq("id", user.id).maybeSingle();
    return json({ status: "claimed", user: row });
  } catch (e) {
    await log("invite.claim", "failed", "internal_error", null, { message: String((e as any)?.message ?? e) });
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
