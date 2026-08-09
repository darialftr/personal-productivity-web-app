"use strict";

(function (global) {
  const dayNames = ["Duminică", "Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă"];
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const typeLabels = {
    school: "Oră",
    tutoring: "Meditație",
    study: "Studiu",
    personal: "Personal",
    other: "Activitate"
  };
  let root, user, subjects = [], items = [], mounted = false;
  let activeBuilderDay = 1;
  let dayDrafts = new Map();

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
    dayDrafts.clear();
  }

  function render() {
    root.innerHTML = `
      <header class="schedule-spa-header">
        <div><p class="eyebrow">Planificare</p><h2>Orarul tău</h2>
        <p>Alege materiile în ordine. Itera calculează automat orele și pauzele.</p></div>
        <div class="schedule-spa-header-actions">
          <button class="secondary-button" data-add-activity>Altă activitate</button>
          <button class="primary-small-button" data-build-schedule><span aria-hidden="true">+</span> Orar rapid</button>
        </div>
      </header>
      <div class="schedule-spa-week">${dayOrder.map(renderDay).join("")}</div>
      ${dayBuilderDialog()}
      ${activityDialog()}`;

    root.querySelector("[data-build-schedule]").addEventListener("click", () => openDayBuilder(preferredBuilderDay()));
    root.querySelector("[data-add-activity]").addEventListener("click", () => openActivityDialog());
    root.querySelectorAll("[data-build-day]").forEach(button =>
      button.addEventListener("click", () => openDayBuilder(Number(button.dataset.buildDay)))
    );
    root.querySelectorAll("[data-close-day-builder]").forEach(button =>
      button.addEventListener("click", closeDayBuilder)
    );
    root.querySelector("[data-day-builder-form]").addEventListener("submit", saveBuiltDay);
    root.querySelector("[data-close-schedule]").addEventListener("click", closeActivityDialog);
    root.querySelector("[data-schedule-form]").addEventListener("submit", saveItem);
    root.querySelector("[data-delete-schedule]").addEventListener("click", deleteItem);
    root.querySelectorAll("[data-edit-schedule]").forEach(button =>
      button.addEventListener("click", () => openActivityDialog(items.find(item => item.id === button.dataset.editSchedule)))
    );
  }

  function preferredBuilderDay() {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1;
  }

  function schoolItemsForDay(day) {
    return items
      .filter(item => Number(item.day_of_week) === Number(day) && (item.item_type || "school") === "school")
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  }

  function renderDay(day) {
    const current = items
      .filter(item => Number(item.day_of_week) === day)
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    const school = current.filter(item => (item.item_type || "school") === "school");
    const summary = school.length
      ? `${school.length} ${school.length === 1 ? "oră" : "ore"} · ${String(school[0].start_time).slice(0, 5)}–${String(school.at(-1).end_time).slice(0, 5)}`
      : current.length
        ? `${current.length} ${current.length === 1 ? "activitate" : "activități"}`
        : "Zi neconfigurată";
    return `<section class="schedule-spa-day">
      <div class="schedule-spa-day-head"><div><strong>${dayNames[day]}</strong><small>${summary}</small></div>
        <button type="button" class="schedule-spa-day-add" data-build-day="${day}" aria-label="Configurează ${dayNames[day]}">+</button></div>
      ${current.length ? current.map(renderItem).join("") : `<button class="schedule-spa-empty schedule-spa-empty-action" data-build-day="${day}"><strong>Adaugă materiile</strong><span>Alegi ordinea, Itera pune orele.</span></button>`}
    </section>`;
  }

  function renderItem(item) {
    const subject = subjects.find(value => value.id === item.subject_id);
    const secondary = subject?.name && subject.name !== item.title
      ? subject.name
      : (item.location || typeLabels[item.item_type] || "Activitate");
    return `<button class="schedule-spa-item" data-edit-schedule="${item.id}" title="${escapeHtml(item.title)}" style="--subject:${subject?.color || "#f3a9c5"}">
      <span class="schedule-spa-item-time">${String(item.start_time).slice(0, 5)}</span><span class="schedule-spa-item-copy"><strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(secondary)}</small></span></button>`;
  }

  function dayBuilderDialog() {
    return `<dialog class="schedule-day-builder"><form data-day-builder-form>
      <div class="schedule-spa-dialog-head"><div><p class="eyebrow">Configurare rapidă</p><h3>Construiește ziua</h3></div>
      <button type="button" class="icon-button" data-close-day-builder aria-label="Închide">×</button></div>
      <div data-day-builder-content></div>
      <p class="schedule-spa-error" data-day-builder-error></p>
      <div class="schedule-spa-actions"><button type="button" class="secondary-button" data-close-day-builder>Renunță</button>
      <button type="submit" class="primary-button" data-save-built-day>Salvează orarul</button></div>
    </form></dialog>`;
  }

  function initializeDayDrafts() {
    dayDrafts = new Map(dayOrder.map(day => {
      const school = schoolItemsForDay(day);
      const firstDuration = school[0]
        ? Math.max(30, minutesFromTime(school[0].end_time) - minutesFromTime(school[0].start_time))
        : 50;
      const inferredBreak = school.length > 1
        ? Math.max(0, minutesFromTime(school[1].start_time) - minutesFromTime(school[0].end_time))
        : 10;
      return [day, {
        startTime: school[0] ? String(school[0].start_time).slice(0, 5) : "08:00",
        lessonMinutes: Math.min(90, firstDuration || 50),
        breakMinutes: Math.min(30, inferredBreak),
        lessons: school.map(item => ({ subjectId: item.subject_id || "", title: item.title || "Oră" }))
      }];
    }));
  }

  function openDayBuilder(day = 1) {
    initializeDayDrafts();
    activeBuilderDay = day;
    renderDayBuilderContent();
    root.querySelector(".schedule-day-builder").showModal();
  }

  function closeDayBuilder() {
    root.querySelector(".schedule-day-builder")?.close();
  }

  function renderDayBuilderContent() {
    const container = root.querySelector("[data-day-builder-content]");
    const draft = dayDrafts.get(activeBuilderDay);
    const slots = calculateSlots(draft);
    container.innerHTML = `
      <div class="schedule-builder-days" role="tablist" aria-label="Alege ziua">
        ${dayOrder.map(day => `<button type="button" role="tab" aria-selected="${day === activeBuilderDay}" class="${day === activeBuilderDay ? "active" : ""}" data-builder-day="${day}">${shortDayName(day)}</button>`).join("")}
      </div>
      <section class="schedule-builder-start">
        <label><span>La cât începi ${dayNames[activeBuilderDay].toLowerCase()}?</span><input type="time" value="${draft.startTime}" data-builder-start required></label>
        <div class="schedule-builder-summary" data-builder-summary>${builderSummary(draft, slots)}</div>
      </section>
      <section class="schedule-builder-picker">
        <div class="schedule-builder-section-head"><div><span>Materii</span><strong>Apasă-le în ordinea în care le ai</strong></div>
          ${draft.lessons.length ? '<button type="button" class="text-button" data-clear-builder>Golește</button>' : ""}</div>
        ${subjects.length ? `<div class="schedule-subject-chips">${subjects.map(subject => `<button type="button" data-add-builder-subject="${subject.id}" style="--subject:${subject.color || "#f3a9c5"}"><i aria-hidden="true"></i>${escapeHtml(subject.name)}</button>`).join("")}</div>` : `<div class="schedule-builder-no-subjects"><span>Adaugă mai întâi materiile tale.</span><button type="button" class="text-button" data-open-subjects>Deschide Materii</button></div>`}
      </section>
      <section class="schedule-builder-sequence">
        <div class="schedule-builder-section-head"><div><span>Ordinea zilei</span><strong>${draft.lessons.length ? `${draft.lessons.length} ${draft.lessons.length === 1 ? "oră selectată" : "ore selectate"}` : "Nicio materie selectată"}</strong></div></div>
        <div class="schedule-builder-lessons">${draft.lessons.length ? draft.lessons.map((lesson, index) => renderBuilderLesson(lesson, index, slots[index])).join("") : '<div class="schedule-builder-empty">Atinge materiile de mai sus pentru a construi ziua.</div>'}</div>
      </section>
      <details class="schedule-builder-options">
        <summary>Ajustează durata orei și pauza</summary>
        <div><label><span>O oră durează</span><select data-builder-duration>${[45, 50, 55, 60].map(value => `<option value="${value}" ${value === Number(draft.lessonMinutes) ? "selected" : ""}>${value} minute</option>`).join("")}</select></label>
        <label><span>Pauza obișnuită</span><select data-builder-break>${[0, 5, 10, 15, 20].map(value => `<option value="${value}" ${value === Number(draft.breakMinutes) ? "selected" : ""}>${value} minute</option>`).join("")}</select></label></div>
      </details>`;
    bindDayBuilderContent();
  }

  function renderBuilderLesson(lesson, index, slot) {
    const subject = subjects.find(item => item.id === lesson.subjectId);
    return `<div class="schedule-builder-lesson" style="--subject:${subject?.color || "#f3a9c5"}">
      <span class="schedule-builder-number">${index + 1}</span>
      <span class="schedule-builder-lesson-copy"><strong>${escapeHtml(subject?.name || lesson.title || "Oră")}</strong><small>${slot ? `${slot.start}–${slot.end}` : ""}</small></span>
      <button type="button" data-remove-builder="${index}" aria-label="Elimină ${escapeHtml(subject?.name || lesson.title || "ora")}">×</button>
    </div>`;
  }

  function bindDayBuilderContent() {
    root.querySelectorAll("[data-builder-day]").forEach(button => button.addEventListener("click", () => {
      persistBuilderControls();
      activeBuilderDay = Number(button.dataset.builderDay);
      renderDayBuilderContent();
    }));
    root.querySelectorAll("[data-add-builder-subject]").forEach(button => button.addEventListener("click", () => {
      persistBuilderControls();
      const subject = subjects.find(item => item.id === button.dataset.addBuilderSubject);
      if (subject) dayDrafts.get(activeBuilderDay).lessons.push({ subjectId: subject.id, title: subject.name });
      renderDayBuilderContent();
    }));
    root.querySelectorAll("[data-remove-builder]").forEach(button => button.addEventListener("click", () => {
      persistBuilderControls();
      dayDrafts.get(activeBuilderDay).lessons.splice(Number(button.dataset.removeBuilder), 1);
      renderDayBuilderContent();
    }));
    root.querySelector("[data-clear-builder]")?.addEventListener("click", () => {
      dayDrafts.get(activeBuilderDay).lessons = [];
      renderDayBuilderContent();
    });
    root.querySelector("[data-open-subjects]")?.addEventListener("click", () => {
      closeDayBuilder();
      global.IteraShell?.navigate("subjects", { updateUrl: true });
    });
    root.querySelectorAll("[data-builder-start],[data-builder-duration],[data-builder-break]").forEach(control => {
      control.addEventListener("change", () => {
        persistBuilderControls();
        renderDayBuilderContent();
      });
    });
  }

  function persistBuilderControls() {
    const draft = dayDrafts.get(activeBuilderDay);
    const start = root.querySelector("[data-builder-start]");
    const duration = root.querySelector("[data-builder-duration]");
    const breakControl = root.querySelector("[data-builder-break]");
    if (start?.value) draft.startTime = start.value;
    if (duration?.value) draft.lessonMinutes = Number(duration.value);
    if (breakControl?.value !== undefined) draft.breakMinutes = Number(breakControl.value);
  }

  function calculateSlots(draft) {
    const start = minutesFromTime(draft.startTime);
    return draft.lessons.map((_, index) => {
      const slotStart = start + index * (Number(draft.lessonMinutes) + Number(draft.breakMinutes));
      const slotEnd = slotStart + Number(draft.lessonMinutes);
      return { start: timeFromMinutes(slotStart), end: timeFromMinutes(slotEnd), startMinutes: slotStart, endMinutes: slotEnd };
    });
  }

  function builderSummary(draft, slots = calculateSlots(draft)) {
    if (!draft.lessons.length) return '<strong>Începi la ' + escapeHtml(draft.startTime) + '</strong><span>Adaugă materiile ca să estimăm finalul.</span>';
    const finish = slots.at(-1)?.end || draft.startTime;
    return `<strong>${draft.lessons.length} ${draft.lessons.length === 1 ? "oră" : "ore"} · termini în jur de ${finish}</strong><span>Calculat cu ore de ${draft.lessonMinutes} min și pauze de ${draft.breakMinutes} min.</span>`;
  }

  async function saveBuiltDay(event) {
    event.preventDefault();
    persistBuilderControls();
    const errorNode = root.querySelector("[data-day-builder-error]");
    const saveButton = root.querySelector("[data-save-built-day]");
    errorNode.textContent = "";
    if (![...dayDrafts.values()].some(draft => draft.lessons.length)) {
      errorNode.textContent = "Adaugă cel puțin o materie într-una dintre zile.";
      return;
    }

    for (const day of dayOrder) {
      const draft = dayDrafts.get(day);
      const slots = calculateSlots(draft);
      if (slots.some(slot => slot.endMinutes >= 24 * 60)) {
        errorNode.textContent = `${dayNames[day]} depășește finalul zilei. Schimbă ora de început sau durata.`;
        return;
      }
      const separateActivities = items.filter(item =>
        Number(item.day_of_week) === day && (item.item_type || "school") !== "school"
      );
      const conflict = separateActivities.find(item => {
        const activityStart = minutesFromTime(item.start_time);
        const activityEnd = minutesFromTime(item.end_time);
        return slots.some(slot => slot.startMinutes < activityEnd && slot.endMinutes > activityStart);
      });
      if (conflict) {
        errorNode.textContent = `${dayNames[day]} se suprapune cu „${conflict.title}”. Ajustează ora de început.`;
        return;
      }
    }

    saveButton.disabled = true;
    saveButton.textContent = "Se salvează…";
    const operations = [];
    for (const day of dayOrder) {
      const draft = dayDrafts.get(day);
      const slots = calculateSlots(draft);
      const existing = schoolItemsForDay(day);
      for (let index = 0; index < draft.lessons.length; index++) {
        const lesson = draft.lessons[index];
        const subject = subjects.find(item => item.id === lesson.subjectId);
        const payload = {
          user_id: user.id,
          subject_id: lesson.subjectId || null,
          title: subject?.name || lesson.title || `Ora ${index + 1}`,
          item_type: "school",
          day_of_week: day,
          start_time: slots[index].start,
          end_time: slots[index].end
        };
        const query = existing[index]
          ? supabaseClient.from("schedule_items").update(payload).eq("id", existing[index].id).eq("user_id", user.id)
          : supabaseClient.from("schedule_items").insert(payload);
        operations.push(query);
      }

      const extraIds = existing.slice(draft.lessons.length).map(item => item.id);
      if (extraIds.length) {
        operations.push(
          supabaseClient.from("schedule_items").delete().in("id", extraIds).eq("user_id", user.id)
        );
      }
    }
    const results = await Promise.all(operations);
    if (results.some(result => result.error)) {
      closeDayBuilder();
      await reload();
      global.showToast?.("Orarul nu a putut fi salvat complet. Verifică zilele și încearcă din nou.", "!");
      return;
    }
    closeDayBuilder();
    await reload();
    global.showToast?.("Orarul săptămânal este gata.", "✓");
  }

  function activityDialog() {
    return `<dialog class="schedule-spa-dialog">
      <form data-schedule-form>
        <input type="hidden" name="id">
        <div class="schedule-spa-dialog-head"><h3 data-dialog-title>Activitate nouă</h3>
        <button type="button" class="icon-button" data-close-schedule aria-label="Închide">×</button></div>
        <label>Titlu<input name="title" required></label>
        <div class="schedule-spa-fields">
          <label>Materie<select name="subject_id"><option value="">Fără materie</option>
            ${subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
          </select></label>
          <label>Tip<select name="item_type"><option value="school">Oră specială</option>
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
  }

  function openActivityDialog(item) {
    const dialog = root.querySelector(".schedule-spa-dialog");
    const form = dialog.querySelector("form");
    form.reset();
    for (const name of ["id", "title", "subject_id", "item_type", "day_of_week", "start_time", "end_time", "location", "notes"]) {
      if (form.elements[name]) form.elements[name].value = item?.[name] ?? "";
    }
    if (!item) {
      form.elements.item_type.value = "tutoring";
      form.elements.day_of_week.value = String(preferredBuilderDay());
      form.elements.start_time.value = "16:00";
      form.elements.end_time.value = "17:00";
    }
    form.querySelector("[data-dialog-title]").textContent = item ? "Editează activitatea" : "Activitate separată";
    form.querySelector("[data-delete-schedule]").hidden = !item;
    dialog.showModal();
  }

  function closeActivityDialog() {
    root.querySelector(".schedule-spa-dialog")?.close();
  }

  async function saveItem(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    form.querySelector("[data-schedule-error]").textContent = "";
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
    closeActivityDialog();
    await reload();
  }

  async function deleteItem() {
    const id = root.querySelector("[data-schedule-form]").elements.id.value;
    if (!id) return;
    const { error } = await supabaseClient.from("schedule_items").delete()
      .eq("id", id).eq("user_id", user.id);
    if (!error) {
      closeActivityDialog();
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

  function minutesFromTime(value) {
    const [hours, minutes] = String(value || "00:00").slice(0, 5).split(":").map(Number);
    return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
  }

  function timeFromMinutes(value) {
    const safe = Math.max(0, Math.min(1439, Math.round(value)));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function shortDayName(day) {
    return ["Du", "Lu", "Ma", "Mi", "Jo", "Vi", "Sâ"][day];
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  global.IteraScheduleView = Object.freeze({ mount, unmount });
})(window);
