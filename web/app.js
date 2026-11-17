"use strict";
/* Fox Notes — yerel bilgi kasan
 * Tauri (gerçek ~/FoxNotes klasörü) veya tarayıcıda localStorage kasası.
 * Notlar düz markdown; [[Wiki Bağlantı]] ve #etiket desteklenir.
 */
const isTauri = Boolean(window.__TAURI__?.core?.invoke);
const $ = (id) => document.getElementById(id);

/* ════════════ Markdown renderer (kapsüllü, bağımlılıksız) ════════════ */
const HTML_ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);

function renderMarkdown(src) {
  // 1) kod bloklarını ayır
  const codeBlocks = [];
  src = src.replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(`<pre><code>${esc(code.replace(/^\n/, "").replace(/\n$/, ""))}</code></pre>`);
    return `\u0000${codeBlocks.length - 1}\u0000`;
  });
  // 2) satırlara ayır, bloklara böl
  const lines = esc(src).split("\n");
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push("<p>" + inline(para.join("<br/>")) + "</p>"); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>` + list.items.map(i => `<li>${inline(i)}</li>`).join("") + `</${list.tag}>`); list = null; } };
  const flushAll = () => { flushPara(); flushList(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\u0000\d+\u0000$/.test(line.trim())) { flushAll(); out.push(line.trim()); continue; }
    if (!line.trim()) { flushAll(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushAll(); const level = h[1].length; out.push(`<h${level}>${inline(h[2])}</h${level}>`); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushAll(); out.push("<hr/>"); continue; }
    const bq = line.match(/^&gt;\s?(.*)$/);
    if (bq) { flushAll(); out.push(`<blockquote>${inline(bq[1])}</blockquote>`); continue; }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { flushPara(); if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(ul[1]); continue; }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { flushPara(); if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; } list.items.push(ol[1]); continue; }
    if (list) flushList();
    para.push(line);
  }
  flushAll();
  let html = out.join("\n");
  // kod bloklarını geri koy
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => codeBlocks[Number(i)]);
  return html;
}

function inline(escaped) {
  let s = escaped;
  // satır içi kod
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // wiki bağlantıları [[hedef|etiket]] ya da [[hedef]]
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const t = target.trim(), l = (label || target).trim();
    return `<a class="wikilink" href="#" data-target="${esc(t)}">${l}</a>`;
  });
  // normal bağlantılar [metin](url) — yalnız http/https/mailto/göreli
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    const clean = url.trim();
    if (/^(https?:|mailto:|\/|\.\.?\/|#)/i.test(clean)) return `<a href="${esc(clean)}" rel="noopener noreferrer">${text}</a>`;
    return text;
  });
  // kalın / italik / üstü çizili
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // #etiketler (kelime başı)
  s = s.replace(/(^|\s)#([A-Za-z0-9_çğıöşüÇĞİÖŞÜ-]{2,})/g, '$1<span class="ptag">#$2</span>');
  return s;
}

/* ════════════ Depolama katmanı ════════════ */
const WEB_KEY = "foxnotes.notes.v1";
const tauriStore = {
  async list() { return await window.__TAURI__.core.invoke("vault_list"); },
  async read(rel) { return await window.__TAURI__.core.invoke("vault_read", { rel }); },
  async write(rel, content) { return await window.__TAURI__.core.invoke("vault_write", { rel, content }); },
  async remove(rel) { return await window.__TAURI__.core.invoke("vault_delete", { rel }); },
  async vaultPath() { try { return await window.__TAURI__.core.invoke("vault_path"); } catch { return "~/FoxNotes"; } },
};
const webStore = {
  _load() { try { return JSON.parse(localStorage.getItem(WEB_KEY) || "{}"); } catch { return {}; } },
  _save(m) { localStorage.setItem(WEB_KEY, JSON.stringify(m)); },
  async list() { const m = this._load(); return Object.keys(m).map(p => ({ path: p, mtime: m[p].mtime || 0, size: (m[p].content || "").length })); },
  async read(rel) { return this._load()[rel]?.content ?? ""; },
  async write(rel, content) { const m = this._load(); m[rel] = { content, mtime: Date.now() }; this._save(m); },
  async remove(rel) { const m = this._load(); delete m[rel]; this._save(m); },
  async vaultPath() { return "Tarayıcı kasası (localStorage)"; },
};
const store = isTauri ? tauriStore : webStore;

/* ════════════ Durum ════════════ */
const state = {
  notes: [],            // {path, name, title, content, mtime}
  currentPath: null,
  filterTag: null,
  query: "",
  sort: "name",
  backlinks: new Map(), // hedef(key) -> [{path,title}]
  saveTimer: null,
  graphNodes: [],
};
const baseKey = (path) => path.split("/").pop().replace(/\.md$/i, "").toLocaleLowerCase("tr");
const pathBase = (p) => p.split("/").pop().replace(/\.md$/i, "");
const noteTitle = (n) => (n.content.match(/^#\s+(.+)$/m)?.[1] || pathBase(n.path)).trim();
const tagsOf = (content) => [...new Set([...content.matchAll(/(^|\s)#([A-Za-z0-9_çğıöşüÇĞİÖŞÜ-]{2,})/g)].map(m => m[2].toLocaleLowerCase("tr")))];
const excerpt = (content) => content.replace(/^#.*$/gm, "").replace(/[`*_>#[\]-]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
const relTime = (ts) => {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "şimdi";
  if (s < 3600) return `${Math.floor(s / 60)}d önce`;
  if (s < 86400) return `${Math.floor(s / 3600)}s önce`;
  return `${Math.floor(s / 86400)}g önce`;
};
const toast = (msg) => { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._timer); t._timer = setTimeout(() => { t.hidden = true; }, 3200); };

