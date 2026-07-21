"use strict";

/*
  ITERA — INITIAL FRONTEND PROTOTYPE

  Momentan, datele sunt salvate în localStorage.
  Mai târziu le vom înlocui cu date din Supabase.
*/

const STORAGE_KEYS = {
  events: "itera_events",
  tasks: "itera_tasks",
  energy: "itera_energy"
};

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

const weekdayNames = [
  "duminică",
  "luni",
  "marți",
  "miercuri",
  "joi",
  "vineri",
  "sâmbătă"
];

const pageIds = {
  home: "homePage",
  calendar: "calendarPage",
  tasks: "tasksPage",
  subjects: "subjectsPage",
  grades: "gradesPage",
  university: "universityPage"
};

const now = new Date();

let displayedMonth = now.getMonth();
let displayedYear = now.getFullYear();

let selectedDate = formatDateForInput(now);

let focusTimerInterval = null;
let focusSecondsRemaining = 45 * 60;
let focusInitialSeconds = 45 * 60;
let focusPaused = false;

const defaultEvents = [
  {
    id: createId(),
    title: "Matematică",
    type: "school",
    subject: "Matematică",
    date: formatDateForInput(now),
    time: "08:00",
    duration: 50,
    priority: "medium",
    notes: "Ora de matematică",
    completed: false
  },
  {
    id: createId(),
    title: "Limba română",
    type: "school",
    subject: "Limba română",
    date: formatDateForInput(now),
    time: "10:00",
    duration: 50,
    priority: "medium",
    notes: "Ora de limba română",
    completed: false
  },
  {
    id: createId(),
    title: "Exerciții la matematică",
    type: "homework",
    subject: "Matematică",
    date: formatDateForInput(now),
    time: "16:00",
    duration: 45,
    priority: "high",
    notes: "Exercițiile 4–12",
    completed: false
  },
  {
    id: createId(),
    title: "Eseu la română",
    type: "homework",
    subject: "Limba română",
    date: formatDateForInput(now),
    time: "17:00",
    duration: 60,
    priority: "high",
    notes: "Introducere și primul argument",
    completed: false
  },
  {
    id: createId(),
    title: "Recapitulare informatică",
    type: "homework",
    subject: "Informatică",
    date: formatDateForInput(now),
    time: "18:30",
    duration: 35,
    priority: "medium",
    notes: "Backtracking",
    completed: false
  },
  {
    id: createId(),
    title: "Test la biologie",
    type: "test",
    subject: "Biologie",
    date: addDaysToDate(now, 3),
    time: "09:00",
    duration: 50,
    priority: "high",
    notes: "Sistemul nervos",
    completed: false
  },
  {
    id: createId(),
    title: "Meditație la informatică",
    type: "tutoring",
    subject: "Informatică",
    date: addDaysToDate(now, 1),
    time: "17:00",
    duration: 120,
    priority: "medium",
    notes: "",
    completed: false
  }
];

let events = loadEvents();
let tasks = loadTasks();

initializeApp();

function initializeApp() {
  updateCurrentDate();
  initializeNavigation();
  initializeModals();
  initializeFocusControls();
  initializeEnergySlider();
  initializeEventForm();
  initializeCalendarControls();
  initializeQuickActions();
  window.addEventListener("focus", () => {
  refreshStoredData();
  renderAll();
});

document.addEventListener(
  "visibilitychange",
  () => {
    if (!document.hidden) {
      refreshStoredData();
      renderAll();
    }
  }
);

  renderAll();
}

function loadEvents() {
  try {
    const storedEvents = localStorage.getItem(STORAGE_KEYS.events);

    if (!storedEvents) {
      localStorage.setItem(
        STORAGE_KEYS.events,
        JSON.stringify(defaultEvents)
      );

      return defaultEvents;
    }

    const parsedEvents = JSON.parse(storedEvents);

    if (!Array.isArray(parsedEvents)) {
      throw new Error("Format invalid pentru evenimente.");
    }

    return parsedEvents;
  } catch (error) {
    console.error("Evenimentele nu au putut fi încărcate:", error);

    return defaultEvents;
  }
}

