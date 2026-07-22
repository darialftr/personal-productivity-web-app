"use strict";

/* CONSTANTS */

const monthNames = [
  "Ianuarie",
  "Februarie",
  "Martie",
  "Aprilie",
  "Mai",
  "Iunie",
  "Iulie",
  "August",
  "Septembrie",
  "Octombrie",
  "Noiembrie",
  "Decembrie"
];

const shortMonthNames = [
  "ian.",
  "feb.",
  "mar.",
  "apr.",
  "mai",
  "iun.",
  "iul.",
  "aug.",
  "sept.",
  "oct.",
  "nov.",
  "dec."
];

const typeLabels = {
  event: "Eveniment",
  test: "Test",
  homework: "Temă",
  project: "Proiect",
  study: "Studiu",
  personal: "Personal",
  reminder: "Reminder"
};

const typeColors = {
  event: "pink",
  test: "peach",
  homework: "lilac",
  project: "blue",
  study: "green",
  personal: "yellow",
  reminder: "pink"
};

/* STATE */

const today = new Date();

let currentUser = null;
let profile = null;
let subjects = [];

let calendarEvents = [];
let tasks = [];

let displayedMonth = today.getMonth();
let displayedYear = today.getFullYear();

let selectedDate = formatDateForInput(today);
let eventPendingDeletionId = null;
let toastTimeout = null;

/* INITIALIZATION */

initializeCalendarPage();

async function initializeCalendarPage() {
  try {
    const session = await getCurrentSession();

    if (!session) {
      window.location.replace("auth.html");
      return;
    }

    currentUser = session.user;

    await Promise.all([
      loadProfile(),
      loadSubjects(),
      loadCalendarEvents(),
      loadTasks()
    ]);

    renderProfile();
    populateSubjectSelect();
    initializeButtons();
    renderEverything();
  } catch (error) {
    console.error(
      "Calendarul nu a putut fi inițializat:",
      error
    );

    alert(
      "Calendarul nu a putut fi încărcat. Verifică consola."
    );
  }
}

/* AUTH */

async function getCurrentSession() {
  const {
    data: { session },
    error
  } = await supabaseClient.auth.getSession();

  if (error) {
    throw error;
  }

  return session;
}

/* PROFILE */

async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select(
      `
        id,
        first_name,
        grade,
        university,
        onboarding_completed
      `
    )
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  profile = data || {
    first_name:
      currentUser.user_metadata?.first_name ||
      "Itera",

    grade: ""
  };
}

function renderProfile() {
  const firstName =
    profile?.first_name ||
    currentUser?.user_metadata?.first_name ||
    "Itera";

  const grade = profile?.grade || "";

  document.getElementById(
    "sidebarName"
  ).textContent = firstName;

  document.getElementById(
    "sidebarAvatar"
  ).textContent =
    firstName.charAt(0).toUpperCase();

  document.getElementById(
    "sidebarGrade"
  ).textContent =
    formatGradeLabel(grade);
}

function formatGradeLabel(grade) {
  const normalizedGrade = String(
    grade || ""
  ).toLowerCase();

  const gradeMap = {
    "9": "Clasa a IX-a",
    "9th": "Clasa a IX-a",
    ix: "Clasa a IX-a",

    "10": "Clasa a X-a",
    "10th": "Clasa a X-a",
    x: "Clasa a X-a",

    "11": "Clasa a XI-a",
    "11th": "Clasa a XI-a",
    xi: "Clasa a XI-a",

    "12": "Clasa a XII-a",
    "12th": "Clasa a XII-a",
    xii: "Clasa a XII-a"
  };

  return gradeMap[normalizedGrade] || "Elev";
}

/* SUBJECTS */

async function loadSubjects() {
  const { data, error } = await supabaseClient
    .from("subjects")
    .select(
      `
        id,
        name,
        color,
        icon,
        position
      `
    )
    .eq("user_id", currentUser.id)
    .eq("is_active", true)
    .order("position", {
      ascending: true
    })
    .order("name", {
      ascending: true
    });

  if (error) {
    throw error;
  }

  subjects = data || [];
}

function populateSubjectSelect() {
  const select = document.getElementById(
    "eventSubject"
  );

  select.innerHTML = `
    <option value="">
      Fără materie
    </option>
  `;

  subjects.forEach((subject) => {
    const option = document.createElement(
      "option"
    );

    option.value = subject.id;
    option.textContent = subject.name;

    select.appendChild(option);
  });
}

