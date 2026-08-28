"use strict";

/* Canvas notebook: one page in memory, compact vector strokes in local storage.
 * It intentionally never writes during pointer movement. */
(function (global) {
  let root, canvas, ctx, subject, user, notebook, activePage = 0, tool = "pen", color = "#4d4260", width = 3;
  let drawing = null, redo = [], saveTimer = null, frame = 0, mounted = false;
  const key = () => `itera:notebook:${user?.id || "guest"}:${subject?.id || "subject"}`;
  const templates = { lined: "Liniat", grid: "Pătrățele", blank: "Simplu" };

  function freshNotebook() { return { version: 1, pages: [{ template: "lined", strokes: [] }], updatedAt: Date.now() }; }
  function load() {
    try { const saved = JSON.parse(localStorage.getItem(key()) || "null"); return saved?.pages?.length ? saved : freshNotebook(); }
    catch (_) { return freshNotebook(); }
  }
  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = global.setTimeout(() => {
      notebook.updatedAt = Date.now();
      try { localStorage.setItem(key(), JSON.stringify(notebook)); updateSaveStatus("Salvat pe dispozitiv"); }
      catch (_) { updateSaveStatus("Spațiul local este plin"); }
    }, 650);
  }
  function updateSaveStatus(text) { root?.querySelector("[data-notebook-status]")?.replaceChildren(text); }

  async function mount(subjectId) {
    root = document.getElementById("notebookViewRoot");
    if (!root) return;
    mounted = true;
    root.innerHTML = '<div class="subjects-spa-state">Se deschide caietul…</div>';
    const sessionResult = await supabaseClient.auth.getSession();
    user = sessionResult.data?.session?.user;
    if (!user || !mounted) return;
    const { data } = await supabaseClient.from("subjects").select("id,name,color").eq("id", subjectId).eq("user_id", user.id).maybeSingle();
    if (!data || !mounted) { root.innerHTML = '<div class="subjects-spa-state">Caietul nu a fost găsit.</div>'; return; }
    subject = data; notebook = load(); activePage = 0; redo = [];
    render();
  }
  function unmount() { clearTimeout(saveTimer); if (notebook) { try { localStorage.setItem(key(), JSON.stringify(notebook)); } catch (_) {} } mounted = false; root = canvas = ctx = null; drawing = null; }

  function desk() { return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 18h24v10H12zM16 28l-3 12m19-12 3 12M12 40h8m8 0h8M19 13h10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
  function render() {
    const page = notebook.pages[activePage];
    root.innerHTML = `<a class="subjects-spa-back" href="#/subjects/${subject.id}">← ${escape(subject.name)}</a>
      <section class="notebook-shell" style="--subject:${subject.color || "#f3a9c5"}">
        <header class="notebook-head"><div class="notebook-title-icon">${desk()}</div><div><p class="eyebrow">Caietul tău</p><h2>${escape(subject.name)}</h2></div><small data-notebook-status>Pregătit</small></header>
        <div class="notebook-toolbar" role="toolbar" aria-label="Instrumente caiet">
          <button data-tool="pen" class="active" aria-label="Pix">✎</button><button data-tool="highlighter" aria-label="Marker">▰</button><button data-tool="eraser" aria-label="Gumă">⌫</button>
          <button data-undo aria-label="Anulează">↶</button><button data-redo aria-label="Refă">↷</button>
          <input data-color type="color" value="${color}" aria-label="Culoare"><input data-width type="range" min="1" max="12" value="${width}" aria-label="Grosime">
          <select data-template aria-label="Tip pagină">${Object.entries(templates).map(([id, label]) => `<option value="${id}" ${page.template === id ? "selected" : ""}>${label}</option>`).join("")}</select>
        </div>
        <div class="notebook-paper-wrap"><canvas class="notebook-paper" aria-label="Scrie cu Apple Pencil sau degetul"></canvas></div>
        <footer class="notebook-footer"><button data-prev ${activePage === 0 ? "disabled" : ""}>‹ Pagina anterioară</button><span>Pagina ${activePage + 1} din ${notebook.pages.length}</span><button data-next ${activePage === notebook.pages.length - 1 ? "disabled" : ""}>Pagina următoare ›</button><button class="primary-small-button" data-add-page>+ Pagină</button></footer>
      </section>`;
    canvas = root.querySelector("canvas"); ctx = canvas.getContext("2d", { desynchronized: true }); resize(); bind();
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); redraw();
  }
  function page() { return notebook.pages[activePage]; }
  function background() {
    const rect = canvas.getBoundingClientRect(); ctx.clearRect(0, 0, rect.width, rect.height); ctx.fillStyle = "#fffdf9"; ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "rgba(142, 169, 207, .28)"; ctx.lineWidth = 1;
    if (page().template === "lined") for (let y = 42; y < rect.height; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke(); }
    if (page().template === "grid") for (let x = 20; x < rect.width; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke(); };
    if (page().template === "grid") for (let y = 20; y < rect.height; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke(); }
    ctx.strokeStyle = "rgba(224, 109, 136, .26)"; ctx.beginPath(); ctx.moveTo(44, 0); ctx.lineTo(44, rect.height); ctx.stroke();
  }
  function drawStroke(stroke) {
    if (!stroke.points?.length) return; const rect = canvas.getBoundingClientRect();
    ctx.save(); ctx.globalAlpha = stroke.tool === "highlighter" ? .24 : 1; ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.lineCap = ctx.lineJoin = "round"; ctx.beginPath();
    stroke.points.forEach((point, index) => { const x = point[0] * rect.width, y = point[1] * rect.height; index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.restore();
  }
  function redraw() { if (!ctx || !canvas) return; background(); page().strokes.forEach(drawStroke); }
  function queueRedraw() { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; redraw(); }); }
  function point(event) { const rect = canvas.getBoundingClientRect(); return [Number(((event.clientX - rect.left) / rect.width).toFixed(4)), Number(((event.clientY - rect.top) / rect.height).toFixed(4))]; }
  function begin(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return; event.preventDefault(); canvas.setPointerCapture(event.pointerId); redo = [];
    drawing = { tool, color, width: tool === "highlighter" ? width * 3 : width, points: [point(event)] }; page().strokes.push(drawing); queueRedraw();
  }
  function move(event) { if (!drawing || !canvas.hasPointerCapture(event.pointerId)) return; event.preventDefault(); const next = point(event), last = drawing.points.at(-1); if (Math.abs(next[0] - last[0]) + Math.abs(next[1] - last[1]) < .002) return; drawing.points.push(next); queueRedraw(); }
  function finish(event) { if (!drawing) return; if (drawing.points.length === 1) drawing.points.push([drawing.points[0][0] + .001, drawing.points[0][1] + .001]); drawing = null; persistSoon(); }
  function bind() {
    root.querySelectorAll("[data-tool]").forEach(button => button.addEventListener("click", () => { tool = button.dataset.tool; root.querySelectorAll("[data-tool]").forEach(item => item.classList.toggle("active", item === button)); }));
    root.querySelector("[data-color]").addEventListener("input", e => { color = e.target.value; }); root.querySelector("[data-width]").addEventListener("input", e => { width = Number(e.target.value); });
    root.querySelector("[data-template]").addEventListener("change", e => { page().template = e.target.value; persistSoon(); redraw(); });
    root.querySelector("[data-undo]").addEventListener("click", () => { const item = page().strokes.pop(); if (item) { redo.push(item); persistSoon(); redraw(); } });
    root.querySelector("[data-redo]").addEventListener("click", () => { const item = redo.pop(); if (item) { page().strokes.push(item); persistSoon(); redraw(); } });
    root.querySelector("[data-prev]").addEventListener("click", () => { activePage--; render(); }); root.querySelector("[data-next]").addEventListener("click", () => { activePage++; render(); });
    root.querySelector("[data-add-page]").addEventListener("click", () => { notebook.pages.push({ template: page().template, strokes: [] }); activePage = notebook.pages.length - 1; persistSoon(); render(); });
    canvas.addEventListener("pointerdown", begin, { passive: false }); canvas.addEventListener("pointermove", move, { passive: false }); canvas.addEventListener("pointerup", finish); canvas.addEventListener("pointercancel", finish);
    global.addEventListener("resize", resize, { once: true });
  }
  function escape(value) { return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
  global.IteraNotebookView = Object.freeze({ mount, unmount });
})(window);
