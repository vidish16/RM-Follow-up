import { requireAdmin } from "./_requireAdmin.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const { admin, callerId, callerName } = ctx;

    const { rmUserId, newPassword } = req.body || {};
    if (!rmUserId || !newPassword) {
      return res.status(400).json({ error: "rmUserId and newPassword are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const { error } = await admin.auth.admin.updateUserById(rmUserId, { password: newPassword });
    if (error) return res.status(400).json({ error: error.message });

    // Force them to set their own password again on next login
    await admin.from("profiles").update({ must_change_password: true }).eq("id", rmUserId);

    const { data: rmProfile } = await admin.from("profiles").select("full_name").eq("id", rmUserId).single();
    await admin.from("activity_log").insert({
      actor_id: callerId, actor_name: callerName, action: "Reset RM password", target: rmProfile?.full_name || rmUserId,
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: `Unexpected server error: ${e.message}` });
  }
}
