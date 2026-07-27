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

let now = new Date();

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
let currentEnergyDate = formatDateForInput(now);
let energySaveVersion = 0;
let recommendedTask = null;
let pendingDayPlan = [];
const appLaunchStartedAt = Date.now();

let currentUser = null;
let profile = null;
let subjects = [];
let events = [];
let tasks = [];
let scheduleItems = [];

initializeApp();

async function initializeApp() {
  await loadHomeData();
  if (!currentUser) return;
  hydrateDailyEnergy();
  applyAccountPreferences();
  initializeShellViews();
  updateCurrentDate();
  initializeNavigation();
  initializeModals();
  initializeAccountSettings();
  initializeFocusControls();
  initializeEnergyCheckin();
  initializeNotificationCenter();
  initializeFloatingTimer();
  IteraPush.initialize();
  initializeEventForm();
  initializeQuickActions();
  initializeQuickTaskForm();
  initializeOrganizer();
  initializeDayPlanner();
  initializeMorningBrief();
  window.setInterval(() => {
    resetEnergyForNewDay();
    updateCurrentDate();
    renderTodayTimeline();
    renderNowRecommendation();
  }, 60000);
  window.addEventListener("focus", async () => {
  await loadHomeData();
  hydrateDailyEnergy();
  applyAccountPreferences();
  updateCurrentDate();
  renderAll();
});

document.addEventListener(
  "visibilitychange",
  async () => {
    if (!document.hidden) {
      await loadHomeData();
      hydrateDailyEnergy();
      applyAccountPreferences();
      updateCurrentDate();
      renderAll();
    }
  }
);

  renderAll();
  hideAppLaunchScreen();
}

function hideAppLaunchScreen() {
  const launchScreen = document.getElementById("appLaunchScreen");
  if (!launchScreen) {
    document.documentElement.classList.remove("app-booting");
    return;
  }

  const minimumDuration = 620;
  const remainingDelay = Math.max(0, minimumDuration - (Date.now() - appLaunchStartedAt));

  window.setTimeout(() => {
    launchScreen.classList.add("leaving");
    document.documentElement.classList.remove("app-booting");
    window.setTimeout(() => launchScreen.remove(), 520);
  }, remainingDelay);
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
  globalThis.IteraPush
    ?.syncUpcomingReminders(tasksResult.data || [], eventsResult.data || [])
    .catch((error) => console.warn("Itera reminder sync:", error));
  populateHomeSubjects();
}

