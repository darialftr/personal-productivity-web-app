"use strict";

(function (global) {
  let root, user, subjects = [], tasks = [], scheduleItems = [], calendarEvents = [];
  let filter = "all", search = "", mounted = false, pendingTaskId = null;
  const lifeTaskTypes = ["personal", "selfcare", "home", "health", "errand", "goal"];
  const isLifeTask = type => lifeTaskTypes.includes(type);
  const isFixedPersonalTask = type => ["personal", "selfcare", "home", "health", "errand"].includes(type);
  const personalTaskOnlyMarker = "[itera:task-only]";
  const personalNoTimerMarker = "[itera:no-timer]";
  const personalCategoryPattern = /\[itera:category=([^\]]+)\]/i;
  const cleanTaskNotes = notes => String(notes || "")
    .replace(personalTaskOnlyMarker, "")
    .replace(personalNoTimerMarker, "")
    .replace(personalCategoryPattern, "")
    .replace("[itera:event]", "")
    .trim();
  const normalizeTask = task => {
    const storedCategory = String(task.notes || "").match(personalCategoryPattern)?.[1];
    return { ...task, task_type: storedCategory || task.task_type };
  };
  const isPersonalEventLike = task => String(task.notes || "").includes("[itera:event]") ||
    (isFixedPersonalTask(task.task_type) && !String(task.notes || "").includes(personalTaskOnlyMarker));
  const isChecklistTask = task => String(task.notes || "").includes(personalNoTimerMarker);
  const isAutomaticReviewTask = task =>
    /recapitulare recomandată automat după o sesiune de studiu/i.test(String(task.notes || ""));
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
  const taskPlan = task => global.IteraPlanning?.getTaskPlan(user, task) || null;
  const plannedDate = task => taskPlan(task)?.date || task.deadline_date || null;
  const plannedTime = task => taskPlan(task)?.time || task.deadline_time || null;

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
    tasks = (taskResult.data || []).map(normalizeTask);
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
    const visible = tasks.filter(task => {
      if (isPersonalEventLike(task) || isAutomaticReviewTask(task)) return false;
      const matchesSearch = task.title.toLowerCase().includes(search);
      if (!matchesSearch) return false;
      if (filter === "today") return plannedDate(task) === today() && !task.completed;
      if (filter === "homework") return task.task_type === "homework" && !task.completed;
      if (filter === "test") return task.task_type === "test" && !task.completed;
      if (filter === "life") return isLifeTask(task.task_type) && !task.completed;
      if (filter === "completed") {
        return task.completed && task.completed_at && localDate(new Date(task.completed_at)) === today();
      }
      return !task.completed;
    });
    if (filter === "today") {
      visible.sort((first, second) =>
        String(plannedTime(first) || "23:59").localeCompare(String(plannedTime(second) || "23:59"))
      );
    }
    return visible;
  }

  function render() {
    const list = visibleTasks();
    const open = tasks.filter(task => !isPersonalEventLike(task) && !task.completed).length;
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
      <p class="tasks-swipe-hint ${filter === "today" ? "plan-order-hint" : ""}">${filter === "today"
        ? "Ține de ⋮⋮ și mută taskurile. Itera recalculează orele și pauzele imediat."
        : "Glisează un task spre stânga pentru a-l șterge rapid."}</p>
      <section class="tasks-spa-list">${list.length ? list.map(renderTask).join("") :
        '<div class="tasks-spa-empty"><strong>Niciun task aici.</strong><span>Ai spațiu pentru următorul pas.</span></div>'}</section>
      <dialog class="tasks-spa-dialog"><form data-task-form>
        <input type="hidden" name="id"><div class="tasks-spa-dialog-head"><div><p class="card-kicker">Următorul pas</p><h3 data-task-dialog-title>Task nou</h3></div>
        <button type="button" class="icon-button" data-close-task aria-label="Închide">×</button></div>
        <p class="task-form-intro">Spune-i Iterei ce ai de făcut. Ora poate rămâne liberă — o alegem noi realist.</p>
        <label class="task-title-field">Ce ai de făcut?<input name="title" required autocomplete="off" placeholder="Ex: Termin exercițiile la matematică"></label>
        <div class="tasks-spa-fields">
          <label data-task-subject-field>Materie<select name="subject_id"><option value="">Fără materie</option>${subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label>
          <label>Tip<select name="task_type"><option value="homework">Temă</option><option value="test">Test</option><option value="project">Proiect</option><option value="study">Studiu</option><option value="personal">Personal</option><option value="selfcare">Self-care</option><option value="home">Casă</option><option value="health">Sănătate</option><option value="errand">De rezolvat</option><option value="goal">Obiectiv</option><option value="other">Altceva</option></select></label>
          <label data-task-kind-field hidden>Cum îl faci?<select name="personal_kind"><option value="checklist">Doar îl bifez</option><option value="timer">Folosesc un timer</option></select></label>
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
    const dateLabel = task.deadline_date ? formatTaskDate(task.deadline_date) : "";
    const plan = taskPlan(task);
    const planLabel = plan ? `Planificat ${formatTaskDate(plan.date)} · ${plan.time}` : "";
    const contextLabel = subject?.name || taskTypeLabel(task.task_type);
    const personalEvent = isPersonalEventLike(task);
    const reorderable = filter === "today" && !task.completed && !personalEvent && Boolean(plan);
    return `<div class="tasks-swipe-row" data-task-row="${task.id}" ${reorderable ? `data-plan-order="${task.id}" data-order-key="${task.id}"` : ""}>
      <button class="tasks-swipe-delete" data-swipe-delete="${task.id}" aria-label="Șterge ${escapeHtml(task.title)}"><span class="tasks-trash-icon" aria-hidden="true"></span></button>
      <article class="tasks-spa-item ${task.completed ? "completed" : ""} ${isLifeTask(task.task_type) ? "life-task" : ""} ${personalEvent ? "personal-event" : ""}" data-swipe-surface style="--subject:${subject?.color || taskTypeColor(task.task_type)}">
      ${personalEvent
        ? '<span class="tasks-spa-event-icon" aria-label="Eveniment"></span>'
        : `<button class="tasks-spa-check" data-toggle-task="${task.id}" aria-label="Schimbă starea">${task.completed ? "✓" : ""}</button>`}
      <div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(contextLabel)}${planLabel ? ` · ${escapeHtml(planLabel)}` : ""}${dateLabel && (!plan || plan.date !== task.deadline_date) ? ` · ${isLifeTask(task.task_type) ? "ziua aleasă" : "termen"} ${escapeHtml(dateLabel)}` : ""}</small></div>
      ${personalEvent
        ? '<span class="tasks-spa-badge tasks-spa-event-badge">Eveniment</span>'
        : `<span class="tasks-spa-badge priority-${escapeHtml(task.priority || "medium")}">${task.estimated_minutes || 0}m</span>`}
      ${task.completed || personalEvent || isChecklistTask(task) ? "" : `<button class="tasks-spa-start" data-start-task="${task.id}"><span class="tasks-play-icon" aria-hidden="true"></span> Start</button>`}
      <button class="tasks-spa-edit" data-edit-task="${task.id}">Editează</button>
      ${reorderable ? '<button class="task-plan-grip" data-plan-grip aria-label="Mută taskul în plan">⋮⋮</button>' : ""}</article></div>`;
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
    root.querySelector('[name="personal_kind"]').addEventListener("change", () =>
      syncTaskFormType(root.querySelector('[name="task_type"]').value)
    );
    root.querySelector("[data-delete-task]").addEventListener("click", deleteTask);
    root.querySelector("[data-task-search]").addEventListener("change", event => { search = event.target.value.trim().toLowerCase(); render(); });
    root.querySelectorAll("[data-task-filter]").forEach(button => button.addEventListener("click", () => { filter = button.dataset.taskFilter; render(); }));
    root.querySelectorAll("[data-toggle-task]").forEach(button => button.addEventListener("click", () => toggleTask(button.dataset.toggleTask)));
    root.querySelectorAll(".tasks-spa-item button").forEach(button => {
      button.addEventListener("pointerdown", event => event.stopPropagation());
    });
    root.querySelectorAll("[data-start-task]").forEach(button => button.addEventListener("click", () => {
      const task = tasks.find(item => item.id === button.dataset.startTask);
      const subject = subjects.find(item => item.id === task?.subject_id);
      if (task && global.IteraFocus) global.IteraFocus.startTask(task, subject);
    }));
    root.querySelectorAll("[data-edit-task]").forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      const task = tasks.find(item => String(item.id) === String(button.dataset.editTask));
      if (!task) {
        global.showToast?.("Taskul nu a putut fi deschis. Reîncarcă pagina și încearcă din nou.", "!");
        return;
      }
      openDialog(task);
    }));
    root.querySelectorAll("[data-swipe-delete]").forEach(button => button.addEventListener("click", () => deleteTaskById(button.dataset.swipeDelete)));
    bindSwipeRows();
    bindPlanReorder();
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
    form.elements.personal_kind.value = task && !isChecklistTask(task) ? "timer" : "checklist";
    syncTaskFormType(form.elements.task_type.value);
    form.querySelector("[data-task-dialog-title]").textContent = task ? "Editează task-ul" : "Task nou";
    form.querySelector("[data-delete-task]").hidden = !task;
    if (!dialog.open) dialog.showModal();
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
    form.querySelector("[data-task-kind-field]").hidden = !fixedPersonal;
    if (life) {
      form.elements.subject_id.value = "";
      form.elements.priority.value = "medium";
    }
    form.querySelector("[data-task-date-label]").textContent = goal
      ? "Data țintă"
      : life
        ? "Ziua în care vrei să faci asta"
        : "Deadline";
    form.querySelector("[data-task-duration-label]").textContent = goal ? "Timp alocat" : life ? "Durată" : "Minute estimate";
    form.elements.deadline_date.required = fixedPersonal;
    form.elements.deadline_time.required = false;
    form.querySelector("[data-task-time-hint]").textContent = fixedPersonal
      ? "Opțional: las-o liberă și Itera alege automat un moment potrivit în ziua aleasă."
      : goal
        ? "Opțional: adaugă o oră doar dacă obiectivul are un moment precis."
        : "Las-o liberă și Itera alege ora după prioritate.";
  }

  async function saveTask(event) {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form)), id = values.id;
    const submitButton = form.querySelector('[type="submit"]');
    form.querySelector("[data-task-error]").textContent = "";
    const fixedPersonal = isFixedPersonalTask(values.task_type);
    const keepAsTaskOnly = fixedPersonal;
    const categoryMarker = isLifeTask(values.task_type) && values.task_type !== "personal"
      ? `[itera:category=${values.task_type}]`
      : "";
    const noTimerMarker = fixedPersonal && values.personal_kind === "checklist"
      ? personalNoTimerMarker
      : "";
    const payload = { user_id: user.id, subject_id: isLifeTask(values.task_type) ? null : (values.subject_id || null), title: values.title.trim(),
      task_type: values.task_type, deadline_date: values.deadline_date || null, deadline_time: values.deadline_time || null,
      priority: isLifeTask(values.task_type) ? "medium" : values.priority, estimated_minutes: Number(values.estimated_minutes) || 0,
      notes: isLifeTask(values.task_type) && keepAsTaskOnly
        ? `${values.notes.trim()} ${personalTaskOnlyMarker} ${noTimerMarker} ${categoryMarker}`.trim()
        : values.notes.trim() || null };
    if (fixedPersonal && !payload.deadline_date) {
      form.querySelector("[data-task-error]").textContent = "Alege ziua în care vrei să faci activitatea.";
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = "Se salvează…";
    const persist = nextPayload => (id
      ? supabaseClient.from("tasks").update(nextPayload).eq("id", id).eq("user_id", user.id)
      : supabaseClient.from("tasks").insert(nextPayload)).select("*").single();
    let { data, error } = await persist(payload);
    if (error && isLifeTask(values.task_type) && values.task_type !== "personal" && (
      ["23514", "22P02"].includes(error.code) ||
      /task_type|constraint|invalid input/i.test(`${error.message || ""} ${error.details || ""}`)
    )) {
      ({ data, error } = await persist({ ...payload, task_type: "personal" }));
    }
    if (error) {
      submitButton.disabled = false;
      submitButton.textContent = "Salvează";
      form.querySelector("[data-task-error]").textContent = "Task-ul nu a putut fi salvat.";
      return;
    }
    const normalizedData = normalizeTask(data);
    closeDialog();
    if (id) {
      tasks = tasks.map(task => String(task.id) === String(id) ? normalizedData : task);
    } else {
      tasks.unshift(normalizedData);
    }
    render();
    global.showToast?.("Salvat. Planul se actualizează acum.", "✓");
    const removal = await global.IteraPlanning?.removeTask(user, data.id);
    if (removal?.user) user = removal.user;
    await reload();
    if (!isPersonalEventLike(normalizedData) && normalizedData.task_type !== "goal" && normalizedData.deadline_date) {
      await autoScheduleOpenTasks({ silent: true, highlightId: data.id });
    } else {
      await global.IteraPush?.scheduleTaskReminders(data);
    }
    global.dispatchEvent(new CustomEvent("itera:task-updated", { detail: { id: data.id, saved: true } }));
  }

  async function autoScheduleOpenTasks(options = {}) {
    const button = root.querySelector("[data-auto-plan]");
    const energy = user?.user_metadata?.itera_energy_date === today()
      ? Number(user.user_metadata.itera_energy_level) || 3
      : 3;
    const result = global.IteraPlanning?.buildPlan({
      tasks, scheduleItems, calendarEvents, user, energy, today: today()
    });
    if (!result?.total) {
      if (!options.silent) global.showToast?.("Nu există taskuri care trebuie planificate.", "✓");
      return;
    }
    if (button) { button.disabled = true; button.textContent = "Planific..."; }
    const saved = await global.IteraPlanning.savePlan(user, result.plan);
    if (button) { button.disabled = false; button.textContent = "Planifică automat"; }
    if (!saved.ok) {
      global.showToast?.("Planul nu a putut fi salvat în cont.", "!");
      return;
    }
    user = saved.user;
    await Promise.all(tasks.map(task => {
      const plan = global.IteraPlanning.getTaskPlan(user, task);
      return global.IteraPush?.scheduleTaskReminders(plan
        ? { ...task, deadline_date: plan.date, deadline_time: plan.time }
        : task);
    }));
    if (!options.silent) filter = "today";
    render();
    global.dispatchEvent(new CustomEvent("itera:plan-updated"));
    const highlighted = options.highlightId && global.IteraPlanning.getTaskPlan(user, options.highlightId);
    if (options.silent && highlighted) {
      global.showToast?.(`Planificat ${formatTaskDate(highlighted.date)}, la ${highlighted.time}, înainte de termen.`, "✓");
    } else if (!options.silent) {
      global.showToast?.(result.scheduled
        ? `${result.scheduled} ${result.scheduled === 1 ? "task planificat" : "taskuri planificate"}, cu pauze și fără ultima clipă.`
        : "Nu am găsit intervale libere înaintea termenelor.", result.scheduled ? "✓" : "!");
    }
  }

  function bindPlanReorder() {
    const list = root.querySelector(".tasks-spa-list");
    if (!list) return;
    list.querySelectorAll("[data-plan-order]").forEach(rowElement => {
      const surface = rowElement.querySelector("[data-swipe-surface]");
      if (!surface) return;
      let row = null;
      let moved = false;
      let armed = false;
      let pointerId = null;
      let startX = 0;
      let startY = 0;
      let holdTimer = null;
      let suppressClick = false;

      surface.addEventListener("click", event => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
      }, true);

      surface.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const interactive = event.target.closest("button, input, select, textarea, [contenteditable='true']");
        if (interactive && !interactive.matches("[data-plan-grip]")) return;
        row = rowElement;
        if (!row) return;
        moved = false;
        armed = event.pointerType === "mouse";
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        if (!armed) {
          holdTimer = window.setTimeout(() => {
            armed = true;
            row?.classList.add("reorder-armed");
            navigator.vibrate?.(8);
          }, 190);
        }
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      }, true);
      const move = event => {
        if (!row || event.pointerId !== pointerId) return;
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        const distance = Math.hypot(deltaX, deltaY);
        if (!armed) {
          if (distance > 10) cancel();
          return;
        }
        if (!moved && distance < 6) return;
        if (!moved && Math.abs(deltaX) > Math.abs(deltaY)) {
          cancel();
          return;
        }
        event.preventDefault();
        if (!moved) {
          moved = true;
          suppressClick = true;
          row.classList.add("is-reordering");
          row.classList.remove("reorder-armed");
          row.style.pointerEvents = "none";
          list.classList.add("plan-reorder-active");
        }
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-plan-order]");
        if (!target || target === row || target.parentElement !== list) return;
        const rect = target.getBoundingClientRect();
        list.insertBefore(row, event.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
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
        row?.classList.remove("reorder-armed");
        row = null;
        pointerId = null;
        armed = false;
      };
      const finish = event => {
        if (!row || event.pointerId !== pointerId) return;
        cleanup();
        row.classList.remove("is-reordering");
        row.classList.remove("reorder-armed");
        row.style.pointerEvents = "";
        list.classList.remove("plan-reorder-active");
        row = null;
        pointerId = null;
        armed = false;
        if (!moved) return;
        const order = [...list.querySelectorAll("[data-plan-order]")].map(item => item.dataset.planOrder);
        void saveReorderedPlan(order);
        window.setTimeout(() => { suppressClick = false; }, 350);
      };
    });
  }

  async function saveReorderedPlan(order) {
    if (!order.length || !global.IteraPlanning) return;
    const date = today();
    const plan = { ...global.IteraPlanning.getPlan(user) };
    const orderedTasks = order.map(id => tasks.find(task => String(task.id) === String(id))).filter(Boolean);
    const existingStarts = orderedTasks.map(task => timeToMinutes(global.IteraPlanning.getTaskPlan(user, task)?.time)).filter(Number.isFinite);
    let cursor = existingStarts.length ? Math.min(...existingStarts) : 15 * 60 + 30;
    const day = new Date(`${date}T12:00:00`).getDay();
    const fixed = [
      ...scheduleItems.filter(item => Number(item.day_of_week) === day).map(item => ({
        start: timeToMinutes(item.start_time),
        end: timeToMinutes(item.end_time) || timeToMinutes(item.start_time) + 60
      })),
      ...calendarEvents.filter(item => item.event_date === date && item.start_time).map(item => ({
        start: timeToMinutes(item.start_time),
        end: timeToMinutes(item.end_time) || timeToMinutes(item.start_time) + 60
      }))
    ].filter(item => Number.isFinite(item.start) && Number.isFinite(item.end)).sort((a, b) => a.start - b.start);

    orderedTasks.forEach(task => {
      const duration = Math.max(15, Number(task.estimated_minutes) || 30);
      let conflict = fixed.find(interval => cursor < interval.end && cursor + duration > interval.start);
      while (conflict) {
        cursor = conflict.end;
        conflict = fixed.find(interval => cursor < interval.end && cursor + duration > interval.start);
      }
      const previous = global.IteraPlanning.getTaskPlan(user, task) || {};
      plan[String(task.id)] = {
        ...previous,
        date,
        time: minutesToTime(cursor),
        duration,
        source: "manual-order",
        updatedAt: new Date().toISOString()
      };
      cursor += duration + (task.task_type === "selfcare" ? 0 : 15);
    });

    const previousUser = user;
    user = {
      ...user,
      user_metadata: {
        ...(user.user_metadata || {}),
        itera_task_plan: plan
      }
    };
    render();
    const saved = await global.IteraPlanning.savePlan(user, plan);
    if (!saved.ok) {
      user = previousUser;
      global.showToast?.("Noua ordine nu a putut fi salvată.", "!");
      await reload();
      return;
    }
    user = saved.user;
    await Promise.all(orderedTasks.map(task => {
      const entry = global.IteraPlanning.getTaskPlan(user, task);
      return global.IteraPush?.scheduleTaskReminders({ ...task, deadline_date: entry.date, deadline_time: entry.time });
    }));
    global.dispatchEvent(new CustomEvent("itera:plan-updated"));
    global.showToast?.("Planul și orele s-au reașezat.", "✓");
  }

  function timeToMinutes(value) {
    if (!value) return null;
    const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
  }

  function minutesToTime(value) {
    const safe = Math.max(0, Math.min(1439, Math.round(value)));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
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
      const removal = await global.IteraPlanning?.removeTask(user, id);
      if (removal?.user) user = removal.user;
      await global.IteraPush?.scheduleTaskReminders({ ...task, completed });
      global.dispatchEvent(new CustomEvent("itera:task-updated", { detail: { id, completed } }));
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
    const taskIndex = tasks.findIndex(item => String(item.id) === String(id));
    const removedTask = taskIndex >= 0 ? tasks[taskIndex] : null;
    if (deleteButton) deleteButton.disabled = true;
    if (!fromDialog && removedTask) {
      tasks.splice(taskIndex, 1);
      root.querySelector(`[data-task-row="${id}"]`)?.remove();
      global.showToast?.("Task șters.", "✓");
    }
    await global.IteraPush?.cancelTaskReminders(id);
    const { error } = await supabaseClient.from("tasks").delete().eq("id", id).eq("user_id", user.id);
    if (!error) {
      const removal = await global.IteraPlanning?.removeTask(user, id);
      if (removal?.user) user = removal.user;
      if (fromDialog) closeDialog();
      if (fromDialog) global.showToast?.("Task șters.", "✓");
      global.dispatchEvent(new CustomEvent("itera:task-updated", { detail: { id, deleted: true } }));
      await reload();
    } else {
      if (removedTask && taskIndex >= 0) tasks.splice(taskIndex, 0, removedTask);
      if (deleteButton) deleteButton.disabled = false;
      await reload();
      global.showToast?.("Task-ul nu a putut fi șters.", "!");
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  global.IteraTasksView = Object.freeze({ mount, unmount, openTask, refresh: reload });
})(window);
