"use strict";

(function (global) {
  let root, user, mounted = false;

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
    const { data: profile, error } = await supabaseClient.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (!mounted) return;
    if (error) {
      root.innerHTML = '<div class="progress-spa-state">Planul nu a putut fi încărcat.</div>';
      return;
    }
    renderAdmission(profile || {});
  }

  function renderAdmission(profile) {
    const studyGoals = profile.study_goals || [], personalGoals = profile.personal_goals || [];
    root.innerHTML = `
      <header class="progress-spa-header"><div><p class="eyebrow">Viitorul tău</p><h2>Planul de admitere</h2>
      <p>Direcția și obiectivele tale, într-un spațiu calm.</p></div><button class="primary-small-button" data-edit-admission>Editează</button></header>
      <section class="admission-spa-hero"><p class="eyebrow">Obiectiv principal</p>
        <h3>${escapeHtml(profile.university || "Alege universitatea sau facultatea dorită")}</h3>
        <p>Planul este salvat în profilul tău Supabase și rămâne sincronizat.</p></section>
      <div class="admission-spa-grid">
        <section class="progress-spa-panel"><h3>Obiective de studiu</h3>${studyGoals.length ? studyGoals.map(goalRow).join("") : empty("Nu ai adăugat obiective de studiu.")}</section>
        <section class="progress-spa-panel"><h3>Obiective personale</h3>${personalGoals.length ? personalGoals.map(goalRow).join("") : empty("Nu ai adăugat obiective personale.")}</section>
      </div>
      <dialog class="progress-spa-dialog"><form data-admission-form>
        <div class="progress-spa-dialog-head"><h3>Editează planul</h3><button type="button" class="icon-button" data-close-admission>×</button></div>
        <label>Universitate / facultate<input name="university" value="${escapeHtml(profile.university || "")}"></label>
        <label>Obiective de studiu<textarea name="study_goals" rows="4" placeholder="Un obiectiv pe fiecare rând">${escapeHtml(studyGoals.join("\n"))}</textarea></label>
        <label>Obiective personale<textarea name="personal_goals" rows="4" placeholder="Un obiectiv pe fiecare rând">${escapeHtml(personalGoals.join("\n"))}</textarea></label>
        <p class="progress-spa-error" data-admission-error></p><button class="primary-button">Salvează planul</button>
      </form></dialog>`;
    root.querySelector("[data-edit-admission]").addEventListener("click", () => root.querySelector("dialog").showModal());
    root.querySelector("[data-close-admission]").addEventListener("click", () => root.querySelector("dialog").close());
    root.querySelector("[data-admission-form]").addEventListener("submit", saveAdmission);
  }

  function goalRow(goal) { return `<div class="admission-spa-goal"><span>◇</span><strong>${escapeHtml(goal)}</strong></div>`; }

  async function saveAdmission(event) {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    const lines = value => String(value).split("\n").map(item => item.trim()).filter(Boolean);
    const { error } = await supabaseClient.from("profiles").update({
      university: values.university.trim() || null, study_goals: lines(values.study_goals),
      personal_goals: lines(values.personal_goals), updated_at: new Date().toISOString()
    }).eq("id", user.id);
    if (error) {
      form.querySelector("[data-admission-error]").textContent = "Planul nu a putut fi salvat.";
      return;
    }
    form.closest("dialog").close();
    mounted = false;
    await mountAdmission();
  }

  function unmount() { mounted = false; root = null; }
  function empty(text) { return `<div class="progress-spa-empty">${text}</div>`; }
  function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  global.IteraProgressView = Object.freeze({ mountGrades, mountAdmission, unmount });
})(window);