function saveEvents() {
  localStorage.setItem(
    STORAGE_KEYS.events,
    JSON.stringify(events)
  );
}
function loadTasks() {
  try {
    const storedTasks = localStorage.getItem(
      STORAGE_KEYS.tasks
    );

    if (!storedTasks) {
      return [];
    }

    const parsedTasks = JSON.parse(storedTasks);

    return Array.isArray(parsedTasks)
      ? parsedTasks
      : [];
  } catch (error) {
    console.error(
      "Task-urile nu au putut fi încărcate:",
      error
    );

    return [];
  }
}

function saveTasks() {
  localStorage.setItem(
    STORAGE_KEYS.tasks,
    JSON.stringify(tasks)
  );
}

function convertTaskToCalendarItem(task) {
  return {
    id: task.id,
    source: "task",

    title: task.title,
    type: task.type || "homework",
    subject: task.subject || "",

    date: task.deadline,
    time: task.deadlineTime || "",

    duration: Number(
      task.estimatedMinutes || 0
    ),

    priority: task.priority || "medium",
    notes: task.notes || "",

    completed:
      Boolean(task.completed) ||
      Number(task.progress) === 100,

    progress: Number(task.progress || 0)
  };
}

function getAllCalendarItems() {
  const calendarEvents = events.map((event) => ({
    ...event,
    source: "event"
  }));

  const calendarTasks = tasks
    .filter((task) => task.deadline)
    .map(convertTaskToCalendarItem);

  return [
    ...calendarEvents,
    ...calendarTasks
  ];
}

function refreshStoredData() {
  events = loadEvents();
  tasks = loadTasks();
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDaysToDate(date, days) {
  const newDate = new Date(date);

  newDate.setDate(newDate.getDate() + days);

  return formatDateForInput(newDate);
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString
    .split("-")
    .map(Number);

  return new Date(year, month - 1, day);
}

function updateCurrentDate() {
  const currentDateLabel = document.getElementById(
    "currentDateLabel"
  );

  const greetingTitle = document.getElementById(
    "greetingTitle"
  );

  const todayNumber = document.getElementById(
    "todayNumber"
  );
  let profileName = "Daria";

try {
  const savedProfile = JSON.parse(
    localStorage.getItem("itera_profile")
  );

  if (savedProfile?.firstName) {
    profileName = savedProfile.firstName;
  }
} catch (error) {
  console.error("Profilul nu a putut fi citit:", error);
}

  const hour = now.getHours();

  let greeting = "Bună dimineața";

  if (hour >= 12 && hour < 18) {
    greeting = "Bună ziua";
  }

  if (hour >= 18) {
    greeting = "Bună seara";
  }

  currentDateLabel.textContent =
    `${capitalizeFirstLetter(weekdayNames[now.getDay()])}, ` +
    `${now.getDate()} ${monthNames[now.getMonth()].toLowerCase()}`;

  greetingTitle.textContent = `${greeting}, ${profileName} 🌷`;
  todayNumber.textContent = String(now.getDate());
}

function capitalizeFirstLetter(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/* NAVIGATION */

function initializeNavigation() {
  const navigationButtons = document.querySelectorAll(
    "[data-page]"
  );

  navigationButtons.forEach((button) => {
    button.addEventListener("click", () => {
      openPage(button.dataset.page);
    });
  });

  document.querySelectorAll("[data-open-page]").forEach((button) => {
    button.addEventListener("click", () => {
      openPage(button.dataset.openPage);
    });
  });
}

function openPage(pageName) {
  const targetPageId = pageIds[pageName];

  if (!targetPageId) {
    return;
  }

  document.querySelectorAll(".page-section").forEach((page) => {
    page.classList.remove("active-page");
  });

  const targetPage = document.getElementById(targetPageId);

  targetPage.classList.add("active-page");

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageName
    );
  });

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  if (pageName === "calendar") {
    renderCalendar();
    renderSelectedDateEvents();
  }

  if (pageName === "tasks") {
    renderAllTasks();
  }
}