function populateHomeSubjects() {
  const focusSelect = document.getElementById("focusSubject");
  const eventSelect = document.getElementById("eventSubject");
  const quickTaskSelect = document.getElementById("quickTaskSubject");

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

  if (quickTaskSelect) {
    const previousValue = quickTaskSelect.value;
    quickTaskSelect.innerHTML = subjects.length
      ? subjects
          .map((subject) => `<option value="${subject.id}">${escapeHtml(subject.name)}</option>`)
          .join("")
      : '<option value="">Adaugă mai întâi o materie</option>';
    if (previousValue && subjects.some((subject) => subject.id === previousValue)) {
      quickTaskSelect.value = previousValue;
    }
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
  now = new Date();
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

  const dailyBriefing = getDailyBriefing(profileName);

  currentDateLabel.textContent =
    `${capitalizeFirstLetter(weekdayNames[now.getDay()])}, ` +
    `${now.getDate()} ${monthNames[now.getMonth()].toLowerCase()}`;

  greetingTitle.textContent = dailyBriefing.title;
  document.getElementById("dailyBriefingText").textContent = dailyBriefing.subtitle;
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

function getDailyBriefing(profileName) {
  const todayString = formatDateForInput(now);
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6;
  const todaySchedule = scheduleItems
    .filter((item) => Number(item.day_of_week) === day)
    .sort((a, b) => String(a.start_time || "").localeCompare(String(b.start_time || "")));
  const todayTasks = tasks.filter((task) => task.deadline === todayString);
  const remainingTasks = todayTasks.filter((task) => !task.completed);
  const greetingTitle = getGreetingTitle(profileName, now);

  if (todayTasks.length && remainingTasks.length === 0) {
    return {
      title: greetingTitle,
      subtitle: "Ai terminat tot ce era planificat pentru astăzi. Bucură-te de progres."
    };
  }

  if (isWeekend) {
    const bacTask = tasks.find(
      (task) => !task.completed && /bac|recapitul/i.test(`${task.title} ${task.notes || ""}`)
    );
    return {
      title: greetingTitle,
      subtitle: bacTask
        ? `Ai o recapitulare planificată: ${bacTask.title}.`
        : "Fără grabă. Alege o singură recapitulare care contează."
    };
  }

  const lastClass = todaySchedule[todaySchedule.length - 1];
  const lastClassEnd = String(lastClass?.end_time || lastClass?.start_time || "").slice(0, 5);
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const afterSchool = lastClassEnd && currentTime >= lastClassEnd;
  const nextTask = remainingTasks
    .slice()
    .sort((a, b) => {
      const score = { high: 0, medium: 1, low: 2 };
      return (score[a.priority] ?? 1) - (score[b.priority] ?? 1);
    })[0];

  if (now.getHours() < 10) {
    return {
      title: greetingTitle,
      subtitle: todaySchedule.length
        ? `Azi ai ${todaySchedule.length} ${todaySchedule.length === 1 ? "oră" : "ore"} în program.`
        : "Ai o dimineață liberă pentru un început liniștit."
    };
  }

  if (now.getHours() < 17) {
    return {
      title: greetingTitle,
      subtitle: afterSchool
        ? nextTask
          ? `Este un moment bun să începi „${nextTask.title}”.`
          : "Programul de școală s-a încheiat. Poți lua o pauză."
        : todaySchedule.length
          ? `Azi ai ${todaySchedule.length} ${todaySchedule.length === 1 ? "oră" : "ore"} în program.`
          : nextTask
            ? `Următorul pas recomandat este „${nextTask.title}”.`
            : "Ai o zi mai aerisită."
    };
  }

  const remainingMinutes = remainingTasks.reduce(
    (sum, task) => sum + Number(task.estimatedMinutes || task.estimated_minutes || 0),
    0
  );
  return {
    title: greetingTitle,
    subtitle: remainingMinutes
      ? `Mai ai aproximativ ${formatMinutes(remainingMinutes)} de studiu recomandat.`
      : "Poți încheia ziua fără nimic restant."
  };
}

function getGreetingTitle(profileName, date = new Date()) {
  const hour = date.getHours();
  if (hour < 10) return `Bună dimineața, ${profileName}.`;
  if (hour < 17) return `Bună ziua, ${profileName}.`;
  return `Bună seara, ${profileName}.`;
}

function getAccountPreferences() {
  const metadata = currentUser?.user_metadata || {};
  const hasCurrentThemePreferences = metadata.itera_theme_version === 2;
  return {
    theme: ["neutral", "rose", "ocean", "forest"].includes(metadata.itera_theme)
      ? metadata.itera_theme
      : "neutral",
    mode: hasCurrentThemePreferences && ["light", "dark", "system"].includes(metadata.itera_mode)
      ? metadata.itera_mode
      : "light"
  };
}

function applyAccountPreferences(preferences = getAccountPreferences()) {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const effectiveMode = preferences.mode === "system"
    ? (prefersDark ? "dark" : "light")
    : preferences.mode;

  document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.dataset.mode = effectiveMode;

  const themeColor = effectiveMode === "dark"
    ? "#101114"
    : {
        neutral: "#f7f3eb",
        rose: "#fff8fb",
        ocean: "#f5f8fb",
        forest: "#f5f8f5"
      }[preferences.theme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);
}

function initializeAccountSettings() {
  const desktopButton = document.getElementById("openAccountSettingsButton");
  const mobileButton = document.getElementById("mobileAccountSettingsButton");
  const form = document.getElementById("accountSettingsForm");
  const logoutButton = document.getElementById("logoutAccountButton");
  const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");

  const openSettings = () => {
    const preferences = getAccountPreferences();
    const displayName =
      profile?.first_name ||
      currentUser?.user_metadata?.first_name ||
      "";

    document.getElementById("accountDisplayName").value = displayName;
    document.getElementById("accountEmail").value = currentUser?.email || "";
    form.elements.theme.value = preferences.theme;
    form.elements.mode.value = preferences.mode;
    document.getElementById("accountSettingsError").textContent = "";
    closeModal("mobileMoreModal");
    openModal("accountSettingsModal");
  };

  desktopButton?.addEventListener("click", openSettings);
  mobileButton?.addEventListener("click", openSettings);
  document
    .querySelectorAll('[data-close-modal="accountSettingsModal"]')
    .forEach((button) => {
      button.addEventListener("click", () => applyAccountPreferences());
    });

  form?.addEventListener("change", (event) => {
    if (event.target.name === "theme" || event.target.name === "mode") {
      applyAccountPreferences({
        theme: form.elements.theme.value || "neutral",
        mode: form.elements.mode.value || "system"
      });
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = form.elements.displayName.value.trim();
    const theme = form.elements.theme.value || "neutral";
    const mode = form.elements.mode.value || "system";
    const errorElement = document.getElementById("accountSettingsError");
    const saveButton = document.getElementById("saveAccountSettingsButton");

    if (!name) {
      errorElement.textContent = "Te rugăm să introduci numele.";
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Se salvează…";
    errorElement.textContent = "";

    const nextMetadata = {
      ...(currentUser?.user_metadata || {}),
      first_name: name,
      itera_theme: theme,
      itera_mode: mode,
      itera_theme_version: 2
    };

    const { data: authData, error: authError } = await supabaseClient.auth.updateUser({
      data: nextMetadata
    });

    if (authError) {
      errorElement.textContent = "Setările nu au putut fi salvate. Încearcă din nou.";
      saveButton.disabled = false;
      saveButton.textContent = "Salvează setările";
      return;
    }

    const { error: profileError } = await supabaseClient
      .from("profiles")
      .update({
        first_name: name,
        updated_at: new Date().toISOString()
      })
      .eq("id", currentUser.id);

    if (profileError) {
      errorElement.textContent = "Numele nu a putut fi actualizat în profil.";
      saveButton.disabled = false;
      saveButton.textContent = "Salvează setările";
      return;
    }

    currentUser = authData.user || {
      ...currentUser,
      user_metadata: nextMetadata
    };
    profile = { ...(profile || {}), first_name: name };
    applyAccountPreferences({ theme, mode });
    updateCurrentDate();
    closeModal("accountSettingsModal");
    showToast("Setările contului au fost salvate.", "✓");
    saveButton.disabled = false;
    saveButton.textContent = "Salvează setările";
  });

  logoutButton?.addEventListener("click", async () => {
    if (!window.confirm("Sigur vrei să ieși din cont pe acest dispozitiv?")) return;

    logoutButton.disabled = true;
    logoutButton.textContent = "Se închide sesiunea…";
    document.getElementById("accountSettingsError").textContent = "";

    try {
      await globalThis.IteraPush?.disableCurrentDevice();
    } catch (error) {
      console.warn("Itera push cleanup:", error);
    }

    const { error } = await supabaseClient.auth.signOut({ scope: "local" });
    if (error) {
      document.getElementById("accountSettingsError").textContent =
        "Nu am putut închide sesiunea. Încearcă din nou.";
      logoutButton.disabled = false;
      logoutButton.textContent = "Ieși din cont";
      return;
    }

    window.location.replace("auth.html?logged_out=1");
  });

  systemTheme?.addEventListener?.("change", () => {
    if (getAccountPreferences().mode === "system") {
      applyAccountPreferences();
    }
  });
}

function capitalizeFirstLetter(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/* NAVIGATION */

function initializeNavigation() {
  const navigationButtons = document.querySelectorAll(
    "[data-page]"
  );

  document
    .querySelectorAll(".mobile-navigation > button, .mobile-navigation > a")
    .forEach((item) => {
      item.addEventListener("click", () => animateMobileNavigationItem(item));
    });

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

function animateMobileNavigationItem(item) {
  item.classList.remove("nav-bounce");
  void item.offsetWidth;
  item.classList.add("nav-bounce");
  window.setTimeout(() => item.classList.remove("nav-bounce"), 480);
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

  document.getElementById("addTaskButton")?.addEventListener("click", () => {
    prepareQuickTaskModal("homework");
  });
  document.getElementById("addTaskPageButton")?.addEventListener("click", () => {
    IteraShell.navigate("tasks", { updateUrl: true });
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
  prepareQuickTaskModal(action);
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

function prepareQuickTaskModal(type = "homework") {
  const form = document.getElementById("quickTaskForm");
  const normalizedType = type === "task" ? "homework" : type;
  form.reset();
  document.getElementById("quickTaskType").value = normalizedType;
  document.getElementById("quickTaskDate").value = formatDateForInput(new Date());
  document.getElementById("quickTaskMinutes").value = "45";
  document.getElementById("quickTaskModalTitle").textContent =
    normalizedType === "test" ? "Adaugă un test" : "Adaugă o temă";
  openModal("quickTaskModal");
  window.setTimeout(() => document.getElementById("quickTaskTitle")?.focus(), 50);
}

function initializeQuickTaskForm() {
  document.getElementById("quickTaskForm")?.addEventListener("submit", handleQuickTaskSubmit);
}

async function handleQuickTaskSubmit(event) {
  event.preventDefault();
  if (!currentUser) return;

  const saveButton = document.getElementById("saveQuickTaskButton");
  const title = document.getElementById("quickTaskTitle").value.trim();
  const subjectId = document.getElementById("quickTaskSubject").value || null;
  const deadlineDate = document.getElementById("quickTaskDate").value;
  const deadlineTime = document.getElementById("quickTaskTime").value || null;
  const taskType = document.getElementById("quickTaskType").value || "homework";

  saveButton.disabled = true;
  saveButton.textContent = "Se salvează…";

  const { data, error } = await supabaseClient
    .from("tasks")
    .insert({
      user_id: currentUser.id,
      subject_id: subjectId,
      title,
      task_type: taskType,
      deadline_date: deadlineDate,
      deadline_time: deadlineTime,
      priority: document.getElementById("quickTaskPriority").value,
      estimated_minutes: Number(document.getElementById("quickTaskMinutes").value) || 45,
      notes: document.getElementById("quickTaskNotes").value.trim() || null,
      completed: false,
      progress: 0
    })
    .select("*")
    .single();

  saveButton.disabled = false;
  saveButton.textContent = "Salvează";

  if (error) {
    showToast("Tema nu a putut fi salvată.", "!");
    return;
  }

  tasks.unshift(normalizeHomeTask(data));
  await globalThis.IteraPush?.scheduleTaskReminders(data);
  closeModal("quickTaskModal");
  renderAll();
  showToast(
    `${taskType === "test" ? "Testul" : "Tema"} apare acum în Task-uri, Calendar și Materii.`,
    "✓"
  );
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
  await globalThis.IteraPush?.scheduleTestEventReminders(data);
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
  emitFocusTimerState();
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
  emitFocusTimerState();
}

function getFocusTimerState() {
  const timer = document.getElementById("floatingTimer");
  return {
    active: Boolean(timer?.classList.contains("visible")),
    paused: focusPaused,
    time: document.getElementById("floatingTimerValue")?.textContent || "00:00",
    subject: document.getElementById("floatingTimerSubject")?.textContent || "Focus",
    task: document.getElementById("floatingTimerTask")?.textContent || ""
  };
}

function emitFocusTimerState() {
  window.dispatchEvent(new CustomEvent("itera:focus-timer", {
    detail: getFocusTimerState()
  }));
}

async function saveCurrentFocusSession() {
  if (focusSessionSaved) return Math.max(1, Math.round(
    (focusInitialSeconds - focusSecondsRemaining) / 60
  ));

  clearInterval(focusTimerInterval);
  const studiedSeconds = Math.max(0, focusInitialSeconds - focusSecondsRemaining);
  const studiedMinutes = Math.max(1, Math.round(studiedSeconds / 60));

  if (currentUser && focusSubjectId && studiedSeconds >= 30) {
    const sessionPayload = {
      user_id: currentUser.id,
      subject_id: focusSubjectId,
      started_at: focusStartedAt?.toISOString() || new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_minutes: studiedMinutes,
      source: "manual",
      notes: focusTaskTitle,
      study_date: formatDateForInput(new Date())
    };
    let { error } = await supabaseClient
      .from("subject_study_sessions")
      .insert(sessionPayload);

    if (error && /jwt|auth|row-level|permission/i.test(`${error.message} ${error.details || ""}`)) {
      const { data: refreshData } = await supabaseClient.auth.refreshSession();
      if (refreshData?.user) currentUser = refreshData.user;
      if (refreshData?.session) {
        ({ error } = await supabaseClient
          .from("subject_study_sessions")
          .insert(sessionPayload));
      }
    }

    const canUseMinimalPayload = error && (
      ["23514", "PGRST204", "42703"].includes(error.code) ||
      /source|notes|study_date|column|constraint|schema/i.test(
        `${error.message} ${error.details || ""}`
      )
    );

    if (canUseMinimalPayload) {
      const minimalPayload = {
        user_id: currentUser.id,
        subject_id: focusSubjectId,
        duration_minutes: studiedMinutes
      };
      ({ error } = await supabaseClient
        .from("subject_study_sessions")
        .insert(minimalPayload));
    }

    if (error) {
      console.error("Itera focus session save failed", {
        code: error.code,
        message: error.message,
        details: error.details
      });
      showToast("Timpul nu a putut fi salvat. Apasă din nou pe Finalizează.", "!");
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

function hydrateDailyEnergy() {
  const today = formatDateForInput(new Date());
  const metadata = currentUser?.user_metadata || {};
  const savedLevel = Number(metadata.itera_energy_level);
  const hasSavedLevel =
    metadata.itera_energy_date === today &&
    Number.isInteger(savedLevel) &&
    savedLevel >= 1 &&
    savedLevel <= 5;

  currentEnergyDate = today;
  currentEnergy = hasSavedLevel ? savedLevel : 3;
  syncEnergyCheckinUI();
}

function resetEnergyForNewDay() {
  const today = formatDateForInput(new Date());
  if (currentEnergyDate === today) return;
  currentEnergyDate = today;
  currentEnergy = 3;
  syncEnergyCheckinUI();
  renderOrganizerPreview();
}

function syncEnergyCheckinUI() {
  document.querySelectorAll("[data-energy]").forEach((item) => {
    const level = Number(item.dataset.energy);
    item.classList.toggle("active", level === currentEnergy);
    item.classList.toggle("filled", level <= currentEnergy);
  });
  const value = document.getElementById("energyValue");
  if (value) value.textContent = `${currentEnergy}/5`;
}

async function saveDailyEnergy(level, previousLevel) {
  if (!currentUser) return;
  const requestVersion = ++energySaveVersion;
  const today = formatDateForInput(new Date());
  const nextMetadata = {
    ...(currentUser.user_metadata || {}),
    itera_energy_level: level,
    itera_energy_date: today
  };
  const { data, error } = await supabaseClient.auth.updateUser({
    data: nextMetadata
  });

  if (requestVersion !== energySaveVersion) return;

  if (error) {
    currentEnergy = previousLevel;
    syncEnergyCheckinUI();
    renderNowRecommendation();
    renderOrganizerPreview();
    showToast("Nivelul de energie nu a putut fi salvat.", "!");
    return;
  }

  currentUser = data.user || {
    ...currentUser,
    user_metadata: nextMetadata
  };
  currentEnergyDate = today;
}

function initializeEnergyCheckin() {
  syncEnergyCheckinUI();
  document.querySelectorAll("[data-energy]").forEach((button) => {
    button.addEventListener("click", () => {
      const previousLevel = currentEnergy;
      currentEnergy = Number(button.dataset.energy);
      currentEnergyDate = formatDateForInput(new Date());
      syncEnergyCheckinUI();
      renderNowRecommendation();
      renderOrganizerPreview();
      saveDailyEnergy(currentEnergy, previousLevel);
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
    title.textContent = "Ai terminat tot ce era planificat pentru azi.";
    reason.textContent = `Dacă vrei, poți păstra ${minutes} de minute pentru o recapitulare ușoară.`;
    return;
  }

  const subject = recommendedTask.subject || subjectName(recommendedTask.subject_id);
  const finishTime = new Date(Date.now() + minutes * 60000).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit"
  });
  title.textContent = subject
    ? `Îți recomand să începi cu ${subject.toLowerCase()}.`
    : `Îți recomand să începi cu „${recommendedTask.title}”.`;
  const urgency = recommendedTask.daysUntil <= 0
    ? "are termen astăzi"
    : recommendedTask.daysUntil === 1
      ? "este pentru mâine"
      : `are termen peste ${recommendedTask.daysUntil} zile`;
  reason.textContent =
    `„${recommendedTask.title}” ${urgency}. Dacă începi acum, termini înainte de ${finishTime}.`;
}

function getMinutesFromTime(value) {
  const [hours, minutes] = String(value || "00:00").slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function formatClockMinutes(totalMinutes) {
  const safeMinutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  return `${String(Math.floor(safeMinutes / 60)).padStart(2, "0")}:${String(safeMinutes % 60).padStart(2, "0")}`;
}

function roundToQuarter(totalMinutes) {
  return Math.ceil(totalMinutes / 15) * 15;
}

function buildDayPlan() {
  const today = formatDateForInput(new Date());
  const dayTasks = tasks
    .filter((task) => !task.completed && task.deadline && task.deadline <= today)
    .sort(sortTasksForPlan);
  const energyCapacity = { 1: 45, 2: 90, 3: 150, 4: 210, 5: 270 }[currentEnergy] || 150;
  const currentDate = new Date();
  let cursor = roundToQuarter(currentDate.getHours() * 60 + currentDate.getMinutes() + 10);
  const lastClass = scheduleItems
    .filter((item) => Number(item.day_of_week) === currentDate.getDay())
    .sort((a, b) => String(a.end_time || a.start_time || "").localeCompare(String(b.end_time || b.start_time || "")))
    .at(-1);

  if (lastClass) {
    const classEnd = getMinutesFromTime(lastClass.end_time || lastClass.start_time);
    if (classEnd > cursor) cursor = roundToQuarter(classEnd + 30);
  }

  const plan = [];
  let plannedMinutes = 0;
  for (const task of dayTasks) {
    const duration = Math.min(getTaskMinutes(task), getRecommendedSessionMinutes());
    if (plan.length && plannedMinutes + duration > energyCapacity) break;
    if (cursor + duration > 22 * 60 + 30) break;
    plan.push({
      task,
      start: formatClockMinutes(cursor),
      end: formatClockMinutes(cursor + duration),
      duration
    });
    plannedMinutes += duration;
    cursor = roundToQuarter(cursor + duration + 10);
  }

  return {
    entries: plan,
    totalTasks: dayTasks.length,
    plannedMinutes
  };
}

function openDayPlanner() {
  const plan = buildDayPlan();
  const list = document.getElementById("dayPlanList");
  const intro = document.getElementById("dayPlanIntro");
  const applyButton = document.getElementById("applyDayPlanButton");
  pendingDayPlan = plan.entries;

  if (!plan.entries.length) {
    intro.textContent = plan.totalTasks
      ? "Este prea târziu pentru un plan realist astăzi. Păstrează doar ce este urgent."
      : "Nu ai task-uri restante sau cu deadline astăzi.";
    list.innerHTML = `
      <div class="day-plan-empty">
        <strong>Ziua poate rămâne aerisită.</strong>
        <span>Itera nu îți va umple programul doar de dragul de a-l umple.</span>
      </div>
    `;
    applyButton.hidden = true;
  } else {
    intro.textContent =
      `Am așezat ${plan.entries.length} din ${plan.totalTasks} ${plan.totalTasks === 1 ? "task" : "task-uri"} în limita energiei ${currentEnergy}/5 · ${formatMinutes(plan.plannedMinutes)}.`;
    list.innerHTML = plan.entries.map((entry, index) => `
      ${index ? '<div class="day-plan-break"><span></span>Pauză scurtă</div>' : ""}
      <div class="day-plan-row">
        <time>${escapeHtml(entry.start)}</time>
        <span class="day-plan-line"><i></i></span>
        <div>
          <strong>${escapeHtml(entry.task.title)}</strong>
          <small>${escapeHtml(entry.task.subject || "Fără materie")} · ${entry.duration} min · până la ${escapeHtml(entry.end)}</small>
        </div>
      </div>
    `).join("");
    applyButton.hidden = false;
  }

  openModal("dayPlanModal");
}

function initializeDayPlanner() {
  document.getElementById("planDayButton")?.addEventListener("click", openDayPlanner);
  document.getElementById("briefPlanDayButton")?.addEventListener("click", () => {
    markMorningBriefSeen();
    closeModal("morningBriefModal");
    openDayPlanner();
  });
  document.getElementById("applyDayPlanButton")?.addEventListener("click", async (event) => {
    if (!pendingDayPlan.length || !currentUser) return;
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = "Aplic planul…";
    const today = formatDateForInput(new Date());
    const results = await Promise.all(
      pendingDayPlan.map((entry) =>
        supabaseClient
          .from("tasks")
          .update({ deadline_date: today, deadline_time: entry.start })
          .eq("id", entry.task.id)
          .eq("user_id", currentUser.id)
      )
    );
    event.currentTarget.disabled = false;
    event.currentTarget.textContent = "Aplică planul";

    if (results.some((result) => result.error)) {
      showToast("O parte din plan nu a putut fi salvată.", "!");
      return;
    }

    await loadHomeData();
    closeModal("dayPlanModal");
    renderAll();
    showToast("Planul zilei apare acum în timeline și calendar.", "✓");
  });
}

async function markMorningBriefSeen() {
  if (!currentUser) return;
  const today = formatDateForInput(new Date());
  const nextMetadata = {
    ...(currentUser.user_metadata || {}),
    itera_brief_seen_date: today
  };
  const { data } = await supabaseClient.auth.updateUser({ data: nextMetadata });
  if (data?.user) currentUser = data.user;
}

function initializeMorningBrief() {
  const today = formatDateForInput(new Date());
  if (currentUser?.user_metadata?.itera_brief_seen_date === today) return;

  const todayTasks = tasks.filter((task) => !task.completed && task.deadline === today);
  const todayClasses = scheduleItems.filter(
    (item) => Number(item.day_of_week) === new Date().getDay()
  );
  const studyMinutes = todayTasks.reduce((sum, task) => sum + getTaskMinutes(task), 0);
  const displayName =
    profile?.first_name ||
    currentUser?.user_metadata?.first_name ||
    "Itera";
  const isWeekend = [0, 6].includes(new Date().getDay());

  document.getElementById("morningBriefTitle").textContent =
    getGreetingTitle(displayName, new Date());
  document.getElementById("morningBriefSummary").textContent =
    isWeekend && !todayTasks.length
      ? "Un weekend în ritmul tău. Nu ai nimic urgent planificat."
      : todayTasks.length
      ? `Ai ${todayTasks.length} ${todayTasks.length === 1 ? "task" : "task-uri"} și aproximativ ${formatMinutes(studyMinutes)} de studiu.`
      : "Nu ai nimic urgent planificat pentru astăzi.";
  document.getElementById("morningBriefMetrics").innerHTML = `
    <div><strong>${todayClasses.length}</strong><span>ore</span></div>
    <div><strong>${todayTasks.length}</strong><span>task-uri</span></div>
    <div><strong>${currentEnergy}/5</strong><span>energie</span></div>
  `;

  document
    .querySelectorAll('[data-close-modal="morningBriefModal"]')
    .forEach((button) => button.addEventListener("click", markMorningBriefSeen, { once: true }));
  window.setTimeout(() => openModal("morningBriefModal"), 1150);
}

function getTomorrowDate(offset = 1) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return formatDateForInput(date);
}

function getTomorrowTasks() {
  const tomorrow = getTomorrowDate();
  return tasks.filter((task) => !task.completed && task.deadline === tomorrow);
}

function getTaskMinutes(task) {
  return Math.max(5, Number(task.estimatedMinutes || task.estimated_minutes || 30));
}

function sortTasksForPlan(firstTask, secondTask) {
  const priorityScore = { high: 0, medium: 1, low: 2 };
  const firstDeadline = firstTask.deadline || "9999-12-31";
  const secondDeadline = secondTask.deadline || "9999-12-31";
  return firstDeadline.localeCompare(secondDeadline) ||
    (priorityScore[firstTask.priority] ?? 1) - (priorityScore[secondTask.priority] ?? 1);
}

function getOrganizerPlan() {
  const today = formatDateForInput(new Date());
  const tomorrow = getTomorrowDate();
  const openTasks = tasks.filter((task) => !task.completed);
  const overdueTasks = openTasks.filter((task) => task.deadline && task.deadline < today);
  const todayTasks = openTasks.filter((task) => task.deadline === today).sort(sortTasksForPlan);
  const tomorrowTasks = openTasks.filter((task) => task.deadline === tomorrow).sort(sortTasksForPlan);
  const todayMinutes = todayTasks.reduce((sum, task) => sum + getTaskMinutes(task), 0);
  const tomorrowMinutes = tomorrowTasks.reduce((sum, task) => sum + getTaskMinutes(task), 0);
  const energyCapacity = { 1: 45, 2: 90, 3: 150, 4: 210, 5: 270 }[currentEnergy] || 150;
  const tomorrowClasses = scheduleItems.filter(
    (item) => Number(item.day_of_week) === parseLocalDate(tomorrow).getDay()
  ).length;
  const insights = [];

  if (overdueTasks.length) {
    insights.push(
      `Ai ${overdueTasks.length} ${overdueTasks.length === 1 ? "task restant" : "task-uri restante"}. Primul pas ar trebui să fie „${overdueTasks.sort(sortTasksForPlan)[0].title}”.`
    );
  }

  if (todayTasks.length) {
    const firstTask = todayTasks[0];
    insights.push(
      `Astăzi începe cu „${firstTask.title}” și rezervă aproximativ ${formatMinutes(getTaskMinutes(firstTask))}.`
    );
  } else {
    insights.push("Pentru astăzi nu ai task-uri cu deadline. Păstrează spațiul liber.");
  }

  if (todayMinutes > energyCapacity) {
    insights.push(
      `Planul de azi are ${formatMinutes(todayMinutes)}, peste ritmul recomandat pentru energia ${currentEnergy}/5. Lucrează în sesiuni de ${getRecommendedSessionMinutes()} de minute.`
    );
  } else if (todayMinutes) {
    insights.push(
      `Cele ${formatMinutes(todayMinutes)} planificate astăzi se potrivesc cu energia ta de ${currentEnergy}/5.`
    );
  }

  if (tomorrowTasks.length) {
    insights.push(
      `Mâine ai ${tomorrowTasks.length} ${tomorrowTasks.length === 1 ? "task" : "task-uri"}, ${formatMinutes(tomorrowMinutes)} în total${tomorrowClasses ? `, plus ${tomorrowClasses} ore în program` : ""}.`
    );
  } else {
    insights.push("Mâine nu ai task-uri planificate.");
  }

  const tomorrowIsHeavy =
    tomorrowTasks.length >= 4 ||
    tomorrowMinutes > 180 ||
    (tomorrowClasses >= 5 && tomorrowMinutes > 120);
  let action = null;

  if (tomorrowIsHeavy) {
    const movable = tomorrowTasks
      .filter((task) => task.type !== "test" && task.priority !== "high")
      .sort((a, b) => getTaskMinutes(b) - getTaskMinutes(a))
      .slice(0, 2);
    const candidateDays = [2, 3, 4, 5, 6].map((offset) => {
      const date = getTomorrowDate(offset);
      const dayTasks = openTasks.filter((task) => task.deadline === date);
      return {
        date,
        count: dayTasks.length,
        minutes: dayTasks.reduce((sum, task) => sum + getTaskMinutes(task), 0)
      };
    }).sort((a, b) => a.minutes - b.minutes || a.count - b.count);
    const targetDay = candidateDays[0];

    if (movable.length && targetDay) {
      action = {
        taskIds: movable.map((task) => task.id),
        targetDate: targetDay.date,
        label: `Mută ${movable.length === 1 ? "un task" : "două task-uri"}`,
        description:
          `Mutăm ${movable.map((task) => `„${task.title}”`).join(" și ")} pe ${formatReadableDate(targetDay.date)}.`
      };
      insights.push(action.description);
    }
  }

  const nextTask = [...overdueTasks, ...todayTasks, ...tomorrowTasks]
    .sort(sortTasksForPlan)[0] || null;
  const headline = action
    ? "Am găsit o zi care merită echilibrată."
    : nextTask
      ? "Planul tău are un următor pas clar."
      : "Programul tău este aerisit.";
  const summary = action
    ? "Am ales doar task-uri care nu sunt teste și nu au prioritate ridicată."
    : nextTask
      ? `Următorul pas recomandat este „${nextTask.title}”.`
      : "Nu este nevoie să mutăm nimic acum.";
  const preview = action
    ? `Mâine este încărcat. Pot muta ${action.taskIds.length === 1 ? "un task" : "două task-uri"} într-o zi mai liberă.`
    : todayTasks.length
      ? `Începe cu „${todayTasks[0].title}”. Planul de azi are ${formatMinutes(todayMinutes)}.`
      : tomorrowTasks.length
        ? `Mâine ai ${tomorrowTasks.length} ${tomorrowTasks.length === 1 ? "task" : "task-uri"}, dar planul este realist.`
        : "Planul este aerisit. Nu este nevoie să mutăm nimic.";

  return {
    headline,
    summary,
    preview,
    insights: insights.slice(0, 4),
    action,
    metrics: [
      { value: `${currentEnergy}/5`, label: "energie" },
      { value: formatMinutes(todayMinutes), label: "astăzi" },
      { value: formatMinutes(tomorrowMinutes), label: "mâine" }
    ]
  };
}

function initializeOrganizer() {
  document.getElementById("openOrganizerButton")?.addEventListener("click", () => {
    const plan = getOrganizerPlan();
    const response = document.getElementById("organizerResponse");
    const rebalanceButton = document.getElementById("rebalanceTasksButton");

    response.innerHTML = `
      <div class="organizer-response-heading">
        <strong>${escapeHtml(plan.headline)}</strong>
        <p>${escapeHtml(plan.summary)}</p>
      </div>
      <div class="organizer-metrics">
        ${plan.metrics.map((metric) => `
          <div><strong>${escapeHtml(metric.value)}</strong><span>${escapeHtml(metric.label)}</span></div>
        `).join("")}
      </div>
      <ol class="organizer-insights">
        ${plan.insights.map((insight) => `<li><span aria-hidden="true"></span><p>${escapeHtml(insight)}</p></li>`).join("")}
      </ol>
      <section class="weekly-review-panel" id="weeklyReviewPanel">
        <div class="weekly-review-loading">Pregătesc review-ul săptămânal…</div>
      </section>
    `;

    if (plan.action) {
      rebalanceButton.dataset.taskIds = plan.action.taskIds.join(",");
      rebalanceButton.dataset.targetDate = plan.action.targetDate;
      rebalanceButton.textContent = plan.action.label;
      rebalanceButton.hidden = false;
    } else {
      delete rebalanceButton.dataset.taskIds;
      delete rebalanceButton.dataset.targetDate;
      rebalanceButton.textContent = "Echilibrează ziua";
      rebalanceButton.hidden = true;
    }

    openModal("organizerModal");
    renderWeeklyReview();
  });

  document.getElementById("rebalanceTasksButton")?.addEventListener("click", async (event) => {
    const taskIds = event.currentTarget.dataset.taskIds?.split(",").filter(Boolean) || [];
    const targetDate = event.currentTarget.dataset.targetDate;
    if (!taskIds.length || !targetDate || !currentUser) return;

    const originalLabel = event.currentTarget.textContent;
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = "Reechilibrez…";
    const { error } = await supabaseClient
      .from("tasks")
      .update({ deadline_date: targetDate })
      .eq("user_id", currentUser.id)
      .in("id", taskIds);
    event.currentTarget.disabled = false;
    event.currentTarget.textContent = originalLabel;

    if (error) {
      showToast("Planul nu a putut fi actualizat.", "!");
      return;
    }

    await loadHomeData();
    closeModal("organizerModal");
    renderAll();
    showToast(
      `${taskIds.length === 1 ? "Task-ul a fost mutat" : "Task-urile au fost mutate"} pe ${formatReadableDate(targetDate)}.`,
      "✓"
    );
  });
}

function renderOrganizerPreview() {
  const preview = document.getElementById("organizerPreview");
  if (!preview) return;
  preview.textContent = getOrganizerPlan().preview;
}

async function renderWeeklyReview() {
  const panel = document.getElementById("weeklyReviewPanel");
  if (!panel || !currentUser) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const heatmapStart = new Date(today);
  heatmapStart.setDate(today.getDate() - 55);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const { data: sessions, error } = await supabaseClient
    .from("subject_study_sessions")
    .select("subject_id,duration_minutes,study_date")
    .eq("user_id", currentUser.id)
    .gte("study_date", formatDateForInput(heatmapStart))
    .order("study_date");

  const safeSessions = error ? [] : (sessions || []);
  const completedThisWeek = tasks.filter((task) => {
    if (!task.completed_at) return false;
    const completedAt = new Date(task.completed_at);
    return completedAt >= weekStart && completedAt <= new Date();
  });
  const weekSessions = safeSessions.filter(
    (session) => session.study_date >= formatDateForInput(weekStart)
  );
  const weekMinutes = weekSessions.reduce(
    (sum, session) => sum + Number(session.duration_minutes || 0),
    0
  );
  const subjectMinutes = weekSessions.reduce((totals, session) => {
    totals[session.subject_id] = (totals[session.subject_id] || 0) + Number(session.duration_minutes || 0);
    return totals;
  }, {});
  const topSubjectId = Object.entries(subjectMinutes)
    .sort((first, second) => second[1] - first[1])[0]?.[0];
  const topSubject = subjectName(topSubjectId) || "—";
  const activityByDate = {};

  safeSessions.forEach((session) => {
    activityByDate[session.study_date] =
      (activityByDate[session.study_date] || 0) + Number(session.duration_minutes || 0);
  });
  tasks.forEach((task) => {
    if (!task.completed_at) return;
    const completedDate = formatDateForInput(new Date(task.completed_at));
    if (completedDate >= formatDateForInput(heatmapStart)) {
      activityByDate[completedDate] = (activityByDate[completedDate] || 0) + 15;
    }
  });

  const heatmapDays = Array.from({ length: 56 }, (_, index) => {
    const date = new Date(heatmapStart);
    date.setDate(heatmapStart.getDate() + index);
    const dateString = formatDateForInput(date);
    const activity = activityByDate[dateString] || 0;
    const level = activity === 0 ? 0 : activity < 30 ? 1 : activity < 60 ? 2 : activity < 120 ? 3 : 4;
    return `<span data-level="${level}" title="${formatReadableDate(dateString)} · ${formatMinutes(activity)}"></span>`;
  }).join("");
  const bestDayEntry = Object.entries(activityByDate)
    .filter(([date]) => date >= formatDateForInput(weekStart))
    .sort((first, second) => second[1] - first[1])[0];
  const bestDay = bestDayEntry ? formatReadableDate(bestDayEntry[0]) : "—";

  panel.innerHTML = `
    <div class="weekly-review-heading">
      <div>
        <p class="card-kicker">Weekly Review</p>
        <strong>Săptămâna ta, fără presiune</strong>
      </div>
      <span>${formatReadableDate(formatDateForInput(weekStart))}–${formatReadableDate(formatDateForInput(today))}</span>
    </div>
    <div class="weekly-review-stats">
      <div><strong>${completedThisWeek.length}</strong><span>finalizate</span></div>
      <div><strong>${formatMinutes(weekMinutes)}</strong><span>studiu</span></div>
      <div><strong>${escapeHtml(topSubject)}</strong><span>materia principală</span></div>
      <div><strong>${escapeHtml(bestDay)}</strong><span>ziua cea mai activă</span></div>
    </div>
    <div class="study-heatmap-wrap">
      <div class="study-heatmap" aria-label="Activitatea din ultimele opt săptămâni">${heatmapDays}</div>
      <div class="heatmap-legend"><span>Mai puțin</span><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><span>Mai mult</span></div>
    </div>
  `;
}

function renderGoalCountdowns() {
  const list = document.getElementById("goalCountdownList");
  if (!list) return;
  const today = parseLocalDate(formatDateForInput(new Date()));
  const keywords = /bac|cambridge|delf|driving|permis|admitere|examen/i;
  const allItems = getAllCalendarItems()
    .filter((item) => item.date && keywords.test(`${item.title} ${item.notes || ""}`))
    .sort(sortEvents);
  const uniqueItems = allItems.filter(
    (item, index, array) => array.findIndex((candidate) => candidate.title.toLowerCase() === item.title.toLowerCase()) === index
  );
  const goals = uniqueItems.length
    ? uniqueItems.slice(0, 4)
    : getAllCalendarItems()
        .filter((item) => item.date && parseLocalDate(item.date) >= today)
        .sort(sortEvents)
        .slice(0, 3);

  if (!goals.length) {
    list.innerHTML = `
      <div class="countdown-empty">
        <strong>Adaugă primul obiectiv important.</strong>
        <span>Examenele și deadline-urile vor avea aici propriul countdown.</span>
      </div>
    `;
    return;
  }

  list.innerHTML = goals.map((goal) => {
    const days = Math.ceil((parseLocalDate(goal.date) - today) / 86400000);
    const isComplete = Boolean(goal.completed);
    const status = isComplete
      ? "Finalizat ✓"
      : days === 0
        ? "Astăzi"
        : days === 1
          ? "Mâine"
          : days > 1
            ? `${days} zile`
            : "Încheiat";
    return `
      <div class="goal-countdown-row">
        <span class="goal-countdown-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(goal.title)}</strong>
        <span class="${isComplete ? "completed" : ""}">${status}</span>
      </div>
    `;
  }).join("");
}

function renderAchievement() {
  const card = document.getElementById("achievementCard");
  if (!card) return;
  const todayString = formatDateForInput(new Date());
  const todayTasks = tasks.filter((task) => task.deadline === todayString);
  const currentDate = new Date();
  const mondayOffset = (currentDate.getDay() + 6) % 7;
  const weekStart = new Date(currentDate);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(currentDate.getDate() - mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const completedThisWeek = tasks.filter((task) => {
    if (!task.completed_at) return false;
    const completedAt = new Date(task.completed_at);
    return completedAt >= weekStart && completedAt < weekEnd;
  }).length;

  if (todayTasks.length && todayTasks.every((task) => task.completed)) {
    card.hidden = false;
    document.getElementById("achievementTitle").textContent = "Ai terminat toate task-urile de azi.";
    document.getElementById("achievementDescription").textContent = "Planul de astăzi este complet.";
  } else if (completedThisWeek >= 5) {
    card.hidden = false;
    document.getElementById("achievementTitle").textContent = "Consecvență foarte bună.";
    document.getElementById("achievementDescription").textContent =
      `Ai finalizat ${completedThisWeek} task-uri săptămâna aceasta.`;
  } else {
    card.hidden = true;
  }
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
  emitFocusTimerState();
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
    const scheduledFor = new Date(Date.now() + minutes * 60000);
    window.setTimeout(() => {
      showToast(`E timpul să continui „${reminderTitle}”.`, "▶");
    }, minutes * 60000);
    const result = await globalThis.IteraPush?.queueReminder({
      title: "Continuă sesiunea de focus",
      body: `E timpul să continui „${reminderTitle}”.`,
      scheduledFor,
      targetUrl: "./index.html#/tasks",
      tag: `task-continuation-${taskSnapshot.id}`,
      notificationType: "task-continuation",
      sourceId: taskSnapshot.id,
      dedupeKey: `task-continuation-${taskSnapshot.id}-${scheduledFor.toISOString()}`
    });

    if (result?.ok) {
      showToast(`Notificarea este programată peste ${minutes} minute.`, "♡");
    } else {
      showToast("Reminderul funcționează doar cât timp Itera rămâne deschisă.", "!");
    }
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
  emitFocusTimerState();
}

globalThis.IteraFocus = Object.freeze({
  startTask: startTaskFocus,
  getState: getFocusTimerState,
  togglePause: toggleFocusPause,
  finish: finishFocusSession
});

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
  updateCurrentDate();
  renderHomeSummary();
  renderTodayTimeline();
  renderTodayTasks();
  renderUpcomingEvents();
  renderNowRecommendation();
  renderGoalCountdowns();
  renderOrganizerPreview();
  renderAchievement();
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
  const timeline = document.getElementById("todayTimeline");
  const todayString = formatDateForInput(new Date());
  const todaySchedule = scheduleItems
    .filter((item) => Number(item.day_of_week) === new Date().getDay())
    .map((item) => ({
      title: item.title,
      subject: subjectName(item.subject_id),
      time: String(item.start_time || "").slice(0, 5),
      endTime: String(item.end_time || "").slice(0, 5),
      type: item.item_type || "school"
    }));

  const timelineItems = [
    ...todaySchedule,
    ...events
      .filter((event) => event.date === todayString && event.time)
      .map((event) => ({ ...event, endTime: "" })),
    ...tasks
      .filter((task) => task.deadline === todayString && task.deadlineTime && !task.completed)
      .map((task) => ({
        title: task.title,
        subject: task.subject,
        time: task.deadlineTime,
        endTime: "",
        type: task.type || "homework"
      }))
  ];

  const lastClass = todaySchedule
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time))
    .at(-1);
  if (lastClass?.endTime) {
    const [hours, minutes] = lastClass.endTime.split(":").map(Number);
    const homeTime = new Date();
    homeTime.setHours(hours, minutes + 30, 0, 0);
    timelineItems.push({
      title: "Acasă",
      subject: "Timp pentru pauză și reset",
      time: `${String(homeTime.getHours()).padStart(2, "0")}:${String(homeTime.getMinutes()).padStart(2, "0")}`,
      endTime: "",
      type: "personal"
    });
  }

  if (timelineItems.length) {
    timelineItems.push({
      title: "Somn",
      subject: "Încheierea zilei",
      time: "22:30",
      endTime: "",
      type: "personal"
    });
  }

  if (timelineItems.length === 0) {
    timeline.innerHTML = `
      <div class="empty-state">
        <span>○</span>
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

  const currentTime = `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
  timelineItems.push({
    title: "Acum este",
    subject: "Linia zilei se actualizează în timp real",
    time: currentTime,
    endTime: "",
    type: "current",
    isCurrent: true
  });

  timeline.innerHTML = timelineItems
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 12)
    .map((event) => {
      return `
        <div class="timeline-item ${event.isCurrent ? "current-time" : ""}">
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