/* CALENDAR EVENTS */

async function loadCalendarEvents() {
  const { data, error } = await supabaseClient
    .from("calendar_events")
    .select(
      `
        id,
        user_id,
        subject_id,
        title,
        event_type,
        event_date,
        start_time,
        end_time,
        color,
        location,
        notes,
        created_at,
        updated_at,
        subjects (
          id,
          name,
          color,
          icon
        )
      `
    )
    .eq("user_id", currentUser.id)
    .order("event_date", {
      ascending: true
    })
    .order("start_time", {
      ascending: true
    });

  if (error) {
    throw error;
  }

  calendarEvents = (data || []).map(
    normalizeCalendarEvent
  );
}

function normalizeCalendarEvent(event) {
  return {
    id: event.id,
    source: "event",

    title: event.title,
    type: event.event_type || "event",

    subjectId: event.subject_id,
    subject: event.subjects?.name || "",

    date: event.event_date,

    startTime: normalizeTime(
      event.start_time
    ),

    endTime: normalizeTime(
      event.end_time
    ),

    color:
      event.color ||
      typeColors[event.event_type] ||
      "pink",

    location: event.location || "",
    notes: event.notes || "",

    createdAt: event.created_at,
    updatedAt: event.updated_at
  };
}

/* TASKS */

async function loadTasks() {
  const { data, error } = await supabaseClient
    .from("tasks")
    .select(
      `
        id,
        user_id,
        subject_id,
        title,
        task_type,
        deadline_date,
        deadline_time,
        priority,
        difficulty,
        estimated_minutes,
        progress,
        notes,
        completed,
        subjects (
          id,
          name,
          color,
          icon
        )
      `
    )
    .eq("user_id", currentUser.id)
    .not("deadline_date", "is", null);

  if (error) {
    throw error;
  }

  tasks = (data || []).map((task) => ({
    id: `task:${task.id}`,
    sourceId: task.id,
    source: "task",

    title: task.title,
    type: task.task_type || "homework",

    subjectId: task.subject_id,
    subject: task.subjects?.name || "",

    date: task.deadline_date,

    startTime: normalizeTime(
      task.deadline_time
    ),

    endTime: "",

    color:
      task.subjects?.color ||
      typeColors[task.task_type] ||
      "lilac",

    location: "",
    notes: task.notes || "",

    priority: task.priority || "medium",
    progress: Number(task.progress) || 0,
    completed: Boolean(task.completed)
  }));
}

/* BUTTONS */

function initializeButtons() {
  document
    .getElementById("addCalendarEventButton")
    .addEventListener("click", () => {
      prepareCreateEventModal(
        formatDateForInput(new Date())
      );
    });

  document
    .getElementById("mobileAddCalendarButton")
    .addEventListener("click", () => {
      prepareCreateEventModal(
        formatDateForInput(new Date())
      );
    });

  document
    .getElementById("previousMonthButton")
    .addEventListener("click", () => {
      displayedMonth -= 1;

      if (displayedMonth < 0) {
        displayedMonth = 11;
        displayedYear -= 1;
      }

      renderEverything();
    });

  document
    .getElementById("nextMonthButton")
    .addEventListener("click", () => {
      displayedMonth += 1;

      if (displayedMonth > 11) {
        displayedMonth = 0;
        displayedYear += 1;
      }

      renderEverything();
    });

  document
    .getElementById("todayButton")
    .addEventListener("click", () => {
      const now = new Date();

      displayedMonth = now.getMonth();
      displayedYear = now.getFullYear();
      selectedDate = formatDateForInput(now);

      renderEverything();
    });

  document
    .getElementById("calendarTypeFilter")
    .addEventListener(
      "change",
      renderEverything
    );

  document
    .getElementById("closeEventModalButton")
    .addEventListener("click", () => {
      closeModal("calendarEventModal");
    });

  document
    .getElementById("cancelEventButton")
    .addEventListener("click", () => {
      closeModal("calendarEventModal");
    });

  document
    .getElementById("calendarEventForm")
    .addEventListener(
      "submit",
      handleEventSubmit
    );

  document
    .getElementById("deleteEventButton")
    .addEventListener("click", () => {
      const editingId = document.getElementById(
        "editingEventId"
      ).value;

      if (!editingId) {
        return;
      }

      eventPendingDeletionId = editingId;

      closeModal("calendarEventModal");
      openModal(
        "deleteEventConfirmationModal"
      );
    });

  document
    .getElementById(
      "cancelEventDeletionButton"
    )
    .addEventListener("click", () => {
      eventPendingDeletionId = null;

      closeModal(
        "deleteEventConfirmationModal"
      );
    });

  document
    .getElementById(
      "confirmEventDeletionButton"
    )
    .addEventListener(
      "click",
      confirmEventDeletion
    );

  document
    .getElementById("closeDayDetailsButton")
    .addEventListener("click", () => {
      closeModal("dayDetailsModal");
    });

  document
    .getElementById(
      "addEventForSelectedDayButton"
    )
    .addEventListener("click", () => {
      closeModal("dayDetailsModal");

      prepareCreateEventModal(selectedDate);
    });

  document
    .querySelectorAll(".modal-overlay")
    .forEach((overlay) => {
      overlay.addEventListener(
        "click",
        (event) => {
          if (event.target === overlay) {
            closeModal(overlay.id);
          }
        }
      );
    });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") {
        return;
      }

      document
        .querySelectorAll(
          ".modal-overlay.visible"
        )
        .forEach((modal) => {
          closeModal(modal.id);
        });
    }
  );
}