/* ════════════ Kasa yükleme ════════════ */
async function seedStarterVault() {
  const welcome = `# Fox Notes'e hoş geldin

Bu bir **yerel bilgi kasası**: notların \`~/FoxNotes\` klasöründe düz \`.md\` dosyaları olarak yaşar.
Hesap yok, bulut yok, telemetri yok. Yedeklemen senin dosyalarındır.

## Neler yapabilirsin

- [[Proje fikirleri]] ve [[Okuma listesi]] gibi notlara **çift yönlü** bağlan
- Yazılarına #fikir gibi **etiketler** ekle, soldan süz
- Sağ üstteki **Graf** ile tüm kasanı kuş bakışı gör
- \`/\` ile ara, \`Ctrl+S\` ile elle kaydet

Peşinizi bırakmıyorum — _istediğin notları sil, gerisi kılavuz_.
`;
  const ideas = `# Proje fikirleri

Kodlama setlerini düzenlemek #fikirler arasına girdi.

## Adaylar

- **Fox Notes** — Notion/Obsidian alternatifi; bkz. [[Fox Notes'e hoş geldin]]
- **Çevrimdışı kütüphane** — kindle yerine pdf arşivi, #kişisel

> Not al, bağlan, küt küt düşün.
`;
  const reading = `# Okuma listesi

- *Thinking in Systems* — Donella Meadows, #sistem
- *Gödel, Escher, Bach* — Douglas Hofstadter, #zihin
- [[Proje fikirleri]] ile bir seferde oku ve kurcala.
`;
  for (const [path, content] of Object.entries({ "Fox Notes'e hoş geldin.md": welcome, "Proje fikirleri.md": ideas, "Okuma listesi.md": reading })) {
    try { await store.write(path, content); } catch { /* yoksay */ }
  }
}

async function loadVault(keepPath) {
  let metas = [];
  try { metas = await store.list(); } catch (e) { toast("Kasa okunamadı: " + e); return; }
  if (metas.length === 0) await seedStarterVault();
  metas = await store.list();
  const loaded = [];
  for (const m of metas) {
    try {
      const content = await store.read(m.path);
      loaded.push({ path: m.path, mtime: m.mtime || 0, size: m.size || content.length, content, name: pathBase(m.path) });
    } catch { /* okunamayan dosyayı atla */ }
  }
  state.notes = loaded;
  computeLinks();
  renderAll();
  const target = keepPath && loaded.find(n => n.path === keepPath) ? keepPath : null;
  if (target) await openNote(target, { silentList: true });
  else if (state.currentPath && !loaded.find(n => n.path === state.currentPath)) {
    state.currentPath = null;
    $("editorSplit").hidden = true; $("editorEmpty").hidden = false; $("deleteNoteBtn").hidden = true;
  } else if (state.currentPath) { await openNote(state.currentPath, { silentList: true }); }
}

