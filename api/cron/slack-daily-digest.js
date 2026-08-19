import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const cronSecret = process.env.CRON_SECRET;
// Comma-separated list of admin emails who should get the full (all-RMs) digest.
// e.g. SLACK_ADMIN_EMAILS = "vidish@urbancompany.com,anotheradmin@urbancompany.com"
const adminEmails = (process.env.SLACK_ADMIN_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);

// India is UTC+5:30 year-round (no daylight saving), so this is a fixed offset.
function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function fmtHour(t) {
  if (!t) return "";
  const h = parseInt(t.split(":")[0], 10);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${ap}`;
}
function leadLine(f) {
  return `• *${f.cx_name}* (${f.contact}) — ${fmtHour(f.follow_up_time)} — ${f.lead_type} — ₹${Number(f.quoted_value || 0).toLocaleString("en-IN")}`;
}
async function slackLookupByEmail(email) {
  const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${slackBotToken}` },
  });
  return res.json();
}
async function slackDM(userId, text) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${slackBotToken}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: userId, text }),
  });
  return res.json();
}

export default async function handler(req, res) {
  try {
    if (!cronSecret || req.headers["x-cron-secret"] !== cronSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ error: "Server is missing Supabase environment variables." });
    }
    if (!slackBotToken) {
      return res.status(500).json({ error: "Server is missing SLACK_BOT_TOKEN." });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const date = todayIST();

    const { data: due, error } = await admin
      .from("followups")
      .select("*")
      .eq("follow_up_date", date)
      .eq("status", "Pending");

    if (error) return res.status(500).json({ error: error.message });

    const results = [];
    if (!due || due.length === 0) {
      return res.status(200).json({ ok: true, date, message: "No pending follow-ups today.", results });
    }

    const byRM = {};
    for (const f of due) {
      if (!byRM[f.rm_id]) byRM[f.rm_id] = { rm_name: f.rm_name, items: [] };
      byRM[f.rm_id].items.push(f);
    }
    Object.values(byRM).forEach((g) => g.items.sort((a, b) => (a.follow_up_time || "").localeCompare(b.follow_up_time || "")));

    // Each RM gets just their own list
    for (const [rmId, group] of Object.entries(byRM)) {
      try {
        const { data: userData, error: userErr } = await admin.auth.admin.getUserById(rmId);
        if (userErr || !userData?.user?.email) {
          results.push({ rm: group.rm_name, ok: false, error: "Could not find this RM's email" });
          continue;
        }
        const lookup = await slackLookupByEmail(userData.user.email);
        if (!lookup.ok) {
          results.push({ rm: group.rm_name, ok: false, error: `Slack lookup failed: ${lookup.error}` });
          continue;
        }
        const text =
          `:sunny: *Good morning! Your follow-ups for today (${date})*\n` +
          `You have *${group.items.length}* pending follow-up${group.items.length > 1 ? "s" : ""}:\n` +
          group.items.map(leadLine).join("\n");
        const post = await slackDM(lookup.user.id, text);
        results.push({ rm: group.rm_name, ok: post.ok, error: post.ok ? undefined : post.error, count: group.items.length });
      } catch (e) {
        results.push({ rm: group.rm_name, ok: false, error: e.message });
      }
    }

    // Named admins get the full digest across all RMs
    if (adminEmails.length > 0) {
      const fullText =
        `:bar_chart: *Full follow-up digest — ${date}*\n\n` +
        Object.values(byRM)
          .map((g) => `*${g.rm_name}* (${g.items.length}):\n${g.items.map(leadLine).join("\n")}`)
          .join("\n\n");

      for (const email of adminEmails) {
        try {
          const lookup = await slackLookupByEmail(email);
          if (!lookup.ok) {
            results.push({ admin: email, ok: false, error: `Slack lookup failed: ${lookup.error}` });
            continue;
          }
          const post = await slackDM(lookup.user.id, fullText);
          results.push({ admin: email, ok: post.ok, error: post.ok ? undefined : post.error });
        } catch (e) {
          results.push({ admin: email, ok: false, error: e.message });
        }
      }
    }

    return res.status(200).json({ ok: true, date, results });
  } catch (e) {
    return res.status(500).json({ error: `Unexpected server error: ${e.message}` });
  }
}