/* MODALS */

function openModal(modalId) {
  const modal = document.getElementById(
    modalId
  );

  if (!modal) {
    return;
  }

  modal.classList.add("visible");
  modal.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.style.overflow = "hidden";
}

function closeModal(modalId) {
  const modal = document.getElementById(
    modalId
  );

  if (!modal) {
    return;
  }

  modal.classList.remove("visible");
  modal.setAttribute(
    "aria-hidden",
    "true"
  );

  const visibleModal =
    document.querySelector(
      ".modal-overlay.visible"
    );

  if (!visibleModal) {
    document.body.style.overflow = "";
  }
}

/* CREATE / EDIT */

function prepareCreateEventModal(dateValue) {
  const form = document.getElementById(
    "calendarEventForm"
  );

  form.reset();

  document.getElementById(
    "editingEventId"
  ).value = "";

  document.getElementById(
    "eventModalKicker"
  ).textContent = "Eveniment nou";

  document.getElementById(
    "eventModalTitle"
  ).textContent = "Adaugă în calendar";

  document.getElementById(
    "saveEventButton"
  ).textContent = "Salvează";

  document.getElementById(
    "deleteEventButton"
  ).classList.add("hidden");

  document.getElementById(
    "eventDate"
  ).value =
    dateValue ||
    formatDateForInput(new Date());

  document.getElementById(
    "eventType"
  ).value = "event";

  document.getElementById(
    "eventColor"
  ).value = "pink";

  document.getElementById(
    "eventFormError"
  ).textContent = "";

  openModal("calendarEventModal");

  setTimeout(() => {
    document.getElementById(
      "eventTitle"
    ).focus();
  }, 180);
}

function prepareEditEventModal(eventId) {
  const event = calendarEvents.find(
    (currentEvent) =>
      currentEvent.id === eventId
  );

  if (!event) {
    return;
  }

  document.getElementById(
    "editingEventId"
  ).value = event.id;

  document.getElementById(
    "eventTitle"
  ).value = event.title;

  document.getElementById(
    "eventType"
  ).value = event.type;

  document.getElementById(
    "eventSubject"
  ).value = event.subjectId || "";

  document.getElementById(
    "eventDate"
  ).value = event.date;

  document.getElementById(
    "eventColor"
  ).value = event.color || "pink";

  document.getElementById(
    "eventStartTime"
  ).value = event.startTime || "";

  document.getElementById(
    "eventEndTime"
  ).value = event.endTime || "";

  document.getElementById(
    "eventLocation"
  ).value = event.location || "";

  document.getElementById(
    "eventNotes"
  ).value = event.notes || "";

  document.getElementById(
    "eventModalKicker"
  ).textContent = "Modifică evenimentul";

  document.getElementById(
    "eventModalTitle"
  ).textContent = "Editează evenimentul";

  document.getElementById(
    "saveEventButton"
  ).textContent = "Salvează modificările";

  document.getElementById(
    "deleteEventButton"
  ).classList.remove("hidden");

  document.getElementById(
    "eventFormError"
  ).textContent = "";

  closeModal("dayDetailsModal");
  openModal("calendarEventModal");
}