function computeLinks() {
  state.backlinks = new Map();
  const byBasename = new Map(state.notes.map(n => [baseKey(n.path), n]));
  for (const n of state.notes) {
    for (const m of n.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
      const key = m[1].trim().toLocaleLowerCase("tr");
      const hits = state.backlinks.get(key) || [];
      hits.push({ path: n.path, title: noteTitle(n) });
      state.backlinks.set(key, hits);
    }
  }
  state.byBasename = byBasename;
}

/* ════════════ Render ════════════ */
function filteredNotes() {
  let list = [...state.notes];
  if (state.filterTag) list = list.filter(n => tagsOf(n.content).includes(state.filterTag));
  if (state.query) {
    const tokens = state.query.toLocaleLowerCase("tr").split(/\s+/).filter(Boolean);
    list = list.filter(n => {
      const hay = (n.title + " " + n.path + " " + n.content).toLocaleLowerCase("tr");
      return tokens.every(t => hay.includes(t));
    });
  }
  list.sort((a, b) => state.sort === "mtime" ? (b.mtime - a.mtime) : a.path.localeCompare(b.path, "tr"));
  return list;
}

function renderAll() {
  $("countAll").textContent = String(state.notes.length);
  $("noteCount").textContent = String(state.notes.length);
  // etiketler
  const tagCount = new Map();
  for (const n of state.notes) for (const t of tagsOf(n.content)) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const tagList = $("tagList");
  tagList.innerHTML = "";
  const sorted = [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"));
  if (!sorted.length) tagList.innerHTML = '<p class="tag-empty">Henüz #etiket yok</p>';
  for (const [tag, count] of sorted) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tag-chip" + (state.filterTag === tag ? " is-active" : "");
    b.textContent = `#${tag} · ${count}`;
    b.addEventListener("click", () => { state.filterTag = state.filterTag === tag ? null : tag; renderAll(); });
    tagList.appendChild(b);
  }
  $("navAll").classList.toggle("is-active", !state.filterTag);
  $("notesTitle").textContent = state.filterTag ? `#${state.filterTag}` : "Tüm Notlar";
  renderNoteList();
  if (state.currentPath) renderPreview(state.notes.find(n => n.path === state.currentPath), { markViewed: false });
}

function renderNoteList() {
  const list = filteredNotes();
  const box = $("noteList");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = '<p class="notes-empty">Eşleşen not yok.<br/>Aramayı ya da etiketi temizle.</p>';
    return;
  }
  for (const n of list) {
    const card = document.createElement("button");
    card.type = "button";
    card.setAttribute("role", "option");
    card.className = "note-card" + (n.path === state.currentPath ? " is-selected" : "");
    const firstTag = tagsOf(n.content)[0];
    card.innerHTML =
      `<div class="note-card-title">${esc(noteTitle(n))}</div>` +
      `<div class="note-card-snippet">${esc(excerpt(n.content)) || "Boş not"}</div>` +
      `<div class="note-card-foot"><span>${esc(relTime(n.mtime))}</span>${firstTag ? `<span class="note-card-tag">#${esc(firstTag)}</span>` : ""}</div>`;
    card.addEventListener("click", () => openNote(n.path));
    box.appendChild(card);
  }
}

function renderPreview(note, { markViewed = true } = {}) {
  if (!note) return;
  const prev = $("preview");
  prev.innerHTML = renderMarkdown(note.content);
  // wiki bağlantılarını tıklanabilir yap + eksikleri işaretle
  const existing = new Set(state.notes.map(n => baseKey(n.path)));
  for (const a of prev.querySelectorAll("a.wikilink")) {
    const key = a.dataset.target.trim().toLocaleLowerCase("tr");
    if (!existing.has(key)) a.classList.add("is-missing");
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const hit = state.notes.find(n => baseKey(n.path) === key);
      if (hit) await openNote(hit.path);
      else {
        // eksik not: oluşturmayı teklif et
        if (confirm(`"${a.dataset.target}" notu yok. Oluşturulsun mu?`)) {
          const rel = a.dataset.target.trim().replace(/\.md$/i, "") + ".md";
          await store.write(rel, `# ${a.dataset.target.trim()}\n\n`);
          await loadVault(rel);
        }
      }
    });
  }
  // geri bağlantılar
  const bl = state.backlinks.get(baseKey(note.path)) || [];
  const area = $("backlinks"), ul = $("backlinkList");
  ul.innerHTML = "";
  for (const source of bl) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = source.title;
    b.addEventListener("click", () => openNote(source.path));
    ul.appendChild(b);
  }
  area.hidden = bl.length === 0;
}

