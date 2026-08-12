"use strict";

(function (global) {
  let root, user, mounted = false;
  let activeSubjectId = null;
  let pdfDocument = null, pdfPage = 1, pdfScale = 1.15, pdfRendering = false;
  let pdfLoadToken = 0, pdfLoadingTask = null, pdfRenderTask = null;
  const pdfDocumentCache = new Map();
  const pdfSignedUrlCache = new Map();
  let currentPdfPath = null;
  const pdfLastPages = new Map();
  const PDF_PROGRESS_METADATA_KEY = "itera_pdf_progress";
  const PDF_ANNOTATIONS_METADATA_KEY = "itera_pdf_annotations";
  let currentPdfSubjectId = null;
  let currentPdfTitle = "Document";
  let pdfProgressSaveTimer = null;
  let pendingPdfProgress = null;
  let pdfProgressWrite = Promise.resolve();
  let focusTimerListener = null;
  let pdfNoteDirty = false;
  let pdfLibraryPromise = null;

  function loadPdfLibrary() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    if (pdfLibraryPromise) return pdfLibraryPromise;

    pdfLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
      script.async = true;
      script.onload = () => global.pdfjsLib ? resolve(global.pdfjsLib) : reject(new Error("pdf-library"));
      script.onerror = () => reject(new Error("pdf-library"));
      document.head.appendChild(script);
    }).catch((error) => {
      pdfLibraryPromise = null;
      throw error;
    });

    return pdfLibraryPromise;
  }

  async function session() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    user = session?.user || null;
    return user;
  }

  async function mountList() {
    unmount();
    activeSubjectId = null;
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
    bindPointerReorder(
      root.querySelector(".subjects-spa-grid"),
      "[data-subject-order]",
      "[data-reorder-handle]",
      saveSubjectOrder
    );
  }

  function subjectCard(subject) {
    return `<a class="subjects-spa-card" href="#/subjects/${subject.id}" data-subject-order="${subject.id}" data-order-key="${subject.id}" style="--subject:${subject.color || "#f3a9c5"}">
      <span class="subjects-spa-icon">${escapeHtml(subject.icon || subject.name.charAt(0))}</span>
      <div><p class="eyebrow">Materie</p><h3>${escapeHtml(subject.name)}</h3>
      <small>${escapeHtml(subject.teacher_name || "Fără profesor")}${subject.room ? ` · ${escapeHtml(subject.room)}` : ""}</small></div>
      <span class="subjects-spa-arrow">›</span><span class="reorder-grip" data-reorder-handle aria-label="Mută materia">⋮⋮</span></a>`;
  }

  async function saveSubjectOrder(order) {
    const results = await Promise.all(order.map((id, position) =>
      supabaseClient.from("subjects").update({ position }).eq("id", id).eq("user_id", user.id)
    ));
    if (results.some(result => result.error)) {
      global.showToast?.("Ordinea materiilor nu a putut fi salvată.", "!");
      mounted = false;
      await mountList();
      return;
    }
    global.showToast?.("Ordinea materiilor a fost salvată.", "✓");
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
    activeSubjectId = subjectId;
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
    const storedPdfOrder = user?.user_metadata?.itera_pdf_order?.[id] || [];
    const pdfOrderIndex = new Map(storedPdfOrder.map((key, index) => [String(key), index]));
    const pdfItems = [
      ...data.books.map(item => ({ ...item, orderKey: `book:${item.id}` })),
      ...data.resources.map(item => ({ ...item, orderKey: `resource:${item.id}` }))
    ].sort((first, second) =>
      (pdfOrderIndex.get(first.orderKey) ?? 9999) - (pdfOrderIndex.get(second.orderKey) ?? 9999) ||
      String(first.created_at || "").localeCompare(String(second.created_at || ""))
    );
    const savedPdfProgress = user?.user_metadata?.[PDF_PROGRESS_METADATA_KEY] || {};
    root.innerHTML = `
      <a class="subjects-spa-back" href="#/subjects">← Materii</a>
      <section class="subject-spa-hero" style="--subject:${subject.color || "#f3a9c5"}">
        <div><p class="eyebrow">Materia ta</p><h2>${escapeHtml(subject.name)}</h2>
        ${subject.teacher_name ? `<p>${escapeHtml(subject.teacher_name)}${subject.room ? ` · ${escapeHtml(subject.room)}` : ""}</p>` : '<button class="subject-inline-edit" data-edit-subject>+ Adaugă profesorul și sala</button>'}</div>
        <div class="subject-hero-actions"><button class="subject-edit-button" data-edit-subject>Editează materia</button>
        <button class="primary-small-button" data-study-timer>▶ Start focus</button></div>
      </section>
      <dialog class="subject-focus-dialog" data-subject-focus-dialog>
        <form data-subject-focus-form>
          <div class="subject-focus-head"><div><p class="card-kicker">Sesiune pentru ${escapeHtml(subject.name)}</p><h3>Cât timp studiezi?</h3></div>
          <button type="button" class="icon-button" data-close-subject-focus aria-label="Închide">×</button></div>
          <p class="subject-focus-copy">Alege o durată realistă. Timerul rămâne vizibil oriunde mergi în Itera.</p>
          <div class="subject-focus-presets" role="group" aria-label="Durata sesiunii">
            ${[25, 45, 60, 90].map(duration => `<button type="button" class="${duration === 45 ? "active" : ""}" data-subject-focus-duration="${duration}"><strong>${duration}</strong><span>min</span></button>`).join("")}
          </div>
          <label class="subject-focus-custom"><span>Altă durată</span><span><input name="duration" type="number" min="5" max="240" step="5" value="45" inputmode="numeric"> minute</span></label>
          <button type="submit" class="primary-button subject-focus-start">▶ Pornește sesiunea</button>
        </form>
      </dialog>
      <section class="subject-spa-stats"><article><span>Medie</span><strong>${average}</strong></article>
        <article><span>Task-uri</span><strong>${regularTasks}</strong></article>
        <article><span>Teste</span><strong>${tests}</strong></article>
        <article><span>Ore studiate</span><strong>${formatMinutes(minutes)}</strong></article></section>
      <div class="subject-spa-columns">
        <section class="subject-spa-panel"><div class="subject-spa-panel-head"><h3>Note</h3><button data-add-grade aria-label="Adaugă o notă"><span aria-hidden="true">+</span></button></div>
          ${data.grades.length ? data.grades.map(item => `<div class="subject-spa-row"><b>${item.grade}</b><span>${escapeHtml(item.description || item.grade_type || "Notă")}</span><small>${item.grade_date || ""}</small></div>`).join("") : emptyAction("Nicio notă încă", "Adaugă prima notă", "data-add-grade")}</section>
        <section class="subject-spa-panel"><h3>Task-uri active</h3>${data.tasks.length ? data.tasks.map(item => `<a class="subject-spa-row" href="#/tasks"><b>✓</b><span>${escapeHtml(item.title)}</span><small>${item.deadline_date || ""}</small></a>`).join("") : empty("Niciun task activ")}</section>
        <section class="subject-spa-panel subject-resources-panel"><div class="subject-spa-panel-head"><div><p class="card-kicker">Biblioteca ta</p><h3>Resurse și cărți</h3></div>
          <button data-add-pdf><span aria-hidden="true">+</span><span>PDF</span></button></div><div class="subject-resource-list">${pdfItems.length ?
          pdfItems.map(item => {
            const lastPage = Math.max(1, Number(savedPdfProgress[item.file_path]?.page) || 1);
            const hasProgress = lastPage > 1;
            return `<button class="subject-spa-resource" data-open-pdf="${item.id}" data-order-key="${escapeHtml(item.orderKey)}" data-file-path="${escapeHtml(item.file_path || "")}" data-resource-title="${escapeHtml(item.title)}">
              <span class="subject-resource-icon" aria-hidden="true"><b>PDF</b><i></i></span>
              <span class="subject-resource-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.author || item.resource_type || "Document PDF")}</small>
                <span class="subject-resource-status ${hasProgress ? "has-progress" : ""}"><i aria-hidden="true"></i>${hasProgress ? `Continuă de la pagina ${lastPage}` : "Pregătit pentru studiu"}</span></span>
              <span class="subject-resource-open"><span>Deschide</span><b aria-hidden="true">→</b></span><span class="reorder-grip resource-reorder-grip" data-reorder-handle aria-label="Mută PDF-ul">⋮⋮</span>
            </button>`;
          }).join("") : emptyAction("Biblioteca este goală", "Adaugă primul PDF", "data-add-pdf")}</div></section>
        <section class="subject-spa-panel subject-goals-panel"><div class="subject-spa-panel-head"><h3>Obiective</h3><button data-add-goal aria-label="Adaugă un obiectiv"><span aria-hidden="true">+</span></button></div>${data.goals.length ? data.goals.map(item => `<button class="subject-spa-row subject-goal-row ${item.completed ? "completed" : ""}" data-goal-id="${item.id}" data-goal-completed="${Boolean(item.completed)}"><b>${item.completed ? "✓" : "○"}</b><span>${escapeHtml(item.title)}</span></button>`).join("") : emptyAction("Niciun obiectiv încă", "Creează primul obiectiv", "data-add-goal")}</section>
      </div>
      <dialog class="subjects-spa-dialog subject-grade-dialog"><form data-grade-form>
        <div class="subjects-spa-dialog-head"><div><p class="card-kicker">Progres</p><h3>Adaugă o notă</h3></div><button type="button" class="icon-button" data-close-grade>×</button></div>
        <div class="subjects-spa-fields"><label>Nota<input name="grade" type="number" min="1" max="10" step="0.01" inputmode="decimal" required placeholder="10"></label>
        <label>Data<input name="grade_date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label></div>
        <label>La ce?<input name="description" maxlength="160" placeholder="Ex: Test algebră (opțional)"></label>
        <p class="subjects-spa-error" data-grade-error></p>
        <div class="subjects-spa-actions"><button class="primary-button">Salvează nota</button></div>
      </form></dialog>
      <dialog class="subjects-spa-dialog subject-detail-dialog"><form data-subject-edit-form>
        <div class="subjects-spa-dialog-head"><div><p class="card-kicker">Detalii materie</p><h3>Editează materia</h3></div><button type="button" class="icon-button" data-close-subject-edit>×</button></div>
        <label>Nume<input name="name" required value="${escapeHtml(subject.name)}"></label><div class="subjects-spa-fields">
        <label>Profesor<input name="teacher_name" value="${escapeHtml(subject.teacher_name || "")}" placeholder="Ex: Andrei Popescu"></label>
        <label>Sala<input name="room" value="${escapeHtml(subject.room || "")}" placeholder="Opțional"></label>
        <label>Culoare<input name="color" type="color" value="${escapeHtml(subject.color || "#f3a9c5")}"></label></div>
        <p class="subjects-spa-error" data-subject-edit-error></p>
        <div class="subjects-spa-actions"><button class="primary-button">Salvează modificările</button></div>
      </form></dialog>
      <dialog class="subjects-spa-dialog subject-goal-dialog"><form data-goal-form>
        <div class="subjects-spa-dialog-head"><div><p class="card-kicker">Un pas clar</p><h3>Obiectiv nou</h3></div><button type="button" class="icon-button" data-close-goal>×</button></div>
        <label>Ce vrei să obții?<input name="title" required maxlength="160" placeholder="Ex: Termin capitolul de algebră"></label>
        <p class="subjects-spa-error" data-goal-error></p>
        <div class="subjects-spa-actions"><button class="primary-button">Adaugă obiectivul</button></div>
      </form></dialog>
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
            <div class="pdf-viewer-title">
              <strong data-pdf-title>Document</strong>
              <button type="button" class="pdf-focus-pill" data-pdf-focus-pill hidden>
                <span aria-hidden="true"></span>
                <b data-pdf-focus-subject>Focus</b>
                <strong data-pdf-focus-time>00:00</strong>
              </button>
            </div>
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
          <div class="pdf-study-actions">
            <button type="button" data-pdf-bookmark>◇ Marchează pagina</button>
            <button type="button" data-pdf-note-toggle>✎ Notiță</button>
            <button type="button" data-pdf-task>+ Repetă pagina</button>
          </div>
          <div class="pdf-study-layout">
            <div class="pdf-canvas-wrap">
              <button type="button" class="pdf-edge-nav pdf-edge-prev" data-pdf-edge-prev aria-label="Pagina anterioară">‹</button>
              <canvas data-pdf-canvas></canvas>
              <div class="pdf-loading-state" data-pdf-loading hidden><span></span><strong>Deschid documentul…</strong></div>
              <button type="button" class="pdf-edge-nav pdf-edge-next" data-pdf-edge-next aria-label="Pagina următoare">›</button>
            </div>
            <aside class="pdf-notes-panel" data-pdf-notes-panel hidden>
              <div><strong>Notiță la pagina <span data-pdf-note-page>1</span></strong><button type="button" data-pdf-note-close aria-label="Închide notița">×</button></div>
              <textarea data-pdf-note rows="10" placeholder="Idei, formule sau lucruri de repetat…"></textarea>
              <button type="button" class="primary-small-button" data-pdf-note-save>Salvează notița</button>
              <small data-pdf-note-status></small>
            </aside>
          </div>
          <p class="subjects-spa-error" data-viewer-error></p>
        </div>
      </dialog>`;
    root.querySelectorAll("[data-add-grade]").forEach(button => button.addEventListener("click", () => root.querySelector(".subject-grade-dialog").showModal()));
    root.querySelector("[data-close-grade]").addEventListener("click", () => root.querySelector(".subject-grade-dialog").close());
    root.querySelector("[data-grade-form]").addEventListener("submit", event => addGrade(event, id));
    const focusDialog = root.querySelector("[data-subject-focus-dialog]");
    const focusForm = root.querySelector("[data-subject-focus-form]");
    const focusDurationInput = focusForm.elements.duration;
    const selectFocusDuration = duration => {
      focusDurationInput.value = String(duration);
      focusForm.querySelectorAll("[data-subject-focus-duration]").forEach(button => {
        button.classList.toggle("active", Number(button.dataset.subjectFocusDuration) === Number(duration));
      });
    };
    root.querySelector("[data-study-timer]").addEventListener("click", () => focusDialog.showModal());
    root.querySelector("[data-close-subject-focus]").addEventListener("click", () => focusDialog.close());
    focusDialog.addEventListener("click", event => {
      if (event.target === focusDialog) focusDialog.close();
    });
    focusForm.querySelectorAll("[data-subject-focus-duration]").forEach(button => {
      button.addEventListener("click", () => selectFocusDuration(Number(button.dataset.subjectFocusDuration)));
    });
    focusDurationInput.addEventListener("input", () => selectFocusDuration(Number(focusDurationInput.value)));
    focusForm.addEventListener("submit", event => {
      event.preventDefault();
      const duration = Math.max(5, Math.min(240, Number(focusDurationInput.value) || 45));
      focusDialog.close();
      global.IteraFocus?.startSubject(subject, duration);
    });
    root.querySelectorAll("[data-edit-subject]").forEach(button => button.addEventListener("click", () => root.querySelector(".subject-detail-dialog").showModal()));
    root.querySelector("[data-close-subject-edit]").addEventListener("click", () => root.querySelector(".subject-detail-dialog").close());
    root.querySelector("[data-subject-edit-form]").addEventListener("submit", event => updateSubject(event, id));
    root.querySelectorAll("[data-add-goal]").forEach(button => button.addEventListener("click", () => root.querySelector(".subject-goal-dialog").showModal()));
    root.querySelector("[data-close-goal]").addEventListener("click", () => root.querySelector(".subject-goal-dialog").close());
    root.querySelector("[data-goal-form]").addEventListener("submit", event => addGoal(event, id));
    root.querySelectorAll("[data-goal-id]").forEach(button => button.addEventListener("click", () => {
      void toggleGoal(button.dataset.goalId, button.dataset.goalCompleted === "true", id);
    }));
    root.querySelectorAll("[data-add-pdf]").forEach(button => button.addEventListener("click", () => root.querySelector(".subject-pdf-upload").showModal()));
    root.querySelector("[data-close-pdf-upload]").addEventListener("click", () => root.querySelector(".subject-pdf-upload").close());
    root.querySelector("[data-pdf-form]").addEventListener("submit", event => uploadPdf(event, id));
    root.querySelectorAll("[data-open-pdf]").forEach(button => button.addEventListener("click", () => {
      if (button.dataset.filePath) openPdf(button.dataset.filePath, button.dataset.resourceTitle, id);
    }));
    bindPointerReorder(
      root.querySelector(".subject-resource-list"),
      "[data-order-key]",
      "[data-reorder-handle]",
      order => savePdfOrder(id, order)
    );
    const warmResources = () => warmPdfUrls(pdfItems.slice(0, 4));
    if ("requestIdleCallback" in global) global.requestIdleCallback(warmResources, { timeout: 1800 });
    else global.setTimeout(warmResources, 500);
    bindPdfViewer();
  }

  async function warmPdfUrls(items) {
    await Promise.all(items.filter(item => item.file_path && !pdfSignedUrlCache.has(item.file_path)).map(async item => {
      const { data, error } = await supabaseClient.storage.from("subject-files").createSignedUrl(item.file_path, 3600);
      if (!error && data?.signedUrl) {
        pdfSignedUrlCache.set(item.file_path, { url: data.signedUrl, expiresAt: Date.now() + 55 * 60000 });
      }
    }));
  }

  async function savePdfOrder(subjectId, order) {
    const previous = user?.user_metadata?.itera_pdf_order || {};
    const { data, error } = await supabaseClient.auth.updateUser({
      data: { itera_pdf_order: { ...previous, [subjectId]: order } }
    });
    if (error) {
      global.showToast?.("Ordinea PDF-urilor nu a putut fi salvată.", "!");
      return;
    }
    if (data?.user) user = data.user;
    global.showToast?.("Ordinea PDF-urilor a fost salvată.", "✓");
  }

  async function updateSubject(event, subjectId) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const submitButton = form.querySelector("button[type='submit'], .primary-button");
    const errorElement = form.querySelector("[data-subject-edit-error]");
    submitButton.disabled = true;
    errorElement.textContent = "";
    const { error } = await supabaseClient.from("subjects").update({
      name: values.name.trim(),
      teacher_name: values.teacher_name.trim() || null,
      room: values.room.trim() || null,
      color: values.color
    }).eq("id", subjectId).eq("user_id", user.id);
    submitButton.disabled = false;
    if (error) {
      errorElement.textContent = "Detaliile materiei nu au putut fi salvate.";
      return;
    }
    form.closest("dialog").close();
    mounted = false;
    await mountDetail(subjectId);
  }

  async function addGoal(event, subjectId) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title") || "").trim();
    const submitButton = form.querySelector("button[type='submit'], .primary-button");
    const errorElement = form.querySelector("[data-goal-error]");
    if (!title) return;
    submitButton.disabled = true;
    errorElement.textContent = "";
    const { error } = await supabaseClient.from("subject_goals").insert({
      user_id: user.id,
      subject_id: subjectId,
      title,
      completed: false
    });
    submitButton.disabled = false;
    if (error) {
      errorElement.textContent = "Obiectivul nu a putut fi adăugat.";
      return;
    }
    form.closest("dialog").close();
    mounted = false;
    await mountDetail(subjectId);
  }

  async function toggleGoal(goalId, completed, subjectId) {
    const { error } = await supabaseClient.from("subject_goals")
      .update({ completed: !completed })
      .eq("id", goalId)
      .eq("user_id", user.id);
    if (error) return;
    mounted = false;
    await mountDetail(subjectId);
  }

  async function addGrade(event, subjectId) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const grade = Number(values.grade);
    const submitButton = form.querySelector(".primary-button");
    const errorElement = form.querySelector("[data-grade-error]");
    if (!Number.isFinite(grade) || grade < 1 || grade > 10) {
      errorElement.textContent = "Introdu o notă între 1 și 10.";
      return;
    }
    submitButton.disabled = true;
    errorElement.textContent = "";
    const { error } = await supabaseClient.from("subject_grades").insert({
      user_id: user.id,
      subject_id: subjectId,
      grade,
      description: values.description.trim() || null,
      grade_date: values.grade_date
    });
    submitButton.disabled = false;
    if (error) {
      errorElement.textContent = "Nota nu a putut fi salvată.";
      return;
    }
    form.closest("dialog").close();
    mounted = false;
    await mountDetail(subjectId);
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
    viewer.querySelector("[data-close-pdf-viewer]").addEventListener("click", () => closePdfViewer(viewer));
    viewer.addEventListener("cancel", event => {
      event.preventDefault();
      closePdfViewer(viewer);
    });
    viewer.addEventListener("click", event => {
      if (event.target === viewer) void closePdfViewer(viewer);
    });
    viewer.addEventListener("keydown", event => {
      if (["INPUT", "TEXTAREA"].includes(event.target?.tagName)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void changePdfPage(pdfPage - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void changePdfPage(pdfPage + 1);
      }
    });
    viewer.addEventListener("close", () => {
      void flushPdfProgress();
    });
    viewer.querySelector("[data-pdf-prev]").addEventListener("click", () => changePdfPage(pdfPage - 1));
    viewer.querySelector("[data-pdf-next]").addEventListener("click", () => changePdfPage(pdfPage + 1));
    viewer.querySelector("[data-pdf-edge-prev]").addEventListener("click", () => changePdfPage(pdfPage - 1));
    viewer.querySelector("[data-pdf-edge-next]").addEventListener("click", () => changePdfPage(pdfPage + 1));
    viewer.querySelector("[data-pdf-page]").addEventListener("change", event => changePdfPage(Number(event.target.value)));
    viewer.querySelector("[data-pdf-zoom-in]").addEventListener("click", () => changePdfZoom(0.15));
    viewer.querySelector("[data-pdf-zoom-out]").addEventListener("click", () => changePdfZoom(-0.15));
    viewer.querySelector("[data-pdf-note-toggle]").addEventListener("click", () => {
      const panel = viewer.querySelector("[data-pdf-notes-panel]");
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderPdfAnnotation();
    });
    viewer.querySelector("[data-pdf-note-close]").addEventListener("click", () => {
      viewer.querySelector("[data-pdf-notes-panel]").hidden = true;
    });
    viewer.querySelector("[data-pdf-bookmark]").addEventListener("click", togglePdfBookmark);
    viewer.querySelector("[data-pdf-note-save]").addEventListener("click", savePdfNote);
    viewer.querySelector("[data-pdf-note]").addEventListener("input", () => { pdfNoteDirty = true; });
    viewer.querySelector("[data-pdf-task]").addEventListener("click", createPdfReviewTask);
    viewer.querySelector("[data-pdf-focus-pill]").addEventListener("click", () => {
      global.IteraFocus?.togglePause();
    });
    focusTimerListener = event => renderPdfFocusTimer(event.detail);
    global.addEventListener("itera:focus-timer", focusTimerListener);
    renderPdfFocusTimer(global.IteraFocus?.getState());
  }

  function renderPdfFocusTimer(state) {
    const pill = root?.querySelector("[data-pdf-focus-pill]");
    if (!pill) return;
    pill.hidden = !state?.active;
    if (!state?.active) return;
    pill.classList.toggle("paused", Boolean(state.paused));
    pill.querySelector("[data-pdf-focus-subject]").textContent = state.subject || "Focus";
    pill.querySelector("[data-pdf-focus-time]").textContent = state.time || "00:00";
    pill.setAttribute("aria-label", state.paused
      ? `Continuă timerul pentru ${state.subject || "focus"}`
      : `Pune pe pauză timerul pentru ${state.subject || "focus"}`);
  }

  async function openPdf(filePath, title, subjectId) {
    const viewer = root.querySelector(".subject-pdf-viewer");
    const errorElement = viewer.querySelector("[data-viewer-error]");
    const loadingElement = viewer.querySelector("[data-pdf-loading]");
    const canvas = viewer.querySelector("[data-pdf-canvas]");
    const loadToken = ++pdfLoadToken;
    pdfLoadingTask?.destroy?.();
    pdfRenderTask?.cancel?.();
    pdfDocument = null;
    pdfRendering = false;
    errorElement.textContent = "";
    viewer.querySelector("[data-pdf-title]").textContent = title;
    currentPdfPath = filePath;
    currentPdfTitle = title || "Document";
    currentPdfSubjectId = subjectId || null;
    canvas.style.visibility = "hidden";
    canvas.width = 1;
    canvas.height = 1;
    loadingElement.hidden = false;
    viewer.classList.add("is-loading");
    if (!viewer.open) viewer.showModal();

    try {
      await loadPdfLibrary();
    } catch {
      errorElement.textContent = "Viewerul PDF nu s-a putut încărca.";
      loadingElement.hidden = true;
      viewer.classList.remove("is-loading");
      return;
    }
    if (loadToken !== pdfLoadToken) return;

    try {
      const savedProgressPromise = loadPdfProgress(filePath);
      let nextDocument = pdfDocumentCache.get(filePath) || null;
      if (!nextDocument) {
        const cachedUrl = pdfSignedUrlCache.get(filePath);
        let signedUrl = cachedUrl?.expiresAt > Date.now() ? cachedUrl.url : null;
        if (!signedUrl) {
          const { data, error } = await supabaseClient.storage
            .from("subject-files")
            .createSignedUrl(filePath, 3600);
          if (error || !data?.signedUrl) throw new Error("signed-url");
          signedUrl = data.signedUrl;
          pdfSignedUrlCache.set(filePath, { url: signedUrl, expiresAt: Date.now() + 55 * 60000 });
        }
        if (loadToken !== pdfLoadToken) return;
        global.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        const loadingTask = global.pdfjsLib.getDocument(signedUrl);
        pdfLoadingTask = loadingTask;
        nextDocument = await loadingTask.promise;
        if (pdfLoadingTask === loadingTask) pdfLoadingTask = null;
        if (loadToken !== pdfLoadToken) return;
        pdfDocumentCache.set(filePath, nextDocument);
        if (pdfDocumentCache.size > 3) {
          const oldestKey = pdfDocumentCache.keys().next().value;
          if (oldestKey !== filePath) {
            pdfDocumentCache.get(oldestKey)?.destroy?.();
            pdfDocumentCache.delete(oldestKey);
          }
        }
      }
      const savedProgress = await savedProgressPromise;
      if (loadToken !== pdfLoadToken) return;
      pdfDocument = nextDocument;
      pdfPage = Math.max(1, Math.min(
        pdfDocument.numPages,
        Number(savedProgress?.page || pdfLastPages.get(filePath) || 1)
      ));
      pdfScale = Math.max(0.55, Math.min(2.5, Number(savedProgress?.zoom) || 1.15));
      viewer.querySelector("[data-pdf-count]").textContent = `/ ${pdfDocument.numPages}`;
      await renderPdfPage(loadToken);
      await renderPdfAnnotation();
    } catch (error) {
      if (loadToken === pdfLoadToken && error?.name !== "RenderingCancelledException") {
        errorElement.textContent = "PDF-ul nu a putut fi deschis.";
      }
    } finally {
      if (loadToken === pdfLoadToken) {
        loadingElement.hidden = true;
        viewer.classList.remove("is-loading");
        canvas.style.visibility = pdfDocument ? "visible" : "hidden";
      }
    }
  }

  async function changePdfPage(nextPage) {
    if (!pdfDocument) return;
    if (!await persistPdfNoteIfDirty()) {
      root.querySelector("[data-pdf-note-status]").textContent = "Salvează notița înainte să schimbi pagina.";
      return;
    }
    pdfPage = Math.max(1, Math.min(pdfDocument.numPages, Number(nextPage) || 1));
    await renderPdfPage();
  }

  async function changePdfZoom(delta) {
    if (!pdfDocument || pdfRendering) return;
    pdfScale = Math.max(0.55, Math.min(2.5, pdfScale + delta));
    await renderPdfPage();
  }

  async function renderPdfPage(expectedLoadToken = pdfLoadToken) {
    if (!pdfDocument) return;
    pdfRenderTask?.cancel?.();
    pdfRendering = true;
    const viewer = root.querySelector(".subject-pdf-viewer");
    const documentSnapshot = pdfDocument;
    const pageNumber = pdfPage;
    const pathSnapshot = currentPdfPath;
    let currentRenderTask = null;
    try {
      const page = await documentSnapshot.getPage(pageNumber);
      if (expectedLoadToken !== pdfLoadToken || documentSnapshot !== pdfDocument) return;
      const viewport = page.getViewport({ scale: pdfScale });
      const canvas = viewer.querySelector("[data-pdf-canvas]");
      const context = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const renderTask = page.render({ canvasContext: context, viewport });
      currentRenderTask = renderTask;
      pdfRenderTask = renderTask;
      await renderTask.promise;
      if (expectedLoadToken !== pdfLoadToken || documentSnapshot !== pdfDocument) return;
      viewer.querySelector("[data-pdf-page]").value = pageNumber;
      viewer.querySelector("[data-pdf-zoom]").textContent = `${Math.round(pdfScale * 100)}%`;
      viewer.querySelector("[data-pdf-note-page]").textContent = String(pageNumber);
      viewer.querySelector("[data-viewer-error]").textContent = "";
      if (pathSnapshot) {
        pdfLastPages.set(pathSnapshot, pageNumber);
        schedulePdfProgressSave(pathSnapshot, pageNumber, pdfScale);
      }
      await renderPdfAnnotation();
      [pageNumber - 1, pageNumber + 1]
        .filter(number => number >= 1 && number <= documentSnapshot.numPages)
        .forEach(number => { void documentSnapshot.getPage(number); });
    } catch (error) {
      if (error?.name !== "RenderingCancelledException" && expectedLoadToken === pdfLoadToken) {
        viewer.querySelector("[data-viewer-error]").textContent = "Pagina nu a putut fi afișată. Încearcă din nou.";
      }
    } finally {
      pdfRendering = false;
      if (pdfRenderTask === currentRenderTask) pdfRenderTask = null;
    }
  }

  async function closePdfViewer(viewer) {
    if (!await persistPdfNoteIfDirty()) {
      viewer.querySelector("[data-pdf-note-status]").textContent = "Notița nu a putut fi salvată. Încearcă din nou.";
      viewer.querySelector("[data-pdf-notes-panel]").hidden = false;
      return;
    }
    const progressSaved = await flushPdfProgress();
    if (progressSaved === false) {
      viewer.querySelector("[data-viewer-error]").textContent =
        "Pagina curentă nu a putut fi salvată. Verifică internetul și încearcă din nou.";
      return;
    }
    viewer.close();
    pdfLoadToken += 1;
    pdfLoadingTask?.destroy?.();
    pdfRenderTask?.cancel?.();
    pdfDocument = null;
    currentPdfPath = null;
    currentPdfSubjectId = null;
  }

  function getPdfAnnotations() {
    return user?.user_metadata?.[PDF_ANNOTATIONS_METADATA_KEY] || {};
  }

  async function renderPdfAnnotation() {
    const viewer = root?.querySelector(".subject-pdf-viewer");
    if (!viewer || !currentPdfPath) return;
    const annotations = getPdfAnnotations();
    const annotation = annotations[currentPdfPath]?.pages?.[pdfPage] || {};
    viewer.querySelector("[data-pdf-note]").value = annotation.note || "";
    pdfNoteDirty = false;
    viewer.querySelector("[data-pdf-note-page]").textContent = String(pdfPage);
    const bookmark = viewer.querySelector("[data-pdf-bookmark]");
    bookmark.classList.toggle("active", Boolean(annotation.bookmarked));
    bookmark.textContent = annotation.bookmarked ? "◆ Pagină marcată" : "◇ Marchează pagina";
    viewer.querySelector("[data-pdf-note-status]").textContent = annotation.updatedAt ? "Salvat în Itera" : "";
  }

  async function writePdfAnnotation(patch) {
    if (!currentPdfPath || !user) return false;
    const { data: freshData, error: freshError } = await supabaseClient.auth.getUser();
    if (freshError) return false;
    if (freshData?.user) user = freshData.user;
    const annotations = getPdfAnnotations();
    const documentData = annotations[currentPdfPath] || { title: currentPdfTitle, pages: {} };
    const previous = documentData.pages?.[pdfPage] || {};
    const nextPages = Object.entries({
      ...(documentData.pages || {}),
      [pdfPage]: { ...previous, ...patch, updatedAt: new Date().toISOString() }
    })
      .sort(([, first], [, second]) => String(second.updatedAt || "").localeCompare(String(first.updatedAt || "")))
      .slice(0, 100);
    const nextDocument = {
      ...documentData,
      title: currentPdfTitle,
      updatedAt: new Date().toISOString(),
      pages: Object.fromEntries(nextPages)
    };
    const entries = Object.entries({ ...annotations, [currentPdfPath]: nextDocument })
      .sort(([, first], [, second]) => String(second.updatedAt || "").localeCompare(String(first.updatedAt || "")))
      .slice(0, 25);
    const { data, error } = await supabaseClient.auth.updateUser({
      data: { [PDF_ANNOTATIONS_METADATA_KEY]: Object.fromEntries(entries) }
    });
    if (data?.user) user = data.user;
    return !error;
  }

  async function savePdfNote() {
    const viewer = root.querySelector(".subject-pdf-viewer");
    const status = viewer.querySelector("[data-pdf-note-status]");
    status.textContent = "Se salvează…";
    const ok = await writePdfAnnotation({ note: viewer.querySelector("[data-pdf-note]").value.trim() });
    if (ok) pdfNoteDirty = false;
    status.textContent = ok ? "Salvat în Itera" : "Notița nu a putut fi salvată";
  }

  async function persistPdfNoteIfDirty() {
    if (!pdfNoteDirty || !root || !currentPdfPath) return true;
    const viewer = root.querySelector(".subject-pdf-viewer");
    const ok = await writePdfAnnotation({ note: viewer.querySelector("[data-pdf-note]").value.trim() });
    if (ok) pdfNoteDirty = false;
    return ok;
  }

  async function togglePdfBookmark() {
    const annotations = getPdfAnnotations();
    const current = Boolean(annotations[currentPdfPath]?.pages?.[pdfPage]?.bookmarked);
    await writePdfAnnotation({ bookmarked: !current });
    await renderPdfAnnotation();
  }

  async function createPdfReviewTask() {
    if (!currentPdfSubjectId || !user) return;
    const button = root.querySelector("[data-pdf-task]");
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Se creează…";
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { error } = await supabaseClient.from("tasks").insert({
      user_id: user.id,
      subject_id: currentPdfSubjectId,
      title: `Repetă ${currentPdfTitle} · pagina ${pdfPage}`,
      task_type: "homework",
      deadline_date: formatLocalDate(tomorrow),
      estimated_minutes: 25,
      priority: "medium",
      notes: `Creat din PDF, pagina ${pdfPage}.`,
      completed: false,
      progress: 0
    });
    button.textContent = error ? "Nu s-a putut salva" : "✓ Task creat pentru mâine";
    if (!error) {
      window.dispatchEvent(new CustomEvent("itera:task-updated"));
      window.dispatchEvent(new CustomEvent("itera:home-refresh"));
    }
    window.setTimeout(() => {
      if (!button) return;
      button.disabled = false;
      button.textContent = "+ Repetă pagina";
    }, 2200);
  }

  function formatLocalDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  async function loadPdfProgress(filePath) {
    const { data, error } = await supabaseClient.auth.getUser();
    if (!error && data?.user) user = data.user;
    return user?.user_metadata?.[PDF_PROGRESS_METADATA_KEY]?.[filePath] || null;
  }

  function schedulePdfProgressSave(filePath, page, zoom) {
    pendingPdfProgress = {
      filePath,
      page,
      zoom,
      updatedAt: new Date().toISOString()
    };
    clearTimeout(pdfProgressSaveTimer);
    pdfProgressSaveTimer = setTimeout(() => {
      void flushPdfProgress();
    }, 700);
  }

  function flushPdfProgress() {
    clearTimeout(pdfProgressSaveTimer);
    pdfProgressSaveTimer = null;
    if (!pendingPdfProgress || !user) return pdfProgressWrite;

    const progress = pendingPdfProgress;
    pendingPdfProgress = null;
    pdfProgressWrite = pdfProgressWrite.then(async () => {
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data: currentData, error: currentError } = await supabaseClient.auth.getUser();
        const currentUser = currentData?.user || user;
        if (currentError || !currentUser) {
          lastError = currentError || new Error("Missing user");
        } else {
          const existing = currentUser.user_metadata?.[PDF_PROGRESS_METADATA_KEY] || {};
          const entries = Object.entries({
            ...existing,
            [progress.filePath]: {
              page: progress.page,
              zoom: Number(progress.zoom.toFixed(2)),
              updatedAt: progress.updatedAt
            }
          })
            .sort(([, first], [, second]) =>
              String(second.updatedAt || "").localeCompare(String(first.updatedAt || "")))
            .slice(0, 50);
          const { data: updateData, error: updateError } = await supabaseClient.auth.updateUser({
            data: { [PDF_PROGRESS_METADATA_KEY]: Object.fromEntries(entries) }
          });
          if (!updateError) {
            if (updateData?.user) user = updateData.user;
            return true;
          }
          lastError = updateError;
        }
        if (attempt === 0) await supabaseClient.auth.refreshSession();
      }
      throw lastError || new Error("PDF progress save failed");
    }).catch(error => {
      console.error("Itera PDF progress save:", error);
      pendingPdfProgress ||= progress;
      return false;
    });

    return pdfProgressWrite;
  }

  function unmount() {
    void flushPdfProgress();
    if (focusTimerListener) {
      global.removeEventListener("itera:focus-timer", focusTimerListener);
      focusTimerListener = null;
    }
    mounted = false;
    root = null;
  }

  function bindPointerReorder(container, itemSelector, handleSelector, onCommit) {
    if (!container) return;
    container.querySelectorAll(handleSelector).forEach(handle => {
      handle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    container.querySelectorAll(itemSelector).forEach(itemElement => {
      let item = null;
      let moved = false;
      let armed = false;
      let pointerId = null;
      let startX = 0;
      let startY = 0;
      let holdTimer = null;
      let suppressClick = false;

      itemElement.addEventListener("click", event => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
      }, true);

      itemElement.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const interactive = event.target.closest("button, input, select, textarea, [contenteditable='true']");
        const handleHit = event.target.closest(handleSelector);
        if (interactive && interactive !== itemElement && !handleHit) return;
        item = itemElement;
        if (!item) return;
        moved = false;
        armed = event.pointerType === "mouse";
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        if (!armed) {
          holdTimer = window.setTimeout(() => {
            armed = true;
            item?.classList.add("reorder-armed");
            navigator.vibrate?.(8);
          }, 190);
        }
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      }, true);
      const move = event => {
        if (!item || event.pointerId !== pointerId) return;
        const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
        if (!armed) {
          if (distance > 10) cancel();
          return;
        }
        if (!moved && distance < 6) return;
        event.preventDefault();
        if (!moved) {
          moved = true;
          suppressClick = true;
          item.classList.add("is-reordering");
          item.classList.remove("reorder-armed");
          item.style.pointerEvents = "none";
          container.classList.add("reorder-active");
        }
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(itemSelector);
        if (!target || target === item || target.parentElement !== container) return;
        const rect = target.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2 ||
          (Math.abs(event.clientY - (rect.top + rect.height / 2)) < rect.height / 3 && event.clientX < rect.left + rect.width / 2);
        container.insertBefore(item, before ? target : target.nextSibling);
      };
      const cleanup = () => {
        clearTimeout(holdTimer);
        holdTimer = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
      const cancel = () => {
        cleanup();
        item?.classList.remove("reorder-armed");
        item = null;
        pointerId = null;
        armed = false;
      };
      const finish = event => {
        if (!item || event.pointerId !== pointerId) return;
        cleanup();
        item.classList.remove("is-reordering");
        item.classList.remove("reorder-armed");
        item.style.pointerEvents = "";
        container.classList.remove("reorder-active");
        item = null;
        pointerId = null;
        armed = false;
        if (!moved) return;
        const order = [...container.querySelectorAll(itemSelector)].map(element => element.dataset.orderKey);
        void onCommit(order);
        window.setTimeout(() => { suppressClick = false; }, 350);
      };
    });
  }

  function empty(text) { return `<div class="subject-spa-empty">${text}</div>`; }
  function emptyAction(text, label, attribute) {
    return `<div class="subject-empty-action"><span>${escapeHtml(text)}</span><button type="button" ${attribute}>${escapeHtml(label)} <b aria-hidden="true">→</b></button></div>`;
  }
  function formatMinutes(value) { return value < 60 ? `${value}m` : `${Math.floor(value / 60)}h ${value % 60}m`; }
  function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPdfProgress();
  });
  global.addEventListener("pagehide", () => void flushPdfProgress());
  global.addEventListener("itera:study-session-saved", () => {
    if (mounted && activeSubjectId) {
      if (root?.querySelector(".subject-pdf-viewer")?.open) return;
      mounted = false;
      void mountDetail(activeSubjectId);
    }
  });
  global.addEventListener("itera:task-updated", () => {
    if (!mounted || !activeSubjectId || root?.querySelector(".subject-pdf-viewer")?.open) return;
    const subjectId = activeSubjectId;
    mounted = false;
    void mountDetail(subjectId);
  });
  global.IteraSubjectsView = Object.freeze({ mountList, mountDetail, unmount });
})(window);