/* MODALS */

function initializeModals() {
  document
    .getElementById("openQuickAddButton")
    .addEventListener("click", () => openModal("quickAddModal"));

  document
    .getElementById("mobileQuickAddButton")
    .addEventListener("click", () => openModal("quickAddModal"));

  document
    .querySelectorAll("[data-close-modal]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        closeModal(button.dataset.closeModal);
      });
    });

  document
    .querySelectorAll(".modal-overlay")
    .forEach((overlay) => {
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          closeModal(overlay.id);
        }
      });
    });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    document
      .querySelectorAll(".modal-overlay.visible")
      .forEach((modal) => closeModal(modal.id));
  });
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);

  if (!modal) {
    return;
  }

  modal.classList.add("visible");
  modal.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);

  if (!modal) {
    return;
  }

  modal.classList.remove("visible");
  modal.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";
}

/* QUICK ACTIONS */

function initializeQuickActions() {
  const eventButtons = [
    "addCalendarEventButton",
    "addSelectedDateEvent"
  ];

  eventButtons.forEach((buttonId) => {
    document
      .getElementById(buttonId)
      .addEventListener("click", () => {
        prepareEventModal(selectedDate);
      });
  });

  const taskButtons = [
  "addTaskButton",
  "addTaskPageButton"
];

taskButtons.forEach((buttonId) => {
  const button =
    document.getElementById(buttonId);

  if (!button) {
    return;
  }

  button.addEventListener("click", () => {
    window.location.href = "tasks.html";
  });
});

  document
    .querySelectorAll("[data-quick-action]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.quickAction;

        closeModal("quickAddModal");

        if (action === "study") {
          startFocusSession();
          return;
        }
        if (
  action === "task" ||
  action === "test"
) {
  window.location.href = "tasks.html";
  return;
}

        const typeMap = {
          task: "homework",
          event: "personal",
          test: "test"
        };

        prepareEventModal(
          formatDateForInput(new Date()),
          typeMap[action]
        );
      });
    });
}

function prepareEventModal(
  date = formatDateForInput(new Date()),
  type = "school"
) {
  const form = document.getElementById("eventForm");

  form.reset();

  document.getElementById("eventDate").value = date;
  document.getElementById("eventType").value = type;
  document.getElementById("eventDuration").value = "45";
  document.getElementById("eventPriority").value = "medium";

  openModal("eventModal");

  setTimeout(() => {
    document.getElementById("eventTitle").focus();
  }, 220);
}

/* EVENT FORM */

function initializeEventForm() {
  document
    .getElementById("eventForm")
    .addEventListener("submit", handleEventSubmit);
}

function handleEventSubmit(event) {
  event.preventDefault();

  const title = document
    .getElementById("eventTitle")
    .value
    .trim();

  const date = document.getElementById("eventDate").value;

  if (!title || !date) {
    showToast(
      "Completează titlul și data.",
      "!"
    );

    return;
  }

  const newEvent = {
    id: createId(),
    title,
    type: document.getElementById("eventType").value,
    subject: document.getElementById("eventSubject").value,
    date,
    time: document.getElementById("eventTime").value,
    duration: Number(
      document.getElementById("eventDuration").value
    ),
    priority: document.getElementById("eventPriority").value,
    notes: document
      .getElementById("eventNotes")
      .value
      .trim(),
    completed: false
  };

  events.push(newEvent);

  events.sort(sortEvents);

  saveEvents();
  renderAll();

  selectedDate = newEvent.date;

  closeModal("eventModal");

  showToast("Evenimentul a fost adăugat.", "✓");
}

