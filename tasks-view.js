"use strict";

(function (global) {
  let root, user, subjects = [], tasks = [], scheduleItems = [], calendarEvents = [];
  let filter = "all", search = "", mounted = false, pendingTaskId = null;
  const lifeTaskTypes = ["personal", "selfcare", "home", "health", "errand", "goal"];
  const isLifeTask = type => lifeTaskTypes.includes(type);
  const isFixedPersonalTask = type => ["personal", "selfcare", "home", "health", "errand"].includes(type);
  const personalTaskOnlyMarker = "[itera:task-only]";
  const cleanTaskNotes = notes => String(notes || "").replace(personalTaskOnlyMarker, "").trim();
  const taskTypeLabel = type => ({
    personal: "Personal", selfcare: "Self-care", home: "Casă",
    health: "Sănătate", errand: "De rezolvat", goal: "Obiectiv", test: "Test",
    project: "Proiect", study: "Studiu", other: "Altceva"
  })[type] || "Școală";
  const taskTypeColor = type => ({
    personal: "#9dbbd4", selfcare: "#e7a7bd", home: "#d6b98c",
    health: "#9bc6ae", errand: "#b6acd8", goal: "#d2a36f"
  })[type] || "#f3a9c5";
  const localDate = (date = new Date()) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  };
  const today = () => localDate();

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
    const [subjectResult, taskResult, scheduleResult, eventResult] = await Promise.all([
      supabaseClient.from("subjects").select("id,name,color").eq("user_id", user.id).eq("is_active", true).order("position"),
      supabaseClient.from("tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabaseClient.from("schedule_items").select("day_of_week,start_time,end_time").eq("user_id", user.id),
      supabaseClient.from("calendar_events").select("event_date,start_time,end_time").eq("user_id", user.id)
    ]);
    if (!mounted) return;
    if (subjectResult.error || taskResult.error) {
      root.innerHTML = '<div class="tasks-spa-state">Task-urile nu au putut fi încărcate.</div>';
      return;
    }
    subjects = subjectResult.data || [];
    tasks = taskResult.data || [];
    scheduleItems = scheduleResult.data || [];
    calendarEvents = eventResult.data || [];
    render();
    if (pendingTaskId) {
      const task = tasks.find(item => String(item.id) === String(pendingTaskId));
      pendingTaskId = null;
      if (task) openDialog(task);
    }
  }

  function visibleTasks() {
    return tasks.filter(task => {
      const matchesSearch = task.title.toLowerCase().includes(search);
      if (!matchesSearch) return false;
      if (filter === "today") return task.deadline_date === today() && !task.completed;
      if (filter === "homework") return task.task_type === "homework" && !task.completed;
      if (filter === "test") return task.task_type === "test" && !task.completed;
      if (filter === "life") return isLifeTask(task.task_type) && !task.completed;
      if (filter === "completed") return task.completed;
      return true;
    });
  }

  function render() {
    const list = visibleTasks();
    const open = tasks.filter(task => !task.completed).length;
    root.innerHTML = `
      <header class="tasks-spa-header"><div><p class="eyebrow">Organizare</p><h2>Task-urile tale</h2>
        <p>${open} task-uri active · ${open ? "alege următorul pas" : "totul este la zi"}</p></div>
        <div class="tasks-spa-header-actions"><button class="secondary-button tasks-auto-plan" data-auto-plan><span class="tasks-plan-icon" aria-hidden="true"></span> Planifică automat</button>
        <button class="primary-small-button" data-add-task><span class="tasks-add-icon" aria-hidden="true"></span> Task</button></div></header>
      <section class="tasks-spa-toolbar">
        <input type="search" value="${escapeHtml(search)}" placeholder="Caută un task…" data-task-search>
        <div class="tasks-spa-filters">${[
          ["all", "Toate"], ["today", "Astăzi"], ["homework", "Teme"],
          ["test", "Teste"], ["life", "Personal"], ["completed", "Finalizate"]
        ].map(([value, label]) => `<button class="${filter === value ? "active" : ""}" data-task-filter="${value}">${label}</button>`).join("")}</div>
      </section>
      <p class="tasks-swipe-hint">Glisează un task spre stânga pentru a-l șterge rapid.</p>
      <section class="tasks-spa-list">${list.length ? list.map(renderTask).join("") :
        '<div class="tasks-spa-empty"><strong>Niciun task aici.</strong><span>Ai spațiu pentru următorul pas.</span></div>'}</section>
      <dialog class="tasks-spa-dialog"><form data-task-form>
        <input type="hidden" name="id"><div class="tasks-spa-dialog-head"><h3 data-task-dialog-title>Task nou</h3>
        <button type="button" class="icon-button" data-close-task aria-label="Închide">×</button></div>
        <label>Titlu<input name="title" required></label>
        <div class="tasks-spa-fields">
          <label data-task-subject-field>Materie<select name="subject_id"><option value="">Fără materie</option>${subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label>
          <label>Tip<select name="task_type"><option value="homework">Temă</option><option value="test">Test</option><option value="project">Proiect</option><option value="study">Studiu</option><option value="personal">Personal</option><option value="selfcare">Self-care</option><option value="home">Casă</option><option value="health">Sănătate</option><option value="errand">De rezolvat</option><option value="goal">Obiectiv</option><option value="other">Altceva</option></select></label>
          <label><span data-task-date-label>Deadline</span><input name="deadline_date" type="date"></label><label><span>Ora</span><input name="deadline_time" type="time"><small class="tasks-time-hint" data-task-time-hint>Las-o liberă și Itera alege ora după prioritate.</small></label>
          <label data-task-priority-field>Prioritate<select name="priority"><option value="low">Scăzută</option><option value="medium">Medie</option><option value="high">Ridicată</option></select></label>
          <label><span data-task-duration-label>Minute estimate</span><input name="estimated_minutes" type="number" min="0" value="30"></label>
        </div><label>Notițe<textarea name="notes" rows="3"></textarea></label>
        <p class="tasks-spa-error" data-task-error></p>
        <div class="tasks-spa-actions"><button type="button" class="secondary-button tasks-delete-dialog" data-delete-task hidden>Șterge</button>
        <button type="submit" class="primary-button">Salvează</button></div>
      </form></dialog>`;
    bindEvents();
  }

  function renderTask(task) {
    const subject = subjects.find(item => item.id === task.subject_id);
    const deadlineLabel = task.deadline_date ? formatTaskDate(task.deadline_date) : "";
    const contextLabel = subject?.name || taskTypeLabel(task.task_type);
    return `<div class="tasks-swipe-row" data-task-row="${task.id}">
      <button class="tasks-swipe-delete" data-swipe-delete="${task.id}" aria-label="Șterge ${escapeHtml(task.title)}">Șterge</button>
      <article class="tasks-spa-item ${task.completed ? "completed" : ""} ${isLifeTask(task.task_type) ? "life-task" : ""}" data-swipe-surface style="--subject:${subject?.color || taskTypeColor(task.task_type)}">
      <button class="tasks-spa-check" data-toggle-task="${task.id}" aria-label="Schimbă starea">${task.completed ? "✓" : ""}</button>
      <div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(contextLabel)}${deadlineLabel ? ` · ${escapeHtml(deadlineLabel)}` : ""}${task.deadline_time ? ` · ${String(task.deadline_time).slice(0, 5)}` : ""}</small></div>
      <span class="tasks-spa-badge priority-${escapeHtml(task.priority || "medium")}">${task.estimated_minutes || 0}m</span>
      ${task.completed ? "" : `<button class="tasks-spa-start" data-start-task="${task.id}"><span class="tasks-play-icon" aria-hidden="true"></span> Start</button>`}
      <button class="tasks-spa-edit" data-edit-task="${task.id}">Editează</button></article></div>`;
  }

  function formatTaskDate(value) {
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    const includeYear = date.getFullYear() !== new Date().getFullYear();
    return new Intl.DateTimeFormat("ro-RO", {
      day: "numeric",
      month: "short",
      ...(includeYear ? { year: "numeric" } : {})
    }).format(date).replace(".", "");
  }

  function bindEvents() {
    root.querySelector("[data-add-task]").addEventListener("click", () => openDialog());
    root.querySelector("[data-auto-plan]").addEventListener("click", autoScheduleOpenTasks);
    root.querySelector("[data-close-task]").addEventListener("click", closeDialog);
    root.querySelector("[data-task-form]").addEventListener("submit", saveTask);
    root.querySelector('[name="task_type"]').addEventListener("change", event => syncTaskFormType(event.target.value));
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
    root.querySelectorAll("[data-swipe-delete]").forEach(button => button.addEventListener("click", () => deleteTaskById(button.dataset.swipeDelete)));
    bindSwipeRows();
  }

  function openDialog(task) {
    const dialog = root.querySelector("dialog"), form = dialog.querySelector("form");
    form.reset();
    for (const name of ["id", "title", "subject_id", "task_type", "deadline_date", "deadline_time", "priority", "estimated_minutes", "notes"]) {
      if (form.elements[name]) form.elements[name].value = name === "notes"
        ? cleanTaskNotes(task?.[name])
        : task?.[name] ?? "";
    }
    if (!task) { form.elements.task_type.value = "homework"; form.elements.priority.value = "medium"; form.elements.estimated_minutes.value = "30"; }
    syncTaskFormType(form.elements.task_type.value);
    form.querySelector("[data-task-dialog-title]").textContent = task ? "Editează task-ul" : "Task nou";
    form.querySelector("[data-delete-task]").hidden = !task;
    dialog.showModal();
  }

  function closeDialog() { root.querySelector("dialog").close(); }

  function openTask(id) {
    pendingTaskId = id;
    if (!mounted || !root || !root.querySelector("dialog")) return;
    const task = tasks.find(item => String(item.id) === String(id));
    if (!task) return;
    pendingTaskId = null;
    openDialog(task);
  }

  function syncTaskFormType(type) {
    const form = root.querySelector("[data-task-form]");
    if (!form) return;
    const life = isLifeTask(type);
    const goal = type === "goal";
    const fixedPersonal = isFixedPersonalTask(type);
    form.querySelector("[data-task-subject-field]").hidden = life;
    form.querySelector("[data-task-priority-field]").hidden = life;
    if (life) {
      form.elements.subject_id.value = "";
      form.elements.priority.value = "medium";
    }
    form.querySelector("[data-task-date-label]").textContent = goal ? "Data țintă" : life ? "Data" : "Deadline";
    form.querySelector("[data-task-duration-label]").textContent = goal ? "Timp alocat" : life ? "Durată" : "Minute estimate";
    form.elements.deadline_date.required = fixedPersonal;
    form.elements.deadline_time.required = fixedPersonal;
    form.querySelector("[data-task-time-hint]").textContent = fixedPersonal
      ? "Ora fixează un interval pe care Itera îl păstrează în program."
      : goal
        ? "Opțional: adaugă o oră doar dacă obiectivul are un moment precis."
        : "Las-o liberă și Itera alege ora după prioritate.";
  }

  function minutesFromTime(value) {
    if (!value) return null;
    const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
  }

  function clockFromMinutes(value) {
    const safe = Math.max(0, Math.min(1439, Math.round(value)));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function mergeIntervals(intervals) {
    return intervals
      .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
      .sort((a, b) => a.start - b.start)
      .reduce((merged, interval) => {
        const last = merged.at(-1);
        if (!last || interval.start > last.end) merged.push({ ...interval });
        else last.end = Math.max(last.end, interval.end);
        return merged;
      }, []);
  }

  function busyIntervals(dateValue, excludedIds = new Set()) {
    const date = new Date(`${dateValue}T12:00:00`);
    const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();
    const scheduleBusy = scheduleItems
      .filter(item => Number(item.day_of_week) === dayOfWeek)
      .map(item => ({ start: minutesFromTime(item.start_time), end: minutesFromTime(item.end_time) }));
    const eventBusy = calendarEvents
      .filter(item => item.event_date === dateValue && item.start_time)
      .map(item => {
        const start = minutesFromTime(item.start_time);
        return { start, end: minutesFromTime(item.end_time) ?? start + 60 };
      });
    const taskBusy = tasks
      .filter(item => !item.completed && item.deadline_date === dateValue && item.deadline_time && !excludedIds.has(item.id))
      .map(item => {
        const start = minutesFromTime(item.deadline_time);
        return { start, end: start + Math.max(15, Number(item.estimated_minutes) || 30) };
      });
    return mergeIntervals([...scheduleBusy, ...eventBusy, ...taskBusy]);
  }

  function findAutomaticTime(task, extraBusy = []) {
    if (!task.deadline_date) return null;
    const date = new Date(`${task.deadline_date}T12:00:00`);
    const weekend = [0, 6].includes(date.getDay());
    const priorityDelay = task.priority === "high" ? 0 : task.priority === "low" ? 120 : 60;
    let cursor = (weekend ? 10 * 60 : 16 * 60) + priorityDelay;
    if (task.deadline_date === today()) {
      const now = new Date();
      cursor = Math.max(cursor, Math.ceil((now.getHours() * 60 + now.getMinutes() + 10) / 15) * 15);
    }
    const duration = Math.max(15, Number(task.estimated_minutes) || 30);
    const latestEnd = 22 * 60;
    const excludedIds = new Set(task.id ? [task.id] : []);
    const occupied = mergeIntervals([...busyIntervals(task.deadline_date, excludedIds), ...extraBusy]);
    for (const interval of occupied) {
      if (cursor + duration <= interval.start) break;
      if (cursor < interval.end) cursor = Math.ceil(interval.end / 15) * 15;
    }
    return cursor + duration <= latestEnd ? clockFromMinutes(cursor) : null;
  }

  async function saveTask(event) {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form)), id = values.id;
    const submitButton = form.querySelector('[type="submit"]');
    form.querySelector("[data-task-error]").textContent = "";
    const fixedPersonal = isFixedPersonalTask(values.task_type);
    const payload = { user_id: user.id, subject_id: isLifeTask(values.task_type) ? null : (values.subject_id || null), title: values.title.trim(),
      task_type: values.task_type, deadline_date: values.deadline_date || null, deadline_time: values.deadline_time || null,
      priority: isLifeTask(values.task_type) ? "medium" : values.priority, estimated_minutes: Number(values.estimated_minutes) || 0,
      notes: isLifeTask(values.task_type) ? `${values.notes.trim()} ${personalTaskOnlyMarker}`.trim() : values.notes.trim() || null };
    if (fixedPersonal && (!payload.deadline_date || !payload.deadline_time)) {
      form.querySelector("[data-task-error]").textContent = "Alege data și ora pentru a rezerva activitatea în program.";
      return;
    }
    if (!isLifeTask(values.task_type) && payload.deadline_date && !payload.deadline_time) {
      payload.deadline_time = findAutomaticTime({ ...payload, id });
      if (!payload.deadline_time) {
        form.querySelector("[data-task-error]").textContent = "Nu am găsit un interval liber până la 22:00. Alege o oră sau mută deadline-ul.";
        return;
      }
    }
    submitButton.disabled = true;
    submitButton.textContent = "Se salvează…";
    const query = id
      ? supabaseClient.from("tasks").update(payload).eq("id", id).eq("user_id", user.id)
      : supabaseClient.from("tasks").insert(payload);
    const { data, error } = await query.select("*").single();
    if (error) {
      submitButton.disabled = false;
      submitButton.textContent = "Salvează";
      form.querySelector("[data-task-error]").textContent = "Task-ul nu a putut fi salvat.";
      return;
    }
    await global.IteraPush?.scheduleTaskReminders(data);
    if (!isLifeTask(values.task_type) && !values.deadline_time && data.deadline_time) {
      global.showToast?.(`Itera l-a planificat la ${String(data.deadline_time).slice(0, 5)}.`, "✓");
    }
    closeDialog(); await reload();
  }

  async function autoScheduleOpenTasks() {
    const button = root.querySelector("[data-auto-plan]");
    const candidates = tasks
      .filter(task => !task.completed && !isLifeTask(task.task_type) && task.deadline_date && !task.deadline_time)
      .sort((a, b) => {
        const priority = { high: 0, medium: 1, low: 2 };
        return a.deadline_date.localeCompare(b.deadline_date)
          || (priority[a.priority] ?? 1) - (priority[b.priority] ?? 1)
          || String(a.created_at).localeCompare(String(b.created_at));
      });
    if (!candidates.length) {
      global.showToast?.("Toate taskurile au deja o oră.", "✓");
      return;
    }

    button.disabled = true;
    button.textContent = "Planific...";
    const plannedBusy = new Map();
    let planned = 0;
    for (const task of candidates) {
      const extraBusy = plannedBusy.get(task.deadline_date) || [];
      const deadlineTime = findAutomaticTime(task, extraBusy);
      if (!deadlineTime) continue;
      const { data, error } = await supabaseClient.from("tasks")
        .update({ deadline_time: deadlineTime })
        .eq("id", task.id).eq("user_id", user.id).select("*").single();
      if (error) continue;
      const start = minutesFromTime(deadlineTime);
      extraBusy.push({ start, end: start + Math.max(15, Number(task.estimated_minutes) || 30) });
      plannedBusy.set(task.deadline_date, extraBusy);
      planned += 1;
      await global.IteraPush?.scheduleTaskReminders(data);
    }
    global.showToast?.(planned
      ? `${planned} ${planned === 1 ? "task planificat" : "taskuri planificate"} după prioritate.`
      : "Nu am găsit intervale libere până la 22:00.", planned ? "✓" : "!");
    await reload();
  }

  function bindSwipeRows() {
    let openRow = null;
    root.querySelectorAll("[data-swipe-surface]").forEach(surface => {
      let startX = 0, startY = 0, deltaX = 0, dragging = false, suppressClick = false;
      surface.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        startX = event.clientX; startY = event.clientY; deltaX = 0; dragging = true;
        surface.setPointerCapture?.(event.pointerId);
      });
      surface.addEventListener("pointermove", event => {
        if (!dragging) return;
        const horizontal = event.clientX - startX;
        const vertical = event.clientY - startY;
        if (Math.abs(vertical) > Math.abs(horizontal) && Math.abs(vertical) > 8) {
          dragging = false;
          if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
          return;
        }
        if (horizontal >= 0) return;
        if (Math.abs(horizontal) > 8) suppressClick = true;
        deltaX = Math.max(-92, horizontal);
        surface.style.transform = `translateX(${deltaX}px)`;
      });
      const finish = (event) => {
        if (!dragging) return;
        dragging = false;
        if (surface.hasPointerCapture?.(event?.pointerId)) surface.releasePointerCapture(event.pointerId);
        const row = surface.closest("[data-task-row]");
        const shouldOpen = deltaX < -48;
        if (openRow && openRow !== row) closeSwipeRow(openRow);
        row.classList.toggle("swipe-open", shouldOpen);
        surface.style.transform = shouldOpen ? "translateX(-88px)" : "";
        openRow = shouldOpen ? row : null;
      };
      surface.addEventListener("pointerup", event => finish(event));
      surface.addEventListener("pointercancel", event => finish(event));
      surface.addEventListener("click", event => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
      }, true);
    });
  }

  function closeSwipeRow(row) {
    row?.classList.remove("swipe-open");
    const surface = row?.querySelector("[data-swipe-surface]");
    if (surface) surface.style.transform = "";
  }

  async function toggleTask(id) {
    const task = tasks.find(item => item.id === id), completed = !task.completed;
    const { error } = await supabaseClient.from("tasks").update({ completed, progress: completed ? 100 : 0,
      completed_at: completed ? new Date().toISOString() : null }).eq("id", id).eq("user_id", user.id);
    if (!error) {
      await global.IteraPush?.scheduleTaskReminders({ ...task, completed });
      await reload();
    }
  }

  async function deleteTask() {
    const id = root.querySelector("[data-task-form]").elements.id.value;
    if (!id) return;
    await deleteTaskById(id, true);
  }

  async function deleteTaskById(id, fromDialog = false) {
    const deleteButton = root.querySelector(`[data-swipe-delete="${id}"]`)
      || (fromDialog ? root.querySelector("[data-delete-task]") : null);
    if (deleteButton) { deleteButton.disabled = true; deleteButton.textContent = "…"; }
    await global.IteraPush?.cancelTaskReminders(id);
    const { error } = await supabaseClient.from("tasks").delete().eq("id", id).eq("user_id", user.id);
    if (!error) {
      if (fromDialog) closeDialog();
      global.showToast?.("Task șters.", "✓");
      await reload();
    } else {
      if (deleteButton) { deleteButton.disabled = false; deleteButton.textContent = "Șterge"; }
      global.showToast?.("Task-ul nu a putut fi șters.", "!");
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  window.addEventListener("itera:task-updated", () => {
    if (mounted) reload();
  });
  global.IteraTasksView = Object.freeze({ mount, unmount, openTask });
})(window);
