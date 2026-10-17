/* Arety Office — front end. Plain JS, no build step. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch {} throw new Error(m); }
  return r.json();
};
const toast = (m, ms = 2600) => { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), ms); };
const fmtSize = b => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(0) + " KB" : (b / 1048576).toFixed(1) + " MB";
const fmtTime = t => { const d = new Date(t * 1000), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(); };
const KLET = { doc: "W", sheet: "S", slides: "P", pdf: "PDF", dir: "▸" };
const kindOf = n => { const e = n.split(".").pop().toLowerCase(); return ["docx","doc","odt","rtf","md","txt","html","htm","wps","epub"].includes(e) ? "doc" : ["xlsx","xls","csv","ods","et"].includes(e) ? "sheet" : ["pptx","ppt","odp","dps"].includes(e) ? "slides" : e === "pdf" ? "pdf" : null; };

/* ---------- modal ---------- */
function modal(title, bodyHTML, onOk) {
  return new Promise(res => {
    $("#m-title").textContent = title; $("#m-body").innerHTML = bodyHTML; $("#modal").classList.remove("hidden");
    const close = v => { $("#modal").classList.add("hidden"); res(v); };
    $("#m-ok").onclick = () => close(onOk ? onOk() : true); $("#m-cancel").onclick = () => close(null);
    $("#modal").onkeydown = e => { if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") $("#m-ok").click(); if (e.key === "Escape") close(null); };
    const f = $("#m-body input"); if (f) { f.focus(); f.select(); }
  });
}

/* ---------- tabs ---------- */
const tabs = new Map(); let active = "home";
function showTab(id) {
  active = id;
  $$("#tabbar .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === id));
  $("#home").classList.toggle("active", id === "home");
  $$("#docs .dview").forEach(d => d.classList.toggle("active", d.dataset.tab === id));
  const t = tabs.get(id); if (t && t.onShow) t.onShow();
  document.title = id === "home" ? "Arety Office" : tabs.get(id).name + " - Arety Office";
}
function addTab(info) {
  const id = "t" + Math.random().toString(36).slice(2);
  const el = document.createElement("div"); el.className = "tab"; el.dataset.tab = id;
  el.innerHTML = `<span class="k ${info.kind}">${KLET[info.kind]}</span><span class="name">${info.name}</span><span class="x" title="Close">✕</span>`;
  el.onclick = e => { if (e.target.classList.contains("x")) closeTab(id); else showTab(id); };
  $("#tabs").appendChild(el);
  const view = document.createElement("div"); view.className = "dview"; view.dataset.tab = id; $("#docs").appendChild(view);
  const t = { id, el, view, ...info, dirty: false }; tabs.set(id, t); return t;
}
async function closeTab(id) {
  const t = tabs.get(id); if (!t) return;
  if (t.dirty && !confirm(`"${t.name}" has unsaved changes. Close anyway?`)) return;
  t.el.remove(); t.view.remove(); tabs.delete(id); if (active === id) showTab("home");
}
$(".tab.home").onclick = () => showTab("home");
$("#newtab").onclick = () => showTab("home");
const setDirty = (t, d) => { t.dirty = d; t.el.classList.toggle("dirty", d); const s = $(".status", t.view); if (s) s.textContent = d ? "Modified" : "Saved"; };

/* ---------- opening files ---------- */
async function openFile(path) {
  for (const t of tabs.values()) if (t.path === path) return showTab(t.id);
  toast("Opening " + path.split("/").pop() + "…", 8000);
  let d; try { d = await api("/api/open?path=" + encodeURIComponent(path)); } catch (e) { return toast("Cannot open: " + e.message, 6000); }
  const t = addTab({ path: d.path, name: d.name, kind: d.kind, ext: d.ext });
  t.view.innerHTML = toolbarHTML(d);
  wireToolbar(t);
  if (d.kind === "doc") mountDoc(t, d.html);
  else if (d.kind === "sheet") mountSheet(t, d.sheets);
  else { const f = document.createElement("iframe"); f.className = "pdf"; f.src = d.pdf; t.view.appendChild(f); }
  showTab(t.id); toast("Opened " + d.name, 1500); loadRecent(); clog({ opened: d.name, kind: d.kind });
}
const FORMATS = { doc: ["pdf","docx","odt","txt","md","html","epub","rtf"], sheet: ["pdf","xlsx","csv","ods","xls"], slides: ["pdf","pptx","odp","png"], pdf: ["docx","xlsx","txt","png","pptx","html","md"] };
function toolbarHTML(d) {
  const editable = d.kind === "doc" || d.kind === "sheet";
  return `<div class="dtool">
    ${editable ? `<button class="primary" data-act="save">Save</button><button data-act="saveas">Save as…</button>` : ""}
    <button data-act="pdf">Export PDF</button>
    <select data-act="convert"><option value="">Convert to…</option>${FORMATS[d.kind].map(f => `<option>${f}</option>`).join("")}</select>
    <button data-act="wps">Open in WPS</button>
    <button data-act="folder">Show folder</button>
    ${d.kind === "slides" ? `<span class="muted">Slides are shown as a rendered preview. Use "Open in WPS" to edit slides.</span>` : ""}
    <span class="status">${editable ? "Saved" : ""}</span>
  </div>`;
}
function wireToolbar(t) {
  $$("[data-act]", t.view).forEach(b => b.onclick = async e => {
    const act = b.dataset.act;
    try {
      if (act === "save") await save(t);
      else if (act === "saveas") await saveAs(t);
      else if (act === "pdf") { if (t.dirty) await save(t); const r = await api("/api/export-pdf", { path: t.path }); toast("PDF saved: " + r.path, 5000); loadRecent(); }
      else if (act === "wps") { await api("/api/open-external", { path: t.path, app: "wps" }); toast("Opening in WPS Office…"); }
      else if (act === "folder") await api("/api/open-external", { path: t.path, app: "folder" });
    } catch (err) { toast("Error: " + err.message, 6000); }
  });
  const sel = $("select[data-act=convert]", t.view);
  sel.onchange = async () => { const fmt = sel.value; sel.value = ""; if (!fmt) return; try { if (t.dirty) await save(t); toast("Converting…", 60000); const r = await api("/api/convert", { path: t.path, fmt }); toast("Saved: " + r.path, 6000); loadRecent(); } catch (err) { toast("Error: " + err.message, 8000); } };
}
async function save(t) {
  if (t.kind === "doc") await api("/api/save/doc", { path: t.path, html: t.quill.getSemanticHTML() });
  else if (t.kind === "sheet") await api("/api/save/sheet", { path: t.path, sheets: t.sheet.getData() });
  setDirty(t, false); toast("Saved " + t.name, 1500); loadRecent();
}
async function saveAs(t) {
  const dir = t.path.slice(0, t.path.lastIndexOf("/"));
  const r = await modal("Save as", `<label>Folder<input id="sa-dir" value="${dir}"></label><label>File name<input id="sa-name" value="${t.name}"></label>`,
    () => ({ dir: $("#sa-dir").value, name: $("#sa-name").value }));
  if (!r || !r.name) return;
  const path = r.dir.replace(/\/$/, "") + "/" + r.name;
  const old = t.path; t.path = path; t.name = r.name; $(".name", t.el).textContent = r.name;
  try { await save(t); } catch (e) { t.path = old; t.name = old.split("/").pop(); $(".name", t.el).textContent = t.name; throw e; }
}

/* ---------- editors ---------- */
function mountDoc(t, html) {
  const body = document.createElement("div"); body.className = "dbody"; const paper = document.createElement("div"); paper.className = "paper";
  const ed = document.createElement("div"); paper.appendChild(ed); body.appendChild(paper); t.view.appendChild(body);
  t.quill = new Quill(ed, { theme: "snow", modules: { toolbar: [[{ header: [1, 2, 3, false] }, { font: [] }, { size: ["small", false, "large", "huge"] }], ["bold", "italic", "underline", "strike"], [{ color: [] }, { background: [] }], [{ align: [] }], [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }], ["blockquote", "code-block", "link", "image"], ["clean"]] } });
  t.quill.setContents(t.quill.clipboard.convert({ html }), "silent");
  paper.insertBefore($(".ql-toolbar", ed.parentElement) || $(".ql-toolbar", paper), paper.firstChild);
  t.quill.on("text-change", (d, o, src) => { if (src === "user") setDirty(t, true); });
}
function mountSheet(t, sheets) {
  const wrap = document.createElement("div"); wrap.className = "sheetwrap"; t.view.appendChild(wrap);
  const data = sheets.map(s => ({ name: s.name, rows: s.rows, cols: s.cols || {}, styles: s.styles || [], merges: s.merges || [] }));
  t.sheet = x_spreadsheet(wrap, { mode: "edit", showToolbar: true, showGrid: true, showBottomBar: true, view: { height: () => wrap.clientHeight, width: () => wrap.clientWidth } }).loadData(data);
  t.sheet.change(() => setDirty(t, true));
  t.onShow = () => setTimeout(() => t.sheet.reRender(), 0);
  window.addEventListener("resize", () => t.sheet.reRender());
}
document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); const t = tabs.get(active); if (t && (t.kind === "doc" || t.kind === "sheet")) save(t).catch(err => toast("Error: " + err.message, 6000)); } });
window.addEventListener("beforeunload", e => { if ([...tabs.values()].some(t => t.dirty)) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- home: new ---------- */
let lastDir = localStorage.getItem("office.dir") || "";
$$("[data-new]").forEach(b => b.onclick = async () => {
  const kind = b.dataset.new; const defExt = { doc: "docx", sheet: "xlsx", slides: "pptx" }[kind];
  const r = await modal("New " + { doc: "document", sheet: "spreadsheet", slides: "presentation" }[kind],
    `<label>File name<input id="nf-name" value="Untitled.${defExt}"></label><label>Save in folder<input id="nf-dir" value="${lastDir || "~/Documents"}"></label>`,
    () => ({ name: $("#nf-name").value, dir: $("#nf-dir").value }));
  if (!r) return;
  try { const f = await api("/api/new", { kind, name: r.name, dir: r.dir }); lastDir = f.path.slice(0, f.path.lastIndexOf("/")); localStorage.setItem("office.dir", lastDir); await openFile(f.path); } catch (e) { toast("Error: " + e.message, 6000); }
});
$("#open-btn").onclick = () => { showPage("files"); browse(curDir || undefined); };

/* ---------- home: recent ---------- */
function itemHTML(f, extra = "") {
  const k = f.dir ? "dir" : f.kind;
  return `<div class="item" data-path="${f.path}" data-dir="${f.dir ? 1 : 0}"><span class="k ${k}">${KLET[k] || "?"}</span>
    <div class="n"><b>${f.name}</b><small>${f.path}</small></div>
    <span class="meta">${f.dir ? "" : fmtSize(f.size) + " · "}${fmtTime(f.mtime || f.ts)}</span><div class="acts">${extra}</div></div>`;
}
let recentCache = [];
async function loadRecent() {
  recentCache = await api("/api/recent"); renderRecent();
}
function renderRecent() {
  const q = $("#recent-filter").value.toLowerCase();
  const list = recentCache.filter(r => r.name.toLowerCase().includes(q));
  $("#recent").innerHTML = list.length ? list.map(r => itemHTML({ ...r, mtime: r.ts, size: 0 }, `<button data-a="open">Open</button><button data-a="wps">WPS</button><button data-a="forget">Remove</button>`)).join("") : `<div class="empty">No recent files yet. Create one above or open something from Files.</div>`;
  $$("#recent .item").forEach(it => wireItem(it, { forget: async p => { await api("/api/recent/remove", { path: p }); loadRecent(); } }));
}
$("#recent-filter").oninput = renderRecent;
function wireItem(it, handlers = {}) {
  const p = it.dataset.path, isDir = it.dataset.dir === "1";
  it.ondblclick = () => isDir ? browse(p) : openFile(p);
  $$("button", it).forEach(b => b.onclick = async e => {
    e.stopPropagation(); const a = b.dataset.a;
    try {
      if (a === "open") isDir ? browse(p) : openFile(p);
      else if (a === "wps") await api("/api/open-external", { path: p, app: "wps" });
      else if (a === "convert") { $("#conv-path").value = p; showPage("convert"); }
      else if (a === "rename") { const n = await modal("Rename", `<label>New name<input id="rn" value="${p.split("/").pop()}"></label>`, () => $("#rn").value); if (n) { await api("/api/fs", { op: "rename", path: p, name: n }); browse(curDir); loadRecent(); } }
      else if (a === "delete") { if (confirm("Delete " + p + " ?")) { await api("/api/fs", { op: "delete", path: p }); browse(curDir); loadRecent(); } }
      else if (handlers[a]) await handlers[a](p);
    } catch (err) { toast("Error: " + err.message, 6000); }
  });
}

/* ---------- home: files ---------- */
let curDir = localStorage.getItem("office.browse") || "";
async function browse(path) {
  let d; try { d = await api("/api/browse?path=" + encodeURIComponent(path || "~") + ($("#showall").checked ? "&all=1" : "")); } catch (e) { return toast(e.message, 5000); }
  curDir = d.path; localStorage.setItem("office.browse", curDir); $("#path").value = d.path; $("#up").disabled = !d.parent;
  $("#places").innerHTML = d.places.map(p => `<button data-p="${p.path}">${p.name}</button>`).join(""); $$("#places button").forEach(b => b.onclick = () => browse(b.dataset.p));
  renderFiles(d.items);
}
function renderFiles(items) {
  $("#filelist").innerHTML = items.length ? items.map(f => itemHTML(f, f.dir ? `<button data-a="open">Open</button><button data-a="rename">Rename</button><button data-a="delete">Delete</button>` : `<button data-a="open">Open</button><button data-a="wps">WPS</button><button data-a="convert">Convert</button><button data-a="rename">Rename</button><button data-a="delete">Delete</button>`)).join("") : `<div class="empty">No documents here. Tick "all files" to see everything.</div>`;
  $$("#filelist .item").forEach(it => wireItem(it));
}
$("#up").onclick = () => browse(curDir.replace(/\/[^/]*$/, "") || "/");
$("#go").onclick = () => browse($("#path").value); $("#path").onkeydown = e => { if (e.key === "Enter") browse($("#path").value); };
$("#showall").onchange = () => browse(curDir);
$("#mkdir").onclick = async () => { const n = await modal("New folder", `<label>Name<input id="nd" value="New folder"></label>`, () => $("#nd").value); if (n) { await api("/api/fs", { op: "mkdir", path: curDir, name: n }); browse(curDir); } };
let searchT; $("#search").oninput = () => { clearTimeout(searchT); const q = $("#search").value.trim(); searchT = setTimeout(async () => { if (!q) return browse(curDir); renderFiles(await api("/api/search?q=" + encodeURIComponent(q) + "&path=" + encodeURIComponent(curDir))); }, 300); };

/* ---------- home: convert ---------- */
const ALLF = [["pdf","PDF"],["docx","Word"],["xlsx","Excel"],["pptx","PowerPoint"],["odt","OpenDocument text"],["txt","Plain text"],["md","Markdown"],["html","Web page"],["epub","E-book"],["png","PNG images"],["csv","CSV"],["rtf","RTF"]];
$("#conv-formats").innerHTML = ALLF.map(([v, n], i) => `<label><input type="radio" name="cf" value="${v}" ${i === 0 ? "checked" : ""}>${n} <small class="muted">.${v}</small></label>`).join("");
$("#conv-pick").onclick = () => { showPage("files"); toast("Double-click a file to open it, or use its Convert button"); };
$("#conv-run").onclick = async () => {
  const path = $("#conv-path").value.trim(), fmt = $("input[name=cf]:checked").value; if (!path) return toast("Pick a file first");
  $("#conv-run").disabled = true; $("#conv-out").textContent = "Converting…";
  try { const r = await api("/api/convert", { path, fmt, ocr: $("#conv-ocr").checked }); $("#conv-out").innerHTML = `Done: <b>${r.path}</b> <button id="conv-open">Open</button>`; $("#conv-open").onclick = () => openFile(r.path); loadRecent(); }
  catch (e) { $("#conv-out").textContent = "Error: " + e.message; } finally { $("#conv-run").disabled = false; }
};

/* ---------- home pages ---------- */
function showPage(p) { $$(".nav").forEach(n => n.classList.toggle("active", n.dataset.page === p)); $$(".page").forEach(s => s.classList.toggle("active", s.id === "page-" + p)); showTab("home"); if (p === "files" && !$("#filelist").children.length) browse(curDir || undefined); }
$$(".nav").forEach(n => n.onclick = () => showPage(n.dataset.page));

/* ---------- diagnostics (journalctl --user -u officesuite) ---------- */
const clog = o => fetch("/api/clientlog", { method: "POST", body: JSON.stringify(o) }).catch(() => {});
window.addEventListener("error", e => clog({ error: e.message, src: (e.filename || "").split("/").pop(), line: e.lineno }));
window.addEventListener("unhandledrejection", e => clog({ rejection: String(e.reason) }));
/* ---------- boot ---------- */
function handleHash() { const m = location.hash.match(/^#open=(.+)$/); if (m) { history.replaceState(null, "", location.pathname); openFile(decodeURIComponent(m[1])); } }
window.addEventListener("hashchange", handleHash);
loadRecent().then(handleHash); browse(curDir || undefined);
