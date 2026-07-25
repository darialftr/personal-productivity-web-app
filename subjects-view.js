"use strict";

(function (global) {
  let root, user, mounted = false, timerStartedAt = null, timerInterval = null;

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
      <button class="primary-small-button" data-add-subject>＋ Materie</button></header>
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
    root.innerHTML = `
      <a class="subjects-spa-back" href="#/subjects">← Materii</a>
      <section class="subject-spa-hero" style="--subject:${subject.color || "#f3a9c5"}">
        <div><p class="eyebrow">Materia ta</p><h2>${escapeHtml(subject.name)}</h2>
        <p>${escapeHtml(subject.teacher_name || "Spațiul tău de studiu")}${subject.room ? ` · ${escapeHtml(subject.room)}` : ""}</p></div>
        <button class="primary-small-button" data-study-timer>▶ Start focus</button>
      </section>
      <section class="subject-spa-stats"><article><span>Medie</span><strong>${average}</strong></article>
        <article><span>Studiu</span><strong>${formatMinutes(minutes)}</strong></article>
        <article><span>Task-uri active</span><strong>${data.tasks.length}</strong></article>
        <article><span>Obiective</span><strong>${data.goals.filter(goal => !goal.completed).length}</strong></article></section>
      <div class="subject-spa-columns">
        <section class="subject-spa-panel"><div class="subject-spa-panel-head"><h3>Note</h3><button data-add-grade>＋</button></div>
          ${data.grades.length ? data.grades.map(item => `<div class="subject-spa-row"><b>${item.grade}</b><span>${escapeHtml(item.description || item.grade_type || "Notă")}</span><small>${item.grade_date || ""}</small></div>`).join("") : empty("Nicio notă")}</section>
        <section class="subject-spa-panel"><h3>Task-uri active</h3>${data.tasks.length ? data.tasks.map(item => `<a class="subject-spa-row" href="#/tasks"><b>✓</b><span>${escapeHtml(item.title)}</span><small>${item.deadline_date || ""}</small></a>`).join("") : empty("Niciun task activ")}</section>
        <section class="subject-spa-panel"><h3>Resurse și cărți</h3>${[...data.books, ...data.resources].length ?
          [...data.books, ...data.resources].map(item => `<div class="subject-spa-row"><b>◇</b><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.author || item.resource_type || "")}</small></div>`).join("") : empty("Nicio resursă")}</section>
        <section class="subject-spa-panel"><h3>Obiective</h3>${data.goals.length ? data.goals.map(item => `<div class="subject-spa-row"><b>${item.completed ? "✓" : "○"}</b><span>${escapeHtml(item.title)}</span></div>`).join("") : empty("Niciun obiectiv")}</section>
      </div>`;
    root.querySelector("[data-add-grade]").addEventListener("click", () => addGrade(id));
    root.querySelector("[data-study-timer]").addEventListener("click", event => toggleTimer(id, event.currentTarget));
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
