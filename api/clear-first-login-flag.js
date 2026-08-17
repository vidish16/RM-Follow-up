import { createClient } from "@supabase/supabase-js";

// Called by a user (RM or admin) right after they successfully set a new
// password on their forced first login. Only ever clears the flag on the
// caller's own row — never touches anyone else's profile.
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return res.status(500).json({ error: "Server is missing Supabase environment variables." });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid or expired session" });

    const admin = createClient(supabaseUrl, serviceKey);
    const { error } = await admin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", userData.user.id);
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: `Unexpected server error: ${e.message}` });
  }
}
