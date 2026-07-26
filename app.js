"use strict";

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

const now = new Date();

let selectedDate = formatDateForInput(now);

let focusTimerInterval = null;
let focusSecondsRemaining = 45 * 60;
let focusInitialSeconds = 45 * 60;
let focusPaused = false;
let focusStartedAt = null;
let focusSubjectId = null;
let focusTaskId = null;
let focusTaskTitle = null;
let focusSessionSaved = false;
let currentEnergy = 3;
let recommendedTask = null;

let currentUser = null;
let profile = null;
let subjects = [];
let events = [];
let tasks = [];
let scheduleItems = [];

initializeApp();

async function initializeApp() {
  await loadHomeData();
  initializeShellViews();
  updateCurrentDate();
  initializeNavigation();
  initializeModals();
  initializeFocusControls();
  initializeEnergyCheckin();
  initializeNotificationCenter();
  initializeFloatingTimer();
  IteraPush.initialize();
  initializeEventForm();
  initializeQuickActions();
  window.addEventListener("focus", async () => {
  await loadHomeData();
  renderAll();
});

document.addEventListener(
  "visibilitychange",
  async () => {
    if (!document.hidden) {
      await loadHomeData();
      renderAll();
    }
  }
);

  renderAll();
}

function initializeShellViews() {
  IteraShell.registerView("home", {
    elementId: "homePage",
    route: "/"
  });

  IteraShell.registerView("calendar", {
    elementId: "calendarPage",
    route: "/calendar",
    onEnter() {
      IteraCalendarView.mount();
    },
    onLeave() {
      IteraCalendarView.unmount();
    }
  });

  IteraShell.registerView("schedule", {
    elementId: "schedulePage",
    route: "/schedule",
    onEnter() {
      IteraScheduleView.mount();
    },
    onLeave() {
      IteraScheduleView.unmount();
    }
  });

  IteraShell.registerView("tasks", {
    elementId: "tasksPage",
    route: "/tasks",
    onEnter() {
      IteraTasksView.mount();
    },
    onLeave() {
      IteraTasksView.unmount();
    }
  });

  IteraShell.registerView("subjects", {
    elementId: "subjectsPage",
    route: "/subjects",
    onEnter() {
      IteraSubjectsView.mountList();
    },
    onLeave() {
      IteraSubjectsView.unmount();
    }
  });

  IteraShell.registerView("subject-detail", {
    elementId: "subjectDetailPage",
    route: "/subjects/:id",
    navigationName: "subjects",
    onEnter(context) {
      IteraSubjectsView.mountDetail(context.params.id);
    },
    onLeave() {
      IteraSubjectsView.unmount();
    }
  });

  IteraShell.registerView("grades", {
    elementId: "gradesPage",
    route: "/grades",
    onEnter() {
      IteraProgressView.mountGrades();
    },
    onLeave() {
      IteraProgressView.unmount();
    }
  });

  IteraShell.registerView("university", {
    elementId: "universityPage",
    route: "/admission",
    onEnter() {
      IteraProgressView.mountAdmission();
    },
    onLeave() {
      IteraProgressView.unmount();
    }
  });

  IteraShell.start({
    notFoundView: "home"
  });
}

async function loadHomeData() {
  const {
    data: { session },
    error: sessionError
  } = await supabaseClient.auth.getSession();

  if (sessionError || !session) {
    return;
  }

  currentUser = session.user;

  const [profileResult, subjectsResult, eventsResult, tasksResult, scheduleResult] =
    await Promise.all([
      supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .maybeSingle(),
      supabaseClient
        .from("subjects")
        .select("*")
        .eq("user_id", currentUser.id)
        .eq("is_active", true)
        .order("position"),
      supabaseClient
        .from("calendar_events")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("event_date"),
      supabaseClient
        .from("tasks")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false }),
      supabaseClient
        .from("schedule_items")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("day_of_week")
        .order("start_time")
    ]);

  profile = profileResult.data || null;
  subjects = subjectsResult.data || [];
  events = (eventsResult.data || []).map(normalizeHomeEvent);
  tasks = (tasksResult.data || []).map(normalizeHomeTask);
  scheduleItems = scheduleResult.data || [];
  populateHomeSubjects();
}

