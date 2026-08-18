import React, { useState, useEffect, useMemo } from "react";
import {
  Flame, Sun, Snowflake, Plus, X, Phone, Calendar, Clock, LogOut,
  Pencil, Trash2, Check, ShieldCheck, KeyRound, UserPlus, Search, ChevronRight, EyeOff, Eye,
  Undo2, History, RefreshCw, MessageSquare, Upload, Users, ArrowUp, ArrowDown, ArrowUpDown, LogIn,
} from "lucide-react";
import { supabase } from "./supabaseClient";

const ACCENT = "#5B34EA"; // swap for exact UC brand hex/logo whenever you have it

const LEAD_TYPES = {
  Hot: { color: "#E4572E", bg: "#FDEDE7", icon: Flame },
  Warm: { color: "#C8860D", bg: "#FBF1DD", icon: Sun },
  Cold: { color: "#2F70A1", bg: "#E9F1F7", icon: Snowflake },
};

const TIMEFRAMES = ["All", "Today", "Tomorrow", "This Week", "Overdue", "Non-overdue"];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const value = `${String(h).padStart(2, "0")}:00`;
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { value, label: `${h12} ${ap}` };
});

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(t) {
  if (!t) return "";
  const h = parseInt(t.split(":")[0], 10);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
}
function fmtValue(v) {
  return "₹" + Number(v || 0).toLocaleString("en-IN");
}
function fmtDateTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}
async function logActivity(profile, action, target) {
  if (!profile) return;
  try {
    await supabase.from("activity_log").insert({ actor_id: profile.id, actor_name: profile.full_name, action, target: target || null });
  } catch (e) { /* non-fatal — never block the user's actual action over a logging failure */ }
}
function isOverdue(f) {
  if (f.status === "Done") return false;
  const dt = new Date(`${f.follow_up_date}T${f.follow_up_time || "00:00"}`);
  return dt.getTime() < Date.now();
}
function sortByWhen(list) {
  return [...list].sort(
    (a, b) => new Date(`${a.follow_up_date}T${a.follow_up_time || "00:00"}`) -
      new Date(`${b.follow_up_date}T${b.follow_up_time || "00:00"}`)
  );
}
function applySort(list, sortBy) {
  if (sortBy === "amount_desc") return [...list].sort((a, b) => Number(b.quoted_value || 0) - Number(a.quoted_value || 0));
  if (sortBy === "amount_asc") return [...list].sort((a, b) => Number(a.quoted_value || 0) - Number(b.quoted_value || 0));
  return sortByWhen(list);
}
function matchesTimeframe(f, tf) {
  if (tf === "All") return true;
  if (tf === "Overdue") return isOverdue(f);
  if (tf === "Non-overdue") return !isOverdue(f);
  const dt = new Date(`${f.follow_up_date}T00:00:00`);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(startToday); startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startDayAfter = new Date(startToday); startDayAfter.setDate(startDayAfter.getDate() + 2);
  const endWeek = new Date(startToday); endWeek.setDate(endWeek.getDate() + 7);
  if (tf === "Today") return dt >= startToday && dt < startTomorrow;
  if (tf === "Tomorrow") return dt >= startTomorrow && dt < startDayAfter;
  if (tf === "This Week") return dt >= startToday && dt < endWeek;
  return true;
}

/* ---------- Bulk lead import parsing ---------- */
function parseSheetDate(dateStr) {
  const parts = (dateStr || "").trim().split("/");
  if (parts.length !== 3) return null;
  let [m, d, y] = parts.map((p) => p.trim());
  if (y.length === 2) y = "20" + y;
  m = m.padStart(2, "0");
  d = d.padStart(2, "0");
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return null;
  return `${y}-${m}-${d}`;
}
function normalizeLeadType(raw) {
  const t = (raw || "").trim().toLowerCase();
  if (t === "hot") return "Hot";
  if (t === "warm") return "Warm";
  if (t === "cold") return "Cold";
  return null;
}
// Accepts either 6 columns (RM name, CX name, Survey Date, Lead Type, Follow-up Date, Total Quoted GSV)
// or 7 columns (same, with Non-Paid Attribution inserted before Follow-up Date) — whichever your sheet has.
function parseBulkLeads(text, rmProfiles) {
  const rmByName = {};
  rmProfiles.forEach((r) => { rmByName[r.full_name.trim().toLowerCase()] = r; });

  const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
  const delimiter = lines[0]?.includes("\t") ? "\t" : ",";

  const valid = [];
  const invalid = [];

  for (const line of lines) {
    const cols = line.split(delimiter).map((c) => c.trim());
    if (cols[0]?.toLowerCase() === "rm name") continue; // skip header row if pasted
    if (cols.length !== 6 && cols.length !== 7) {
      invalid.push({ line, error: `Expected 6 or 7 columns, found ${cols.length}` });
      continue;
    }

    let rmNameRaw, cxName, surveyDate, leadTypeRaw, attribution, followUpDateRaw, quotedRaw;
    if (cols.length === 7) {
      [rmNameRaw, cxName, surveyDate, leadTypeRaw, attribution, followUpDateRaw, quotedRaw] = cols;
    } else {
      [rmNameRaw, cxName, surveyDate, leadTypeRaw, followUpDateRaw, quotedRaw] = cols;
      attribution = "";
    }

    const rm = rmByName[rmNameRaw.trim().toLowerCase()];
    if (!rm) {
      invalid.push({ line, error: `RM not found: "${rmNameRaw}"` });
      continue;
    }
    const leadType = normalizeLeadType(leadTypeRaw);
    if (!leadType) {
      invalid.push({ line, error: `Invalid lead type: "${leadTypeRaw}" (must be Hot/Warm/Cold)` });
      continue;
    }
    const followUpDate = parseSheetDate(followUpDateRaw);
    if (!followUpDate) {
      invalid.push({ line, error: `Invalid follow-up date: "${followUpDateRaw}" (expected M/D/YYYY)` });
      continue;
    }
    const quotedValue = Number((quotedRaw || "0").replace(/[^0-9.]/g, "")) || 0;

    const commentParts = [];
    if (surveyDate) commentParts.push(`Survey date: ${surveyDate}`);
    if (attribution) commentParts.push(`Reason: ${attribution}`);

    valid.push({
      rm_id: rm.id,
      rm_name: rm.full_name,
      cx_name: cxName || "Unknown",
      contact: "0000000000",
      quoted_value: quotedValue,
      follow_up_date: followUpDate,
      follow_up_time: "11:00:00",
      lead_type: leadType,
      status: "Pending",
      comment: commentParts.join(" · ") || null,
    });
  }
  return { valid, invalid };
}

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid #DDE2E8",
  fontSize: 14.5, fontFamily: "Inter, sans-serif", color: "#14213D", outline: "none", boxSizing: "border-box",
};
const label = { fontSize: 12, fontWeight: 700, color: "#5A6478", marginBottom: 5, display: "block", letterSpacing: "0.02em" };

