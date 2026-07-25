"use strict";

(function (global) {
  let root, user, subjects = [], tasks = [], filter = "all", search = "", mounted = false;
  const today = () => new Date().toISOString().slice(0, 10);

  async function mount() {
    root = document.getElementById("tasksViewRoot");
    if (!root || mounted) return;
    mounted = true;
    root.innerHTML = '<div class="tasks-spa-state">Se încarcă task-urile…</div>';
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || !mounted) return;
    user = session.user;
    await reload();
  }

  function unmount() { mounted = false; root = null; }

  async function reload() {
    const [subjectResult, taskResult] = await Promise.all([
      supabaseClient.from("subjects").select("id,name,color").eq("user_id", user.id).eq("is_active", true).order("position"),
      supabaseClient.from("tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: false })
    ]);
    if (!mounted) return;
    if (subjectResult.error || taskResult.error) {
      root.innerHTML = '<div class="tasks-spa-state">Task-urile nu au putut fi încărcate.</div>';
      return;
    }
    subjects = subjectResult.data || [];
    tasks = taskResult.data || [];
    render();
  }

  function visibleTasks() {
    return tasks.filter(task => {
      const matchesSearch = task.title.toLowerCase().includes(search);
      if (!matchesSearch) return false;
      if (filter === "today") return task.deadline_date === today() && !task.completed;
      if (filter === "homework") return task.task_type === "homework" && !task.completed;
      if (filter === "test") return task.task_type === "test" && !task.completed;
      if (filter === "completed") return task.completed;
      return true;
    });
  }

  function render() {
    const list = visibleTasks();
    const open = tasks.filter(task => !task.completed).length;
    root.innerHTML = `
      <header class="tasks-spa-header"><div><p class="eyebrow">Organizare</p><h2>Task-urile tale</h2>
        <p>${open} task-uri active · sincronizate cu Supabase</p></div>
        <button class="primary-small-button" data-add-task>＋ Task</button></header>
      <section class="tasks-spa-toolbar">
        <input type="search" value="${escapeHtml(search)}" placeholder="Caută un task…" data-task-search>
        <div class="tasks-spa-filters">${[
          ["all", "Toate"], ["today", "Astăzi"], ["homework", "Homework"],
          ["test", "Teste"], ["completed", "Finalizate"]
        ].map(([value, label]) => `<button class="${filter === value ? "active" : ""}" data-task-filter="${value}">${label}</button>`).join("")}</div>
      </section>
      <section class="tasks-spa-list">${list.length ? list.map(renderTask).join("") :
        '<div class="tasks-spa-empty"><strong>Niciun task aici.</strong><span>Ai spațiu pentru următorul pas.</span></div>'}</section>
      <dialog class="tasks-spa-dialog"><form data-task-form>
        <input type="hidden" name="id"><div class="tasks-spa-dialog-head"><h3 data-task-dialog-title>Task nou</h3>
        <button type="button" class="icon-button" data-close-task aria-label="Închide">×</button></div>
        <label>Titlu<input name="title" required></label>
        <div class="tasks-spa-fields">
          <label>Materie<select name="subject_id"><option value="">Fără materie</option>${subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label>
          <label>Tip<select name="task_type"><option value="homework">Homework</option><option value="test">Test</option><option value="project">Proiect</option><option value="study">Studiu</option><option value="other">Altceva</option></select></label>
          <label>Deadline<input name="deadline_date" type="date"></label><label>Ora<input name="deadline_time" type="time"></label>
          <label>Prioritate<select name="priority"><option value="low">Scăzută</option><option value="medium">Medie</option><option value="high">Ridicată</option></select></label>
          <label>Minute estimate<input name="estimated_minutes" type="number" min="0" value="30"></label>
        </div><label>Notițe<textarea name="notes" rows="3"></textarea></label>
        <p class="tasks-spa-error" data-task-error></p>
        <div class="tasks-spa-actions"><button type="button" class="secondary-button" data-delete-task hidden>Șterge</button>
        <button type="submit" class="primary-button">Salvează</button></div>
      </form></dialog>`;
    bindEvents();
  }

  function renderTask(task) {
    const subject = subjects.find(item => item.id === task.subject_id);
    return `<article class="tasks-spa-item ${task.completed ? "completed" : ""}" style="--subject:${subject?.color || "#f3a9c5"}">
      <button class="tasks-spa-check" data-toggle-task="${task.id}" aria-label="Schimbă starea">${task.completed ? "✓" : ""}</button>
      <div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(subject?.name || "Fără materie")}${task.deadline_date ? ` · ${task.deadline_date}` : ""}</small></div>
      <span class="tasks-spa-badge">${task.estimated_minutes || 0}m</span>
      ${task.completed ? "" : `<button class="tasks-spa-start" data-start-task="${task.id}">▶ Start</button>`}
      <button class="tasks-spa-edit" data-edit-task="${task.id}">Editează</button></article>`;
  }

  function bindEvents() {
    root.querySelector("[data-add-task]").addEventListener("click", () => openDialog());
    root.querySelector("[data-close-task]").addEventListener("click", closeDialog);
    root.querySelector("[data-task-form]").addEventListener("submit", saveTask);
    root.querySelector("[data-delete-task]").addEventListener("click", deleteTask);
    root.querySelector("[data-task-search]").addEventListener("change", event => { search = event.target.value.trim().toLowerCase(); render(); });
    root.querySelectorAll("[data-task-filter]").forEach(button => button.addEventListener("click", () => { filter = button.dataset.taskFilter; render(); }));
    root.querySelectorAll("[data-toggle-task]").forEach(button => button.addEventListener("click", () => toggleTask(button.dataset.toggleTask)));
    root.querySelectorAll("[data-start-task]").forEach(button => button.addEventListener("click", () => {
      const task = tasks.find(item => item.id === button.dataset.startTask);
      const subject = subjects.find(item => item.id === task?.subject_id);
      if (task && global.IteraFocus) global.IteraFocus.startTask(task, subject);
    }));
    root.querySelectorAll("[data-edit-task]").forEach(button => button.addEventListener("click", () => openDialog(tasks.find(task => task.id === button.dataset.editTask))));
  }

  function openDialog(task) {
    const dialog = root.querySelector("dialog"), form = dialog.querySelector("form");
    form.reset();
    for (const name of ["id", "title", "subject_id", "task_type", "deadline_date", "deadline_time", "priority", "estimated_minutes", "notes"]) {
      if (form.elements[name]) form.elements[name].value = task?.[name] ?? "";
    }
    if (!task) { form.elements.task_type.value = "homework"; form.elements.priority.value = "medium"; form.elements.estimated_minutes.value = "30"; }
    form.querySelector("[data-task-dialog-title]").textContent = task ? "Editează task-ul" : "Task nou";
    form.querySelector("[data-delete-task]").hidden = !task;
    dialog.showModal();
  }

  function closeDialog() { root.querySelector("dialog").close(); }

  async function saveTask(event) {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form)), id = values.id;
    const payload = { user_id: user.id, subject_id: values.subject_id || null, title: values.title.trim(),
      task_type: values.task_type, deadline_date: values.deadline_date || null, deadline_time: values.deadline_time || null,
      priority: values.priority, estimated_minutes: Number(values.estimated_minutes) || 0, notes: values.notes.trim() || null };
    const query = id ? supabaseClient.from("tasks").update(payload).eq("id", id).eq("user_id", user.id) : supabaseClient.from("tasks").insert(payload);
    const { error } = await query;
    if (error) { form.querySelector("[data-task-error]").textContent = "Task-ul nu a putut fi salvat."; return; }
    closeDialog(); await reload();
  }

  async function toggleTask(id) {
    const task = tasks.find(item => item.id === id), completed = !task.completed;
    const { error } = await supabaseClient.from("tasks").update({ completed, progress: completed ? 100 : 0,
      completed_at: completed ? new Date().toISOString() : null }).eq("id", id).eq("user_id", user.id);
    if (!error) await reload();
  }

  async function deleteTask() {
    const id = root.querySelector("[data-task-form]").elements.id.value;
    if (!id) return;
    const { error } = await supabaseClient.from("tasks").delete().eq("id", id).eq("user_id", user.id);
    if (!error) { closeDialog(); await reload(); }
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  window.addEventListener("itera:task-updated", () => {
    if (mounted) reload();
  });
  global.IteraTasksView = Object.freeze({ mount, unmount });
})(window);