async function openNote(path, { silentList = false } = {}) {
  const note = state.notes.find(n => n.path === path);
  if (!note) return;
  state.currentPath = path;
  $("editorEmpty").hidden = true;
  $("editorSplit").hidden = false;
  $("deleteNoteBtn").hidden = false;
  $("currentPath").textContent = path;
  $("saveStatus").textContent = "Kaydedildi";
  $("editor").value = note.content;
  renderPreview(note);
  if (!silentList) renderNoteList(); else {
    for (const card of $("noteList").children) { /* listeyi sessiz tut; seçim işaretini güncelle */ }
    renderNoteList();
  }
}

/* ════════════ Düzenleme & kaydetme ════════════ */
function scheduleSave() {
  clearTimeout(state.saveTimer);
  $("saveStatus").textContent = "Düzenleniyor…";
  state.saveTimer = setTimeout(saveNow, 600);
}
async function saveNow() {
  clearTimeout(state.saveTimer);
  const note = state.notes.find(n => n.path === state.currentPath);
  if (!note) return;
  const content = $("editor").value;
  if (content === note.content) { $("saveStatus").textContent = "Kaydedildi"; return; }
  note.content = content;
  note.mtime = Date.now();
  try {
    await store.write(note.path, content);
    computeLinks();
    $("saveStatus").textContent = "Kaydedildi ✓ " + new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    renderAll();
  } catch (e) {
    $("saveStatus").textContent = "Kaydedilemedi!";
    toast("Kaydetme hatası: " + e);
  }
}

/* ════════════ Yeni not ════════════ */
function sanitizeRelPath(input) {
  const raw = input.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
  if (!raw) return null;
  const parts = raw.split("/").map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (parts.some(p => p === "." || p === "..")) return null;
  let rel = parts.join("/");
  if (!/\.md$/i.test(rel)) rel += ".md";
  return rel;
}

function openNewNoteModal() {
  $("newNoteModal").hidden = false;
  $("newNoteDir").textContent = isTauri ? "~/FoxNotes/" : "kasa kökü";
  $("newNoteName").value = "";
  setTimeout(() => $("newNoteName").focus(), 0);
}
function closeNewNoteModal() { $("newNoteModal").hidden = true; }

async function createNote() {
  const rel = sanitizeRelPath($("newNoteName").value);
  if (!rel) { toast("Geçerli bir ad yaz (ör. 'proje fikirleri')."); return; }
  if (state.notes.some(n => n.path.toLocaleLowerCase("tr") === rel.toLocaleLowerCase("tr"))) { toast("Bu adla bir not zaten var."); return; }
  const title = pathBase(rel);
  try {
    await store.write(rel, `# ${title}\n\n`);
  } catch (e) { toast("Oluşturulamadı: " + e); return; }
  closeNewNoteModal();
  await loadVault(rel);
  toast("Not oluşturuldu: " + rel);
}

/* ════════════ Graph ════════════ */
function openGraph() {
  const overlay = $("graphOverlay");
  overlay.hidden = false;
  drawGraph();
}
function closeGraph() { $("graphOverlay").hidden = true; }

function computeGraphLayout(w, h) {
  const notes = state.notes;
  const n = notes.length;
  const cx = w / 2, cy = h / 2 - 10;
  const radius = Math.min(w, h) / 2 - 78;
  const order = [...notes].sort((a, b) => (state.backlinks.get(baseKey(b.path))?.length || 0) - (state.backlinks.get(baseKey(a.path))?.length || 0));
  const nodes = order.map((note, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    return { note, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), r: 7 };
  });
  state.graphNodes = nodes;
  return nodes;
}

