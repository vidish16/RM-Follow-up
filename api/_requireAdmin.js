import { createClient } from "@supabase/supabase-js";

// Returns { admin } (a service-role client) if the request's bearer token
// belongs to a logged-in admin. Otherwise writes an error response and
// returns null so the caller can just `return`. Never throws — every
// failure path returns clean JSON instead of crashing the function.
export async function requireAdmin(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const missing = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL (or VITE_SUPABASE_URL)");
    if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");
    if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length) {
      res.status(500).json({
        error: `Server is missing environment variable(s): ${missing.join(", ")}. Set them in Vercel → Settings → Environment Variables, then redeploy.`,
      });
      return null;
    }

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

    if (profileErr) {
      res.status(500).json({ error: `Could not read profile: ${profileErr.message}` });
      return null;
    }
    if (profile?.role !== "admin") {
      res.status(403).json({ error: "Admins only" });
      return null;
    }

    return { admin };
  } catch (e) {
    res.status(500).json({ error: `Unexpected server error: ${e.message}` });
    return null;
  }
}
