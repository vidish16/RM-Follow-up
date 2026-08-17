import { requireAdmin } from "./_requireAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ctx = await requireAdmin(req, res);
  if (!ctx) return; // requireAdmin already sent the error response
  const { admin } = ctx;

  const { fullName, email, tempPassword } = req.body || {};
  if (!fullName || !email || !tempPassword) {
    return res.status(400).json({ error: "fullName, email and tempPassword are required" });
  }
  if (tempPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true, // no confirmation email needed, RM can log in right away
  });
  if (createErr) return res.status(400).json({ error: createErr.message });

  const { error: insertErr } = await admin
    .from("profiles")
    .insert({ id: created.user.id, full_name: fullName, role: "rm" });
  if (insertErr) return res.status(400).json({ error: insertErr.message });

  return res.status(200).json({ ok: true, id: created.user.id });
}