function sortEvents(firstEvent, secondEvent) {
  const firstDateTime =
    `${firstEvent.date} ${firstEvent.time || "23:59"}`;

  const secondDateTime =
    `${secondEvent.date} ${secondEvent.time || "23:59"}`;

  return firstDateTime.localeCompare(secondDateTime);
}

/* FOCUS TIMER */

function initializeFocusControls() {
  const focusSubject = document.getElementById(
    "focusSubject"
  );

  const focusDuration = document.getElementById(
    "focusDuration"
  );

  focusSubject.addEventListener(
    "change",
    updateFocusButtonSubtitle
  );

  focusDuration.addEventListener(
    "change",
    updateFocusButtonSubtitle
  );

  document
    .getElementById("startFocusButton")
    .addEventListener("click", startFocusSession);

  document
    .getElementById("pauseFocusButton")
    .addEventListener("click", toggleFocusPause);

  document
    .getElementById("resetFocusButton")
    .addEventListener("click", resetFocusSession);

  document
    .getElementById("closeFocusModal")
    .addEventListener("click", () => {
      closeModal("focusModal");
    });

  updateFocusButtonSubtitle();
}

function updateFocusButtonSubtitle() {
  const subject = document.getElementById(
    "focusSubject"
  ).value;

  const duration = document.getElementById(
    "focusDuration"
  ).value;

  document.getElementById(
    "focusButtonSubtitle"
  ).textContent = `${subject} · ${duration} minute`;
}

function startFocusSession() {
  const subject = document.getElementById(
    "focusSubject"
  ).value;

  const duration = Number(
    document.getElementById("focusDuration").value
  );

  clearInterval(focusTimerInterval);

  focusInitialSeconds = duration * 60;
  focusSecondsRemaining = focusInitialSeconds;
  focusPaused = false;

  document.getElementById(
    "focusModalSubject"
  ).textContent = subject;

  document.getElementById(
    "pauseFocusButton"
  ).textContent = "Pauză";

  document.getElementById(
    "focusMessage"
  ).textContent =
    "Ai nevoie doar de următorul pas.";

  updateFocusTimerDisplay();

  openModal("focusModal");

  focusTimerInterval = setInterval(() => {
    if (focusPaused) {
      return;
    }

    focusSecondsRemaining -= 1;

    updateFocusTimerDisplay();

    if (focusSecondsRemaining <= 0) {
      finishFocusSession();
    }
  }, 1000);
}

function toggleFocusPause() {
  focusPaused = !focusPaused;

  document.getElementById(
    "pauseFocusButton"
  ).textContent = focusPaused
    ? "Continuă"
    : "Pauză";

  document.getElementById(
    "focusMessage"
  ).textContent = focusPaused
    ? "Ia o gură de apă și revino când ești gata."
    : "Ai nevoie doar de următorul pas.";
}

function resetFocusSession() {
  focusSecondsRemaining = focusInitialSeconds;
  focusPaused = true;

  document.getElementById(
    "pauseFocusButton"
  ).textContent = "Continuă";

  document.getElementById(
    "focusMessage"
  ).textContent =
    "Sesiunea a fost resetată.";

  updateFocusTimerDisplay();
}

