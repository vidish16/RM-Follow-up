import { requireAdmin } from "./_requireAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const { admin } = ctx;

  const { rmUserId, newPassword } = req.body || {};
  if (!rmUserId || !newPassword) {
    return res.status(400).json({ error: "rmUserId and newPassword are required" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const { error } = await admin.auth.admin.updateUserById(rmUserId, { password: newPassword });
  if (error) return res.status(400).json({ error: error.message });

  return res.status(200).json({ ok: true });
}
