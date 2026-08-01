"use strict";

(function (global) {
  let root, user, mounted = false, admissionContext = null;

  async function getSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    user = session?.user || null;
    return user;
  }

  async function mountGrades() {
    unmount();
    mounted = true;
    root = document.getElementById("gradesViewRoot");
    root.innerHTML = '<div class="progress-spa-state">Se încarcă notele…</div>';
    if (!await getSession() || !mounted) return;
    const [subjectResult, gradeResult] = await Promise.all([
      supabaseClient.from("subjects").select("id,name,color").eq("user_id", user.id).eq("is_active", true).order("position"),
      supabaseClient.from("subject_grades").select("*").eq("user_id", user.id).order("grade_date", { ascending: false })
    ]);
    if (!mounted) return;
    if (subjectResult.error || gradeResult.error) {
      root.innerHTML = '<div class="progress-spa-state">Notele nu au putut fi încărcate.</div>';
      return;
    }
    renderGrades(subjectResult.data || [], gradeResult.data || []);
  }

  function renderGrades(subjects, grades) {
    const values = grades.map(item => Number(item.grade)).filter(Number.isFinite);
    const average = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : "—";
    const summaries = subjects.map(subject => {
      const subjectGrades = grades.filter(item => item.subject_id === subject.id);
      const nums = subjectGrades.map(item => Number(item.grade)).filter(Number.isFinite);
      return { ...subject, count: nums.length, average: nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2) : "—" };
    });
    root.innerHTML = `
      <header class="progress-spa-header"><div><p class="eyebrow">Progres academic</p><h2>Notele tale</h2>
      <p>O privire compactă asupra rezultatelor tale.</p></div><button class="primary-small-button" data-add-global-grade><span aria-hidden="true">+</span> Notă</button></header>
      <section class="grades-spa-summary"><article class="grades-spa-average"><span>Media generală</span><strong>${average}</strong><small>${values.length} note înregistrate</small></article>
      <div class="grades-spa-subjects">${summaries.map(item => `<a href="#/subjects/${item.id}" style="--subject:${item.color || "#f3a9c5"}">
        <span>${escapeHtml(item.name)}</span><strong>${item.average}</strong><small>${item.count} note</small></a>`).join("")}</div></section>
      <section class="progress-spa-panel"><h3>Note recente</h3><div class="grades-spa-list">${grades.length ? grades.map(grade => {
        const subject = subjects.find(item => item.id === grade.subject_id);
        return `<a href="#/subjects/${grade.subject_id}" class="grades-spa-row" style="--subject:${subject?.color || "#f3a9c5"}">
          <b>${grade.grade}</b><span><strong>${escapeHtml(subject?.name || "Materie")}</strong><small>${escapeHtml(grade.description || grade.grade_type || "Notă")}</small></span>
          <time>${grade.grade_date || ""}</time></a>`;
      }).join("") : empty("Nu există note încă.")}</div></section>
      <dialog class="progress-spa-dialog"><form data-global-grade-form>
        <div class="progress-spa-dialog-head"><h3>Notă nouă</h3><button type="button" class="icon-button" data-close-grade>×</button></div>
        <label>Materie<select name="subject_id" required><option value="">Alege materia</option>${subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label>
        <div class="progress-spa-fields"><label>Nota<input name="grade" type="number" min="1" max="10" step=".01" required></label>
        <label>Data<input name="grade_date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
        <label>Descriere<input name="description"></label><p class="progress-spa-error" data-grade-error></p>
        <button class="primary-button">Salvează nota</button></form></dialog>`;
    root.querySelector("[data-add-global-grade]").addEventListener("click", () => root.querySelector("dialog").showModal());
    root.querySelector("[data-close-grade]").addEventListener("click", () => root.querySelector("dialog").close());
    root.querySelector("[data-global-grade-form]").addEventListener("submit", saveGrade);
  }

  async function saveGrade(event) {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    const { error } = await supabaseClient.from("subject_grades").insert({
      user_id: user.id, subject_id: values.subject_id, grade: Number(values.grade),
      grade_date: values.grade_date || null, description: values.description.trim() || null
    });
    if (error) {
      form.querySelector("[data-grade-error]").textContent = "Nota nu a putut fi salvată.";
      return;
    }
    form.closest("dialog").close();
    mounted = false;
    await mountGrades();
  }

  async function mountAdmission() {
    unmount();
    mounted = true;
    root = document.getElementById("admissionViewRoot");
    root.innerHTML = '<div class="progress-spa-state">Se încarcă planul…</div>';
    if (!await getSession() || !mounted) return;
    const [profileResult, taskResult, eventResult, sessionResult] = await Promise.all([
      supabaseClient.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabaseClient.from("tasks").select("id,title,completed,deadline_date,priority,notes,task_type").eq("user_id", user.id),
      supabaseClient.from("calendar_events").select("id,title,event_date,event_type,notes").eq("user_id", user.id),
      supabaseClient.from("subject_study_sessions").select("duration_minutes,started_at").eq("user_id", user.id)
    ]);
    if (!mounted) return;
    if (profileResult.error) {
      root.innerHTML = '<div class="progress-spa-state">Planul nu a putut fi încărcat.</div>';
      return;
    }
    renderAdmission(
      profileResult.data || {},
      taskResult.error ? [] : taskResult.data || [],
      eventResult.error ? [] : eventResult.data || [],
      sessionResult.error ? [] : sessionResult.data || []
    );
  }

  function getAdmissionSettings() {
    const saved = user?.user_metadata?.itera_admission || {};
    const defaultChecklist = [
      "Verifică actele și calendarul înscrierii",
      "Stabilește materiile prioritare",
      "Finalizează o simulare completă",
      "Pregătește dosarul final"
    ];
    const source = Array.isArray(saved.checklist)
      ? saved.checklist
      : defaultChecklist.map((label, index) => ({ id: `default-${index + 1}`, label, completed: false }));
    return {
      targetDate: normalizeAdmissionDate(saved.targetDate),
      currentScore: normalizeScore(saved.currentScore),
      targetScore: normalizeScore(saved.targetScore),
      checklist: source.slice(0, 10).map((item, index) => ({
        id: String(item.id || `milestone-${index + 1}`),
        label: String(item.label || "Pas de admitere").slice(0, 120),
        completed: Boolean(item.completed)
      })),
      updatedAt: saved.updatedAt || null
    };
  }

  function renderAdmission(profile, tasks = [], events = [], sessions = []) {
    const studyGoals = normalizeList(profile.study_goals);
    const personalGoals = normalizeList(profile.personal_goals);
    const settings = getAdmissionSettings();
    const keyword = /admitere|bac|examen|facultate|universitat|cambridge|delf/i;
    const admissionTasks = tasks.filter(item =>
      item.task_type === "university" || keyword.test(`${item.title || ""} ${item.notes || ""}`)
    );
    const admissionEvents = events.filter(item =>
      item.event_type === "university" || keyword.test(`${item.title || ""} ${item.notes || ""}`)
    );
    const today = localDateString(new Date());
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    const recentMinutes = sessions.reduce((sum, item) => {
      const startedAt = item.started_at ? new Date(item.started_at) : null;
      return startedAt && startedAt >= monthAgo ? sum + Number(item.duration_minutes || 0) : sum;
    }, 0);
    const readiness = calculateAdmissionReadiness(settings, studyGoals, admissionTasks, recentMinutes);
    const targetDate = settings.targetDate ? parseLocalDate(settings.targetDate) : null;
    const daysLeft = targetDate ? Math.ceil((targetDate - parseLocalDate(today)) / 86400000) : null;
    const openTasks = admissionTasks.filter(item => !item.completed).sort((a, b) =>
      String(a.deadline_date || "9999").localeCompare(String(b.deadline_date || "9999"))
    );
    const nextMilestone = settings.checklist.find(item => !item.completed);
    const nextMove = openTasks[0]?.title || nextMilestone?.label || studyGoals[0] || "Configurează primul pas concret";
    const scoreGap = settings.currentScore !== null && settings.targetScore !== null
      ? Math.max(0, settings.targetScore - settings.currentScore)
      : null;
    const upcoming = [
      ...openTasks.filter(item => item.deadline_date).map(item => ({
        id: `task-${item.id}`, title: item.title, date: item.deadline_date, type: "Task"
      })),
      ...admissionEvents.filter(item => item.event_date >= today).map(item => ({
        id: `event-${item.id}`, title: item.title, date: item.event_date, type: "Eveniment"
      }))
    ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

    admissionContext = { profile, tasks, events, sessions, settings };
    root.innerHTML = `
      <header class="progress-spa-header"><div><p class="eyebrow">Viitorul tău</p><h2>Planul de admitere</h2>
      <p>Un centru de comandă calm pentru următorul tău pas important.</p></div><button class="primary-small-button" data-edit-admission>Editează planul</button></header>
      <section class="admission-spa-hero admission-command-hero">
        <div class="admission-command-copy"><p class="eyebrow">Obiectiv principal</p>
          <h3>${escapeHtml(profile.university || "Alege universitatea sau facultatea dorită")}</h3>
          <p>${targetDate ? `${daysLeft >= 0 ? `${daysLeft} ${daysLeft === 1 ? "zi" : "zile"} rămase` : "Data țintă a trecut"} · ${formatAdmissionDate(settings.targetDate)}` : "Adaugă data admiterii pentru un countdown personalizat."}</p>
          <div class="admission-hero-actions">
            <button class="primary-small-button" data-admission-next>${openTasks.length ? "Deschide următorul task" : nextMilestone ? "Continuă traseul" : "Configurează planul"}</button>
            <button class="text-button" data-edit-admission>Actualizează</button>
          </div>
        </div>
        <div class="admission-readiness" style="--readiness:${readiness.score}" aria-label="Pregătire ${readiness.score}%">
          <div><strong>${readiness.score}%</strong><span>pregătire</span></div>
          <small>${escapeHtml(readiness.label)}<em>traseu · taskuri · studiu · scor</em></small>
        </div>
      </section>
      <section class="admission-signal-grid">
        <article><span>Countdown</span><strong>${daysLeft === null ? "—" : Math.max(0, daysLeft)}</strong><small>${daysLeft === null ? "setează data" : daysLeft === 1 ? "zi rămasă" : "zile rămase"}</small></article>
        <article><span>Score Lab</span><strong>${settings.currentScore === null ? "—" : formatScore(settings.currentScore)}</strong><small>${settings.targetScore === null ? "setează scorul țintă" : scoreGap ? `${formatScore(scoreGap)} până la țintă` : "ținta este atinsă"}</small></article>
        <article><span>Momentum · 30 zile</span><strong>${formatStudyTime(recentMinutes)}</strong><small>${admissionTasks.filter(item => item.completed).length} task-uri finalizate</small></article>
      </section>
      <div class="admission-command-grid">
        <section class="progress-spa-panel admission-next-card">
          <p class="eyebrow">Următorul pas</p><h3>${escapeHtml(nextMove)}</h3>
          <p>${openTasks.length ? "Este cel mai apropiat task de admitere încă deschis." : nextMilestone ? "Un pas clar, fără să te uiți la întregul plan." : "Adaugă un milestone și Itera îl va scoate în față."}</p>
          <div class="admission-score-track"><i style="width:${settings.currentScore === null || settings.targetScore === null ? 0 : Math.min(100, settings.currentScore / settings.targetScore * 100)}%"></i></div>
          <small>${settings.targetScore === null ? "Score Lab se activează după ce setezi ținta." : `Țintă: ${formatScore(settings.targetScore)}`}</small>
        </section>
        <section class="progress-spa-panel admission-pathway"><div class="admission-panel-heading"><div><p class="eyebrow">Pathway</p><h3>Traseul tău</h3></div><span>${settings.checklist.filter(item => item.completed).length}/${settings.checklist.length}</span></div>
          <div class="admission-milestone-list">${settings.checklist.map(item => milestoneRow(item)).join("")}</div>
          <p class="admission-live-status" data-admission-status aria-live="polite"></p>
        </section>
        <section class="progress-spa-panel admission-upcoming"><div class="admission-panel-heading"><div><p class="eyebrow">În perspectivă</p><h3>Date importante</h3></div><a class="text-button" href="#/calendar">Calendar</a></div>
          ${upcoming.length ? `<div>${upcoming.map(item => `<div class="admission-date-row"><time>${formatCompactDate(item.date)}</time><span><strong>${escapeHtml(item.title)}</strong><small>${item.type}</small></span></div>`).join("")}</div>` : empty("Adaugă un examen sau un deadline în calendar.")}
        </section>
        <section class="progress-spa-panel admission-goals-panel"><div><h3>Obiective de studiu</h3>${studyGoals.length ? studyGoals.map(goalRow).join("") : empty("Nu ai adăugat obiective de studiu.")}</div>
          <div><h3>Obiective personale</h3>${personalGoals.length ? personalGoals.map(goalRow).join("") : empty("Nu ai adăugat obiective personale.")}</div></section>
      </div>
      <dialog class="progress-spa-dialog"><form data-admission-form>
        <div class="progress-spa-dialog-head"><h3>Editează planul</h3><button type="button" class="icon-button" data-close-admission>×</button></div>
        <label>Universitate / facultate<input name="university" value="${escapeHtml(profile.university || "")}"></label>
        <div class="progress-spa-fields"><label>Data admiterii<input name="target_date" type="date" value="${escapeHtml(settings.targetDate)}"></label>
        <label>Scor țintă<input name="target_score" type="number" min="1" max="10" step=".01" value="${settings.targetScore ?? ""}" placeholder="Ex: 9.50"></label></div>
        <label>Scor estimat acum<input name="current_score" type="number" min="1" max="10" step=".01" value="${settings.currentScore ?? ""}" placeholder="Ex: 8.75"></label>
        <label>Milestone-uri<textarea name="checklist" rows="4" placeholder="Un pas pe fiecare rând">${escapeHtml(settings.checklist.map(item => item.label).join("\n"))}</textarea></label>
        <label>Obiective de studiu<textarea name="study_goals" rows="4" placeholder="Un obiectiv pe fiecare rând">${escapeHtml(studyGoals.join("\n"))}</textarea></label>
        <label>Obiective personale<textarea name="personal_goals" rows="4" placeholder="Un obiectiv pe fiecare rând">${escapeHtml(personalGoals.join("\n"))}</textarea></label>
        <p class="progress-spa-error" data-admission-error></p><button class="primary-button">Salvează planul</button>
      </form></dialog>`;
    root.querySelectorAll("[data-edit-admission]").forEach(button => button.addEventListener("click", () => root.querySelector("dialog").showModal()));
    root.querySelector("[data-close-admission]").addEventListener("click", () => root.querySelector("dialog").close());
    root.querySelector("[data-admission-form]").addEventListener("submit", saveAdmission);
    root.querySelectorAll("[data-admission-milestone]").forEach(button => button.addEventListener("click", () => toggleAdmissionMilestone(button)));
    root.querySelector("[data-admission-next]").addEventListener("click", () => {
      if (openTasks.length) {
        global.location.hash = "#/tasks";
      } else if (nextMilestone) {
        root.querySelector(`[data-admission-milestone="${cssEscape(nextMilestone.id)}"]`)?.focus();
        root.querySelector(".admission-pathway")?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        root.querySelector("dialog").showModal();
      }
    });
  }

  function goalRow(goal) { return `<div class="admission-spa-goal"><span>◇</span><strong>${escapeHtml(goal)}</strong></div>`; }
  function milestoneRow(item) {
    return `<button type="button" class="admission-milestone ${item.completed ? "completed" : ""}" data-admission-milestone="${escapeHtml(item.id)}" aria-pressed="${item.completed}">
      <span aria-hidden="true">${item.completed ? "✓" : ""}</span><strong>${escapeHtml(item.label)}</strong>
    </button>`;
  }

  async function toggleAdmissionMilestone(button) {
    if (!admissionContext || button.disabled) return;
    const id = button.dataset.admissionMilestone;
    const previous = admissionContext.settings;
    const next = {
      ...previous,
      checklist: previous.checklist.map(item => item.id === id ? { ...item, completed: !item.completed } : item),
      updatedAt: new Date().toISOString()
    };
    button.disabled = true;
    const status = root.querySelector("[data-admission-status]");
    status.textContent = "Se salvează…";
    const { data, error } = await supabaseClient.auth.updateUser({ data: { itera_admission: next } });
    if (error) {
      button.disabled = false;
      status.textContent = "Pasul nu a putut fi actualizat.";
      return;
    }
    if (data?.user) user = data.user;
    renderAdmission(admissionContext.profile, admissionContext.tasks, admissionContext.events, admissionContext.sessions);
  }

  async function saveAdmission(event) {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    const submitButton = form.querySelector(".primary-button");
    const previousSettings = getAdmissionSettings();
    const previousByLabel = new Map(previousSettings.checklist.map(item => [item.label.toLowerCase(), item]));
    const nextSettings = {
      targetDate: values.target_date || "",
      currentScore: normalizeScore(values.current_score),
      targetScore: normalizeScore(values.target_score),
      checklist: lines(values.checklist).slice(0, 10).map((label, index) => {
        const previous = previousByLabel.get(label.toLowerCase());
        return previous || { id: global.crypto?.randomUUID?.() || `milestone-${Date.now()}-${index}`, label, completed: false };
      }),
      updatedAt: new Date().toISOString()
    };
    submitButton.disabled = true;
    submitButton.textContent = "Se salvează…";
    const metadataResult = await supabaseClient.auth.updateUser({ data: { itera_admission: nextSettings } });
    if (metadataResult.error) {
      submitButton.disabled = false;
      submitButton.textContent = "Salvează planul";
      form.querySelector("[data-admission-error]").textContent = "Detaliile admiterii nu au putut fi salvate.";
      return;
    }
    if (metadataResult.data?.user) user = metadataResult.data.user;
    const { error } = await supabaseClient.from("profiles").update({
      university: values.university.trim() || null, study_goals: lines(values.study_goals),
      personal_goals: lines(values.personal_goals), updated_at: new Date().toISOString()
    }).eq("id", user.id);
    if (error) {
      const rollback = await supabaseClient.auth.updateUser({ data: { itera_admission: previousSettings } });
      if (rollback.data?.user) user = rollback.data.user;
      submitButton.disabled = false;
      submitButton.textContent = "Salvează planul";
      form.querySelector("[data-admission-error]").textContent = "Planul nu a putut fi salvat.";
      return;
    }
    form.closest("dialog").close();
    mounted = false;
    await mountAdmission();
  }

  function calculateAdmissionReadiness(settings, studyGoals, tasks, recentMinutes) {
    const checklistRatio = settings.checklist.length
      ? settings.checklist.filter(item => item.completed).length / settings.checklist.length
      : 0;
    const taskRatio = tasks.length ? tasks.filter(item => item.completed).length / tasks.length : 0;
    const scoreRatio = settings.currentScore !== null && settings.targetScore
      ? Math.min(1, settings.currentScore / settings.targetScore)
      : 0;
    const score = Math.round(
      checklistRatio * 40 +
      taskRatio * 20 +
      Math.min(1, recentMinutes / 600) * 20 +
      scoreRatio * 15 +
      (studyGoals.length ? 5 : 0)
    );
    return {
      score: Math.max(0, Math.min(100, score)),
      label: score >= 80 ? "Foarte aproape de ritmul țintă" : score >= 55 ? "Planul prinde contur" : score >= 25 ? "Construiești fundația" : "Începe cu primul pas"
    };
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    return typeof value === "string" ? lines(value) : [];
  }
  function lines(value) { return String(value || "").split("\n").map(item => item.trim()).filter(Boolean); }
  function normalizeScore(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 && number <= 10 ? number : null;
  }
  function normalizeAdmissionDate(value) {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const date = parseLocalDate(text);
    return Number.isNaN(date.getTime()) || localDateString(date) !== text ? "" : text;
  }
  function formatScore(value) { return Number(value).toFixed(2).replace(".", ","); }
  function localDateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function parseLocalDate(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  function formatAdmissionDate(value) {
    return new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "long", year: "numeric" }).format(parseLocalDate(value));
  }
  function formatCompactDate(value) {
    return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short" }).format(parseLocalDate(value));
  }
  function formatStudyTime(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h ${total % 60 ? `${total % 60}m` : ""}`.trim();
  }
  function cssEscape(value) {
    return global.CSS?.escape ? global.CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function unmount() { mounted = false; root = null; admissionContext = null; }
  function empty(text) { return `<div class="progress-spa-empty">${text}</div>`; }
  function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  global.IteraProgressView = Object.freeze({ mountGrades, mountAdmission, unmount });
})(window);
