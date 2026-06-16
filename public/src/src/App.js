import { useState, useCallback } from "react";

// ── DEPARTMENTS ───────────────────────────────────────────────────────────────
const DEPARTMENTS = [
  { id: "finance",             label: "Finance",              icon: "💰", color: "#10b981" },
  { id: "it",                  label: "IT",                   icon: "💻", color: "#6366f1" },
  { id: "product",             label: "Product",              icon: "📦", color: "#f59e0b" },
  { id: "hr",                  label: "HR",                   icon: "👥", color: "#ec4899" },
  { id: "marketing",           label: "Marketing",            icon: "📣", color: "#8b5cf6" },
  { id: "strategy_consulting", label: "Strategy & Consulting",icon: "🎯", color: "#0ea5e9" },
  { id: "customer_support",    label: "Customer Support",     icon: "🎧", color: "#14b8a6" },
  { id: "sales",               label: "Sales",                icon: "📈", color: "#f97316" },
  { id: "operations",          label: "Operations",           icon: "⚙️", color: "#64748b" },
  { id: "legal",               label: "Legal",                icon: "⚖️", color: "#a78bfa" },
  { id: "other",               label: "Other",                icon: "📁", color: "#94a3b8" },
];

const getDept = (id) => DEPARTMENTS.find((d) => d.id === id) || DEPARTMENTS.at(-1);

