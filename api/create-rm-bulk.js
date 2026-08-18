import { requireAdmin } from "./_requireAdmin.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const { admin, callerId, callerName } = ctx;

    const { rms } = req.body || {};
    if (!Array.isArray(rms) || rms.length === 0) {
      return res.status(400).json({ error: "Provide a non-empty list of RMs" });
    }

    const results = [];
    for (const rm of rms) {
      const fullName = (rm.fullName || "").trim();
      const email = (rm.email || "").trim();

      if (!fullName || !email) {
        results.push({ email: email || "(blank)", ok: false, error: "Missing name or email" });
        continue;
      }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: "123456",
        email_confirm: true,
      });
      if (createErr) {
        results.push({ email, ok: false, error: createErr.message });
        continue;
      }

      const { error: insertErr } = await admin
        .from("profiles")
        .insert({ id: created.user.id, full_name: fullName, role: "rm", must_change_password: true });
      if (insertErr) {
        results.push({ email, ok: false, error: insertErr.message });
        continue;
      }

      results.push({ email, ok: true });
    }

    const createdCount = results.filter((r) => r.ok).length;
    if (createdCount > 0) {
      await admin.from("activity_log").insert({
        actor_id: callerId, actor_name: callerName, action: "Bulk-created RM logins", target: `${createdCount} RM(s)`,
      });
    }

    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: `Unexpected server error: ${e.message}` });
  }
}