/* SAVE EVENT */

async function handleEventSubmit(event) {
  event.preventDefault();

  const saveButton =
    document.getElementById(
      "saveEventButton"
    );

  const title = document
    .getElementById("eventTitle")
    .value
    .trim();

  const date = document.getElementById(
    "eventDate"
  ).value;

  const startTime = document.getElementById(
    "eventStartTime"
  ).value;

  const endTime = document.getElementById(
    "eventEndTime"
  ).value;

  if (!title) {
    showFormError(
      "Scrie titlul evenimentului."
    );
    return;
  }

  if (!date) {
    showFormError(
      "Alege data evenimentului."
    );
    return;
  }

  if (
    startTime &&
    endTime &&
    startTime >= endTime
  ) {
    showFormError(
      "Ora de final trebuie să fie după ora de început."
    );
    return;
  }

  const editingEventId =
    document.getElementById(
      "editingEventId"
    ).value;

  const eventData = {
    user_id: currentUser.id,

    subject_id:
      document.getElementById(
        "eventSubject"
      ).value || null,

    title,

    event_type:
      document.getElementById(
        "eventType"
      ).value,

    event_date: date,

    start_time: startTime || null,
    end_time: endTime || null,

    color:
      document.getElementById(
        "eventColor"
      ).value,

    location:
      document
        .getElementById(
          "eventLocation"
        )
        .value
        .trim() || null,

    notes:
      document
        .getElementById(
          "eventNotes"
        )
        .value
        .trim() || null
  };

  try {
    saveButton.disabled = true;
    saveButton.textContent =
      editingEventId
        ? "Se salvează..."
        : "Se adaugă...";

    if (editingEventId) {
      const { error } = await supabaseClient
        .from("calendar_events")
        .update(eventData)
        .eq("id", editingEventId)
        .eq("user_id", currentUser.id);

      if (error) {
        throw error;
      }

      showToast(
        "Evenimentul a fost actualizat.",
        "✓"
      );
    } else {
      const { error } = await supabaseClient
        .from("calendar_events")
        .insert(eventData);

      if (error) {
        throw error;
      }

      showToast(
        "Evenimentul a fost adăugat.",
        "＋"
      );
    }

    await loadCalendarEvents();

    selectedDate = date;

    const selectedDateObject =
      parseLocalDate(date);

    displayedMonth =
      selectedDateObject.getMonth();

    displayedYear =
      selectedDateObject.getFullYear();

    renderEverything();
    closeModal("calendarEventModal");
  } catch (error) {
    console.error(
      "Evenimentul nu a putut fi salvat:",
      error
    );

    showFormError(
      "Evenimentul nu a putut fi salvat."
    );
  } finally {
    saveButton.disabled = false;

    saveButton.textContent =
      editingEventId
        ? "Salvează modificările"
        : "Salvează";
  }
}

function showFormError(message) {
  document.getElementById(
    "eventFormError"
  ).textContent = message;
}

/* DELETE */

async function confirmEventDeletion() {
  if (!eventPendingDeletionId) {
    return;
  }

  const deleteButton =
    document.getElementById(
      "confirmEventDeletionButton"
    );

  try {
    deleteButton.disabled = true;
    deleteButton.textContent =
      "Se șterge...";

    const { error } = await supabaseClient
      .from("calendar_events")
      .delete()
      .eq("id", eventPendingDeletionId)
      .eq("user_id", currentUser.id);

    if (error) {
      throw error;
    }

    eventPendingDeletionId = null;

    await loadCalendarEvents();

    renderEverything();

    closeModal(
      "deleteEventConfirmationModal"
    );

    showToast(
      "Evenimentul a fost șters.",
      "×"
    );
  } catch (error) {
    console.error(
      "Evenimentul nu a putut fi șters:",
      error
    );

    showToast(
      "Evenimentul nu a putut fi șters.",
      "!"
    );
  } finally {
    deleteButton.disabled = false;
    deleteButton.textContent =
      "Da, șterge";
  }
}

/* ALL ITEMS */

function getAllCalendarItems() {
  return [
    ...calendarEvents,
    ...tasks
  ].sort(sortCalendarItems);
}