function populateHomeSubjects() {
  const focusSelect = document.getElementById("focusSubject");
  const eventSelect = document.getElementById("eventSubject");

  if (focusSelect && subjects.length) {
    const previousValue = focusSelect.value;
    focusSelect.innerHTML = subjects
      .map((subject) => `<option value="${escapeHtml(subject.name)}">${escapeHtml(subject.name)}</option>`)
      .join("");
    focusSelect.value = subjects.some((subject) => subject.name === previousValue)
      ? previousValue
      : subjects[0].name;
  }

  if (eventSelect) {
    const previousValue = eventSelect.value;
    eventSelect.innerHTML = `<option value="">Fără materie</option>${subjects
      .map((subject) => `<option value="${escapeHtml(subject.name)}">${escapeHtml(subject.name)}</option>`)
      .join("")}`;
    eventSelect.value = previousValue;
  }
}

function subjectName(subjectId) {
  return subjects.find((subject) => subject.id === subjectId)?.name || "";
}

function normalizeHomeEvent(event) {
  return {
    id: event.id,
    title: event.title,
    type: event.event_type,
    subject: subjectName(event.subject_id),
    subjectId: event.subject_id,
    date: event.event_date,
    time: String(event.start_time || "").slice(0, 5),
    duration: 0,
    priority: "medium",
    notes: event.notes || "",
    completed: false
  };
}

function normalizeHomeTask(task) {
  return {
    ...task,
    type: task.task_type,
    subject: subjectName(task.subject_id),
    deadline: task.deadline_date,
    deadlineTime: String(task.deadline_time || "").slice(0, 5),
    estimatedMinutes: task.estimated_minutes
  };
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

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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
  const profileName =
    profile?.first_name ||
    currentUser?.user_metadata?.first_name ||
    "Itera";

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

  const sidebarName = document.querySelector(".mini-profile-text strong");
  const sidebarGrade = document.querySelector(".mini-profile-text span");
  const sidebarAvatar = document.querySelector(".mini-profile .avatar");

  if (sidebarName) sidebarName.textContent = profileName;
  if (sidebarGrade) {
    sidebarGrade.textContent = profile?.grade
      ? `Clasa a ${profile.grade}-a`
      : "Profilul meu";
  }
  if (sidebarAvatar) {
    sidebarAvatar.textContent = profileName.charAt(0).toUpperCase();
  }
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

  document
    .getElementById("mobileMoreButton")
    .addEventListener("click", () => openModal("mobileMoreModal"));

  document
    .querySelectorAll("[data-mobile-route]")
    .forEach((link) => {
      link.addEventListener("click", () => {
        closeModal("mobileMoreModal");
      });
    });
}

