"use strict";

(function (global) {
  const dayNames = ["Duminică", "Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă"];
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  let root, user, subjects = [], items = [], mounted = false;

  async function mount() {
    root = document.getElementById("scheduleViewRoot");
    if (!root || mounted) return;
    mounted = true;
    root.innerHTML = '<div class="schedule-spa-state">Se încarcă orarul…</div>';

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || !mounted) return;
    user = session.user;

    const [subjectResult, scheduleResult] = await Promise.all([
      supabaseClient.from("subjects").select("id,name,color")
        .eq("user_id", user.id).eq("is_active", true).order("position"),
      supabaseClient.from("schedule_items").select("*")
        .eq("user_id", user.id).order("day_of_week").order("start_time")
    ]);

    if (subjectResult.error || scheduleResult.error) {
      root.innerHTML = '<div class="schedule-spa-state">Orarul nu a putut fi încărcat.</div>';
      return;
    }
    subjects = subjectResult.data || [];
    items = scheduleResult.data || [];
    render();
  }

  function unmount() {
    mounted = false;
    root = null;
  }

  function render() {
    root.innerHTML = `
      <header class="schedule-spa-header">
        <div><p class="eyebrow">Planificare</p><h2>Orarul tău</h2>
        <p>Programul săptămânal, sincronizat cu Supabase.</p></div>
        <button class="primary-small-button" data-add-schedule><span aria-hidden="true">+</span> Activitate</button>
      </header>
      <div class="schedule-spa-week">${dayOrder.map(renderDay).join("")}</div>
      <dialog class="schedule-spa-dialog">
        <form data-schedule-form>
          <input type="hidden" name="id">
          <div class="schedule-spa-dialog-head"><h3 data-dialog-title>Activitate nouă</h3>
          <button type="button" class="icon-button" data-close-schedule aria-label="Închide">×</button></div>
          <label>Titlu<input name="title" required></label>
          <div class="schedule-spa-fields">
            <label>Materie<select name="subject_id"><option value="">Fără materie</option>
              ${subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
            </select></label>
            <label>Tip<select name="item_type"><option value="school">Școală</option>
              <option value="tutoring">Meditație</option><option value="study">Studiu</option>
              <option value="personal">Personal</option><option value="other">Altceva</option>
            </select></label>
            <label>Zi<select name="day_of_week">${dayOrder.map(d => `<option value="${d}">${dayNames[d]}</option>`).join("")}</select></label>
            <label>Locație<input name="location"></label>
            <label>Început<input name="start_time" type="time" required></label>
            <label>Final<input name="end_time" type="time" required></label>
          </div>
          <label>Notițe<textarea name="notes" rows="3"></textarea></label>
          <p class="schedule-spa-error" data-schedule-error></p>
          <div class="schedule-spa-actions"><button type="button" class="secondary-button" data-delete-schedule hidden>Șterge</button>
          <button type="submit" class="primary-button">Salvează</button></div>
        </form>
      </dialog>`;

    root.querySelector("[data-add-schedule]").addEventListener("click", () => openDialog());
    root.querySelector("[data-close-schedule]").addEventListener("click", closeDialog);
    root.querySelector("[data-schedule-form]").addEventListener("submit", saveItem);
    root.querySelector("[data-delete-schedule]").addEventListener("click", deleteItem);
    root.querySelectorAll("[data-edit-schedule]").forEach(button =>
      button.addEventListener("click", () => openDialog(items.find(item => item.id === button.dataset.editSchedule)))
    );
  }

  function renderDay(day) {
    const current = items.filter(item => item.day_of_week === day);
    return `<section class="schedule-spa-day"><div class="schedule-spa-day-head"><strong>${dayNames[day]}</strong><span>${current.length}</span></div>
      ${current.length ? current.map(renderItem).join("") : '<p class="schedule-spa-empty">Nicio activitate</p>'}</section>`;
  }

  function renderItem(item) {
    const subject = subjects.find(value => value.id === item.subject_id);
    return `<button class="schedule-spa-item" data-edit-schedule="${item.id}" style="--subject:${subject?.color || "#f3a9c5"}">
      <span>${String(item.start_time).slice(0, 5)}</span><span><strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(subject?.name || item.location || "Activitate")}</small></span></button>`;
  }

  function openDialog(item) {
    const dialog = root.querySelector("dialog");
    const form = dialog.querySelector("form");
    form.reset();
    for (const name of ["id", "title", "subject_id", "item_type", "day_of_week", "start_time", "end_time", "location", "notes"]) {
      if (form.elements[name]) form.elements[name].value = item?.[name] ?? "";
    }
    if (!item) {
      form.elements.item_type.value = "school";
      form.elements.day_of_week.value = "1";
      form.elements.start_time.value = "08:00";
      form.elements.end_time.value = "09:00";
    }
    form.querySelector("[data-dialog-title]").textContent = item ? "Editează activitatea" : "Activitate nouă";
    form.querySelector("[data-delete-schedule]").hidden = !item;
    dialog.showModal();
  }

  function closeDialog() {
    root.querySelector("dialog").close();
  }

  async function saveItem(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (data.start_time >= data.end_time) {
      form.querySelector("[data-schedule-error]").textContent = "Ora de final trebuie să fie după ora de început.";
      return;
    }
    const id = data.id;
    const overlap = items.find(item =>
      item.id !== id &&
      Number(item.day_of_week) === Number(data.day_of_week) &&
      data.start_time < String(item.end_time).slice(0, 5) &&
      data.end_time > String(item.start_time).slice(0, 5)
    );
    if (overlap) {
      form.querySelector("[data-schedule-error]").textContent =
        `Intervalul se suprapune cu „${overlap.title}” (${String(overlap.start_time).slice(0, 5)}–${String(overlap.end_time).slice(0, 5)}).`;
      return;
    }
    const payload = { user_id: user.id, subject_id: data.subject_id || null, title: data.title.trim(),
      item_type: data.item_type, day_of_week: Number(data.day_of_week), start_time: data.start_time,
      end_time: data.end_time, location: data.location.trim() || null, notes: data.notes.trim() || null };
    const query = id
      ? supabaseClient.from("schedule_items").update(payload).eq("id", id).eq("user_id", user.id)
      : supabaseClient.from("schedule_items").insert(payload);
    const { error } = await query;
    if (error) {
      form.querySelector("[data-schedule-error]").textContent = "Activitatea nu a putut fi salvată.";
      return;
    }
    closeDialog();
    await reload();
  }

  async function deleteItem() {
    const id = root.querySelector("[data-schedule-form]").elements.id.value;
    if (!id) return;
    const { error } = await supabaseClient.from("schedule_items").delete()
      .eq("id", id).eq("user_id", user.id);
    if (!error) {
      closeDialog();
      await reload();
    }
  }

  async function reload() {
    const { data, error } = await supabaseClient.from("schedule_items").select("*")
      .eq("user_id", user.id).order("day_of_week").order("start_time");
    if (!error && mounted) {
      items = data || [];
      render();
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  global.IteraScheduleView = Object.freeze({ mount, unmount });
})(window);