function getFilteredCalendarItems() {
  const filter =
    document.getElementById(
      "calendarTypeFilter"
    ).value;

  const allItems =
    getAllCalendarItems();

  if (filter === "all") {
    return allItems;
  }

  return allItems.filter(
    (item) => item.type === filter
  );
}

/* RENDER */

function renderEverything() {
  renderCalendar();
  renderSummary();
  renderUpcomingEvents();
}

/* CALENDAR GRID */

function renderCalendar() {
  const grid = document.getElementById(
    "calendarGrid"
  );

  document.getElementById(
    "calendarMonthTitle"
  ).textContent =
    `${monthNames[displayedMonth]} ${displayedYear}`;

  const firstDayOfMonth = new Date(
    displayedYear,
    displayedMonth,
    1
  );

  const lastDayOfMonth = new Date(
    displayedYear,
    displayedMonth + 1,
    0
  );

  let startWeekday =
    firstDayOfMonth.getDay();

  startWeekday =
    startWeekday === 0
      ? 6
      : startWeekday - 1;

  const previousMonthLastDay =
    new Date(
      displayedYear,
      displayedMonth,
      0
    ).getDate();

  const totalCurrentMonthDays =
    lastDayOfMonth.getDate();

  const cells = [];

  for (
    let index = startWeekday - 1;
    index >= 0;
    index -= 1
  ) {
    const day =
      previousMonthLastDay - index;

    const date = new Date(
      displayedYear,
      displayedMonth - 1,
      day
    );

    cells.push({
      date,
      outsideMonth: true
    });
  }

  for (
    let day = 1;
    day <= totalCurrentMonthDays;
    day += 1
  ) {
    cells.push({
      date: new Date(
        displayedYear,
        displayedMonth,
        day
      ),

      outsideMonth: false
    });
  }

  let nextMonthDay = 1;

  while (
    cells.length < 42
  ) {
    cells.push({
      date: new Date(
        displayedYear,
        displayedMonth + 1,
        nextMonthDay
      ),

      outsideMonth: true
    });

    nextMonthDay += 1;
  }

  const filteredItems =
    getFilteredCalendarItems();

  grid.innerHTML = cells
    .map((cell) => {
      return createCalendarDayMarkup(
        cell,
        filteredItems
      );
    })
    .join("");

  grid
    .querySelectorAll("[data-add-date]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();

          prepareCreateEventModal(
            button.dataset.addDate
          );
        }
      );
    });

  grid
    .querySelectorAll("[data-calendar-date]")
    .forEach((dayElement) => {
      dayElement.addEventListener(
        "click",
        () => {
          openDayDetails(
            dayElement.dataset.calendarDate
          );
        }
      );
    });

  grid
    .querySelectorAll("[data-event-id]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();

          const eventId =
            button.dataset.eventId;

          const source =
            button.dataset.eventSource;

          if (source === "task") {
            window.location.href =
              "tasks.html";
            return;
          }

          prepareEditEventModal(eventId);
        }
      );
    });

  grid
    .querySelectorAll("[data-more-date]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();

          openDayDetails(
            button.dataset.moreDate
          );
        }
      );
    });
}

