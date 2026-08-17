import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Returns { admin } (a service-role client) if the request's bearer token
// belongs to a logged-in admin. Otherwise writes an error response and
// returns null so the caller can just `return`.
export async function requireAdmin(req, res) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing auth token" });
    return null;
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return null;
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profileErr || profile?.role !== "admin") {
    res.status(403).json({ error: "Admins only" });
    return null;
  }

  return { admin };
}