function drawGraph() {
  const canvas = $("graphCanvas");
  const parent = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = parent.clientWidth, h = parent.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const nodes = computeGraphLayout(w, h);
  const pos = new Map(nodes.map(nd => [nd.note.path, nd]));
  // kenarlar
  ctx.lineWidth = 1.1;
  for (const n of state.notes) {
    for (const m of n.content.matchAll(/\[\[([^\]|]+)/g)) {
      const target = m[1].trim().toLocaleLowerCase("tr");
      const targetNote = state.byBasename?.get(target);
      if (!targetNote) continue;
      const a = pos.get(n.path), b = pos.get(targetNote.path);
      if (!a || !b) continue;
      ctx.strokeStyle = "rgba(227,168,87,.16)";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  // düğümler + etiketler
  ctx.textAlign = "center";
  for (const nd of nodes) {
    const isCurrent = nd.note.path === state.currentPath;
    const degree = (state.backlinks.get(baseKey(nd.note.path)) || []).length;
    const r = isCurrent ? 11 : 6 + Math.min(degree, 6);
    ctx.beginPath();
    ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isCurrent ? "#e3a857" : "#26211c";
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = isCurrent ? "#f0bd72" : "rgba(227,168,87,.55)";
    ctx.stroke();
    ctx.font = (isCurrent ? "bold 12px" : "11px") + ' "JetBrains Mono", monospace';
    ctx.fillStyle = isCurrent ? "#f3ece1" : "rgba(243,236,225,.72)";
    const label = noteTitle(nd.note);
    ctx.fillText(label.length > 22 ? label.slice(0, 21) + "…" : label, nd.x, nd.y + r + 13);
  }
}
function graphHit(evt) {
  const canvas = $("graphCanvas");
  const rect = canvas.getBoundingClientRect();
  const x = evt.clientX - rect.left, y = evt.clientY - rect.top;
  for (const nd of state.graphNodes) {
    const dx = x - nd.x, dy = y - nd.y;
    if (dx * dx + dy * dy <= 18 * 18) return nd.note;
  }
  return null;
}

/* ════════════ Olaylar ════════════ */
$("newNoteBtn").addEventListener("click", openNewNoteModal);
$("graphBtn").addEventListener("click", openGraph);
$("graphClose").addEventListener("click", closeGraph);
$("newNoteClose").addEventListener("click", closeNewNoteModal);
$("newNoteCancel").addEventListener("click", closeNewNoteModal);
$("newNoteCreate").addEventListener("click", createNote);
$("newNoteModal").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeNewNoteModal(); });
$("newNoteName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); createNote(); } });
$("navAll").addEventListener("click", () => { state.filterTag = null; renderAll(); });
$("sortSelect").addEventListener("change", (e) => { state.sort = e.target.value; renderNoteList(); });
$("searchInput").addEventListener("input", (e) => { state.query = e.target.value.trim(); renderNoteList(); });
$("editor").addEventListener("input", () => {
  const note = state.notes.find(n => n.path === state.currentPath);
  if (note) { note.content = $("editor").value; renderPreview(note); }
  scheduleSave();
});
$("deleteNoteBtn").addEventListener("click", async () => {
  const note = state.notes.find(n => n.path === state.currentPath);
  if (!note) return;
  if (!confirm(`"${noteTitle(note)}" kalıcı olarak silinsin mi?\nBu dosya diskten silinir.`)) return;
  try { await store.remove(note.path); } catch (e) { toast("Silinemedi: " + e); return; }
  state.currentPath = null;
  $("editorSplit").hidden = true;
  $("editorEmpty").hidden = false;
  $("deleteNoteBtn").hidden = true;
  $("currentPath").textContent = "—";
  await loadVault();
  toast("Not silindi.");
});
$("graphCanvas").addEventListener("click", async (e) => {
  const hit = graphHit(e);
  if (hit) { closeGraph(); await openNote(hit.path); }
});
window.addEventListener("resize", () => { if (!$("graphOverlay").hidden) drawGraph(); });

document.addEventListener("keydown", (e) => {
  const editable = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); return; }
  if (e.key === "Escape") {
    if (!$("graphOverlay").hidden) { closeGraph(); return; }
    if (!$("newNoteModal").hidden) { closeNewNoteModal(); return; }
    if (editable) { document.activeElement.blur(); return; }
    return;
  }
  if (editable) return;
  if (e.key === "/") { e.preventDefault(); $("searchInput").focus(); }
  else if (e.key.toLowerCase() === "n") { e.preventDefault(); openNewNoteModal(); }
});

/* ════════════ Başlat ════════════ */
(async function init() {
  try { $("vaultPath").textContent = await store.vaultPath(); } catch { /* varsayılan kalır */ }
  await loadVault();
})();