function openPage(pageName) {
  if (!IteraShell.navigate(pageName, {
    updateUrl: true
  })) {
    return;
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
    const button = document.getElementById(buttonId);

    if (button) {
      button.addEventListener("click", () => {
        prepareEventModal(selectedDate);
      });
    }
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
    IteraShell.navigate("tasks", { updateUrl: true });
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
  action === "test" ||
  action === "homework"
) {
  IteraShell.navigate("tasks", { updateUrl: true });
  return;
}

        if (action === "grade") {
          IteraShell.navigate("grades", { updateUrl: true });
          return;
        }

        if (action === "material") {
          IteraShell.navigate("subjects", { updateUrl: true });
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

async function handleEventSubmit(event) {
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

  const subjectNameValue =
    document.getElementById("eventSubject").value;
  const subject = subjects.find(
    (item) => item.name === subjectNameValue
  );
  const eventPayload = {
    user_id: currentUser.id,
    title,
    event_type: document.getElementById("eventType").value,
    subject_id: subject?.id || null,
    event_date: date,
    start_time: document.getElementById("eventTime").value || null,
    notes: document
      .getElementById("eventNotes")
      .value
      .trim() || null
  };

  const { data, error } = await supabaseClient
    .from("calendar_events")
    .insert(eventPayload)
    .select()
    .single();

  if (error) {
    showToast("Evenimentul nu a putut fi salvat.", "!");
    return;
  }

  const newEvent = normalizeHomeEvent(data);
  events.push(newEvent);
  events.sort(sortEvents);
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
    .getElementById("startRecommendedSession")
    .addEventListener("click", startRecommendedFocusSession);

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
  focusStartedAt = new Date();
  focusSubjectId = subjects.find((item) => item.name === subject)?.id || null;
  const matchingTask = recommendedTask?.subject === subject ? recommendedTask : null;
  focusTaskId = matchingTask?.id || null;
  focusTaskTitle = matchingTask?.title || null;
  focusSessionSaved = false;

  updateFocusTimerDisplay();
  showFloatingTimer(subject, matchingTask?.title || "Studiu individual");

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

function startRecommendedFocusSession() {
  if (recommendedTask?.subject) {
    const focusSubject = document.getElementById("focusSubject");
    const subjectExists = [...focusSubject.options].some(
      (option) => option.value === recommendedTask.subject
    );
    if (subjectExists) focusSubject.value = recommendedTask.subject;
  }

  document.getElementById("focusDuration").value = String(getRecommendedSessionMinutes());
  updateFocusButtonSubtitle();
  startFocusSession();
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

  document.getElementById("floatingPauseButton").textContent = focusPaused
    ? "Continuă"
    : "Pauză";
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

  document.getElementById("floatingTimerValue").textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const progress = focusInitialSeconds
    ? ((focusInitialSeconds - focusSecondsRemaining) / focusInitialSeconds) * 100
    : 0;
  document.getElementById("floatingTimerProgress").style.width =
    `${Math.max(0, progress)}%`;
}

async function saveCurrentFocusSession() {
  if (focusSessionSaved) return Math.max(1, Math.round(
    (focusInitialSeconds - focusSecondsRemaining) / 60
  ));

  clearInterval(focusTimerInterval);
  const studiedSeconds = Math.max(0, focusInitialSeconds - focusSecondsRemaining);
  const studiedMinutes = Math.max(1, Math.round(studiedSeconds / 60));

  if (currentUser && focusSubjectId && studiedSeconds >= 30) {
    const { error } = await supabaseClient.from("subject_study_sessions").insert({
      user_id: currentUser.id,
      subject_id: focusSubjectId,
      started_at: focusStartedAt?.toISOString() || new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_minutes: studiedMinutes,
      source: "focus-timer",
      notes: focusTaskTitle,
      study_date: formatDateForInput(new Date())
    });

    if (error) {
      showToast("Timpul nu a putut fi salvat în Supabase.", "!");
      return 0;
    }
  }
  focusSessionSaved = true;
  return studiedMinutes;
}

async function finishFocusSession() {
  clearInterval(focusTimerInterval);
  focusPaused = true;

  if (focusTaskId) {
    document.getElementById("taskCompletionTitle").textContent =
      `„${focusTaskTitle}” — spune-ne dacă ai terminat.`;
    document.getElementById("taskResumeOptions").hidden = true;
    openModal("taskCompletionModal");
    return;
  }

  const studiedMinutes = await saveCurrentFocusSession();
  if (!studiedMinutes) return;

  const floatingTimer = document.getElementById("floatingTimer");
  floatingTimer.classList.remove("visible");
  floatingTimer.setAttribute("aria-hidden", "true");

  showToast(
    `Sesiunea de ${studiedMinutes} min a fost salvată.`,
    "✿"
  );
}

function initializeEnergyCheckin() {
  document.querySelectorAll("[data-energy]").forEach((button) => {
    button.addEventListener("click", () => {
      currentEnergy = Number(button.dataset.energy);
      document.querySelectorAll("[data-energy]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      renderNowRecommendation();
    });
  });
}

function getRecommendedSessionMinutes() {
  if (currentEnergy <= 2) return 25;
  if (currentEnergy === 3) return 45;
  return 60;
}

function renderNowRecommendation() {
  const today = parseLocalDate(formatDateForInput(new Date()));
  const openTasks = tasks
    .filter((task) => !task.completed)
    .map((task) => {
      const deadline = task.deadline ? parseLocalDate(task.deadline) : null;
      const daysUntil = deadline ? Math.round((deadline - today) / 86400000) : 30;
      const priorityScore = { high: 40, medium: 20, low: 5 }[task.priority] || 10;
      const difficultyScore = { hard: 12, medium: 7, easy: 2 }[task.difficulty] || 5;
      return {
        ...task,
        daysUntil,
        recommendationScore: priorityScore + difficultyScore + Math.max(0, 35 - daysUntil * 7)
      };
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore);

  recommendedTask = openTasks[0] || null;
  const title = document.getElementById("nowRecommendationTitle");
  const reason = document.getElementById("nowRecommendationReason");
  const energyMessage = document.getElementById("energyRecommendation");
  const minutes = getRecommendedSessionMinutes();

  const energyLabels = {
    1: "Astăzi păstrăm planul foarte ușor.",
    2: "Îți recomandăm sesiuni scurte și o pauză generoasă.",
    3: "Plan echilibrat pentru astăzi.",
    4: "Ai energie pentru o sesiune mai consistentă.",
    5: "Energie bună — folosim momentul fără să exagerăm."
  };
  energyMessage.textContent = energyLabels[currentEnergy];

  if (!recommendedTask) {
    title.textContent = "Ai încheiat task-urile importante.";
    reason.textContent = `Poți face ${minutes} min de recapitulare la materia aleasă.`;
    return;
  }

  title.textContent = `Începe cu „${recommendedTask.title}”.`;
  const urgency = recommendedTask.daysUntil <= 0
    ? "are termen astăzi"
    : recommendedTask.daysUntil === 1
      ? "este pentru mâine"
      : `are termen peste ${recommendedTask.daysUntil} zile`;
  reason.textContent =
    `${urgency}, iar o sesiune realistă acum este de ${minutes} minute.`;
}

function initializeFloatingTimer() {
  const timer = document.getElementById("floatingTimer");
  const dragHandle = document.getElementById("floatingTimerDrag");
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  document.getElementById("floatingPauseButton").addEventListener("click", toggleFocusPause);
  document.getElementById("floatingFinishButton").addEventListener("click", finishFocusSession);
  document.getElementById("minimizeFloatingTimer").addEventListener("click", () => {
    timer.classList.toggle("minimized");
  });
  document.getElementById("closeFloatingTimer").addEventListener("click", () => {
    finishFocusSession();
  });
  document.getElementById("taskCompletedYes").addEventListener("click", completeFocusedTask);
  document.getElementById("taskCompletedNo").addEventListener("click", () => {
    document.getElementById("taskResumeOptions").hidden = false;
  });
  document.querySelectorAll("[data-resume-minutes]").forEach((button) => {
    button.addEventListener("click", () => {
      scheduleTaskContinuation(Number(button.dataset.resumeMinutes));
    });
  });

  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    const rect = timer.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    dragHandle.setPointerCapture(event.pointerId);
    timer.classList.add("dragging");
  });

  dragHandle.addEventListener("pointermove", (event) => {
    if (!dragHandle.hasPointerCapture(event.pointerId)) return;
    const maxLeft = window.innerWidth - timer.offsetWidth - 8;
    const maxTop = window.innerHeight - timer.offsetHeight - 8;
    timer.style.left = `${Math.max(8, Math.min(maxLeft, event.clientX - dragOffsetX))}px`;
    timer.style.top = `${Math.max(8, Math.min(maxTop, event.clientY - dragOffsetY))}px`;
    timer.style.right = "auto";
    timer.style.bottom = "auto";
  });

  dragHandle.addEventListener("pointerup", (event) => {
    if (dragHandle.hasPointerCapture(event.pointerId)) {
      dragHandle.releasePointerCapture(event.pointerId);
    }
    timer.classList.remove("dragging");
  });
}

function showFloatingTimer(subject, taskTitle) {
  const timer = document.getElementById("floatingTimer");
  timer.classList.remove("minimized");
  timer.classList.add("visible");
  timer.setAttribute("aria-hidden", "false");
  document.getElementById("floatingTimerSubject").textContent = subject;
  document.getElementById("floatingTimerTask").textContent = taskTitle;
  document.getElementById("floatingPauseButton").textContent = "Pauză";
}

function startTaskFocus(task, subject) {
  clearInterval(focusTimerInterval);
  focusInitialSeconds = Math.max(1, Number(task.estimated_minutes || 30)) * 60;
  focusSecondsRemaining = focusInitialSeconds;
  focusPaused = false;
  focusStartedAt = new Date();
  focusSubjectId = task.subject_id || subject?.id || null;
  focusTaskId = task.id;
  focusTaskTitle = task.title;
  focusSessionSaved = false;
  updateFocusTimerDisplay();
  showFloatingTimer(subject?.name || "Fără materie", task.title);

  focusTimerInterval = setInterval(() => {
    if (focusPaused) return;
    focusSecondsRemaining -= 1;
    updateFocusTimerDisplay();
    if (focusSecondsRemaining <= 0) finishFocusSession();
  }, 1000);
}

async function completeFocusedTask() {
  const taskId = focusTaskId;
  const studiedMinutes = await saveCurrentFocusSession();
  if (!studiedMinutes) return;

  const { error } = await supabaseClient.from("tasks").update({
    completed: true,
    progress: 100,
    completed_at: new Date().toISOString()
  }).eq("id", taskId).eq("user_id", currentUser.id);

  if (error) {
    showToast("Task-ul nu a putut fi bifat.", "!");
    return;
  }

  closeTaskSession();
  window.dispatchEvent(new CustomEvent("itera:task-updated"));
  await loadHomeData();
  renderAll();
  showToast("Task finalizat și timpul salvat.", "✓");
}

async function scheduleTaskContinuation(minutes) {
  const taskSnapshot = {
    id: focusTaskId,
    title: focusTaskTitle,
    subject_id: focusSubjectId,
    estimated_minutes: Math.max(1, Math.ceil(focusInitialSeconds / 60))
  };
  const subjectSnapshot = subjects.find((subject) => subject.id === focusSubjectId);
  const reminderTitle = focusTaskTitle;
  const studiedMinutes = await saveCurrentFocusSession();
  if (!studiedMinutes) return;
  closeTaskSession();

  if (minutes === 0) {
    startTaskFocus(taskSnapshot, subjectSnapshot);
    return;
  }

  if (minutes > 0) {
    window.setTimeout(() => {
      showToast(`E timpul să continui „${reminderTitle}”.`, "▶");
    }, minutes * 60000);
    showToast(`Îți amintim peste ${minutes} minute.`, "♡");
    return;
  }

  showToast("Task-ul rămâne în listă pentru mai târziu.", "♡");
}

function closeTaskSession() {
  closeModal("taskCompletionModal");
  const timer = document.getElementById("floatingTimer");
  timer.classList.remove("visible");
  timer.setAttribute("aria-hidden", "true");
  focusTaskId = null;
  focusTaskTitle = null;
}

globalThis.IteraFocus = Object.freeze({ startTask: startTaskFocus });

function buildNotifications() {
  const today = parseLocalDate(formatDateForInput(new Date()));
  const taskNotifications = tasks
    .filter((task) => !task.completed && task.deadline)
    .map((task) => {
      const days = Math.round((parseLocalDate(task.deadline) - today) / 86400000);
      if (days > 3) return null;
      return {
        icon: days < 0 ? "!" : "✓",
        title: days < 0 ? `${task.title} este întârziat` : task.title,
        text: days === 0
          ? `Deadline astăzi · ${task.estimatedMinutes || 30} min estimate`
          : days === 1
            ? `Pentru mâine · ${task.estimatedMinutes || 30} min estimate`
            : days < 0
              ? "Replanifică-l sau finalizează-l acum."
              : `Deadline peste ${days} zile`,
        action: "tasks",
        urgent: days <= 1
      };
    })
    .filter(Boolean);

  const testNotifications = events
    .filter((event) => event.type === "test" && event.date >= formatDateForInput(new Date()))
    .slice(0, 3)
    .map((event) => ({
      icon: "☆",
      title: event.title,
      text: `${formatRelativeDate(event.date)}${event.subject ? ` · ${event.subject}` : ""}`,
      action: "calendar",
      urgent: event.date === formatDateForInput(new Date())
    }));

  return [...taskNotifications, ...testNotifications].slice(0, 8);
}

function initializeNotificationCenter() {
  const panel = document.getElementById("notificationPanel");
  const close = () => {
    panel.classList.remove("visible");
    panel.setAttribute("aria-hidden", "true");
  };

  document.getElementById("notificationButton").addEventListener("click", () => {
    panel.classList.toggle("visible");
    panel.setAttribute("aria-hidden", String(!panel.classList.contains("visible")));
  });
  document.getElementById("closeNotificationPanel").addEventListener("click", close);
}

function renderNotifications() {
  const notifications = buildNotifications();
  const list = document.getElementById("notificationList");
  const dot = document.getElementById("notificationDot");
  dot.classList.toggle("hidden", notifications.length === 0);

  if (!notifications.length) {
    list.innerHTML = `<div class="empty-state"><span>✓</span><strong>Ești la zi.</strong><p>Nu ai notificări urgente.</p></div>`;
    return;
  }

  list.innerHTML = notifications.map((notification) => `
    <button class="notification-item ${notification.urgent ? "urgent" : ""}" data-notification-route="${notification.action}">
      <span>${notification.icon}</span>
      <div><strong>${escapeHtml(notification.title)}</strong><small>${escapeHtml(notification.text)}</small></div>
      <b>→</b>
    </button>
  `).join("");

  list.querySelectorAll("[data-notification-route]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("notificationPanel").classList.remove("visible");
      openPage(button.dataset.notificationRoute);
    });
  });
}