function updateFocusTimerDisplay() {
  const minutes = Math.floor(focusSecondsRemaining / 60);
  const seconds = focusSecondsRemaining % 60;

  document.getElementById(
    "focusTimer"
  ).textContent =
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`;
}

function finishFocusSession() {
  clearInterval(focusTimerInterval);

  focusSecondsRemaining = 0;

  updateFocusTimerDisplay();

  document.getElementById(
    "focusMessage"
  ).textContent =
    "Minunat! Ai terminat sesiunea de focus. 🌷";

  document.getElementById(
    "pauseFocusButton"
  ).textContent = "Finalizat";

  showToast(
    "Sesiunea de focus a fost finalizată.",
    "✿"
  );
}

/* ENERGY */

function initializeEnergySlider() {
  const energySlider = document.getElementById(
    "energySlider"
  );

  const savedEnergy =
    localStorage.getItem(STORAGE_KEYS.energy);

  if (savedEnergy) {
    energySlider.value = savedEnergy;
  }

  updateEnergyDisplay(energySlider.value);

  energySlider.addEventListener("input", () => {
    updateEnergyDisplay(energySlider.value);

    localStorage.setItem(
      STORAGE_KEYS.energy,
      energySlider.value
    );
  });
}

function updateEnergyDisplay(value) {
  document.getElementById(
    "energyValue"
  ).textContent = `${value}/10`;
}

/* RENDER */

function renderAll() {
  renderHomeSummary();
  renderTodayTimeline();
  renderTodayTasks();
  renderUpcomingEvents();
  renderCalendar();
  renderSelectedDateEvents();
  renderAllTasks();
}

function getTodayEvents() {
  const todayString = formatDateForInput(
    new Date()
  );

  return getAllCalendarItems()
    .filter(
      (item) => item.date === todayString
    )
    .sort(sortEvents);
}

function renderHomeSummary() {
  const todayEvents = getTodayEvents();

  const schoolEvents = todayEvents.filter(
    (event) => event.type === "school"
  );

  const taskEvents = todayEvents.filter(
    (event) =>
      event.type === "homework" ||
      event.type === "test" ||
      event.type === "project"
  );

  const remainingTasks = taskEvents.filter(
    (event) => !event.completed
  );

  const totalMinutes = remainingTasks.reduce(
    (sum, event) => sum + Number(event.duration || 0),
    0
  );

  document.getElementById(
    "schoolClassesCount"
  ).textContent =
    `${schoolEvents.length} ${
      schoolEvents.length === 1 ? "materie" : "materii"
    }`;

  document.getElementById(
    "remainingTasksCount"
  ).textContent =
    `${remainingTasks.length} ${
      remainingTasks.length === 1
        ? "task"
        : "task-uri"
    }`;

  document.getElementById(
    "estimatedWorkTime"
  ).textContent = formatMinutes(totalMinutes);
}

function formatMinutes(totalMinutes) {
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes
    ? `${hours}h ${minutes}m`
    : `${hours}h`;
}

function renderTodayTimeline() {
  const timeline = document.getElementById(
    "todayTimeline"
  );

  const todayEvents = getTodayEvents()
    .filter((event) => event.time)
    .slice(0, 5);

  if (todayEvents.length === 0) {
    timeline.innerHTML = `
      <p class="empty-message">
        Nu ai nimic programat astăzi.
      </p>
    `;

    return;
  }

  timeline.innerHTML = todayEvents
    .map((event) => {
      return `
        <div class="timeline-item">
          <span class="timeline-time">
            ${escapeHtml(event.time)}
          </span>

          <div class="timeline-line">
            <span class="timeline-dot"></span>
          </div>

          <div class="timeline-content">
            <strong>${escapeHtml(event.title)}</strong>

            <span>
              ${
                escapeHtml(event.subject) ||
                getTypeLabel(event.type)
              }
              · ${formatMinutes(event.duration)}
            </span>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderTodayTasks() {
  const taskList = document.getElementById(
    "todayTaskList"
  );

  const taskEvents = getTodayEvents().filter(
    (event) =>
      event.type === "homework" ||
      event.type === "test" ||
      event.type === "project"
  );

  renderTaskCollection(
    taskList,
    taskEvents,
    "Nu ai task-uri pentru astăzi."
  );
}

function renderAllTasks() {
  const taskList = document.getElementById(
    "allTasksList"
  );

  const taskItems = getAllCalendarItems()
    .filter(
      (item) =>
        item.source === "task" ||
        item.type === "homework" ||
        item.type === "test" ||
        item.type === "project"
    )
    .sort(sortEvents);

  renderTaskCollection(
    taskList,
    taskItems,
    "Nu ai adăugat încă niciun task."
  );
}

function renderTaskCollection(
  container,
  taskEvents,
  emptyText
) {
  if (taskEvents.length === 0) {
    container.innerHTML = `
      <p class="empty-message">
        ${escapeHtml(emptyText)}
      </p>
    `;

    return;
  }

  container.innerHTML = taskEvents
    .map((event) => {
      const completedClass = event.completed
        ? "is-completed"
        : "";

      const checkboxClass = event.completed
        ? "completed"
        : "";

      return `
        <div class="task-item ${completedClass}">
          <button
            class="task-checkbox ${checkboxClass}"
            data-complete-event="${event.id}"
data-item-source="${event.source || "event"}"
            aria-label="Marchează task-ul"
          >
            ${event.completed ? "✓" : ""}
          </button>

          <div class="task-content">
            <strong>${escapeHtml(event.title)}</strong>

            <span>
              ${
                escapeHtml(event.subject) ||
                getTypeLabel(event.type)
              }
              · ${formatReadableDate(event.date)}
            </span>
          </div>

          <span class="task-time">
            ${formatMinutes(event.duration)}
          </span>
        </div>
      `;
    })
    .join("");

  container
    .querySelectorAll("[data-complete-event]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        toggleItemCompletion(
  button.dataset.completeEvent,
  button.dataset.itemSource
);
      });
    });
}

