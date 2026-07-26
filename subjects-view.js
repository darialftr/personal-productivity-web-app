"use strict";

(function (global) {
  let root, user, mounted = false, timerStartedAt = null, timerInterval = null;
  let pdfDocument = null, pdfPage = 1, pdfScale = 1.15, pdfRendering = false;
  let currentPdfPath = null;
  const pdfLastPages = new Map();

  async function session() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    user = session?.user || null;
    return user;
  }

  async function mountList() {
    unmount();
    mounted = true;
    root = document.getElementById("subjectsViewRoot");
    root.innerHTML = '<div class="subjects-spa-state">Se încarcă materiile…</div>';
    if (!await session() || !mounted) return;
    const { data, error } = await supabaseClient.from("subjects").select("*")
      .eq("user_id", user.id).eq("is_active", true).order("position").order("name");
    if (!mounted) return;
    if (error) {
      root.innerHTML = '<div class="subjects-spa-state">Materiile nu au putut fi încărcate.</div>';
      return;
    }
    renderList(data || []);
  }

  function renderList(subjects) {
    root.innerHTML = `
      <header class="subjects-spa-header"><div><p class="eyebrow">Învățare</p><h2>Materiile tale</h2>
      <p>${subjects.length} materii active, toate sincronizate.</p></div>
      <button class="primary-small-button" data-add-subject><span aria-hidden="true">+</span> Materie</button></header>
      <section class="subjects-spa-grid">${subjects.length ? subjects.map(subjectCard).join("") :
        '<div class="subjects-spa-state">Adaugă prima materie pentru a începe.</div>'}</section>
      <dialog class="subjects-spa-dialog"><form data-subject-form>
        <div class="subjects-spa-dialog-head"><h3>Materie nouă</h3><button type="button" class="icon-button" data-close-subject>×</button></div>
        <label>Nume<input name="name" required></label><div class="subjects-spa-fields">
        <label>Profesor<input name="teacher_name"></label><label>Sala<input name="room"></label>
        <label>Culoare<input name="color" type="color" value="#f3a9c5"></label></div>
        <p class="subjects-spa-error" data-subject-error></p>
        <div class="subjects-spa-actions"><button class="primary-button">Adaugă materia</button></div>
      </form></dialog>`;
    root.querySelector("[data-add-subject]").addEventListener("click", () => root.querySelector("dialog").showModal());
    root.querySelector("[data-close-subject]").addEventListener("click", () => root.querySelector("dialog").close());
    root.querySelector("[data-subject-form]").addEventListener("submit", saveSubject);
  }

  function subjectCard(subject) {
    return `<a class="subjects-spa-card" href="#/subjects/${subject.id}" style="--subject:${subject.color || "#f3a9c5"}">
      <span class="subjects-spa-icon">${escapeHtml(subject.icon || subject.name.charAt(0))}</span>
      <div><p class="eyebrow">Materie</p><h3>${escapeHtml(subject.name)}</h3>
      <small>${escapeHtml(subject.teacher_name || "Fără profesor")}${subject.room ? ` · ${escapeHtml(subject.room)}` : ""}</small></div>
      <span class="subjects-spa-arrow">›</span></a>`;
  }

  async function saveSubject(event) {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    const { error } = await supabaseClient.from("subjects").insert({
      user_id: user.id, name: values.name.trim(), teacher_name: values.teacher_name.trim() || null,
      room: values.room.trim() || null, color: values.color, is_active: true, position: 9999
    });
    if (error) {
      form.querySelector("[data-subject-error]").textContent = "Materia nu a putut fi adăugată.";
      return;
    }
    form.closest("dialog").close();
    mounted = false;
    await mountList();
  }

  async function mountDetail(subjectId) {
    unmount();
    mounted = true;
    root = document.getElementById("subjectDetailViewRoot");
    root.innerHTML = '<div class="subjects-spa-state">Se încarcă materia…</div>';
    if (!await session() || !mounted) return;
    const [subject, grades, sessions, books, resources, tasks, events, goals] = await Promise.all([
      query("subjects", builder => builder.eq("id", subjectId).maybeSingle()),
      query("subject_grades", builder => builder.eq("subject_id", subjectId).order("grade_date", { ascending: false })),
      query("subject_study_sessions", builder => builder.eq("subject_id", subjectId).order("study_date", { ascending: false })),
      query("subject_books", builder => builder.eq("subject_id", subjectId)),
      query("subject_resources", builder => builder.eq("subject_id", subjectId)),
      query("tasks", builder => builder.eq("subject_id", subjectId).eq("completed", false)),
      query("calendar_events", builder => builder.eq("subject_id", subjectId)),
      query("subject_goals", builder => builder.eq("subject_id", subjectId))
    ]);
    if (!mounted || !subject.data) return;
    renderDetail(subjectId, subject.data, {
      grades: grades.data || [], sessions: sessions.data || [], books: books.data || [],
      resources: resources.data || [], tasks: tasks.data || [], events: events.data || [], goals: goals.data || []
    });
  }

  async function query(table, refine) {
    let builder = supabaseClient.from(table).select("*").eq("user_id", user.id);
    return refine(builder);
  }

  function renderDetail(id, subject, data) {
    const validGrades = data.grades.map(item => Number(item.grade)).filter(Number.isFinite);
    const average = validGrades.length ? (validGrades.reduce((a, b) => a + b, 0) / validGrades.length).toFixed(2) : "—";
    const minutes = data.sessions.reduce((sum, item) => sum + Number(item.duration_minutes || 0), 0);
    const tests = data.tasks.filter(item => item.task_type === "test").length;
    const regularTasks = data.tasks.length - tests;
    root.innerHTML = `
      <a class="subjects-spa-back" href="#/subjects">← Materii</a>
      <section class="subject-spa-hero" style="--subject:${subject.color || "#f3a9c5"}">
        <div><p class="eyebrow">Materia ta</p><h2>${escapeHtml(subject.name)}</h2>
        <p>${escapeHtml(subject.teacher_name || "Spațiul tău de studiu")}${subject.room ? ` · ${escapeHtml(subject.room)}` : ""}</p></div>
        <button class="primary-small-button" data-study-timer>▶ Start focus</button>
      </section>
      <section class="subject-spa-stats"><article><span>Medie</span><strong>${average}</strong></article>
        <article><span>Task-uri</span><strong>${regularTasks}</strong></article>
        <article><span>Teste</span><strong>${tests}</strong></article>
        <article><span>Ore studiate</span><strong>${formatMinutes(minutes)}</strong></article></section>
      <div class="subject-spa-columns">
        <section class="subject-spa-panel"><div class="subject-spa-panel-head"><h3>Note</h3><button data-add-grade aria-label="Adaugă o notă"><span aria-hidden="true">+</span></button></div>
          ${data.grades.length ? data.grades.map(item => `<div class="subject-spa-row"><b>${item.grade}</b><span>${escapeHtml(item.description || item.grade_type || "Notă")}</span><small>${item.grade_date || ""}</small></div>`).join("") : empty("Nicio notă")}</section>
        <section class="subject-spa-panel"><h3>Task-uri active</h3>${data.tasks.length ? data.tasks.map(item => `<a class="subject-spa-row" href="#/tasks"><b>✓</b><span>${escapeHtml(item.title)}</span><small>${item.deadline_date || ""}</small></a>`).join("") : empty("Niciun task activ")}</section>
        <section class="subject-spa-panel"><div class="subject-spa-panel-head"><h3>Resurse și cărți</h3>
          <button data-add-pdf><span aria-hidden="true">+</span> PDF</button></div>${[...data.books, ...data.resources].length ?
          [...data.books, ...data.resources].map(item => `<button class="subject-spa-row subject-spa-resource" data-open-pdf="${item.id}" data-file-path="${escapeHtml(item.file_path || "")}" data-resource-title="${escapeHtml(item.title)}"><b>◇</b><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.author || item.resource_type || "")}</small></button>`).join("") : empty("Nicio resursă")}</section>
        <section class="subject-spa-panel"><h3>Obiective</h3>${data.goals.length ? data.goals.map(item => `<div class="subject-spa-row"><b>${item.completed ? "✓" : "○"}</b><span>${escapeHtml(item.title)}</span></div>`).join("") : empty("Niciun obiectiv")}</section>
      </div>
      <dialog class="subject-pdf-upload"><form data-pdf-form>
        <div class="subjects-spa-dialog-head"><h3>Adaugă un PDF</h3><button type="button" class="icon-button" data-close-pdf-upload>×</button></div>
        <label>Titlu<input name="title" required placeholder="Ex: Manual de matematică"></label>
        <label>Autor<input name="author" placeholder="Opțional"></label>
        <label>Fișier PDF<input name="pdf" type="file" accept="application/pdf,.pdf" required></label>
        <p class="subjects-spa-error" data-pdf-error></p>
        <button class="primary-button">Încarcă PDF-ul</button>
      </form></dialog>
      <dialog class="subject-pdf-viewer">
        <div class="pdf-viewer-shell">
          <header class="pdf-viewer-toolbar">
            <strong data-pdf-title>Document</strong>
            <div class="pdf-page-controls">
              <button data-pdf-prev aria-label="Pagina anterioară">‹</button>
              <label>Pagina <input data-pdf-page type="number" min="1" value="1"> <span data-pdf-count>/ 1</span></label>
              <button data-pdf-next aria-label="Pagina următoare">›</button>
            </div>
            <div class="pdf-zoom-controls">
              <button data-pdf-zoom-out aria-label="Micșorează">−</button>
              <span data-pdf-zoom>100%</span>
              <button data-pdf-zoom-in aria-label="Mărește"><span aria-hidden="true">+</span></button>
              <button data-close-pdf-viewer aria-label="Închide">×</button>
            </div>
          </header>
          <div class="pdf-canvas-wrap"><canvas data-pdf-canvas></canvas></div>
          <p class="subjects-spa-error" data-viewer-error></p>
        </div>
      </dialog>`;
    root.querySelector("[data-add-grade]").addEventListener("click", () => addGrade(id));
    root.querySelector("[data-study-timer]").addEventListener("click", event => toggleTimer(id, event.currentTarget));
    root.querySelector("[data-add-pdf]").addEventListener("click", () => root.querySelector(".subject-pdf-upload").showModal());
    root.querySelector("[data-close-pdf-upload]").addEventListener("click", () => root.querySelector(".subject-pdf-upload").close());
    root.querySelector("[data-pdf-form]").addEventListener("submit", event => uploadPdf(event, id));
    root.querySelectorAll("[data-open-pdf]").forEach(button => button.addEventListener("click", () => {
      if (button.dataset.filePath) openPdf(button.dataset.filePath, button.dataset.resourceTitle);
    }));
    bindPdfViewer();
  }

  async function addGrade(subjectId) {
    const value = prompt("Nota (1–10)");
    if (value === null) return;
    const grade = Number(value);
    if (!Number.isFinite(grade) || grade < 1 || grade > 10) return;
    const description = prompt("Descriere opțională") || null;
    const { error } = await supabaseClient.from("subject_grades").insert({
      user_id: user.id, subject_id: subjectId, grade, description, grade_date: new Date().toISOString().slice(0, 10)
    });
    if (!error) { mounted = false; await mountDetail(subjectId); }
  }

  async function uploadPdf(event, subjectId) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.pdf.files[0];
    const errorElement = form.querySelector("[data-pdf-error]");
    errorElement.textContent = "";

    if (!file || (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
      errorElement.textContent = "Alege un fișier PDF.";
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      errorElement.textContent = "PDF-ul este prea mare. Limita este de 50 MB.";
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const filePath = `${user.id}/${subjectId}/${Date.now()}-${safeName}`;
    const submitButton = form.querySelector(".primary-button");
    submitButton.disabled = true;
    submitButton.textContent = "Se încarcă…";

    const { error: uploadError } = await supabaseClient.storage
      .from("subject-files")
      .upload(filePath, file, { contentType: "application/pdf", upsert: false });

    if (uploadError) {
      const uploadMessage = String(uploadError.message || "").toLowerCase();
      if (uploadMessage.includes("bucket") && uploadMessage.includes("not found")) {
        errorElement.textContent = "Spațiul pentru PDF-uri nu este încă configurat.";
      } else if (uploadMessage.includes("row-level security") || uploadMessage.includes("policy")) {
        errorElement.textContent = "Nu ai permisiunea de a încărca în acest folder. Reautentifică-te și încearcă din nou.";
      } else if (uploadMessage.includes("maximum allowed size") || uploadMessage.includes("too large")) {
        errorElement.textContent = "PDF-ul depășește limita de 50 MB.";
      } else {
        errorElement.textContent = `PDF-ul nu a putut fi încărcat: ${uploadError.message || "eroare necunoscută"}`;
      }
      submitButton.disabled = false;
      submitButton.textContent = "Încarcă PDF-ul";
      return;
    }

    const { error: bookError } = await supabaseClient.from("subject_books").insert({
      user_id: user.id,
      subject_id: subjectId,
      title: form.elements.title.value.trim(),
      author: form.elements.author.value.trim() || null,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type
    });

    if (bookError) {
      await supabaseClient.storage.from("subject-files").remove([filePath]);
      errorElement.textContent = "Datele PDF-ului nu au putut fi salvate.";
      submitButton.disabled = false;
      submitButton.textContent = "Încarcă PDF-ul";
      return;
    }

    form.closest("dialog").close();
    mounted = false;
    await mountDetail(subjectId);
  }

  function bindPdfViewer() {
    const viewer = root.querySelector(".subject-pdf-viewer");
    viewer.querySelector("[data-close-pdf-viewer]").addEventListener("click", () => viewer.close());
    viewer.querySelector("[data-pdf-prev]").addEventListener("click", () => changePdfPage(pdfPage - 1));
    viewer.querySelector("[data-pdf-next]").addEventListener("click", () => changePdfPage(pdfPage + 1));
    viewer.querySelector("[data-pdf-page]").addEventListener("change", event => changePdfPage(Number(event.target.value)));
    viewer.querySelector("[data-pdf-zoom-in]").addEventListener("click", () => changePdfZoom(0.15));
    viewer.querySelector("[data-pdf-zoom-out]").addEventListener("click", () => changePdfZoom(-0.15));
  }

  async function openPdf(filePath, title) {
    const viewer = root.querySelector(".subject-pdf-viewer");
    const errorElement = viewer.querySelector("[data-viewer-error]");
    errorElement.textContent = "";
    viewer.querySelector("[data-pdf-title]").textContent = title;
    currentPdfPath = filePath;
    viewer.showModal();

    if (!global.pdfjsLib) {
      errorElement.textContent = "Viewerul PDF nu s-a putut încărca.";
      return;
    }

    const { data, error } = await supabaseClient.storage
      .from("subject-files")
      .createSignedUrl(filePath, 3600);
    if (error || !data?.signedUrl) {
      errorElement.textContent = "PDF-ul nu a putut fi deschis.";
      return;
    }

    try {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      pdfDocument = await global.pdfjsLib.getDocument(data.signedUrl).promise;
      pdfPage = Math.min(pdfDocument.numPages, pdfLastPages.get(filePath) || 1);
      pdfScale = 1.15;
      viewer.querySelector("[data-pdf-count]").textContent = `/ ${pdfDocument.numPages}`;
      await renderPdfPage();
    } catch (error) {
      errorElement.textContent = "PDF-ul nu a putut fi randat.";
    }
  }

  async function changePdfPage(nextPage) {
    if (!pdfDocument || pdfRendering) return;
    pdfPage = Math.max(1, Math.min(pdfDocument.numPages, Number(nextPage) || 1));
    await renderPdfPage();
  }

  async function changePdfZoom(delta) {
    if (!pdfDocument || pdfRendering) return;
    pdfScale = Math.max(0.55, Math.min(2.5, pdfScale + delta));
    await renderPdfPage();
  }

  async function renderPdfPage() {
    if (!pdfDocument) return;
    pdfRendering = true;
    const viewer = root.querySelector(".subject-pdf-viewer");
    const page = await pdfDocument.getPage(pdfPage);
    const viewport = page.getViewport({ scale: pdfScale });
    const canvas = viewer.querySelector("[data-pdf-canvas]");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;
    viewer.querySelector("[data-pdf-page]").value = pdfPage;
    viewer.querySelector("[data-pdf-zoom]").textContent = `${Math.round(pdfScale * 100)}%`;
    if (currentPdfPath) pdfLastPages.set(currentPdfPath, pdfPage);
    pdfRendering = false;
  }

  async function toggleTimer(subjectId, button) {
    if (!timerStartedAt) {
      timerStartedAt = new Date();
      button.textContent = "■ Oprește focus";
      timerInterval = setInterval(() => {
        const seconds = Math.floor((Date.now() - timerStartedAt.getTime()) / 1000);
        button.textContent = `■ ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      }, 1000);
      return;
    }
    clearInterval(timerInterval);
    const endedAt = new Date(), duration = Math.max(1, Math.round((endedAt - timerStartedAt) / 60000));
    await supabaseClient.from("subject_study_sessions").insert({
      user_id: user.id, subject_id: subjectId, started_at: timerStartedAt.toISOString(),
      ended_at: endedAt.toISOString(), duration_minutes: duration, source: "timer"
    });
    timerStartedAt = null;
    mounted = false;
    await mountDetail(subjectId);
  }

  function unmount() {
    mounted = false;
    root = null;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    timerStartedAt = null;
  }

  function empty(text) { return `<div class="subject-spa-empty">${text}</div>`; }
  function formatMinutes(value) { return value < 60 ? `${value}m` : `${Math.floor(value / 60)}h ${value % 60}m`; }
  function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  global.IteraSubjectsView = Object.freeze({ mountList, mountDetail, unmount });
})(window);
