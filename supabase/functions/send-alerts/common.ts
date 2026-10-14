import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Returns a client acting as the caller, or null if the caller is not signed in and allowlisted. */
export async function allowedUser(req: Request): Promise<{ client: SupabaseClient; userId: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error } = await client.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (error || !userData?.user) return null;
  // RLS only lets allowlisted users read the allowlist.
  const { data } = await client.from("allowlist").select("email").limit(1);
  if (!data || data.length === 0) return null;
  return { client, userId: userData.user.id };
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}