function toggleItemCompletion(
  itemId,
  itemSource
) {
  if (itemSource === "task") {
    tasks = tasks.map((task) => {
      if (task.id !== itemId) {
        return task;
      }

      const newCompletedState =
        !task.completed;

      return {
        ...task,

        completed: newCompletedState,

        progress: newCompletedState
          ? 100
          : 0,

        updatedAt: new Date().toISOString()
      };
    });

    saveTasks();
  } else {
    events = events.map((event) => {
      if (event.id !== itemId) {
        return event;
      }

      return {
        ...event,
        completed: !event.completed
      };
    });

    saveEvents();
  }

  renderAll();

  showToast(
    "Task-ul a fost actualizat.",
    "✓"
  );
}

function renderUpcomingEvents() {
  const upcomingList = document.getElementById(
    "upcomingList"
  );

  const todayString = formatDateForInput(new Date());

  const upcomingEvents = getAllCalendarItems()
  .filter(
    (event) =>
      event.date >= todayString &&
      event.type !== "school" &&
      !event.completed
  )
  .sort(sortEvents)
  .slice(0, 4);

  if (upcomingEvents.length === 0) {
    upcomingList.innerHTML = `
      <p class="empty-message">
        Nu ai deadline-uri apropiate.
      </p>
    `;

    return;
  }

  upcomingList.innerHTML = upcomingEvents
    .map((event) => {
      const date = parseLocalDate(event.date);

      return `
        <div class="upcoming-item">
          <div class="upcoming-date">
            ${date.getDate()}
          </div>

          <div class="upcoming-content">
            <strong>${escapeHtml(event.title)}</strong>

            <span>
              ${shortMonthNames[date.getMonth()]}
              ${event.time ? `· ${escapeHtml(event.time)}` : ""}
            </span>
          </div>

          <span class="event-tag ${event.type}">
            ${getTypeLabel(event.type)}
          </span>
        </div>
      `;
    })
    .join("");
}

function getTypeLabel(type) {
  const labels = {
    school: "Școală",
    homework: "Homework",
    test: "Test",
    project: "Proiect",
    tutoring: "Meditație",
    personal: "Personal",
    university: "Admitere"
  };

  return labels[type] || "Eveniment";
}

/* CALENDAR */