const fontImport = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; }
    button { font-family: inherit; }
    input:focus, select:focus, textarea:focus { border-color: #14213D !important; }
    .rm-row:hover { background: #F7F8FA; }
  `}</style>
);

function Logo({ size = 34 }) {
  return (
    <img
      src="/uc-logo.png"
      alt="Urban Company"
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, display: "block" }}
    />
  );
}

/* ---------- Funnel chart ----------
   Each stage is an independent centered bar, sized only by its own count.
   (Earlier version chained each band's bottom width into the next band's
   top width, which warped into a diamond/hexagon shape whenever counts
   didn't decrease monotonically — e.g. small or uneven data.) */
function FunnelChart({ counts }) {
  const max = Math.max(counts.Cold, counts.Warm, counts.Hot, 1);
  const minW = 90, maxW = 320;
  const widthFor = (n) => minW + (n / max) * (maxW - minW);
  const stages = [
    { label: "Cold", count: counts.Cold, color: LEAD_TYPES.Cold.color },
    { label: "Warm", count: counts.Warm, color: LEAD_TYPES.Warm.color },
    { label: "Hot", count: counts.Hot, color: LEAD_TYPES.Hot.color },
  ];
  const barH = 56, gap = 12, padTop = 14;
  const totalH = padTop * 2 + barH * 3 + gap * 2;
  return (
    <svg viewBox={`0 0 400 ${totalH}`} style={{ width: "100%", maxWidth: 360, display: "block", margin: "0 auto" }}>
      {stages.map((s, i) => {
        const w = widthFor(s.count);
        const y = padTop + i * (barH + gap);
        const x = 200 - w / 2;
        return (
          <g key={s.label}>
            <rect x={x} y={y} width={w} height={barH} rx={10} fill={s.color} opacity="0.92" />
            <text x={200} y={y + barH / 2 - 3} textAnchor="middle" fontFamily="Sora, sans-serif" fontSize="16" fontWeight="700" fill="#fff">{s.count}</text>
            <text x={200} y={y + barH / 2 + 15} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="10.5" letterSpacing="0.06em" fill="#ffffffcc">{s.label.toUpperCase()}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LeadBadge({ type }) {
  const cfg = LEAD_TYPES[type] || LEAD_TYPES.Warm;
  const Icon = cfg.icon;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, background: cfg.bg, color: cfg.color, fontSize: 12.5, fontWeight: 700 }}>
      <Icon size={12.5} strokeWidth={2.5} /> {type}
    </span>
  );
}

function StatCard({ label: lbl, value, accent }) {
  return (
    <div style={{ flex: "1 1 160px", background: "#F7F8FA", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 11.5, color: "#8891A3", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>{lbl}</div>
      <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: 22, color: accent || "#14213D" }}>{value}</div>
    </div>
  );
}

function UndoToast({ name, onUndo }) {
  return (
    <div style={{ position: "fixed", left: "50%", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)", background: "#14213D", color: "#fff", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 10px 30px #14213D40", zIndex: 9999, maxWidth: "92vw" }}>
      <span style={{ fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Deleted {name}</span>
      <button onClick={onUndo} style={{ display: "flex", alignItems: "center", gap: 5, background: "#ffffff1a", border: "none", borderRadius: 8, padding: "6px 12px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>
        <Undo2 size={14} /> Undo
      </button>
    </div>
  );
}

/* ---------- Analytics ---------- */
function AnalyticsPanel({ followups, totalOverdue }) {
  const [showQuotesByRM, setShowQuotesByRM] = useState(true);
  const totalCount = followups.length;
  const doneCount = followups.filter((f) => f.status === "Done").length;
  const conversionRate = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const openPipeline = followups.filter((f) => f.status !== "Done").reduce((s, f) => s + Number(f.quoted_value || 0), 0);

  const quotesByRM = useMemo(() => {
    const map = {};
    followups.forEach((f) => { map[f.rm_name] = (map[f.rm_name] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [followups]);
  const maxQuotes = Math.max(...quotesByRM.map(([, v]) => v), 1);

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E7EAEF", padding: "18px 18px", marginBottom: 26 }}>
      <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Pipeline insights</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Open pipeline value" value={fmtValue(openPipeline)} />
        <StatCard label="Conversion rate" value={`${conversionRate}%`} />
        <StatCard label="Overdue follow-ups" value={totalOverdue} accent={totalOverdue ? "#C0392B" : undefined} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 12.5, color: "#8891A3", fontWeight: 700 }}>TOTAL QUOTES BY RM</div>
        <button
          onClick={() => setShowQuotesByRM(!showQuotesByRM)}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "1px solid #DDE2E8", borderRadius: 8, padding: "4px 9px", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#5A6478" }}
        >
          {showQuotesByRM ? <EyeOff size={12} /> : <Eye size={12} />}
          {showQuotesByRM ? "Hide" : "Show"}
        </button>
      </div>
      {showQuotesByRM && (
        <>
          {quotesByRM.length === 0 && <div style={{ fontSize: 13, color: "#8891A3" }}>No data yet.</div>}
          {quotesByRM.map(([name, count]) => (
            <div key={name} style={{ marginBottom: 9 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                <span style={{ fontWeight: 700 }}>{name}</span>
                <span style={{ fontFamily: "IBM Plex Mono, monospace" }}>{count}</span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: "#F0F2F5" }}>
                <div style={{ height: 8, borderRadius: 999, background: ACCENT, width: `${(count / maxQuotes) * 100}%` }} />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------- RM detail modal (Admin) ---------- */
function RMDetailModal({ rm, followups, onClose, onEdit, onDelete, onToggleDone }) {
  const list = useMemo(() => sortByWhen(followups.filter((f) => f.rm_name === rm)), [followups, rm]);
  const counts = useMemo(() => {
    const c = { Hot: 0, Warm: 0, Cold: 0 };
    list.forEach((f) => c[f.lead_type]++);
    return c;
  }, [list]);
  const totalValue = useMemo(() => list.reduce((s, f) => s + Number(f.quoted_value || 0), 0), [list]);
  const overdueCount = useMemo(() => list.filter(isOverdue).length, [list]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#14213Db3", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "24px 26px", width: "100%", maxWidth: 660, maxHeight: "86vh", overflowY: "auto", boxShadow: "0 20px 60px #14213D33" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 12, color: "#8891A3", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>RM detail</div>
            <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: 22, color: "#14213D" }}>{rm}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#8891A3" }}><X size={20} /></button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <StatCard label="Total leads" value={list.length} />
          <StatCard label="Pipeline value" value={fmtValue(totalValue)} />
          <StatCard label="Overdue" value={overdueCount} accent={overdueCount ? "#C0392B" : undefined} />
        </div>

        <div style={{ display: "flex", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
          {Object.keys(LEAD_TYPES).map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <LeadBadge type={t} />
              <span style={{ fontWeight: 800, fontFamily: "Sora, sans-serif" }}>{counts[t]}</span>
            </div>
          ))}
        </div>

        {list.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 10px", color: "#8891A3", background: "#F7F8FA", borderRadius: 12 }}>
            No follow-ups for this RM yet.
          </div>
        ) : (
          list.map((f) => (
            <FollowupRow key={f.id} f={f} showRM={false} onEdit={onEdit} onDelete={onDelete} onToggleDone={onToggleDone} />
          ))
        )}
      </div>
    </div>
  );
}

/* ---------- Delete reason modal ---------- */
const DELETE_REASONS = ["Pricing Issue", "Hired from Local/NoBroker", "CNR", "Not interested", "Others"];

function DeleteReasonModal({ record, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  const [otherText, setOtherText] = useState("");
  const [err, setErr] = useState("");

  function confirm() {
    if (!reason) return setErr("Please select a reason.");
    if (reason === "Others" && !otherText.trim()) return setErr("Please specify the reason.");
    onConfirm(reason === "Others" ? `Others — ${otherText.trim()}` : reason);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#14213Db3", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "22px 24px", width: "100%", maxWidth: 380, boxShadow: "0 20px 60px #14213D33" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontFamily: "Sora, sans-serif", fontSize: 17, color: "#14213D" }}>Why delete this lead?</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#8891A3" }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 13, color: "#8891A3", marginBottom: 16 }}>{record.cx_name} · {record.contact}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {DELETE_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => { setReason(r); setErr(""); }}
              style={{
                textAlign: "left", padding: "10px 12px", borderRadius: 9,
                border: reason === r ? "2px solid #C0392B" : "1px solid #DDE2E8",
                background: reason === r ? "#FBEAE8" : "#fff", color: reason === r ? "#C0392B" : "#3A4356",
                fontWeight: 600, fontSize: 13.5, cursor: "pointer",
              }}
            >
              {r}
            </button>
          ))}
        </div>
        {reason === "Others" && (
          <input
            style={{ ...inputStyle, marginBottom: 12 }}
            placeholder="Specify reason"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            autoFocus
          />
        )}
        {err && <div style={{ color: "#C0392B", fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "1px solid #DDE2E8", background: "#fff", color: "#5A6478", fontWeight: 700, cursor: "pointer" }}>Cancel</button>
          <button onClick={confirm} style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "none", background: "#C0392B", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Delete lead</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Filter ribbon ---------- */
function FilterRibbon({ timeframe, setTimeframe, search, setSearch, leadType, setLeadType, status, setStatus, rmFilter, setRmFilter, rmOptions, showRMFilter, sortBy, setSortBy, groupByRM, setGroupByRM }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {TIMEFRAMES.map((tf) => (
          <button key={tf} onClick={() => setTimeframe(tf)} style={{
            padding: "7px 14px", borderRadius: 999, border: timeframe === tf ? "none" : "1px solid #DDE2E8",
            background: timeframe === tf ? "#14213D" : "#fff", color: timeframe === tf ? "#fff" : "#5A6478",
            fontWeight: 700, fontSize: 12.5, cursor: "pointer",
          }}>{tf}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 12, color: "#8891A3" }} />
          <input style={{ ...inputStyle, paddingLeft: 32 }} placeholder="Search customer name or number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {showRMFilter && (
          <select value={rmFilter} onChange={(e) => setRmFilter(e.target.value)} style={{ ...inputStyle, flex: "0 1 160px" }}>
            <option value="All">All RMs</option>
            {rmOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        <select value={leadType} onChange={(e) => setLeadType(e.target.value)} style={{ ...inputStyle, flex: "0 1 130px" }}>
          <option value="All">All types</option>
          <option value="Hot">Hot</option>
          <option value="Warm">Warm</option>
          <option value="Cold">Cold</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, flex: "0 1 140px" }}>
          <option value="All">All statuses</option>
          <option value="Pending">Pending</option>
          <option value="Done">Done</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ ...inputStyle, flex: "0 1 170px" }}>
          <option value="date">Sort: Soonest follow-up</option>
          <option value="amount_desc">Sort: Highest amount</option>
          <option value="amount_asc">Sort: Lowest amount</option>
        </select>
        {showRMFilter && (
          <button
            onClick={() => setGroupByRM(!groupByRM)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 9,
              border: groupByRM ? "none" : "1px solid #DDE2E8", background: groupByRM ? "#14213D" : "#fff",
              color: groupByRM ? "#fff" : "#5A6478", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0,
            }}
          >
            <Users size={14} /> Group by RM
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Add/Edit follow-up modal ---------- */
function FollowupForm({ initial, rmFixed, rmOptions, onCancel, onSave }) {
  const [f, setF] = useState(
    initial
      ? { ...initial }
      : { rm_id: rmFixed?.id || "", rm_name: rmFixed?.full_name || "", cx_name: "", contact: "", quoted_value: "", follow_up_date: "", follow_up_time: "", lead_type: "Warm", comment: "" }
  );
  const [err, setErr] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!f.rm_id || !f.cx_name.trim() || !f.contact.trim() || !f.follow_up_date || !f.follow_up_time) {
      setErr("Please fill in RM, customer name, contact number, date and time.");
      return;
    }
    if (!/^[0-9+\-\s]{7,15}$/.test(f.contact.trim())) {
      setErr("Enter a valid contact number.");
      return;
    }
    setErr("");
    onSave({ ...f, cx_name: f.cx_name.trim(), contact: f.contact.trim() });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#14213Db3", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <form onSubmit={submit} style={{ background: "#fff", borderRadius: 16, padding: "24px 26px", width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px #14213D33" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontFamily: "Sora, sans-serif", fontSize: 19, color: "#14213D" }}>{initial ? "Edit follow-up" : "Add follow-up"}</h3>
          <button type="button" onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#8891A3" }}><X size={20} /></button>
        </div>

        {!rmFixed && (
          <div style={{ marginBottom: 14 }}>
            <label style={label}>RM</label>
            <select
              style={inputStyle}
              value={f.rm_id}
              onChange={(e) => {
                const opt = rmOptions.find((r) => r.id === e.target.value);
                setF({ ...f, rm_id: e.target.value, rm_name: opt?.full_name || "" });
              }}
            >
              <option value="">Select an RM</option>
              {rmOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.full_name}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Customer name</label>
          <input style={inputStyle} value={f.cx_name} onChange={(e) => setF({ ...f, cx_name: e.target.value })} placeholder="e.g. Ramesh Kumar" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={label}>Customer contact number</label>
          <input style={inputStyle} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="e.g. 98765 43210" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={label}>Quoted value (₹)</label>
          <input type="number" min="0" style={inputStyle} value={f.quoted_value} onChange={(e) => setF({ ...f, quoted_value: e.target.value })} placeholder="e.g. 250000" />
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Follow-up date</label>
            <input type="date" style={inputStyle} value={f.follow_up_date} onChange={(e) => setF({ ...f, follow_up_date: e.target.value })} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Follow-up hour</label>
            <select style={inputStyle} value={f.follow_up_time} onChange={(e) => setF({ ...f, follow_up_time: e.target.value })}>
              <option value="">Select hour</option>
              {HOUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={label}>Lead type</label>
          <div style={{ display: "flex", gap: 8 }}>
            {Object.keys(LEAD_TYPES).map((t) => {
              const cfg = LEAD_TYPES[t];
              const active = f.lead_type === t;
              return (
                <button type="button" key={t} onClick={() => setF({ ...f, lead_type: t })}
                  style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: active ? `2px solid ${cfg.color}` : "1px solid #DDE2E8", background: active ? cfg.bg : "#fff", color: cfg.color, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginBottom: 8, marginTop: 14 }}>
          <label style={label}>Comment (optional)</label>
          <textarea
            rows={3}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "Inter, sans-serif" }}
            placeholder="Any notes about this lead…"
            value={f.comment || ""}
            onChange={(e) => setF({ ...f, comment: e.target.value })}
          />
        </div>
        {err && <div style={{ color: "#C0392B", fontSize: 13, margin: "10px 0 0", fontWeight: 600 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onCancel} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "1px solid #DDE2E8", background: "#fff", color: "#5A6478", fontWeight: 700, cursor: "pointer" }}>Cancel</button>
          <button type="submit" style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "none", background: "#14213D", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Save follow-up</button>
        </div>
      </form>
    </div>
  );
}

function FollowupRow({ f, showRM, onEdit, onDelete, onToggleDone }) {
  const overdue = isOverdue(f);
  return (
    <div style={{ padding: "14px 16px", background: "#fff", borderRadius: 12, border: "1px solid #E7EAEF", borderLeft: `4px solid ${overdue ? "#C0392B" : f.status === "Done" ? "#2E8B57" : LEAD_TYPES[f.lead_type].color}`, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button onClick={() => onToggleDone(f)} title={f.status === "Done" ? "Mark pending" : "Mark done"}
          style={{ width: 26, height: 26, borderRadius: "50%", border: f.status === "Done" ? "none" : "2px solid #C7CDD8", background: f.status === "Done" ? "#2E8B57" : "#fff", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          {f.status === "Done" && <Check size={15} strokeWidth={3} />}
        </button>
        <div style={{ flex: "1 1 180px", minWidth: 160 }}>
          <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 15, color: "#14213D" }}>{f.cx_name}</div>
          <div style={{ fontSize: 12.5, color: "#8891A3", display: "flex", alignItems: "center", gap: 4, marginTop: 2, fontFamily: "IBM Plex Mono, monospace" }}>
            <Phone size={11} /> {f.contact}
          </div>
          {showRM && <div style={{ fontSize: 12, color: "#5A6478", marginTop: 3, fontWeight: 600 }}>RM: {f.rm_name}</div>}
        </div>
        <div style={{ minWidth: 110, fontFamily: "IBM Plex Mono, monospace", fontWeight: 700, color: "#14213D", fontSize: 14.5 }}>{fmtValue(f.quoted_value)}</div>
        <div style={{ minWidth: 150, fontSize: 13, color: "#3A4356" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}><Calendar size={12} /> {fmtDate(f.follow_up_date)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, color: "#8891A3" }}><Clock size={12} /> {fmtTime(f.follow_up_time)}</div>
        </div>
        <LeadBadge type={f.lead_type} />
        {overdue && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#C0392B", background: "#FBEAE8", padding: "3px 8px", borderRadius: 999 }}>OVERDUE</span>}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <button onClick={() => onEdit(f)} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid #E7EAEF", background: "#fff", color: "#5A6478", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Pencil size={13} /></button>
          <button onClick={() => onDelete(f.id)} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid #F3D8D5", background: "#fff", color: "#C0392B", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={13} /></button>
        </div>
      </div>
      {f.comment && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #E7EAEF", fontSize: 12.5, color: "#5A6478", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <MessageSquare size={12} style={{ marginTop: 2, flexShrink: 0, color: "#8891A3" }} />
          <span style={{ fontStyle: "italic" }}>{f.comment}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Login screen ---------- */
function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setErr("Incorrect email or password.");
      return;
    }
    onLoggedIn(data.session);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F4F6F8", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 20px", fontFamily: "Inter, sans-serif" }}>
      {fontImport}
      <div style={{ textAlign: "center", marginBottom: 30 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
          <Logo />
          <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: 26, color: "#14213D" }}>Follow-up Funnel</div>
        </div>
        <div style={{ color: "#8891A3", fontSize: 14 }}>Track every lead from cold to closed.</div>
      </div>
      <form onSubmit={submit} style={{ background: "#fff", borderRadius: 16, padding: "28px 26px", width: "100%", maxWidth: 360, border: "1px solid #E7EAEF", boxShadow: "0 4px 14px #14213D0d" }}>
        <label style={label}>Email</label>
        <input style={{ ...inputStyle, marginBottom: 14 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" type="email" />
        <label style={label}>Password</label>
        <input style={{ ...inputStyle, marginBottom: 8 }} value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
        {err && <div style={{ color: "#C0392B", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{err}</div>}
        <button disabled={busy} type="submit" style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: "#14213D", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 10, opacity: busy ? 0.7 : 1 }}>
          {busy ? "Signing in…" : "Log in"}
        </button>
        <div style={{ fontSize: 12, color: "#8891A3", marginTop: 14, textAlign: "center" }}>
          Don't have a login? Ask your admin to create one for you.
        </div>
      </form>
    </div>
  );
}

/* ---------- Forced first-login password change ---------- */
function ForcedPasswordModal({ session, profile, onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setMsg("");
    if (pw.length < 6) return setMsg("Password must be at least 6 characters.");
    if (pw !== pw2) return setMsg("Passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setBusy(false); return setMsg(error.message); }
    try {
      await fetch("/api/clear-first-login-flag", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      });
    } catch (e) { /* non-fatal — worst case they're asked again next login */ }
    logActivity(profile, "Set password (first login)");
    setBusy(false);
    onDone();
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "Inter, sans-serif" }}>
      {fontImport}
      <form onSubmit={submit} style={{ background: "#fff", borderRadius: 16, padding: "28px 26px", width: "100%", maxWidth: 380, border: "1px solid #E7EAEF", boxShadow: "0 4px 14px #14213D0d" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Logo size={30} />
          <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: 18 }}>Set your password</div>
        </div>
        <div style={{ fontSize: 13, color: "#8891A3", marginBottom: 16 }}>For security, choose your own password before continuing. You won't see this again.</div>
        <label style={label}>New password</label>
        <input style={{ ...inputStyle, marginBottom: 12 }} type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <label style={label}>Confirm password</label>
        <input style={{ ...inputStyle, marginBottom: 8 }} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {msg && <div style={{ color: "#C0392B", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{msg}</div>}
        <button disabled={busy} type="submit" style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: "#14213D", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 6 }}>
          {busy ? "Saving…" : "Set password & continue"}
        </button>
      </form>
    </div>
  );
}

/* ---------- Voluntary change-password panel (toggle, not forced) ---------- */
function ChangePasswordPanel({ profile }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setMsg("");
    if (pw.length < 6) return setMsg("Password must be at least 6 characters.");
    if (pw !== pw2) return setMsg("Passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg(error.message);
    logActivity(profile, "Changed password");
    setMsg("Password updated.");
    setPw(""); setPw2("");
  }

  return (
    <form onSubmit={submit} style={{ background: "#fff", borderRadius: 14, border: "1px solid #E7EAEF", padding: "18px 18px", marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <KeyRound size={16} color="#14213D" />
        <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 15 }}>Change my password</div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input style={{ ...inputStyle, flex: "1 1 160px" }} type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <input style={{ ...inputStyle, flex: "1 1 160px" }} type="password" placeholder="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <button disabled={busy} type="submit" style={{ padding: "10px 18px", borderRadius: 9, border: "none", background: "#14213D", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Update</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg === "Password updated." ? "#2E8B57" : "#C0392B", fontWeight: 600 }}>{msg}</div>}
    </form>
  );
}

/* ---------- Activity log (Admin) ---------- */
function actionIcon(action) {
  const a = (action || "").toLowerCase();
  if (a.includes("delete")) return { Icon: Trash2, color: "#C0392B" };
  if (a.includes("bulk")) return { Icon: Upload, color: ACCENT };
  if (a.includes("added")) return { Icon: Plus, color: "#2E8B57" };
  if (a.includes("edited")) return { Icon: Pencil, color: "#5A6478" };
  if (a.includes("done")) return { Icon: Check, color: "#2E8B57" };
  if (a.includes("pending")) return { Icon: RefreshCw, color: "#C8860D" };
  if (a.includes("rm login") || a.includes("created rm")) return { Icon: UserPlus, color: ACCENT };
  if (a.includes("password")) return { Icon: KeyRound, color: "#5A6478" };
  if (a.includes("logged in")) return { Icon: LogIn, color: "#2F70A1" };
  return { Icon: History, color: "#8891A3" };
}

function ActivityLogPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(200);
    setEntries(data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  return (
    <div style={{ position: "fixed", top: 18, right: 18, zIndex: 65 }}>
      <button
        onClick={() => setOpen(!open)}
        title="Activity log"
        style={{ width: 42, height: 42, borderRadius: "50%", background: "#14213D", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 14px #14213D40" }}
      >
        <History size={18} />
      </button>

      {open && (
        <div style={{ position: "absolute", top: 50, right: 0, width: 340, maxWidth: "88vw", maxHeight: 440, overflowY: "auto", background: "#fff", borderRadius: 14, border: "1px solid #E7EAEF", boxShadow: "0 16px 44px #14213D30", padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 14.5 }}>Activity log</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={load} title="Refresh" style={{ display: "flex", alignItems: "center", background: "none", border: "1px solid #DDE2E8", borderRadius: 8, padding: "5px 7px", cursor: "pointer", color: "#5A6478" }}>
                <RefreshCw size={12} />
              </button>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8891A3" }}>
                <X size={16} />
              </button>
            </div>
          </div>

          {loading && <div style={{ fontSize: 13, color: "#8891A3" }}>Loading…</div>}
          {!loading && entries.length === 0 && <div style={{ fontSize: 13, color: "#8891A3" }}>No activity recorded yet.</div>}
          {!loading && entries.map((e) => {
            const { Icon, color } = actionIcon(e.action);
            return (
              <div key={e.id} style={{ display: "flex", gap: 9, padding: "9px 0", borderTop: "1px solid #F0F2F5" }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: `${color}1a`, color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                  <Icon size={12} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5 }}>
                    <span style={{ fontWeight: 700 }}>{e.actor_name}</span>{" "}
                    <span style={{ color: "#5A6478" }}>{e.action.toLowerCase()}</span>
                  </div>
                  {e.target && <div style={{ color: "#8891A3", fontSize: 12, marginTop: 1, wordBreak: "break-word" }}>{e.target}</div>}
                  <div style={{ color: "#B7BECB", fontSize: 11, marginTop: 2 }}>{fmtDateTime(e.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Manage RMs (Admin) ---------- */
function ManageRMs({ rmProfiles, session, onCreated }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPw, setResetPw] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkResults, setBulkResults] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function callApi(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function createRM(e) {
    e.preventDefault();
    setMsg("");
    if (!fullName.trim() || !email.trim()) return setMsg("Fill in name and email.");
    setBusy(true);
    const result = await callApi("/api/create-rm", { fullName: fullName.trim(), email: email.trim() });
    setBusy(false);
    if (result.error) return setMsg(result.error);
    setMsg(`Created login for ${fullName} — password is 123456. They'll be asked to change it on first login.`);
    setFullName(""); setEmail("");
    onCreated();
  }

  async function resetPassword(rm) {
    if (!resetPw || resetPw.length < 6) return setMsg("Enter a new password (6+ characters).");
    setBusy(true);
    const result = await callApi("/api/reset-rm-password", { rmUserId: rm.id, newPassword: resetPw });
    setBusy(false);
    if (result.error) return setMsg(result.error);
    setMsg(`Password reset for ${rm.full_name}. They'll be asked to change it again on next login.`);
    setResetTarget(null); setResetPw("");
  }

  async function bulkCreate() {
    setBulkResults(null); setMsg("");
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    const rms = lines.map((line) => {
      const [n, e] = line.split(",").map((s) => s?.trim());
      return { fullName: n, email: e };
    });
    if (rms.length === 0) return setMsg("Paste at least one line: Full Name, email");
    setBulkBusy(true);
    const result = await callApi("/api/create-rm-bulk", { rms });
    setBulkBusy(false);
    if (result.error) return setMsg(result.error);
    setBulkResults(result.results);
    onCreated();
  }

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E7EAEF", padding: "18px 18px", marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <UserPlus size={16} color="#14213D" />
          <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 15 }}>Manage RM logins</div>
        </div>
        <button onClick={() => setOpen(!open)} style={{ background: "none", border: "1px solid #DDE2E8", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#5A6478" }}>
          {open ? "Close" : "Add / Reset"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, color: "#8891A3", fontWeight: 700, marginBottom: 6 }}>ADD ONE RM (default password: 123456)</div>
          <form onSubmit={createRM} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
            <input style={{ ...inputStyle, flex: "1 1 160px" }} placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <input style={{ ...inputStyle, flex: "1 1 200px" }} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button disabled={busy} type="submit" style={{ padding: "10px 16px", borderRadius: 9, border: "none", background: "#14213D", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Create RM</button>
          </form>

          <div style={{ fontSize: 12.5, color: "#8891A3", fontWeight: 700, marginBottom: 6 }}>BULK CREATE (default password: 123456)</div>
          <textarea rows={4} style={{ ...inputStyle, marginBottom: 8, fontFamily: "IBM Plex Mono, monospace", fontSize: 13 }} placeholder={"One RM per line: Full Name, email\ne.g. Priya Sharma, priya.sharma@company.com"} value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
          <button disabled={bulkBusy} onClick={bulkCreate} style={{ padding: "9px 16px", borderRadius: 9, border: "none", background: ACCENT, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, marginBottom: 8 }}>
            {bulkBusy ? "Creating…" : "Create all"}
          </button>
          {bulkResults && (
            <div style={{ marginBottom: 10 }}>
              {bulkResults.map((r, i) => (
                <div key={i} style={{ fontSize: 12.5, color: r.ok ? "#2E8B57" : "#C0392B", fontWeight: 600 }}>
                  {r.ok ? `✓ ${r.email} created` : `✗ ${r.email}: ${r.error}`}
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 12.5, color: "#8891A3", fontWeight: 700, margin: "14px 0 6px", borderTop: "1px solid #F0F2F5", paddingTop: 14 }}>EXISTING RMs</div>
          {rmProfiles.length === 0 && <div style={{ fontSize: 13, color: "#8891A3" }}>No RMs yet.</div>}
          {rmProfiles.map((rm) => (
            <div key={rm.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid #F0F2F5", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, flex: "1 1 120px" }}>{rm.full_name}</div>
              {resetTarget === rm.id ? (
                <>
                  <input style={{ ...inputStyle, flex: "1 1 140px", padding: "7px 10px" }} placeholder="New password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
                  <button onClick={() => resetPassword(rm)} style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: "#14213D", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12.5 }}>Save</button>
                  <button onClick={() => { setResetTarget(null); setResetPw(""); }} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #DDE2E8", background: "#fff", cursor: "pointer", fontSize: 12.5 }}>Cancel</button>
                </>
              ) : (
                <button onClick={() => setResetTarget(rm.id)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #DDE2E8", background: "#fff", color: "#5A6478", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  Reset password
                </button>
              )}
            </div>
          ))}
          {msg && <div style={{ fontSize: 12.5, marginTop: 10, color: msg.startsWith("Created") || msg.startsWith("Password reset") ? "#2E8B57" : "#C0392B", fontWeight: 600 }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- Bulk upload leads (Admin) ---------- */
function BulkUploadLeads({ profile, rmProfiles, onImported }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);

  async function doImport() {
    setSummary(null);
    const { valid, invalid } = parseBulkLeads(text, rmProfiles);
    if (valid.length === 0 && invalid.length === 0) return;

    setBusy(true);
    let inserted = 0;
    let insertError = null;
    if (valid.length > 0) {
      const { error } = await supabase.from("followups").insert(valid);
      if (error) insertError = error.message;
      else inserted = valid.length;
    }
    setBusy(false);
    setSummary({ inserted, invalid, insertError });
    if (inserted > 0) {
      logActivity(profile, "Bulk imported leads", `${inserted} lead${inserted !== 1 ? "s" : ""}`);
      onImported();
    }
  }

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E7EAEF", padding: "18px 18px", marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Upload size={16} color="#14213D" />
          <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 15 }}>Bulk upload leads</div>
        </div>
        <button onClick={() => setOpen(!open)} style={{ background: "none", border: "1px solid #DDE2E8", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#5A6478" }}>
          {open ? "Close" : "Open"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, color: "#8891A3", marginBottom: 8, lineHeight: 1.5 }}>
            Paste rows straight from your sheet — columns: <strong>RM name, CX name, Survey Date, Lead Type, Follow-up Date, Total Quoted GSV</strong> (a <strong>Non-Paid Attribution</strong> column between Lead Type and Follow-up Date is also fine if your sheet has it).
            Contact number isn't in your sheet, so it defaults to <code>0000000000</code>; follow-up time defaults to <code>11:00 AM</code>. Both are editable per-lead afterward. Survey date and attribution (if present) get saved into the Comment field.
          </div>
          <textarea rows={8} style={{ ...inputStyle, marginBottom: 10, fontFamily: "IBM Plex Mono, monospace", fontSize: 12 }} placeholder="Paste sheet rows here…" value={text} onChange={(e) => setText(e.target.value)} />
          <button disabled={busy || !text.trim()} onClick={doImport} style={{ padding: "10px 18px", borderRadius: 9, border: "none", background: ACCENT, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13.5 }}>
            {busy ? "Importing…" : "Import leads"}
          </button>

          {summary && (
            <div style={{ marginTop: 14 }}>
              {summary.insertError && (
                <div style={{ color: "#C0392B", fontWeight: 600, fontSize: 12.5, marginBottom: 8 }}>Import failed: {summary.insertError}</div>
              )}
              {summary.inserted > 0 && (
                <div style={{ fontSize: 13, fontWeight: 700, color: "#2E8B57", marginBottom: 6 }}>
                  {summary.inserted} lead{summary.inserted !== 1 ? "s" : ""} imported.
                </div>
              )}
              {summary.invalid.length > 0 && (
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#C0392B", marginBottom: 4 }}>
                    {summary.invalid.length} row(s) skipped:
                  </div>
                  {summary.invalid.map((r, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#8891A3", marginBottom: 2, fontFamily: "IBM Plex Mono, monospace" }}>
                      {r.error} — {r.line.slice(0, 70)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Main App ---------- */
export default function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null); // { id, full_name, role, must_change_password }
  const [followups, setFollowups] = useState([]);
  const [rmProfiles, setRmProfiles] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showChangePw, setShowChangePw] = useState(false);
  const [viewingRM, setViewingRM] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(null); // { record, reason, timeoutId }
  const [deleteTarget, setDeleteTarget] = useState(null); // record awaiting a deletion reason

  // RM view filters
  const [rmTimeframe, setRmTimeframe] = useState("All");
  const [rmSearch, setRmSearch] = useState("");
  const [rmLeadType, setRmLeadType] = useState("All");
  const [rmStatus, setRmStatus] = useState("All");
  const [rmSortBy, setRmSortBy] = useState("date");

  // Admin view filters
  const [filterTimeframe, setFilterTimeframe] = useState("All");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterRM, setFilterRM] = useState("All");
  const [filterType, setFilterType] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterSortBy, setFilterSortBy] = useState("date");
  const [groupByRM, setGroupByRM] = useState(false);
  const [breakdownSort, setBreakdownSort] = useState({ col: "rm_name", dir: "asc" });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) loadProfile(data.session);
      else setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (sess) loadProfile(sess);
      else { setSession(null); setProfile(null); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadProfile(sess, opts = {}) {
    setSession(sess);
    const { data } = await supabase.from("profiles").select("*").eq("id", sess.user.id).single();
    setProfile(data);
    setLoading(false);
    if (opts.logLogin && data) logActivity(data, "Logged in");
  }

  async function loadFollowups() {
    const { data } = await supabase.from("followups").select("*");
    setFollowups(data || []);
  }
  async function loadRmProfiles() {
    const { data } = await supabase.from("profiles").select("*").eq("role", "rm").order("full_name");
    setRmProfiles(data || []);
  }

  useEffect(() => {
    if (profile && !profile.must_change_password) {
      loadFollowups();
      if (profile.role === "admin") loadRmProfiles();
    }
  }, [profile]);

  async function handleSave(data) {
    if (editing) {
      await supabase.from("followups").update(data).eq("id", editing.id);
      logActivity(profile, "Edited follow-up", `${data.cx_name} (${data.rm_name})`);
    } else {
      await supabase.from("followups").insert(data);
      logActivity(profile, "Added follow-up", `${data.cx_name} (${data.rm_name})`);
    }
    setShowForm(false); setEditing(null);
    loadFollowups();
  }

  // Delete is undo-able: the row disappears immediately, but the actual
  // database delete is delayed a few seconds so "Undo" can cancel it.
  async function commitDelete(record, reason) {
    await supabase.from("followups").delete().eq("id", record.id);
    logActivity(profile, "Deleted follow-up", `${record.cx_name} (${record.rm_name}) — Reason: ${reason}`);
  }
  function handleDelete(id) {
    const record = followups.find((f) => f.id === id);
    if (!record) return;
    setDeleteTarget(record);
  }
  function confirmDeleteWithReason(reason) {
    const record = deleteTarget;
    setDeleteTarget(null);
    if (pendingDelete) {
      clearTimeout(pendingDelete.timeoutId);
      commitDelete(pendingDelete.record, pendingDelete.reason);
    }
    setFollowups((prev) => prev.filter((f) => f.id !== record.id));
    const timeoutId = setTimeout(() => {
      commitDelete(record, reason);
      setPendingDelete((curr) => (curr && curr.record.id === record.id ? null : curr));
    }, 8000);
    setPendingDelete({ record, reason, timeoutId });
  }
  function handleUndoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timeoutId);
    setFollowups((prev) => [...prev, pendingDelete.record]);
    setPendingDelete(null);
  }

  async function handleToggleDone(f) {
    const newStatus = f.status === "Done" ? "Pending" : "Done";
    await supabase.from("followups").update({ status: newStatus }).eq("id", f.id);
    logActivity(profile, newStatus === "Done" ? "Marked follow-up done" : "Marked follow-up pending", `${f.cx_name} (${f.rm_name})`);
    loadFollowups();
  }
  async function logout() {
    await supabase.auth.signOut();
  }

  const rmFollowupsFiltered = useMemo(() => {
    if (!profile) return [];
    let list = followups.filter((f) => f.rm_id === profile.id);
    list = list.filter((f) => matchesTimeframe(f, rmTimeframe));
    if (rmSearch.trim()) {
      const q = rmSearch.trim().toLowerCase();
      list = list.filter((f) => f.cx_name.toLowerCase().includes(q) || f.contact.includes(q));
    }
    if (rmLeadType !== "All") list = list.filter((f) => f.lead_type === rmLeadType);
    if (rmStatus !== "All") list = list.filter((f) => f.status === rmStatus);
    return applySort(list, rmSortBy);
  }, [followups, profile, rmTimeframe, rmSearch, rmLeadType, rmStatus, rmSortBy]);

  const rmCounts = useMemo(() => {
    const c = { Hot: 0, Warm: 0, Cold: 0 };
    if (!profile) return c;
    followups.filter((f) => f.rm_id === profile.id).forEach((f) => c[f.lead_type]++);
    return c;
  }, [followups, profile]);

  const adminFiltered = useMemo(() => {
    let list = followups;
    list = list.filter((f) => matchesTimeframe(f, filterTimeframe));
    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase();
      list = list.filter((f) => f.cx_name.toLowerCase().includes(q) || f.contact.includes(q));
    }
    if (filterRM !== "All") list = list.filter((f) => f.rm_name === filterRM);
    if (filterType !== "All") list = list.filter((f) => f.lead_type === filterType);
    if (filterStatus !== "All") list = list.filter((f) => f.status === filterStatus);
    return applySort(list, filterSortBy);
  }, [followups, filterTimeframe, filterSearch, filterRM, filterType, filterStatus, filterSortBy]);

  // Grouped view: each RM's leads always ordered soonest-first, regardless
  // of the sort dropdown above (which only governs the flat, ungrouped list).
  const adminGroupedByRM = useMemo(() => {
    const map = {};
    adminFiltered.forEach((f) => {
      if (!map[f.rm_name]) map[f.rm_name] = [];
      map[f.rm_name].push(f);
    });
    Object.keys(map).forEach((name) => { map[name] = sortByWhen(map[name]); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [adminFiltered]);

  const allCounts = useMemo(() => {
    const c = { Hot: 0, Warm: 0, Cold: 0 };
    followups.forEach((f) => c[f.lead_type]++);
    return c;
  }, [followups]);

  const perRM = useMemo(() => {
    const map = {};
    rmProfiles.forEach((r) => (map[r.full_name] = { Hot: 0, Warm: 0, Cold: 0, total: 0, overdue: 0 }));
    followups.forEach((f) => {
      if (!map[f.rm_name]) map[f.rm_name] = { Hot: 0, Warm: 0, Cold: 0, total: 0, overdue: 0 };
      map[f.rm_name][f.lead_type]++;
      map[f.rm_name].total++;
      if (isOverdue(f)) map[f.rm_name].overdue++;
    });
    return map;
  }, [followups, rmProfiles]);

  const totalOverdue = useMemo(() => Object.values(perRM).reduce((s, c) => s + c.overdue, 0), [perRM]);

  const sortedPerRM = useMemo(() => {
    const entries = Object.entries(perRM);
    const { col, dir } = breakdownSort;
    const mult = dir === "asc" ? 1 : -1;
    entries.sort((a, b) => {
      if (col === "rm_name") return a[0].localeCompare(b[0]) * mult;
      return (a[1][col] - b[1][col]) * mult;
    });
    return entries;
  }, [perRM, breakdownSort]);

  function toggleBreakdownSort(col) {
    setBreakdownSort((prev) => (prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }));
  }

  const shell = { minHeight: "100vh", background: "#F4F6F8", fontFamily: "Inter, sans-serif", color: "#14213D" };

  if (loading) {
    return <div style={{ ...shell, display: "flex", alignItems: "center", justifyContent: "center" }}>{fontImport}<div style={{ color: "#8891A3" }}>Loading…</div></div>;
  }

  if (!session || !profile) {
    return <LoginScreen onLoggedIn={(sess) => loadProfile(sess, { logLogin: true })} />;
  }

  if (profile.must_change_password) {
    return <ForcedPasswordModal session={session} profile={profile} onDone={() => setProfile({ ...profile, must_change_password: false })} />;
  }

  /* ---------- RM VIEW ---------- */
  if (profile.role === "rm") {
    return (
      <div style={shell}>
        {fontImport}
        <div style={{ maxWidth: 780, margin: "0 auto", padding: "26px 18px 60px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Logo />
              <div>
                <div style={{ fontSize: 12.5, color: "#8891A3", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>RM profile</div>
                <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: 23 }}>{profile.full_name}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => { setEditing(null); setShowForm(true); }} style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 16px", borderRadius: 10, border: "none", background: "#14213D", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13.5 }}>
                <Plus size={15} /> Add follow-up
              </button>
              <button onClick={() => setShowChangePw(!showChangePw)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, border: "1px solid #DDE2E8", background: "#fff", color: "#5A6478", fontWeight: 600, cursor: "pointer", fontSize: 13.5 }}>
                <KeyRound size={14} /> Password
              </button>
              <button onClick={logout} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, border: "1px solid #DDE2E8", background: "#fff", color: "#5A6478", fontWeight: 600, cursor: "pointer", fontSize: 13.5 }}>
                <LogOut size={14} /> Log out
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
            {Object.keys(LEAD_TYPES).map((t) => (
              <div key={t} style={{ flex: "1 1 100px", background: "#fff", border: "1px solid #E7EAEF", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ marginBottom: 4 }}><LeadBadge type={t} /></div>
                <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: 22 }}>{rmCounts[t]}</div>
              </div>
            ))}
          </div>

          {showChangePw && <ChangePasswordPanel profile={profile} />}

          <FilterRibbon
            timeframe={rmTimeframe} setTimeframe={setRmTimeframe}
            search={rmSearch} setSearch={setRmSearch}
            leadType={rmLeadType} setLeadType={setRmLeadType}
            status={rmStatus} setStatus={setRmStatus}
            sortBy={rmSortBy} setSortBy={setRmSortBy}
            showRMFilter={false}
          />

          {rmFollowupsFiltered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 20px", color: "#8891A3", background: "#fff", borderRadius: 14, border: "1px dashed #DDE2E8" }}>
              No follow-ups match. Add one, or adjust the filters above.
            </div>
          ) : (
            rmFollowupsFiltered.map((f) => (
              <FollowupRow key={f.id} f={f} showRM={false} onEdit={(rec) => { setEditing(rec); setShowForm(true); }} onDelete={handleDelete} onToggleDone={handleToggleDone} />
            ))
          )}
        </div>

        {showForm && (
          <FollowupForm initial={editing} rmFixed={profile} rmOptions={[]} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={handleSave} />
        )}

        {deleteTarget && (
          <DeleteReasonModal record={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDeleteWithReason} />
        )}

        {pendingDelete && <UndoToast name={pendingDelete.record.cx_name} onUndo={handleUndoDelete} />}
      </div>
    );
  }

  /* ---------- ADMIN VIEW ---------- */
  return (
    <div style={shell}>
      {fontImport}
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "26px 18px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Logo />
            <div>
              <div style={{ fontSize: 12.5, color: "#8891A3", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Admin — viewed by me</div>
              <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: 23 }}>All RM follow-ups</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => { setEditing(null); setShowForm(true); }} style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 16px", borderRadius: 10, border: "none", background: "#14213D", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13.5 }}>
              <Plus size={15} /> Add follow-up
            </button>
            <button onClick={() => setShowChangePw(!showChangePw)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, border: "1px solid #DDE2E8", background: "#fff", color: "#5A6478", fontWeight: 600, cursor: "pointer", fontSize: 13.5 }}>
              <KeyRound size={14} /> Password
            </button>
            <button onClick={logout} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, border: "1px solid #DDE2E8", background: "#fff", color: "#5A6478", fontWeight: 600, cursor: "pointer", fontSize: 13.5 }}>
              <LogOut size={14} /> Log out
            </button>
          </div>
        </div>

        {showChangePw && <ChangePasswordPanel profile={profile} />}

        <ManageRMs rmProfiles={rmProfiles} session={session} onCreated={loadRmProfiles} />

        <BulkUploadLeads profile={profile} rmProfiles={rmProfiles} onImported={loadFollowups} />

        <ActivityLogPanel />

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 26 }}>
          <div style={{ flex: "1 1 340px", background: "#14213D", borderRadius: 16, padding: "20px 16px" }}>
            <FunnelChart counts={allCounts} />
          </div>
          <div style={{ flex: "2 1 400px", background: "#fff", borderRadius: 16, border: "1px solid #E7EAEF", padding: "16px 18px", overflowX: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 15 }}>Per-RM breakdown</div>
              <button
                onClick={() => setShowBreakdown(!showBreakdown)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #DDE2E8", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#5A6478" }}
              >
                {showBreakdown ? <EyeOff size={13} /> : <Eye size={13} />}
                {showBreakdown ? "Hide" : "Show"}
              </button>
            </div>
            {showBreakdown && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#8891A3", textAlign: "left" }}>
                  {[
                    { key: "rm_name", label: "RM" },
                    { key: "Hot", label: "Hot" },
                    { key: "Warm", label: "Warm" },
                    { key: "Cold", label: "Cold" },
                    { key: "total", label: "Total" },
                    { key: "overdue", label: "Overdue" },
                  ].map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleBreakdownSort(col.key)}
                      style={{ padding: "6px 8px", fontWeight: 600, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {col.label}
                        {breakdownSort.col === col.key ? (
                          breakdownSort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                        ) : (
                          <ArrowUpDown size={12} style={{ opacity: 0.35 }} />
                        )}
                      </span>
                    </th>
                  ))}
                  <th style={{ padding: "6px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {sortedPerRM.length === 0 && (
                  <tr><td colSpan="7" style={{ padding: "14px 8px", color: "#8891A3" }}>No RM data yet.</td></tr>
                )}
                {sortedPerRM.map(([name, c]) => (
                  <tr key={name} className="rm-row" onClick={() => setViewingRM(name)} style={{ borderTop: "1px solid #F0F2F5", cursor: "pointer" }}>
                    <td style={{ padding: "8px", fontWeight: 700 }}>{name}</td>
                    <td style={{ padding: "8px", color: LEAD_TYPES.Hot.color, fontWeight: 700 }}>{c.Hot}</td>
                    <td style={{ padding: "8px", color: LEAD_TYPES.Warm.color, fontWeight: 700 }}>{c.Warm}</td>
                    <td style={{ padding: "8px", color: LEAD_TYPES.Cold.color, fontWeight: 700 }}>{c.Cold}</td>
                    <td style={{ padding: "8px", fontWeight: 700 }}>{c.total}</td>
                    <td style={{ padding: "8px", color: c.overdue ? "#C0392B" : "#8891A3", fontWeight: 700 }}>{c.overdue}</td>
                    <td style={{ padding: "8px", color: "#C7CDD8" }}><ChevronRight size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        </div>

        <AnalyticsPanel followups={followups} totalOverdue={totalOverdue} />

        <FilterRibbon
          timeframe={filterTimeframe} setTimeframe={setFilterTimeframe}
          search={filterSearch} setSearch={setFilterSearch}
          leadType={filterType} setLeadType={setFilterType}
          status={filterStatus} setStatus={setFilterStatus}
          rmFilter={filterRM} setRmFilter={setFilterRM}
          rmOptions={rmProfiles.map((r) => r.full_name)}
          showRMFilter={true}
          sortBy={filterSortBy} setSortBy={setFilterSortBy}
          groupByRM={groupByRM} setGroupByRM={setGroupByRM}
        />

        {adminFiltered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "50px 20px", color: "#8891A3", background: "#fff", borderRadius: 14, border: "1px dashed #DDE2E8" }}>
            No follow-ups match these filters.
          </div>
        ) : groupByRM ? (
          adminGroupedByRM.map(([rmName, leads]) => (
            <div key={rmName} style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 4px", marginBottom: 8 }}>
                <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 14.5, color: "#14213D" }}>{rmName}</div>
                <div style={{ fontSize: 12, color: "#8891A3", fontWeight: 600 }}>{leads.length} lead{leads.length !== 1 ? "s" : ""}</div>
              </div>
              {leads.map((f) => (
                <FollowupRow key={f.id} f={f} showRM={false} onEdit={(rec) => { setEditing(rec); setShowForm(true); }} onDelete={handleDelete} onToggleDone={handleToggleDone} />
              ))}
            </div>
          ))
        ) : (
          adminFiltered.map((f) => (
            <FollowupRow key={f.id} f={f} showRM={true} onEdit={(rec) => { setEditing(rec); setShowForm(true); }} onDelete={handleDelete} onToggleDone={handleToggleDone} />
          ))
        )}
      </div>

      {showForm && (
        <FollowupForm initial={editing} rmFixed={null} rmOptions={rmProfiles} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={handleSave} />
      )}

      {viewingRM && (
        <RMDetailModal
          rm={viewingRM}
          followups={followups}
          onClose={() => setViewingRM(null)}
          onEdit={(rec) => { setEditing(rec); setShowForm(true); setViewingRM(null); }}
          onDelete={handleDelete}
          onToggleDone={handleToggleDone}
        />
      )}

      {deleteTarget && (
        <DeleteReasonModal record={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDeleteWithReason} />
      )}

      {pendingDelete && <UndoToast name={pendingDelete.record.cx_name} onUndo={handleUndoDelete} />}
    </div>
  );
}