// ── AI PROMPT ─────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert CV/Resume analyst. Analyze the CV and extract structured data.
Return ONLY a valid JSON object, no markdown, no extra text:
{
  "name": "Full Name or null",
  "email": "email or null",
  "phone": "phone number or null",
  "years_of_experience": number or null,
  "current_role": "Job Title or null",
  "current_company": "Company Name or null",
  "department": "one of: finance, it, product, hr, marketing, strategy_consulting, customer_support, sales, operations, legal, other",
  "skills": ["skill1", "skill2"],
  "education": "Highest degree and institution or null",
  "location": "City, Country or null",
  "summary": "2-sentence professional summary",
  "classification_reason": "Brief reason why this department was chosen"
}
Department rules: finance=accountants/bankers/CFO/auditors, it=developers/engineers/sysadmin/data/ML, product=PMs/UX/designers, hr=recruiters/people ops/talent, marketing=digital/brand/growth/content, strategy_consulting=consultants/business analysts/strategy, customer_support=support agents/customer success/helpdesk, sales=AEs/BDRs/account managers/business dev, operations=ops managers/supply chain/logistics/project managers, legal=lawyers/compliance/paralegals, other=anything else.`;

// ── ZIP BUILDER (no external library) ────────────────────────────────────────
function crc32(data) {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function buildZip(files) {
  const enc = new TextEncoder();
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; };

  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const localHeader = new Uint8Array([
      0x50,0x4B,0x03,0x04, 0x14,0x00, 0x00,0x00, 0x00,0x00,
      0x00,0x00,0x00,0x00,
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), 0x00,0x00,
      ...nameBytes,
    ]);
    const cdEntry = new Uint8Array([
      0x50,0x4B,0x01,0x02, 0x14,0x00, 0x14,0x00, 0x00,0x00, 0x00,0x00,
      0x00,0x00,0x00,0x00,
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), 0x00,0x00, 0x00,0x00, 0x00,0x00, 0x00,0x00,0x00,0x00,
      ...u32(offset), ...nameBytes,
    ]);

    parts.push(localHeader, file.data);
    centralDir.push(cdEntry);
    offset += localHeader.length + size;
  }

  parts.push(...centralDir);
  const cdSize = centralDir.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array([
    0x50,0x4B,0x05,0x06, 0x00,0x00, 0x00,0x00,
    ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(offset), 0x00,0x00,
  ]);
  parts.push(eocd);

  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

function triggerDownload(data, filename, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function downloadDeptZip(deptId, candidates) {
  const dept = getDept(deptId);
  const files = candidates.filter(c => c.department === deptId && c._fileData)
    .map(c => ({ name: c._filename, data: c._fileData }));
  if (!files.length) { alert("No PDF data available — please re-upload."); return; }
  const zip = await buildZip(files);
  triggerDownload(zip, `${dept.label}_CVs.zip`, "application/zip");
}

async function downloadAllZip(candidates) {
  const files = candidates.filter(c => c._fileData)
    .map(c => ({ name: `${getDept(c.department).label}/${c._filename}`, data: c._fileData }));
  if (!files.length) { alert("No PDF data available."); return; }
  const zip = await buildZip(files);
  triggerDownload(zip, "All_CVs_Classified.zip", "application/zip");
}

// ── EXCEL EXPORT ──────────────────────────────────────────────────────────────
function exportExcel(candidates) {
  const XLSX = window.XLSX;
  if (!XLSX) { alert("Excel library not ready. Please wait a moment and try again."); return; }

  const headers = [
    "Name","Email","Phone","Years of Experience","Current Role",
    "Current Company","Department","Location","Education","Skills","Summary","Source File","Processed At"
  ];
  const rows = candidates.map(c => [
    c.name||"", c.email||"", c.phone||"",
    c.years_of_experience ?? "", c.current_role||"", c.current_company||"",
    getDept(c.department)?.label || c.department,
    c.location||"", c.education||"",
    (c.skills||[]).join(", "), c.summary||"", c._filename||"",
    c._processedAt ? new Date(c._processedAt).toLocaleString() : "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = [
    {wch:22},{wch:28},{wch:16},{wch:8},{wch:26},{wch:24},
    {wch:22},{wch:18},{wch:32},{wch:40},{wch:50},{wch:28},{wch:20},
  ];

  // Bold header row
  headers.forEach((_, i) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c: i });
    if (ws[ref]) ws[ref].s = {
      font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
      fill: { fgColor: { rgb: "1E293B" } },
      alignment: { horizontal: "center" },
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "All Candidates");

  // Summary sheet
  const summary = [["Department", "Count", "% of Total"]];
  DEPARTMENTS.forEach(d => {
    const count = candidates.filter(c => c.department === d.id).length;
    if (count > 0) summary.push([d.label, count, `${((count / candidates.length) * 100).toFixed(1)}%`]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(summary);
  ws2["!cols"] = [{ wch: 26 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Department Summary");

  const date = new Date().toISOString().split("T")[0];
  XLSX.writeFile(wb, `CV_Database_${date}.xlsx`);
}

// ── SMALL UI COMPONENTS ───────────────────────────────────────────────────────
function Stat({ icon, label, value, color = "#6366f1" }) {
  return (
    <div style={{ background: "rgba(15,23,42,0.8)", border: "1px solid #1e293b", borderRadius: 14, padding: "18px 22px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 46, height: 46, borderRadius: 12, background: `${color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
        <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

function DropZone({ onFiles, busy }) {
  const [drag, setDrag] = useState(false);
  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDrag(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf");
    if (files.length) onFiles(files);
  }, [onFiles]);

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${drag ? "#6366f1" : "#334155"}`,
        borderRadius: 16, padding: "52px 32px", textAlign: "center",
        background: drag ? "rgba(99,102,241,0.08)" : "rgba(15,23,42,0.6)",
        transition: "all .2s", cursor: busy ? "not-allowed" : "pointer",
        position: "relative",
      }}>
      <input
        type="file" accept=".pdf" multiple disabled={busy}
        onChange={e => {
          const files = Array.from(e.target.files).filter(f => f.type === "application/pdf");
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
        style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: busy ? "not-allowed" : "pointer" }}
      />
      <div style={{ fontSize: 52, marginBottom: 14 }}>📄</div>
      <div style={{ color: "#e2e8f0", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
        {busy ? "Processing CVs…" : "Drop CV / Resume PDFs here"}
      </div>
      <div style={{ color: "#64748b", fontSize: 14 }}>Click to browse · Multiple files supported · PDFs only</div>
    </div>
  );
}

function CandidateRow({ c }) {
  const [open, setOpen] = useState(false);
  const dept = getDept(c.department);
  return (
    <div style={{ background: "rgba(15,23,42,0.9)", border: `1px solid ${dept.color}33`, borderLeft: `4px solid ${dept.color}`, borderRadius: 12, padding: "14px 18px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16 }}>{c.name || "Unknown"}</span>
            <span style={{ background: `${dept.color}20`, color: dept.color, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{dept.icon} {dept.label}</span>
            {c.years_of_experience != null && (
              <span style={{ background: "#1e293b", color: "#94a3b8", padding: "2px 10px", borderRadius: 20, fontSize: 11 }}>{c.years_of_experience} yrs exp</span>
            )}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
            {[c.current_role, c.current_company, c.location].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>
          {open ? "Less ▲" : "Details ▼"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[["📧 Email", c.email], ["📞 Phone", c.phone], ["📍 Location", c.location], ["🎓 Education", c.education]].map(([label, val]) => val ? (
            <div key={label} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ color: "#475569", fontSize: 11, marginBottom: 3 }}>{label}</div>
              <div style={{ color: "#cbd5e1", fontSize: 13 }}>{val}</div>
            </div>
          ) : null)}
          {c.skills?.length > 0 && (
            <div style={{ gridColumn: "1/-1", background: "#0f172a", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ color: "#475569", fontSize: 11, marginBottom: 8 }}>🛠 Skills</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {c.skills.slice(0, 10).map(s => <span key={s} style={{ background: `${dept.color}18`, color: dept.color, padding: "3px 10px", borderRadius: 12, fontSize: 12 }}>{s}</span>)}
              </div>
            </div>
          )}
          {c.summary && (
            <div style={{ gridColumn: "1/-1", background: "#0f172a", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ color: "#475569", fontSize: 11, marginBottom: 3 }}>📝 Summary</div>
              <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>{c.summary}</div>
            </div>
          )}
          <div style={{ gridColumn: "1/-1", background: "#0f172a", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ color: "#475569", fontSize: 11, marginBottom: 3 }}>🤖 Why classified here?</div>
            <div style={{ color: "#64748b", fontSize: 12, fontStyle: "italic" }}>{c.classification_reason}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function DeptFolder({ dept, candidates, onZip }) {
  const deptCandidates = candidates.filter(c => c.department === dept.id);
  if (!deptCandidates.length) return null;
  return (
    <div style={{ background: "rgba(15,23,42,0.7)", border: `1px solid ${dept.color}44`, borderRadius: 14, padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>{dept.icon}</span>
          <div>
            <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15 }}>{dept.label}</div>
            <div style={{ color: "#64748b", fontSize: 12 }}>{deptCandidates.length} CV{deptCandidates.length !== 1 ? "s" : ""}</div>
          </div>
        </div>
        <button onClick={() => onZip(dept.id)} style={{ background: `${dept.color}18`, border: `1px solid ${dept.color}55`, borderRadius: 9, color: dept.color, padding: "7px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          ⬇ Download ZIP
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {deptCandidates.map(c => (
          <span key={c._id} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "4px 10px", fontSize: 12, color: "#94a3b8" }}>
            {c.name || c._filename}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [candidates, setCandidates] = useState([]);
  const [queue, setQueue]           = useState([]);
  const [tab, setTab]               = useState("folders");
  const [filter, setFilter]         = useState("all");
  const [search, setSearch]         = useState("");
  const [toasts, setToasts]         = useState([]);

  const addToast = (msg, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  };

  const processFiles = async (files) => {
    setQueue(p => [...p, ...files.map(f => ({ name: f.name, status: "queued" }))]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const upd = (status) => setQueue(p => p.map(q => q.name === file.name ? { ...q, status } : q));

      try {
        upd("reading");

        const [base64, arrayBuffer] = await Promise.all([
          new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file); }),
          new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); }),
        ]);

        upd("analyzing");

        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1000,
            system: SYSTEM_PROMPT,
            messages: [{
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
                { type: "text", text: "Extract all candidate information from this CV. Return only the JSON object as instructed." },
              ],
            }],
          }),
        });

        const data = await resp.json();
        if (data.error) throw new Error(data.error.message);

        const raw = data.content?.map(c => c.text || "").join("") || "";
        const clean = raw.replace(/```json|```/g, "").trim();

        let parsed;
        try { parsed = JSON.parse(clean); }
        catch {
          const m = clean.match(/\{[\s\S]*\}/);
          if (m) parsed = JSON.parse(m[0]);
          else throw new Error("Could not parse AI response as JSON");
        }

        if (!DEPARTMENTS.find(d => d.id === parsed.department)) parsed.department = "other";
        parsed._filename    = file.name;
        parsed._id          = `${Date.now()}-${i}`;
        parsed._processedAt = new Date().toISOString();
        parsed._fileData    = new Uint8Array(arrayBuffer);

        setCandidates(p => [...p, parsed]);
        setQueue(p => p.filter(q => q.name !== file.name));
        addToast(`"${parsed.name || file.name}" → ${getDept(parsed.department).label}`, "success");

      } catch (err) {
        upd("error");
        addToast(`Failed: ${file.name} — ${err.message}`, "error");
        setTimeout(() => setQueue(p => p.filter(q => q.name !== file.name)), 3500);
      }
    }
  };

  const deptCounts = DEPARTMENTS.reduce((acc, d) => {
    acc[d.id] = candidates.filter(c => c.department === d.id).length;
    return acc;
  }, {});

  const avgExp = (() => {
    const w = candidates.filter(c => c.years_of_experience != null);
    if (!w.length) return "—";
    return (w.reduce((a, c) => a + c.years_of_experience, 0) / w.length).toFixed(1);
  })();

  const filtered = candidates.filter(c => {
    const dm = filter === "all" || c.department === filter;
    const s  = search.toLowerCase();
    const tm = !s || [c.name, c.email, c.current_role, c.current_company].some(v => v?.toLowerCase().includes(s));
    return dm && tm;
  });

  const statusIcon = { queued: "⏳", reading: "📖", analyzing: "🤖", error: "❌" };
  const statusText = { queued: "Queued", reading: "Reading PDF…", analyzing: "AI Analyzing…", error: "Error" };

  return (
    <div style={{ minHeight: "100vh", background: "#060d1a", color: "#f1f5f9", fontFamily: "'Inter',-apple-system,sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ background: "linear-gradient(135deg,#0f172a,#1e1b4b)", borderBottom: "1px solid #1e293b", padding: "18px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 32 }}>🗂️</span>
          <div>
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700 }}>CV Classifier & Database</h1>
            <div style={{ color: "#64748b", fontSize: 13 }}>AI-powered · Auto-sort · ZIP & Excel download</div>
          </div>
        </div>
        {candidates.length > 0 && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => downloadAllZip(candidates)}
              style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, color: "#94a3b8", padding: "9px 18px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              🗜️ Download All ZIPs
            </button>
            <button onClick={() => { exportExcel(candidates); addToast("Excel downloaded!", "success"); }}
              style={{ background: "linear-gradient(135deg,#10b981,#059669)", border: "none", borderRadius: 10, color: "white", padding: "9px 18px", cursor: "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 4px 14px rgba(16,185,129,0.3)" }}>
              📊 Export Excel
            </button>
          </div>
        )}
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>

        <DropZone onFiles={processFiles} busy={queue.length > 0} />

        {/* Processing queue */}
        {queue.length > 0 && (
          <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {queue.map(q => (
              <div key={q.name} style={{ background: q.status === "error" ? "#7f1d1d" : "#1e293b", border: `1px solid ${q.status === "error" ? "#ef4444" : "#334155"}`, borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span>{statusIcon[q.status]}</span>
                <span style={{ color: "#cbd5e1" }}>{q.name.length > 28 ? q.name.slice(0, 25) + "…" : q.name}</span>
                <span style={{ color: "#64748b" }}>{statusText[q.status]}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── STATS + VIEWS ── */}
        {candidates.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginTop: 28 }}>
              <Stat icon="📄" label="Total CVs Processed"  value={candidates.length}                                    color="#6366f1" />
              <Stat icon="🗂️" label="Departments"           value={Object.values(deptCounts).filter(v => v > 0).length} color="#10b981" />
              <Stat icon="📅" label="Avg. Experience (yrs)" value={avgExp}                                               color="#f59e0b" />
              <Stat icon="📞" label="With Contact Info"     value={candidates.filter(c => c.email || c.phone).length}   color="#ec4899" />
            </div>

            {/* Tab switcher */}
            <div style={{ display: "flex", gap: 4, marginTop: 28, background: "#0f172a", borderRadius: 12, padding: 4, width: "fit-content", border: "1px solid #1e293b" }}>
              {[["folders", "📁 Folder View"], ["list", "📋 Candidate List"]].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} style={{ background: tab === id ? "#1e293b" : "none", border: "none", borderRadius: 9, color: tab === id ? "#f1f5f9" : "#64748b", padding: "8px 20px", cursor: "pointer", fontWeight: tab === id ? 600 : 400, fontSize: 14 }}>
                  {label}
                </button>
              ))}
            </div>

            {/* FOLDER VIEW */}
            {tab === "folders" && (
              <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 14 }}>
                {DEPARTMENTS.filter(d => deptCounts[d.id] > 0).map(dept => (
                  <DeptFolder key={dept.id} dept={dept} candidates={candidates} onZip={id => downloadDeptZip(id, candidates)} />
                ))}
              </div>
            )}

            {/* LIST VIEW */}
            {tab === "list" && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <button onClick={() => setFilter("all")} style={{ background: filter === "all" ? "#6366f120" : "#0f172a", border: `1px solid ${filter === "all" ? "#6366f1" : "#1e293b"}`, borderRadius: 8, color: filter === "all" ? "#6366f1" : "#64748b", padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: filter === "all" ? 700 : 400 }}>
                      All ({candidates.length})
                    </button>
                    {DEPARTMENTS.filter(d => deptCounts[d.id] > 0).map(dept => (
                      <button key={dept.id} onClick={() => setFilter(dept.id === filter ? "all" : dept.id)}
                        style={{ background: filter === dept.id ? `${dept.color}20` : "#0f172a", border: `1px solid ${filter === dept.id ? dept.color : "#1e293b"}`, borderRadius: 8, color: filter === dept.id ? dept.color : "#64748b", padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: filter === dept.id ? 700 : 400, display: "flex", alignItems: "center", gap: 5 }}>
                        {dept.icon} {dept.label}
                        <span style={{ background: filter === dept.id ? dept.color : "#1e293b", color: filter === dept.id ? "white" : "#64748b", borderRadius: 10, padding: "0 7px", fontSize: 11 }}>{deptCounts[dept.id]}</span>
                      </button>
                    ))}
                  </div>
                  <input type="text" placeholder="Search name, role, company…" value={search} onChange={e => setSearch(e.target.value)}
                    style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 14px", color: "#f1f5f9", fontSize: 13, width: 240, outline: "none" }} />
                </div>
                {filtered.length === 0
                  ? <div style={{ textAlign: "center", padding: 48, color: "#475569", background: "rgba(15,23,42,0.5)", borderRadius: 12 }}>No candidates match your filter.</div>
                  : filtered.map(c => <CandidateRow key={c._id} c={c} />)
                }
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {candidates.length === 0 && queue.length === 0 && (
          <div style={{ marginTop: 36 }}>
            <div style={{ color: "#334155", textAlign: "center", fontSize: 13, marginBottom: 16 }}>CVs will be auto-sorted into these department folders</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
              {DEPARTMENTS.map(dept => (
                <div key={dept.id} style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e293b", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{dept.icon}</span>
                  <span style={{ color: "#94a3b8", fontSize: 13 }}>{dept.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── TOASTS ── */}
      <div style={{ position: "fixed", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 8, zIndex: 9999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background: "#1e293b", border: `1px solid ${t.type === "success" ? "#10b981" : t.type === "error" ? "#ef4444" : "#6366f1"}`, borderLeft: `4px solid ${t.type === "success" ? "#10b981" : t.type === "error" ? "#ef4444" : "#6366f1"}`, borderRadius: 10, padding: "12px 16px", maxWidth: 340, color: "#f1f5f9", fontSize: 13, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", gap: 8 }}>
            <span>{t.type === "success" ? "✅" : t.type === "error" ? "❌" : "ℹ️"}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>

    </div>
  );
}