function initializeCalendarControls() {
  document
    .getElementById("previousMonthButton")
    .addEventListener("click", () => {
      displayedMonth -= 1;

      if (displayedMonth < 0) {
        displayedMonth = 11;
        displayedYear -= 1;
      }

      renderCalendar();
    });

  document
    .getElementById("nextMonthButton")
    .addEventListener("click", () => {
      displayedMonth += 1;

      if (displayedMonth > 11) {
        displayedMonth = 0;
        displayedYear += 1;
      }

      renderCalendar();
    });
}

function renderCalendar() {
  const calendarGrid = document.getElementById(
    "calendarGrid"
  );

  const calendarMonthTitle = document.getElementById(
    "calendarMonthTitle"
  );

  calendarMonthTitle.textContent =
    `${monthNames[displayedMonth]} ${displayedYear}`;

  const firstDay = new Date(
    displayedYear,
    displayedMonth,
    1
  );

  const lastDay = new Date(
    displayedYear,
    displayedMonth + 1,
    0
  );

  const totalDays = lastDay.getDate();

  let startingWeekday = firstDay.getDay();

  startingWeekday =
    startingWeekday === 0
      ? 6
      : startingWeekday - 1;

  const cells = [];

  for (let index = 0; index < startingWeekday; index += 1) {
    cells.push(`
      <div class="calendar-day empty"></div>
    `);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const dateString = formatDateForInput(
      new Date(displayedYear, displayedMonth, day)
    );

    const dateEvents =
  getAllCalendarItems().filter(
    (item) => item.date === dateString
  );

    const isToday =
      dateString === formatDateForInput(new Date());

    const isSelected = dateString === selectedDate;

    const dotMarkup = dateEvents
      .slice(0, 5)
      .map(
        (event) =>
          `<span class="event-dot ${event.type}"></span>`
      )
      .join("");

    cells.push(`
      <button
        class="calendar-day
          ${isToday ? "today" : ""}
          ${isSelected ? "selected" : ""}"
        data-calendar-date="${dateString}"
      >
        <span class="calendar-number">
          ${day}
        </span>

        <span class="calendar-event-dots">
          ${dotMarkup}
        </span>
      </button>
    `);
  }

  calendarGrid.innerHTML = cells.join("");

  calendarGrid
    .querySelectorAll("[data-calendar-date]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        selectedDate = button.dataset.calendarDate;

        renderCalendar();
        renderSelectedDateEvents();
      });
    });
}

function renderSelectedDateEvents() {
  const title = document.getElementById(
    "selectedDateTitle"
  );

  const container = document.getElementById(
    "selectedDateEvents"
  );

  const selectedDateObject = parseLocalDate(selectedDate);

  title.textContent =
    `${selectedDateObject.getDate()} ` +
    `${monthNames[
      selectedDateObject.getMonth()
    ].toLowerCase()}`;

  const dateEvents = getAllCalendarItems()
  .filter(
    (item) => item.date === selectedDate
  )
  .sort(sortEvents);

  if (dateEvents.length === 0) {
    container.innerHTML = `
      <p class="empty-message">
        Ziua aceasta este liberă. Poți adăuga un eveniment, un test sau o sesiune de studiu.
      </p>
    `;

    return;
  }

  container.innerHTML = dateEvents
    .map((event) => {
      return `
        <div class="selected-event">
          <strong>${escapeHtml(event.title)}</strong>

          <span>
            ${event.time ? `${escapeHtml(event.time)} · ` : ""}
            ${
              escapeHtml(event.subject) ||
              getTypeLabel(event.type)
            }
            · ${formatMinutes(event.duration)}
          </span>
        </div>
      `;
    })
    .join("");
}

function formatReadableDate(dateString) {
  const date = parseLocalDate(dateString);

  return `${date.getDate()} ${
    shortMonthNames[date.getMonth()]
  }`;
}

/* TOAST */

let toastTimeout = null;

function showToast(message, icon = "✓") {
  const toast = document.getElementById("toast");

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
  }, 2800);
}

/* SECURITY */

function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