function createCalendarDayMarkup(
  cell,
  items
) {
  const dateString = formatDateForInput(
    cell.date
  );

  const todayString =
    formatDateForInput(new Date());

  const dayItems = items
    .filter(
      (item) => item.date === dateString
    )
    .sort(sortCalendarItems);

  const visibleItems =
    dayItems.slice(0, 3);

  const hiddenItemsCount =
    dayItems.length - visibleItems.length;

  const classes = [
    "calendar-day",
    cell.outsideMonth
      ? "outside-month"
      : "",
    dateString === todayString
      ? "today"
      : "",
    dateString === selectedDate
      ? "selected"
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <article
      class="${classes}"
      data-calendar-date="${dateString}"
    >
      <div class="day-header">
        <span class="day-number">
          ${cell.date.getDate()}
        </span>

        <button
          type="button"
          class="day-add-button"
          data-add-date="${dateString}"
          aria-label="Adaugă eveniment"
        >
          ＋
        </button>
      </div>

      <div class="day-events">
        ${visibleItems
          .map(createCalendarEventMarkup)
          .join("")}

        ${
          hiddenItemsCount > 0
            ? `
              <button
                type="button"
                class="more-events-button"
                data-more-date="${dateString}"
              >
                +${hiddenItemsCount} în plus
              </button>
            `
            : ""
        }
      </div>
    </article>
  `;
}

function createCalendarEventMarkup(item) {
  const timeLabel =
    item.startTime ||
    (
      item.source === "task"
        ? "Deadline"
        : "Toată ziua"
    );

  const completedClass =
    item.source === "task" &&
    item.completed
      ? " completed"
      : "";

  return `
    <button
      type="button"
      class="calendar-event ${
        normalizeColor(item.color)
      }${completedClass}"
      data-event-id="${item.id}"
      data-event-source="${item.source}"
      title="${escapeHtml(item.title)}"
    >
      <span class="calendar-event-time">
        ${escapeHtml(timeLabel)}
      </span>

      <span class="calendar-event-title">
        ${escapeHtml(item.title)}
      </span>
    </button>
  `;
}

/* DAY DETAILS */

function openDayDetails(dateString) {
  selectedDate = dateString;

  const date = parseLocalDate(
    dateString
  );

  document.getElementById(
    "dayDetailsTitle"
  ).textContent =
    `${date.getDate()} ${
      monthNames[
        date.getMonth()
      ].toLowerCase()
    } ${date.getFullYear()}`;

  const items =
    getFilteredCalendarItems()
      .filter(
        (item) => item.date === dateString
      )
      .sort(sortCalendarItems);

  const list = document.getElementById(
    "dayDetailsList"
  );

  if (items.length === 0) {
    list.innerHTML = `
      <p class="empty-message">
        Nu ai nimic planificat în această zi.
      </p>
    `;
  } else {
    list.innerHTML = items
      .map(createDayDetailsMarkup)
      .join("");

    list
      .querySelectorAll(
        "[data-details-event]"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            const source =
              button.dataset.eventSource;

            if (source === "task") {
              window.location.href =
                "tasks.html";
              return;
            }

            prepareEditEventModal(
              button.dataset.detailsEvent
            );
          }
        );
      });
  }

  renderCalendar();
  openModal("dayDetailsModal");
}

function createDayDetailsMarkup(item) {
  const details = [
    item.startTime
      ? item.endTime
        ? `${item.startTime}–${item.endTime}`
        : item.startTime
      : "",

    item.subject,
    item.location,
    typeLabels[item.type]
  ]
    .filter(Boolean)
    .join(" · ");

  return `
    <article class="day-details-item">
      <div class="day-details-item-header">
        <div>
          <strong>
            ${escapeHtml(item.title)}
          </strong>

          <p>
            ${escapeHtml(details)}
          </p>

          ${
            item.notes
              ? `
                <p>
                  ${escapeHtml(item.notes)}
                </p>
              `
              : ""
          }
        </div>

        <button
          type="button"
          class="day-details-edit-button"
          data-details-event="${item.id}"
          data-event-source="${item.source}"
          aria-label="${
            item.source === "task"
              ? "Deschide task-ul"
              : "Editează evenimentul"
          }"
        >
          ${
            item.source === "task"
              ? "›"
              : "✎"
          }
        </button>
      </div>
    </article>
  `;
}

/* SUMMARY */

function renderSummary() {
  const allItems =
    getFilteredCalendarItems();

  const todayString =
    formatDateForInput(new Date());

  const currentMonthStart =
    formatDateForInput(
      new Date(
        displayedYear,
        displayedMonth,
        1
      )
    );

  const currentMonthEnd =
    formatDateForInput(
      new Date(
        displayedYear,
        displayedMonth + 1,
        0
      )
    );

  const monthItems = allItems.filter(
    (item) =>
      item.date >= currentMonthStart &&
      item.date <= currentMonthEnd
  );

  const weekRange =
    getCurrentWeekRange();

  const weekItems = allItems.filter(
    (item) =>
      item.date >= weekRange.start &&
      item.date <= weekRange.end
  );

  const upcomingTests =
    allItems.filter((item) => {
      if (
        item.type !== "test" ||
        item.date < todayString
      ) {
        return false;
      }

      const testDate =
        parseLocalDate(item.date);

      const difference =
        Math.floor(
          (
            testDate.getTime() -
            parseLocalDate(
              todayString
            ).getTime()
          ) /
          86400000
        );

      return difference <= 14;
    });

  const todayItems =
    allItems.filter(
      (item) => item.date === todayString
    );

  document.getElementById(
    "monthlyEventsCount"
  ).textContent =
    String(monthItems.length);

  document.getElementById(
    "weeklyEventsCount"
  ).textContent =
    String(weekItems.length);

  document.getElementById(
    "upcomingTestsCount"
  ).textContent =
    String(upcomingTests.length);

  document.getElementById(
    "todayEventsCount"
  ).textContent =
    String(todayItems.length);
}

/* UPCOMING */

function renderUpcomingEvents() {
  const container =
    document.getElementById(
      "upcomingEventsList"
    );

  const todayString =
    formatDateForInput(new Date());

  const upcomingItems =
    getFilteredCalendarItems()
      .filter(
        (item) =>
          item.date >= todayString
      )
      .sort(sortCalendarItems)
      .slice(0, 8);

  if (upcomingItems.length === 0) {
    container.innerHTML = `
      <p class="empty-message">
        Nu ai evenimente apropiate.
      </p>
    `;

    return;
  }

  container.innerHTML = upcomingItems
    .map((item) => {
      const date =
        parseLocalDate(item.date);

      const details = [
        item.startTime,
        item.subject,
        typeLabels[item.type]
      ]
        .filter(Boolean)
        .join(" · ");

      return `
        <article class="upcoming-item">
          <div class="upcoming-date">
            <strong>
              ${date.getDate()}
            </strong>

            <span>
              ${shortMonthNames[
                date.getMonth()
              ]}
            </span>
          </div>

          <div class="upcoming-content">
            <strong>
              ${escapeHtml(item.title)}
            </strong>

            <span>
              ${escapeHtml(details)}
            </span>
          </div>

          <button
            type="button"
            class="upcoming-edit-button"
            data-upcoming-id="${item.id}"
            data-event-source="${item.source}"
            aria-label="${
              item.source === "task"
                ? "Deschide task-ul"
                : "Editează evenimentul"
            }"
          >
            ›
          </button>
        </article>
      `;
    })
    .join("");

  container
    .querySelectorAll(
      "[data-upcoming-id]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          if (
            button.dataset.eventSource ===
            "task"
          ) {
            window.location.href =
              "tasks.html";
            return;
          }

          prepareEditEventModal(
            button.dataset.upcomingId
          );
        }
      );
    });
}

/* HELPERS */

function sortCalendarItems(
  firstItem,
  secondItem
) {
  if (
    firstItem.date !== secondItem.date
  ) {
    return firstItem.date.localeCompare(
      secondItem.date
    );
  }

  const firstTime =
    firstItem.startTime || "23:59";

  const secondTime =
    secondItem.startTime || "23:59";

  return firstTime.localeCompare(
    secondTime
  );
}

function getCurrentWeekRange() {
  const currentDate = new Date();

  const currentDay =
    currentDate.getDay();

  const mondayDifference =
    currentDay === 0
      ? -6
      : 1 - currentDay;

  const monday = new Date(
    currentDate
  );

  monday.setDate(
    currentDate.getDate() +
    mondayDifference
  );

  const sunday = new Date(
    monday
  );

  sunday.setDate(
    monday.getDate() + 6
  );

  return {
    start: formatDateForInput(monday),
    end: formatDateForInput(sunday)
  };
}

function formatDateForInput(date) {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateString) {
  const [year, month, day] =
    dateString
      .split("-")
      .map(Number);

  return new Date(
    year,
    month - 1,
    day
  );
}

function normalizeTime(timeValue) {
  if (!timeValue) {
    return "";
  }

  return String(timeValue).slice(0, 5);
}

function normalizeColor(color) {
  const allowedColors = [
    "pink",
    "lilac",
    "blue",
    "green",
    "peach",
    "yellow"
  ];

  return allowedColors.includes(color)
    ? color
    : "pink";
}

/* TOAST */

function showToast(message, icon = "✓") {
  const toast =
    document.getElementById("toast");

  document.getElementById(
    "toastMessage"
  ).textContent = message;

  document.getElementById(
    "toastIcon"
  ).textContent = icon;

  toast.classList.add("visible");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.classList.remove("visible");
  }, 2600);
}

/* SECURITY */

function escapeHtml(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