/* RENDER */

function renderAll() {
  renderHomeSummary();
  renderTodayTimeline();
  renderTodayTasks();
  renderUpcomingEvents();
  renderNowRecommendation();
  renderNotifications();
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
  const todayString = formatDateForInput(new Date());
  const schoolEvents = scheduleItems.filter(
    (item) => Number(item.day_of_week) === new Date().getDay()
  );

  const taskEvents = tasks.filter((task) => task.deadline === todayString);

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

  const currentDate = new Date();
  const mondayOffset = (currentDate.getDay() + 6) % 7;
  const weekStart = new Date(currentDate);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(currentDate.getDate() - mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const weeklyTasks = tasks.filter((task) => {
    if (!task.deadline) return false;
    const deadline = parseLocalDate(task.deadline);
    return deadline >= weekStart && deadline <= weekEnd;
  });
  const completedCount = weeklyTasks.filter((task) => task.completed).length;
  const progress = weeklyTasks.length
    ? Math.round((completedCount / weeklyTasks.length) * 100)
    : 0;

  document.getElementById("homeProgressValue").textContent = `${progress}%`;
  document.getElementById("homeProgressRing").style.setProperty("--progress", progress);
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

  const todaySchedule = scheduleItems
    .filter((item) => Number(item.day_of_week) === new Date().getDay())
    .map((item) => ({
      title: item.title,
      subject: subjectName(item.subject_id),
      time: String(item.start_time || "").slice(0, 5),
      endTime: String(item.end_time || "").slice(0, 5),
      type: item.item_type || "school"
    }));

  const todayEvents = [
    ...todaySchedule,
    ...events
      .filter((event) => event.date === formatDateForInput(new Date()) && event.time)
      .map((event) => ({ ...event, endTime: "" }))
  ]
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 5);

  if (todayEvents.length === 0) {
    timeline.innerHTML = `
      <div class="empty-state">
        <span>☁</span>
        <strong>O zi mai aerisită.</strong>
        <p>Adaugă ceva în orar când ești gata.</p>
        <button class="text-button" data-open-page="schedule">Deschide orarul</button>
      </div>
    `;
    timeline.querySelector("[data-open-page]")?.addEventListener(
      "click",
      () => openPage("schedule")
    );

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
              ${event.endTime ? ` · până la ${escapeHtml(event.endTime)}` : ""}
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

function renderTaskCollection(
  container,
  taskEvents,
  emptyText
) {
  if (taskEvents.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span>✓</span>
        <strong>Ești la zi.</strong>
        <p>${escapeHtml(emptyText)}</p>
      </div>
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

async function toggleItemCompletion(
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

    const task = tasks.find((item) => item.id === itemId);
    const { error } = await supabaseClient
      .from("tasks")
      .update({
        completed: task.completed,
        progress: task.progress,
        completed_at: task.completed
          ? new Date().toISOString()
          : null
      })
      .eq("id", itemId)
      .eq("user_id", currentUser.id);

    if (error) {
      await loadHomeData();
      showToast("Task-ul nu a putut fi actualizat.", "!");
    }
  } else {
    showToast(
      "Evenimentele nu folosesc starea de task finalizat.",
      "!"
    );
    return;
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
      <div class="empty-state">
        <span>✦</span>
        <strong>Niciun deadline apropiat.</strong>
        <p>Poți planifica următorul pas în calendar.</p>
      </div>
    `;

    return;
  }

  upcomingList.innerHTML = upcomingEvents
    .map((event) => {
      const date = parseLocalDate(event.date);
      const daysUntil = Math.round(
        (date - parseLocalDate(formatDateForInput(new Date()))) / 86400000
      );
      const urgencyClass = daysUntil <= 1
        ? "is-urgent"
        : daysUntil <= 3
          ? "is-soon"
          : "";

      return `
        <div class="upcoming-item ${urgencyClass}">
          <div class="upcoming-date">
            ${date.getDate()}
          </div>

          <div class="upcoming-content">
            <strong>${escapeHtml(event.title)}</strong>

            <span>
              ${formatRelativeDate(event.date)}
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

function formatRelativeDate(dateString) {
  const target = parseLocalDate(dateString);
  const today = parseLocalDate(formatDateForInput(new Date()));
  const days = Math.round((target - today) / 86400000);

  if (days === 0) return "Astăzi";
  if (days === 1) return "Mâine";
  if (days > 1 && days < 7) return `Peste ${days} zile`;
  return `${target.getDate()} ${shortMonthNames[target.getMonth()]}`;
}

/* CALENDAR */

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
