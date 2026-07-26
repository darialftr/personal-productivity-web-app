"use strict";

(function (global) {
  const months = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];
  let root, user, subjects = [], events = [], tasks = [], mounted = false;
  let month = new Date().getMonth(), year = new Date().getFullYear(), selected = isoDate(new Date());

  async function mount() {
    root = document.getElementById("calendarViewRoot");
    if (!root || mounted) return;
    mounted = true;
    root.innerHTML = '<div class="calendar-spa-state">Se încarcă calendarul…</div>';
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || !mounted) return;
    user = session.user;
    await reload();
  }

  function unmount() { mounted = false; root = null; }

  async function reload() {
    const [subjectResult, eventResult, taskResult] = await Promise.all([
      supabaseClient.from("subjects").select("id,name,color").eq("user_id", user.id).eq("is_active", true).order("position"),
      supabaseClient.from("calendar_events").select("*").eq("user_id", user.id).order("event_date").order("start_time"),
      supabaseClient.from("tasks").select("id,subject_id,title,task_type,deadline_date,deadline_time,priority,completed")
        .eq("user_id", user.id).not("deadline_date", "is", null)
    ]);
    if (!mounted) return;
    if (subjectResult.error || eventResult.error || taskResult.error) {
      root.innerHTML = '<div class="calendar-spa-state">Calendarul nu a putut fi încărcat.</div>';
      return;
    }
    subjects = subjectResult.data || [];
    events = eventResult.data || [];
    tasks = taskResult.data || [];
    render();
  }

  function allItems(date) {
    return [
      ...events.filter(item => item.event_date === date).map(item => ({ ...item, source: "event" })),
      ...tasks.filter(item => item.deadline_date === date).map(item => ({
        ...item, source: "task", event_date: item.deadline_date, start_time: item.deadline_time,
        event_type: item.task_type
      }))
    ].sort((a, b) => String(a.start_time || "23:59").localeCompare(String(b.start_time || "23:59")));
  }

  function render() {
    root.innerHTML = `
      <header class="calendar-spa-header"><div><p class="eyebrow">Planificare</p><h2>Calendarul tău</h2>
        <p>Evenimente și deadline-uri într-un singur loc.</p></div>
        <button class="primary-small-button" data-add-event><span aria-hidden="true">+</span> Eveniment</button></header>
      <div class="calendar-spa-layout">
        <section class="calendar-spa-card">
          <div class="calendar-spa-month-head"><button class="icon-button" data-month="-1">‹</button>
            <h3>${months[month]} ${year}</h3><button class="icon-button" data-month="1">›</button></div>
          <div class="calendar-spa-grid"><span>Lu</span><span>Ma</span><span>Mi</span><span>Jo</span><span>Vi</span><span>Sâ</span><span>Du</span>
            ${renderDays()}</div>
        </section>
        <aside class="calendar-spa-card calendar-spa-details">${renderDetails()}</aside>
      </div>
      ${eventDialog()}`;
    bindEvents();
  }

  function renderDays() {
    const first = new Date(year, month, 1), count = new Date(year, month + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const cells = Array(offset).fill('<div class="calendar-spa-blank"></div>');
    for (let day = 1; day <= count; day++) {
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const items = allItems(date);
      cells.push(`<button class="calendar-spa-day ${date === selected ? "selected" : ""} ${date === isoDate(new Date()) ? "today" : ""}" data-date="${date}">
        <strong>${day}</strong><span>${items.slice(0, 3).map(item => `<i style="--item:${subjectColor(item.subject_id)}">${escapeHtml(item.title)}</i>`).join("")}</span>
        ${items.length > 3 ? `<small>+${items.length - 3}</small>` : ""}</button>`);
    }
    return cells.join("");
  }

  function renderDetails() {
    const items = allItems(selected);
    return `<div class="calendar-spa-detail-head"><div><p class="eyebrow">Zi selectată</p><h3>${formatDate(selected)}</h3></div>
      <button class="icon-button" data-add-selected aria-label="Adaugă"><span aria-hidden="true">+</span></button></div>
      <div class="calendar-spa-detail-list">${items.length ? items.map(item => `<button class="calendar-spa-detail-item" ${item.source === "event" ? `data-edit-event="${item.id}"` : 'data-open-tasks'} style="--item:${subjectColor(item.subject_id)}">
        <span>${String(item.start_time || "—").slice(0, 5)}</span><span><strong>${escapeHtml(item.title)}</strong>
        <small>${item.source === "task" ? "Deadline task" : escapeHtml(subjectName(item.subject_id) || item.event_type)}</small></span></button>`).join("") :
        '<div class="calendar-spa-empty">Nimic planificat în această zi.</div>'}</div>`;
  }

  function eventDialog() {
    return `<dialog class="calendar-spa-dialog"><form data-event-form><input type="hidden" name="id">
      <div class="calendar-spa-dialog-head"><h3 data-event-dialog-title>Eveniment nou</h3><button type="button" class="icon-button" data-close-event>×</button></div>
      <label>Titlu<input name="title" required></label><div class="calendar-spa-fields">
      <label>Materie<select name="subject_id"><option value="">Fără materie</option>${subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label>
      <label>Tip<select name="event_type"><option value="event">Eveniment</option><option value="school">Școală</option><option value="test">Test</option><option value="personal">Personal</option></select></label>
      <label>Data<input name="event_date" type="date" required></label><label>Început<input name="start_time" type="time"></label>
      <label>Final<input name="end_time" type="time"></label><label>Locație<input name="location"></label></div>
      <label>Notițe<textarea name="notes" rows="3"></textarea></label><p class="calendar-spa-error" data-event-error></p>
      <div class="calendar-spa-actions"><button type="button" class="secondary-button" data-delete-event hidden>Șterge</button><button class="primary-button">Salvează</button></div>
      </form></dialog>`;
  }

  function bindEvents() {
    root.querySelector("[data-add-event]").addEventListener("click", () => openDialog());
    root.querySelector("[data-add-selected]").addEventListener("click", () => openDialog());
    root.querySelector("[data-close-event]").addEventListener("click", closeDialog);
    root.querySelector("[data-event-form]").addEventListener("submit", saveEvent);
    root.querySelector("[data-delete-event]").addEventListener("click", deleteEvent);
    root.querySelectorAll("[data-month]").forEach(button => button.addEventListener("click", () => changeMonth(Number(button.dataset.month))));
    root.querySelectorAll("[data-date]").forEach(button => button.addEventListener("click", () => { selected = button.dataset.date; render(); }));
    root.querySelectorAll("[data-edit-event]").forEach(button => button.addEventListener("click", () => openDialog(events.find(item => item.id === button.dataset.editEvent))));
    root.querySelectorAll("[data-open-tasks]").forEach(button => button.addEventListener("click", () => IteraShell.navigate("tasks", { updateUrl: true })));
  }

  function changeMonth(delta) {
    month += delta;
    if (month < 0) { month = 11; year--; }
    if (month > 11) { month = 0; year++; }
    selected = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    render();
  }

  function openDialog(item) {
    const dialog = root.querySelector("dialog"), form = dialog.querySelector("form");
    form.reset();
    for (const name of ["id", "title", "subject_id", "event_type", "event_date", "start_time", "end_time", "location", "notes"]) {
      if (form.elements[name]) form.elements[name].value = item?.[name] ?? "";
    }
    if (!item) { form.elements.event_type.value = "event"; form.elements.event_date.value = selected; }
    form.querySelector("[data-event-dialog-title]").textContent = item ? "Editează evenimentul" : "Eveniment nou";
    form.querySelector("[data-delete-event]").hidden = !item;
    dialog.showModal();
  }

  function closeDialog() { root.querySelector("dialog").close(); }

  async function saveEvent(event) {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form)), id = values.id;
    if (values.start_time && values.end_time && values.start_time >= values.end_time) {
      form.querySelector("[data-event-error]").textContent = "Ora de final trebuie să fie după ora de început."; return;
    }
    const payload = { user_id: user.id, subject_id: values.subject_id || null, title: values.title.trim(),
      event_type: values.event_type, event_date: values.event_date, start_time: values.start_time || null,
      end_time: values.end_time || null, location: values.location.trim() || null, notes: values.notes.trim() || null };
    const query = id ? supabaseClient.from("calendar_events").update(payload).eq("id", id).eq("user_id", user.id)
      : supabaseClient.from("calendar_events").insert(payload);
    const { error } = await query;
    if (error) { form.querySelector("[data-event-error]").textContent = "Evenimentul nu a putut fi salvat."; return; }
    selected = values.event_date; closeDialog(); await reload();
  }

  async function deleteEvent() {
    const id = root.querySelector("[data-event-form]").elements.id.value;
    if (!id) return;
    const { error } = await supabaseClient.from("calendar_events").delete().eq("id", id).eq("user_id", user.id);
    if (!error) { closeDialog(); await reload(); }
  }

  function subjectName(id) { return subjects.find(item => item.id === id)?.name || ""; }
  function subjectColor(id) { return subjects.find(item => item.id === id)?.color || "#f3a9c5"; }
  function isoDate(date) { return date.toISOString().slice(0, 10); }
  function formatDate(value) { return new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
  function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  global.IteraCalendarView = Object.freeze({ mount, unmount });
})(window);
