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
let focusEndsAt = null;
let focusTimerMode = "focus";
let focusTimerId = null;
let focusSubjectName = "Focus";
let focusTaskSnapshot = null;
let focusResumeSubjectId = null;
let focusResumeSubjectName = "Studiu";
let nextTimerMode = "focus";
let focusFinishInProgress = false;
let currentEnergy = 3;
let currentEnergyDate = formatDateForInput(now);
let energySaveVersion = 0;
let energyPromptDismissedUntil = 0;
let recommendedTask = null;
let recommendedNavigation = null;
let pendingDayPlan = [];
let pendingRecoveryPlan = [];
let focusAudioContext = null;
let focusAudioSource = null;
let focusAudioGain = null;
let activeSoundscape = "none";
const appLaunchStartedAt = Date.now();

let currentUser = null;
let profile = null;
let subjects = [];
let events = [];
let tasks = [];
let scheduleItems = [];
let studySessions = [];
let taskRealtimeChannel = null;
let realtimeRefreshTimer = null;
let modalScrollPosition = 0;
let homeDataLoadPromise = null;
let homeDataLoadedAt = 0;
let reminderSyncAt = 0;
let resumeRefreshTimer = null;

initializeApp();

async function initializeApp() {
  const initialSession = await globalThis.IteraAuthSessionPromise;
  if (!initialSession) return;
  currentUser = initialSession.user;
  hydrateDailyEnergy();
  applyAccountPreferences();
  initializeShellViews();
  updateCurrentDate();
  initializeNavigation();
  initializeModals();
  initializeAccountSettings();
  initializeFocusControls();
  initializeEnergyCheckin();
  initializeEnergyPrompt();
  initializeNotificationCenter();
  initializeRealtimeSync();
  initializeFloatingTimer();
  IteraPush.initialize();
  initializeEventForm();
  initializeQuickActions();
  initializeQuickCapture();
  initializeQuickTaskForm();
  initializeOrganizer();
  initializeDayPlanner();
  initializeWeeklyReplay();
  initializeExamMode();
  initializeRecoveryMode();
  initializeLaunchActions();
  updateCurrentDate();
  document.documentElement.classList.add("app-data-loading");
  hideAppLaunchScreen();

  await loadHomeData({ force: true, session: initialSession });
  document.documentElement.classList.remove("app-data-loading");
  hydrateDailyEnergy();
  applyAccountPreferences();
  renderAll();
  initializeMorningBrief();
  void IteraPush.scheduleRhythmReminders?.();

  window.setInterval(() => {
    resetEnergyForNewDay();
    updateCurrentDate();
    renderTodayTimeline();
    renderNowRecommendation();
    maybePromptEnergy();
  }, 60000);
  window.addEventListener("focus", scheduleResumeRefresh);

window.addEventListener("itera:home-refresh", async () => {
  await loadHomeData();
  renderAll();
});

window.addEventListener("itera:plan-updated", async () => {
  const { data } = await supabaseClient.auth.getUser();
  if (data?.user) currentUser = data.user;
  await loadHomeData();
  renderAll();
});

window.addEventListener("itera:task-updated", async () => {
  await loadHomeData();
  renderAll();
  globalThis.IteraTasksView?.refresh?.();
});

document.addEventListener(
  "visibilitychange",
  () => {
    if (!document.hidden) scheduleResumeRefresh();
  }
);

  window.setTimeout(maybePromptEnergy, 700);
  void refreshSmartPlanAfterLaunch();
  void maintainActiveExamPlans();
}

function scheduleResumeRefresh() {
  clearTimeout(resumeRefreshTimer);
  resumeRefreshTimer = window.setTimeout(async () => {
    const refreshed = await loadHomeData({ maxAge: 12000 });
    hydrateDailyEnergy();
    applyAccountPreferences();
    updateCurrentDate();
    if (refreshed) renderAll();
  }, 90);
}

function initializeRealtimeSync() {
  if (!currentUser || taskRealtimeChannel || !supabaseClient?.channel) return;
  taskRealtimeChannel = supabaseClient
    .channel(`itera-tasks-${currentUser.id}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "tasks",
      filter: `user_id=eq.${currentUser.id}`
    }, () => {
      clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = setTimeout(async () => {
        await loadHomeData();
        renderAll();
        globalThis.IteraTasksView?.refresh?.();
      }, 180);
    })
    .subscribe();
}

async function refreshSmartPlanAfterLaunch() {
  try {
    const initialPlan = await rebuildSmartTaskPlan();
    if (!initialPlan?.changed) return;
    await loadHomeData();
    renderAll();
  } catch (error) {
    console.warn("Itera background planning:", error);
  }
}

function hideAppLaunchScreen() {
  const launchScreen = document.getElementById("appLaunchScreen");
  if (!launchScreen) {
    document.documentElement.classList.remove("app-booting");
    return;
  }

  const minimumDuration = 260;
  const remainingDelay = Math.max(0, minimumDuration - (Date.now() - appLaunchStartedAt));

  window.setTimeout(() => {
    launchScreen.classList.add("leaving");
    document.documentElement.classList.remove("app-booting");
    window.setTimeout(() => launchScreen.remove(), 240);
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

async function loadHomeData(options = {}) {
  const maxAge = Number(options.maxAge || 0);
  if (!options.force && maxAge > 0 && currentUser && Date.now() - homeDataLoadedAt < maxAge) {
    return false;
  }
  if (homeDataLoadPromise) return homeDataLoadPromise;

  homeDataLoadPromise = loadHomeDataFromRemote(options);
  try {
    return await homeDataLoadPromise;
  } finally {
    homeDataLoadPromise = null;
  }
}

async function loadHomeDataFromRemote(options = {}) {
  let session = options.session || null;
  let sessionError = null;
  if (!session) {
    const result = await supabaseClient.auth.getSession();
    session = result.data?.session || null;
    sessionError = result.error;
  }

  if (sessionError || !session) {
    return;
  }

  currentUser = session.user;

  const todayString = formatDateForInput(new Date());
  const profileRequest = globalThis.IteraOnboardingProfilePromise || supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();
  const [profileResult, subjectsResult, eventsResult, tasksResult, scheduleResult, sessionsResult] =
    await Promise.all([
      profileRequest,
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
        .order("start_time"),
      supabaseClient
        .from("subject_study_sessions")
        .select("subject_id,duration_minutes,study_date")
        .eq("user_id", currentUser.id)
        .eq("study_date", todayString)
    ]);

  profile = profileResult.data || null;
  subjects = subjectsResult.data || [];
  events = (eventsResult.data || []).map(normalizeHomeEvent);
  const visibleTaskRows = (tasksResult.data || []).filter(task =>
    !/recapitulare recomandată automat după o sesiune de studiu/i.test(String(task.notes || ""))
  );
  tasks = visibleTaskRows.map(normalizeHomeTask);
  scheduleItems = scheduleResult.data || [];
  studySessions = sessionsResult.data || [];
  const reminderTasks = visibleTaskRows.map((task) => {
    const plan = globalThis.IteraPlanning?.getTaskPlan(currentUser, task);
    return plan ? {
      ...task,
      original_deadline_date: task.deadline_date,
      deadline_date: plan.date,
      deadline_time: plan.time
    } : task;
  });
  if (Date.now() - reminderSyncAt > 60000) {
    reminderSyncAt = Date.now();
    globalThis.IteraPush
      ?.syncUpcomingReminders(reminderTasks, eventsResult.data || [])
      .catch((error) => console.warn("Itera reminder sync:", error));
  }
  populateHomeSubjects();
  homeDataLoadedAt = Date.now();
  return true;
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
    quickTaskSelect.innerHTML = `<option value="">Fără materie</option>${subjects
      .map((subject) => `<option value="${subject.id}">${escapeHtml(subject.name)}</option>`)
      .join("")}`;
    if (previousValue && subjects.some((subject) => subject.id === previousValue)) {
      quickTaskSelect.value = previousValue;
    }
  }
}

function subjectName(subjectId) {
  return subjects.find((subject) => subject.id === subjectId)?.name || "";
}

function isLifeTaskType(type) {
  return ["personal", "selfcare", "home", "health", "errand", "goal"].includes(type);
}

function isCareTask(task) {
  return (task?.type || task?.task_type) === "selfcare";
}

function isFixedPersonalTaskType(type) {
  return ["personal", "selfcare", "home", "health", "errand"].includes(type);
}

const PERSONAL_TASK_ONLY_MARKER = "[itera:task-only]";
const PERSONAL_NO_TIMER_MARKER = "[itera:no-timer]";
const PERSONAL_CATEGORY_PATTERN = /\[itera:category=([^\]]+)\]/i;

function isPersonalEventLikeTask(task) {
  const type = task?.type || task?.task_type;
  return isFixedPersonalTaskType(type) && Boolean(task?.eventOnly);
}

function isActionableTask(task) {
  return !isPersonalEventLikeTask(task);
}

function getTaskPlanDate(task) {
  return task?.scheduledDate || task?.deadline || task?.deadline_date || null;
}

function getTaskPlanTime(task) {
  return task?.scheduledTime || task?.deadlineTime || task?.deadline_time || "";
}

async function rebuildSmartTaskPlan({ notify = false } = {}) {
  if (!currentUser || !globalThis.IteraPlanning) return null;
  const result = globalThis.IteraPlanning.buildPlan({
    tasks,
    scheduleItems,
    calendarEvents: events,
    user: currentUser,
    energy: currentEnergy,
    today: formatDateForInput(new Date())
  });
  if (!result.total) return result;
  const currentPlan = globalThis.IteraPlanning.getPlan(currentUser);
  if (JSON.stringify(result.plan) === JSON.stringify(currentPlan)) {
    result.changed = false;
    return result;
  }
  const saved = await globalThis.IteraPlanning.savePlan(currentUser, result.plan);
  if (!saved.ok) {
    if (notify) showToast("Planul nu a putut fi salvat în cont.", "!");
    return null;
  }
  currentUser = saved.user;
  result.changed = true;
  if (notify) {
    showToast(
      `${result.scheduled} ${result.scheduled === 1 ? "task planificat" : "task-uri planificate"} înainte de termen, cu pauze incluse.`,
      "✓"
    );
  }
  return result;
}

async function saveTaskPlanEntries(entries) {
  if (!currentUser || !entries.length || !globalThis.IteraPlanning) return false;
  const plan = { ...globalThis.IteraPlanning.getPlan(currentUser) };
  entries.forEach(({ task, date, time }) => {
    plan[String(task.id)] = {
      date,
      time,
      deadlineDate: task.deadline || task.deadline_date || null,
      deadlineTime: task.deadlineTime || task.deadline_time || null,
      duration: getTaskMinutes(task),
      kind: isLifeTaskType(task.type || task.task_type) ? "personal" : "study",
      source: "manual",
      updatedAt: new Date().toISOString()
    };
  });
  const saved = await globalThis.IteraPlanning.savePlan(currentUser, plan);
  if (!saved.ok) return false;
  currentUser = saved.user;
  await Promise.all(entries.map(({ task, date, time }) =>
    globalThis.IteraPush?.scheduleTaskReminders({
      ...task,
      deadline_date: date,
      deadline_time: time
    })
  ));
  return true;
}

function cleanPersonalTaskNotes(notes) {
  return String(notes || "")
    .replace(PERSONAL_TASK_ONLY_MARKER, "")
    .replace(PERSONAL_NO_TIMER_MARKER, "")
    .replace(PERSONAL_CATEGORY_PATTERN, "")
    .trim();
}

function taskTypeLabel(type) {
  return ({
    personal: "Personal",
    selfcare: "Self-care",
    home: "Casă",
    health: "Sănătate",
    errand: "De rezolvat",
    goal: "Obiectiv",
    test: "Test",
    project: "Proiect",
    study: "Studiu",
    other: "Altceva"
  })[type] || "Școală";
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
    endTime: String(event.end_time || "").slice(0, 5),
    duration: 0,
    priority: "medium",
    notes: event.notes || "",
    completed: false
  };
}

function normalizeHomeTask(task) {
  const plan = globalThis.IteraPlanning?.getTaskPlan(currentUser, task) || null;
  const storedCategory = String(task.notes || "").match(PERSONAL_CATEGORY_PATTERN)?.[1];
  const normalizedType = storedCategory || task.task_type;
  const taskOnly = String(task.notes || "").includes(PERSONAL_TASK_ONLY_MARKER);
  return {
    ...task,
    type: normalizedType,
    task_type: normalizedType,
    subject: subjectName(task.subject_id) || taskTypeLabel(normalizedType),
    deadline: task.deadline_date,
    deadlineTime: String(task.deadline_time || "").slice(0, 5),
    scheduledDate: plan?.date || task.deadline_date,
    scheduledTime: plan?.time || String(task.deadline_time || "").slice(0, 5),
    estimatedMinutes: task.estimated_minutes,
    calendarHidden: taskOnly,
    noTimer: String(task.notes || "").includes(PERSONAL_NO_TIMER_MARKER),
    eventOnly: String(task.notes || "").includes("[itera:event]") ||
      (isFixedPersonalTaskType(normalizedType) && !taskOnly),
    notes: cleanPersonalTaskNotes(task.notes)
  };
}

function convertTaskToCalendarItem(task) {
  return {
    id: task.id,
    source: "task",

    title: task.title,
    type: task.type || "homework",
    subject: task.subject || "",
    subjectId: task.subject_id || null,
    noTimer: Boolean(task.noTimer),

    date: task.scheduledDate || task.deadline,
    time: task.scheduledTime || task.deadlineTime || "",

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
    .filter((task) => task.deadline && !task.calendarHidden)
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
  const todayTasks = tasks.filter(
    (task) => isActionableTask(task) && getTaskPlanDate(task) === todayString
  );
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

  if (!document.body.classList.contains("modal-scroll-locked")) {
    modalScrollPosition = window.scrollY;
    document.body.classList.add("modal-scroll-locked");
    document.body.style.top = `-${modalScrollPosition}px`;
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);

  if (!modal) {
    return;
  }

  modal.classList.remove("visible");
  modal.setAttribute("aria-hidden", "true");

  if (!document.querySelector(".modal-overlay.visible")) {
    document.body.classList.remove("modal-scroll-locked");
    document.body.style.top = "";
    window.scrollTo(0, modalScrollPosition);
  }
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

  document.getElementById("addPersonalTaskButton")?.addEventListener("click", () => {
    prepareQuickTaskModal("personal");
  });

  document.getElementById("addPersonalGoalButton")?.addEventListener("click", () => {
    prepareQuickTaskModal("goal");
  });

  document.getElementById("viewPersonalTasksButton")?.addEventListener("click", () => {
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
          action === "homework" ||
          action === "personal"
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

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inferLifeTaskType(value) {
  const plain = normalizeSearchText(value);
  if (/\b(obiectiv|goal|tinta|vreau sa)\b/.test(plain)) return "goal";
  if (/\b(unghi(?:i|ile)?|manichiura|pedichiura|skincare|masca|parul|self[ -]?care|spa)\b/.test(plain)) return "selfcare";
  if (/\b(curat|curatenie|camera|ordine|aspir|spal|rufe|bucatarie|baie)\b/.test(plain)) return "home";
  if (/\b(sport|sala|alerg|plimbare|medic|doctor|dentist|sanatate|vitamine)\b/.test(plain)) return "health";
  if (/\b(cumparaturi|magazin|ridic|colet|farmacie|programare|rezolvat)\b/.test(plain)) return "errand";
  if (/\b(personal|prieteni|familie|sun[ăa]|iesire|film|citit)\b/.test(plain)) return "personal";
  return "";
}

function parseQuickCapture(value) {
  const raw = String(value || "").trim();
  const plain = normalizeSearchText(raw);
  const result = {
    title: raw,
    type: /\b(test|simulare|examen)\b/.test(plain)
      ? "test"
      : (inferLifeTaskType(plain) || "homework"),
    date: formatDateForInput(new Date()),
    time: "",
    minutes: 45,
    priority: /\b(urgent|important|prioritate mare)\b/.test(plain) ? "high" : "medium",
    subjectId: ""
  };

  const targetDate = new Date();
  if (/\bmaine\b/.test(plain)) targetDate.setDate(targetDate.getDate() + 1);
  if (/\bpoimaine\b/.test(plain)) targetDate.setDate(targetDate.getDate() + 2);
  const weekdayAliases = ["duminica", "luni", "marti", "miercuri", "joi", "vineri", "sambata"];
  const weekdayIndex = weekdayAliases.findIndex((day) => new RegExp(`\\b${day}\\b`).test(plain));
  if (weekdayIndex >= 0) {
    let offset = (weekdayIndex - targetDate.getDay() + 7) % 7;
    if (offset === 0) offset = 7;
    targetDate.setDate(targetDate.getDate() + offset);
  }
  const isoDate = plain.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  const numericDate = plain.match(/\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{4}))?\b/);
  if (isoDate) {
    targetDate.setFullYear(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  } else if (numericDate) {
    targetDate.setFullYear(Number(numericDate[3] || targetDate.getFullYear()), Number(numericDate[2]) - 1, Number(numericDate[1]));
  }
  result.date = formatDateForInput(targetDate);

  const durationMatch = plain.match(/\b(\d{1,3})\s*(?:min|minute)\b/);
  if (durationMatch) result.minutes = Math.max(5, Math.min(600, Number(durationMatch[1])));
  const hourDuration = plain.match(/\b(\d+(?:[.,]\d+)?)\s*(?:h|ora|ore)\b/);
  if (hourDuration && !/\b(?:la|ora)\s+\d{1,2}(?::\d{2})?\b/.test(plain)) {
    result.minutes = Math.max(5, Math.min(600, Math.round(Number(hourDuration[1].replace(",", ".")) * 60)));
  }
  if (/\bo ora si (?:jumatate|jum)\b/.test(plain)) result.minutes = 90;
  else if (/\bo ora\b/.test(plain)) result.minutes = 60;
  const timeMatch = plain.match(/\b(?:la|ora)\s+(\d{1,2})(?:[:.](\d{2}))?\b/);
  if (timeMatch) result.time = `${String(Math.min(23, Number(timeMatch[1]))).padStart(2, "0")}:${String(Math.min(59, Number(timeMatch[2] || 0))).padStart(2, "0")}`;

  const subject = subjects.find((item) => {
    const name = normalizeSearchText(item.name);
    const firstWord = name.split(/\s+/)[0];
    const shortName = firstWord.slice(0, Math.max(3, Math.min(4, firstWord.length)));
    return plain.includes(name) || new RegExp(`\\b${shortName}`).test(plain);
  });
  result.subjectId = isLifeTaskType(result.type)
    ? ""
    : (subject?.id || subjects[0]?.id || "");

  const noisePatterns = [
    /\b(tem[ăa]|task|test|simulare|examen)\b/gi,
    /\b(azi|ast[ăa]zi|m[âa]ine|poim[âa]ine|luni|mar[țt]i|miercuri|joi|vineri|s[âa]mb[ăa]t[ăa]|duminic[ăa])\b/gi,
    /\b(?:la|ora)\s+\d{1,2}(?:[:.]\d{2})?\b/gi,
    /\b\d{1,3}\s*(?:min|minute)\b/gi,
    /\b(?:o|\d+(?:[.,]\d+)?)\s*(?:h|or[ăa]|ore)(?:\s+și\s+(?:jumătate|jum))?\b/gi,
    /\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[.\/]\d{1,2}(?:[.\/]\d{4})?\b/gi,
    /\b(?:pentru|la)\s+[a-zăâîșț]+\b/gi
  ];
  let cleanedTitle = raw.replace(/^(?:temă|tema|task|test|simulare|examen)\s+/i, "");
  noisePatterns.forEach((pattern) => { cleanedTitle = cleanedTitle.replace(pattern, " "); });
  cleanedTitle = cleanedTitle.replace(/\s{2,}/g, " ").replace(/^[,.;:\s]+|[,.;:\s]+$/g, "");
  if (cleanedTitle.length >= 3) result.title = cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1);
  return result;
}

function initializeQuickCapture() {
  const form = document.getElementById("quickCaptureForm");
  const input = document.getElementById("quickCaptureInput");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!input.value.trim()) return;
    const parsed = parseQuickCapture(input.value);
    closeModal("quickAddModal");
    prepareQuickTaskModal(parsed.type);
    document.getElementById("quickTaskTitle").value = parsed.title;
    document.getElementById("quickTaskSubject").value = parsed.subjectId;
    document.getElementById("quickTaskDate").value = parsed.date;
    document.getElementById("quickTaskTime").value = parsed.time;
    document.getElementById("quickTaskMinutes").value = String(parsed.minutes);
    document.getElementById("quickTaskPriority").value = parsed.priority;
    input.value = "";
  });

  const voiceButton = document.getElementById("quickCaptureVoice");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (voiceButton) voiceButton.hidden = true;
    return;
  }
  voiceButton?.addEventListener("click", () => {
    const recognition = new SpeechRecognition();
    recognition.lang = "ro-RO";
    recognition.interimResults = false;
    voiceButton.disabled = true;
    voiceButton.classList.add("listening");
    recognition.onresult = (event) => { input.value = event.results[0][0].transcript; };
    recognition.onend = () => {
      voiceButton.disabled = false;
      voiceButton.classList.remove("listening");
    };
    recognition.onerror = () => {
      voiceButton.disabled = false;
      voiceButton.classList.remove("listening");
      showToast("Dictarea nu a pornit. Verifică permisiunea pentru microfon.", "!");
    };
    recognition.start();
  });
}

function prepareQuickTaskModal(type = "homework") {
  const form = document.getElementById("quickTaskForm");
  const normalizedType = type === "task" ? "homework" : type;
  form.reset();
  document.getElementById("quickTaskDate").value = formatDateForInput(new Date());
  document.getElementById("quickTaskMinutes").value = "45";
  setQuickTaskScope(
    isLifeTaskType(normalizedType) ? "life" : "school",
    normalizedType
  );
  openModal("quickTaskModal");
  window.setTimeout(() => document.getElementById("quickTaskTitle")?.focus(), 50);
}

function initializeQuickTaskForm() {
  document.getElementById("quickTaskForm")?.addEventListener("submit", handleQuickTaskSubmit);
  document.getElementById("quickTaskCategory")?.addEventListener("change", (event) => {
    setQuickTaskScope("life", event.target.value);
  });
  document.getElementById("quickTaskDestination")?.addEventListener("change", () => {
    setQuickTaskScope("life", document.getElementById("quickTaskCategory").value);
  });
}

function setQuickTaskScope(scope, preferredType = "") {
  const life = scope === "life";
  const typeInput = document.getElementById("quickTaskType");
  const category = document.getElementById("quickTaskCategory");
  const subject = document.getElementById("quickTaskSubject");
  const destination = document.getElementById("quickTaskDestination");

  document.getElementById("quickTaskSubjectField").hidden = life;
  document.getElementById("quickTaskCategoryField").hidden = !life;

  if (life) {
    const nextType = isLifeTaskType(preferredType)
      ? preferredType
      : (category.value || "personal");
    category.value = nextType;
    typeInput.value = nextType;
    subject.value = "";
    const goal = nextType === "goal";
    const fixedPersonal = isFixedPersonalTaskType(nextType);
    if (goal) destination.value = "checklist";
    document.getElementById("quickTaskDestinationField").hidden = goal;
    document.getElementById("quickTaskDurationField").classList.toggle("full-field", !goal);
    document.getElementById("quickTaskPriorityField").hidden = true;
    document.getElementById("quickTaskPriority").value = "medium";
    document.getElementById("quickTaskDateLabel").textContent = goal ? "Data țintă" : "Ziua în care vrei să faci asta";
    document.getElementById("quickTaskDurationLabel").textContent = goal ? "Timp alocat" : "Durată";
    document.getElementById("quickTaskTime").required = fixedPersonal && destination.value === "event";
    document.getElementById("quickTaskTimeHint").textContent = fixedPersonal
      ? destination.value === "event"
        ? "Evenimentul va ocupa acest interval în Calendar."
        : "Opțional: las-o liberă și Itera alege automat un moment potrivit în ziua aleasă."
      : "Opțional: adaugă o oră doar dacă obiectivul are un moment precis.";
    document.getElementById("quickTaskTitle").placeholder = goal
      ? "Ex: Alerg primul meu 5K"
      : "Ex: Îmi fac unghiile";
    document.getElementById("quickTaskModalTitle").textContent = goal
      ? "Adaugă un obiectiv"
      : "Adaugă în program";
    document.getElementById("quickTaskHint").textContent = goal
      ? "Obiectivul va apărea în zona Personal și în Task-uri."
      : destination.value === "event"
        ? "Va apărea în Calendar ca interval personal."
        : destination.value === "task"
          ? "Va apărea în Task-uri cu opțiunea de timer."
          : "Va apărea în Task-uri și în planul zilei, gata de bifat.";
    document.getElementById("saveQuickTaskButton").textContent = goal
      ? "Adaugă obiectivul"
      : destination.value === "event"
        ? "Adaugă evenimentul"
        : "Adaugă taskul";
    return;
  }

  typeInput.value = preferredType === "test" ? "test" : "homework";
  destination.value = "checklist";
  document.getElementById("quickTaskDestinationField").hidden = true;
  document.getElementById("quickTaskDurationField").classList.remove("full-field");
  document.getElementById("quickTaskPriorityField").hidden = false;
  document.getElementById("quickTaskDateLabel").textContent = "Deadline";
  document.getElementById("quickTaskDurationLabel").textContent = "Durată estimată";
  document.getElementById("quickTaskTime").required = false;
  document.getElementById("quickTaskTimeHint").textContent =
    "Opțional: dacă o lași liberă, Itera alege ora după prioritate.";
  if (!subject.value && subjects[0]) subject.value = subjects[0].id;
  document.getElementById("quickTaskTitle").placeholder = "Ex: Exercițiile 1–10";
  document.getElementById("quickTaskModalTitle").textContent =
    typeInput.value === "test" ? "Adaugă un test" : "Adaugă o temă";
  document.getElementById("quickTaskHint").textContent =
    "După salvare apare imediat în Task-uri, Calendar și pagina materiei.";
  document.getElementById("saveQuickTaskButton").textContent =
    typeInput.value === "test" ? "Adaugă testul" : "Adaugă tema";
}

async function handleQuickTaskSubmit(event) {
  event.preventDefault();
  if (!currentUser) return;

  const saveButton = document.getElementById("saveQuickTaskButton");
  const title = document.getElementById("quickTaskTitle").value.trim();
  const taskType = document.getElementById("quickTaskType").value || "homework";
  const destination = isLifeTaskType(taskType)
    ? document.getElementById("quickTaskDestination").value
    : "task";
  const subjectId = isLifeTaskType(taskType)
    ? null
    : (document.getElementById("quickTaskSubject").value || null);
  const deadlineDate = document.getElementById("quickTaskDate").value;
  let deadlineTime = document.getElementById("quickTaskTime").value || null;
  const fixedPersonal = isFixedPersonalTaskType(taskType);
  const estimatedMinutes = Number(document.getElementById("quickTaskMinutes").value) || 45;
  const priority = isLifeTaskType(taskType)
    ? "medium"
    : document.getElementById("quickTaskPriority").value;

  if (fixedPersonal && destination === "event" && !deadlineTime) {
    showToast("Alege ora la care vrei să păstrăm acest interval în program.", "!");
    document.getElementById("quickTaskTime").focus();
    return;
  }

  if (deadlineTime && destination === "event") {
    const candidate = {
      ...normalizeInterval(deadlineTime, "", estimatedMinutes),
      title
    };
    const overlap = getDayIntervals(deadlineDate).find(
      (item) => candidate.start < item.end && candidate.end > item.start
    );
    if (
      overlap &&
      !window.confirm(
        `„${title}” se suprapune cu „${overlap.title}”. Vrei să îl adaugi totuși?`
      )
    ) {
      return;
    }
  }

  saveButton.disabled = true;
  saveButton.textContent = "Se salvează…";

  if (destination === "event" && isLifeTaskType(taskType) && taskType !== "goal") {
    const eventNotes = document.getElementById("quickTaskNotes").value.trim();
    const eventPayload = {
      user_id: currentUser.id,
      subject_id: null,
      title,
      event_type: taskType,
      event_date: deadlineDate,
      start_time: deadlineTime,
      end_time: formatClockMinutes(getMinutesFromTime(deadlineTime) + estimatedMinutes),
      notes: eventNotes || null
    };
    let { data, error } = await supabaseClient
      .from("calendar_events")
      .insert(eventPayload)
      .select("*")
      .single();

    if (error && taskType !== "personal" && (
      ["23514", "22P02"].includes(error.code) ||
      /event_type|constraint|invalid input/i.test(`${error.message || ""} ${error.details || ""}`)
    )) {
      ({ data, error } = await supabaseClient
        .from("calendar_events")
        .insert({
          ...eventPayload,
          event_type: "personal",
          notes: `${eventNotes} [itera:category=${taskType}]`.trim()
        })
        .select("*")
        .single());
    }

    saveButton.disabled = false;
    saveButton.textContent = "Adaugă evenimentul";
    if (error) {
      showToast("Evenimentul nu a putut fi salvat.", "!");
      return;
    }

    events.push(normalizeHomeEvent(data));
    events.sort(sortEvents);
    closeModal("quickTaskModal");
    renderAll();
    showToast("Evenimentul apare acum în Calendar.", "✓");
    return;
  }

  const rawNotes = document.getElementById("quickTaskNotes").value.trim();
  const personalMarkers = isLifeTaskType(taskType)
    ? [
        PERSONAL_TASK_ONLY_MARKER,
        destination === "checklist" ? PERSONAL_NO_TIMER_MARKER : "",
        taskType !== "personal" ? `[itera:category=${taskType}]` : ""
      ].filter(Boolean).join(" ")
    : "";
  const taskPayload = {
    user_id: currentUser.id,
    subject_id: subjectId,
    title,
    task_type: taskType,
    deadline_date: deadlineDate,
    deadline_time: deadlineTime,
    priority,
    estimated_minutes: estimatedMinutes,
    notes: `${rawNotes} ${personalMarkers}`.trim() || null,
    completed: false,
    progress: 0
  };
  let { data, error } = await supabaseClient
    .from("tasks")
    .insert(taskPayload)
    .select("*")
    .single();

  if (error && isLifeTaskType(taskType) && taskType !== "personal" && (
    ["23514", "22P02"].includes(error.code) ||
    /task_type|constraint|invalid input/i.test(`${error.message || ""} ${error.details || ""}`)
  )) {
    ({ data, error } = await supabaseClient
      .from("tasks")
      .insert({ ...taskPayload, task_type: "personal" })
      .select("*")
      .single());
  }

  saveButton.disabled = false;
  saveButton.textContent = taskType === "test"
    ? "Adaugă testul"
    : taskType === "goal"
      ? "Adaugă obiectivul"
    : isLifeTaskType(taskType)
      ? "Adaugă taskul"
      : "Adaugă tema";

  if (error) {
    showToast("Taskul nu a putut fi salvat.", "!");
    return;
  }

  tasks.unshift(normalizeHomeTask(data));
  closeModal("quickTaskModal");
  renderAll();
  window.dispatchEvent(new CustomEvent("itera:task-updated", {
    detail: { id: data.id, saved: true }
  }));
  showToast("Adăugat. Planul se actualizează acum.", "✓");
  const smartPlan = taskType !== "goal" && destination !== "event"
    ? await rebuildSmartTaskPlan()
    : null;
  const plannedEntry = smartPlan ? globalThis.IteraPlanning?.getTaskPlan(currentUser, data) : null;
  await globalThis.IteraPush?.scheduleTaskReminders(plannedEntry
    ? { ...data, deadline_date: plannedEntry.date, deadline_time: plannedEntry.time }
    : data);
  if (plannedEntry) await loadHomeData();
  renderAll();
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

function makeTimerId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const random = Math.random() * 16 | 0;
    return (character === "x" ? random : (random & 3 | 8)).toString(16);
  });
}

async function persistActiveTimer() {
  if (!currentUser) return;
  const state = focusTimerId ? {
    id: focusTimerId,
    mode: focusTimerMode,
    subjectId: focusSubjectId,
    subjectName: focusSubjectName,
    resumeSubjectId: focusResumeSubjectId,
    resumeSubjectName: focusResumeSubjectName,
    taskId: focusTaskId,
    taskTitle: focusTaskTitle,
    initialSeconds: focusInitialSeconds,
    remainingSeconds: focusSecondsRemaining,
    startedAt: focusStartedAt?.toISOString() || null,
    endsAt: focusEndsAt?.toISOString() || null,
    paused: focusPaused
  } : null;
  const { data, error } = await supabaseClient.auth.updateUser({ data: { itera_active_timer: state } });
  if (!error && data?.user) currentUser = data.user;
}

async function syncTimerReminder() {
  if (!focusTimerId || !focusEndsAt || focusPaused) return;
  await globalThis.IteraPush?.cancelTimerReminders(focusTimerId);
  const endClock = focusEndsAt.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  const isBreak = focusTimerMode === "break";
  void globalThis.IteraPush?.showTimerStatus({
    title: isBreak ? "Pauză în desfășurare" : `Focus · ${focusSubjectName}`,
    body: `${isBreak ? "Revii" : "Sesiunea se încheie"} la ${endClock}. Itera păstrează timpul exact.`
  });
  void globalThis.IteraPush?.queueReminder({
    title: isBreak ? "Pauza s-a terminat" : "Sesiunea s-a încheiat",
    body: isBreak ? "E timpul să revii. Alegem împreună următorul pas." : "Continui studiul sau iei o pauză?",
    scheduledFor: focusEndsAt,
    targetUrl: "./index.html#/",
    tag: "itera-active-timer",
    notificationType: isBreak ? "break-finished" : "focus-finished",
    sourceId: focusTimerId,
    dedupeKey: `${isBreak ? "break" : "focus"}-finished-${focusTimerId}`
  });
}

function runFocusClock() {
  clearInterval(focusTimerInterval);
  const tick = () => {
    if (focusPaused || !focusEndsAt || focusFinishInProgress) return;
    focusSecondsRemaining = Math.max(0, Math.ceil((focusEndsAt.getTime() - Date.now()) / 1000));
    updateFocusTimerDisplay();
    if (focusSecondsRemaining <= 0) finishFocusSession({ reason: "elapsed" });
  };
  tick();
  focusTimerInterval = setInterval(tick, 500);
}

function startActiveTimer({ mode = "focus", seconds, subjectName, subjectId = null, task = null }) {
  clearInterval(focusTimerInterval);
  focusTimerMode = mode;
  focusInitialSeconds = Math.max(1, Number(seconds) || 1);
  focusSecondsRemaining = focusInitialSeconds;
  focusPaused = false;
  focusStartedAt = new Date();
  focusEndsAt = new Date(Date.now() + focusInitialSeconds * 1000);
  focusTimerId = makeTimerId();
  focusSubjectId = subjectId;
  focusSubjectName = subjectName || (mode === "break" ? "Pauză" : "Focus");
  if (mode === "focus") {
    focusResumeSubjectId = focusSubjectId;
    focusResumeSubjectName = focusSubjectName;
  }
  focusTaskId = task?.id || null;
  focusTaskTitle = task?.title || null;
  focusTaskSnapshot = task ? { ...task } : null;
  focusSessionSaved = mode === "break";
  focusFinishInProgress = false;
  document.getElementById("floatingTimerType").textContent = mode === "break" ? "Pauză" : "Sesiune focus";
  showFloatingTimer(focusSubjectName, mode === "break" ? "Respiră, bea apă și revino." : (focusTaskTitle || "Studiu individual"));
  updateFocusTimerDisplay();
  runFocusClock();
  void persistActiveTimer();
  void syncTimerReminder();
}

function startFocusSession() {
  const subject = document.getElementById(
    "focusSubject"
  ).value;

  const duration = Number(
    document.getElementById("focusDuration").value
  );

  const matchingTask = recommendedTask?.subject === subject ? recommendedTask : null;
  startActiveTimer({
    mode: "focus",
    seconds: duration * 60,
    subjectName: subject,
    subjectId: subjects.find((item) => item.name === subject)?.id || null,
    task: matchingTask
  });
  void playFocusCue("start");
  if (activeSoundscape !== "none") void setFocusSoundscape(activeSoundscape);
}

function startRecommendedFocusSession() {
  if (recommendedNavigation) {
    openPage(recommendedNavigation);
    return;
  }

  if (recommendedTask && isLifeTaskType(recommendedTask.task_type || recommendedTask.type)) {
    startTaskFocus(recommendedTask, null);
    return;
  }

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
  focusEndsAt = focusPaused ? null : new Date(Date.now() + focusSecondsRemaining * 1000);
  void playFocusCue(focusPaused ? "pause" : "resume");

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
  if (focusAudioGain) {
    focusAudioGain.gain.setTargetAtTime(
      focusPaused ? 0 : getSoundscapeSettings(activeSoundscape).volume,
      focusAudioContext.currentTime,
      0.08
    );
  }
  emitFocusTimerState();
  if (focusPaused) void globalThis.IteraPush?.cancelTimerReminders(focusTimerId);
  else void syncTimerReminder();
  void persistActiveTimer();
}

function resetFocusSession() {
  focusSecondsRemaining = focusInitialSeconds;
  focusPaused = true;
  focusEndsAt = null;
  void globalThis.IteraPush?.cancelTimerReminders(focusTimerId);
  void persistActiveTimer();

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

  const timerText = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  document.getElementById("floatingTimerValue").textContent = timerText;
  document.getElementById("focusIslandValue").textContent = timerText;
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

async function finishFocusSession({ reason = "manual" } = {}) {
  if (focusFinishInProgress) return;
  focusFinishInProgress = true;
  clearInterval(focusTimerInterval);
  focusPaused = true;
  focusEndsAt = null;
  void globalThis.IteraPush?.cancelTimerReminders(focusTimerId);
  stopFocusSoundscape();
  void playFocusCue(reason === "elapsed" ? (focusTimerMode === "break" ? "breakComplete" : "complete") : "stop");

  if (focusTimerMode === "break") {
    focusFinishInProgress = false;
    focusTimerId = null;
    await persistActiveTimer();
    if (reason === "elapsed") openFocusNextStep({ afterBreak: true });
    else closeFocusFlow();
    return;
  }

  if (focusTaskId) {
    document.getElementById("taskCompletionTitle").textContent =
      `„${focusTaskTitle}” — spune-ne dacă ai terminat.`;
    document.getElementById("taskResumeOptions").hidden = true;
    openModal("taskCompletionModal");
    focusFinishInProgress = false;
    return;
  }

  const studiedMinutes = await saveCurrentFocusSession();
  if (!studiedMinutes) {
    focusFinishInProgress = false;
    return;
  }

  const floatingTimer = document.getElementById("floatingTimer");
  floatingTimer.classList.remove("visible");
  floatingTimer.setAttribute("aria-hidden", "true");
  stopFocusSoundscape();

  showToast(`Sesiunea de ${studiedMinutes} min a fost salvată.`, "✓");
  emitFocusTimerState();
  await loadHomeData();
  renderAll();
  window.dispatchEvent(new CustomEvent("itera:study-session-saved", {
    detail: { subjectId: focusSubjectId, minutes: studiedMinutes }
  }));
  focusTimerId = null;
  await persistActiveTimer();
  focusFinishInProgress = false;
  if (reason === "elapsed") openFocusNextStep();
  else closeFocusFlow();
}

function openFocusNextStep({ afterBreak = false } = {}) {
  nextTimerMode = "focus";
  document.querySelectorAll("[data-next-timer-mode]").forEach(button => {
    button.classList.toggle("active", button.dataset.nextTimerMode === "focus");
  });
  document.getElementById("focusNextStepKicker").textContent = afterBreak ? "Pauză încheiată" : "Sesiune încheiată";
  document.getElementById("focusNextStepTitle").textContent = afterBreak ? "Ești gata să revii?" : "Cum vrei să continui?";
  document.getElementById("focusNextStepDescription").textContent = afterBreak
    ? "Alege cât timp vrei pentru următoarea sesiune."
    : "Continuă cât mai ai energie sau ia o pauză care chiar te ajută.";
  document.getElementById("focusNextDuration").value = afterBreak ? "25" : "45";
  openModal("focusNextStepModal");
}

function closeFocusFlow() {
  closeModal("focusNextStepModal");
  const timer = document.getElementById("floatingTimer");
  timer.classList.remove("visible");
  timer.setAttribute("aria-hidden", "true");
  const previousTimerId = focusTimerId;
  focusTimerId = null;
  focusEndsAt = null;
  focusTimerMode = "focus";
  void globalThis.IteraPush?.cancelTimerReminders(previousTimerId);
  void persistActiveTimer();
  emitFocusTimerState();
}

function startBreakTimer(minutes) {
  const resumeSubjectId = focusResumeSubjectId || focusSubjectId;
  const resumeSubjectName = focusResumeSubjectName || focusSubjectName;
  startActiveTimer({
    mode: "break",
    seconds: Math.max(1, Number(minutes) || 5) * 60,
    subjectName: "Pauză"
  });
  focusResumeSubjectId = resumeSubjectId;
  focusResumeSubjectName = resumeSubjectName;
  void persistActiveTimer();
  void playFocusCue("breakStart");
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

async function saveDailyEnergy(level, previousLevel, period = getEnergyPromptPeriod()) {
  if (!currentUser) return;
  const requestVersion = ++energySaveVersion;
  const today = formatDateForInput(new Date());
  const existingCheckins = currentUser.user_metadata?.itera_energy_checkins || {};
  const todayCheckins = existingCheckins[today] || {};
  const nextCheckins = Object.fromEntries(
    Object.entries({
      ...existingCheckins,
      [today]: {
        ...todayCheckins,
        ...(period ? { [period]: { level, at: new Date().toISOString() } } : {})
      }
    }).sort(([first], [second]) => second.localeCompare(first)).slice(0, 14)
  );
  const nextMetadata = {
    ...(currentUser.user_metadata || {}),
    itera_energy_level: level,
    itera_energy_date: today,
    itera_energy_checkins: nextCheckins
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
  const replanned = await rebuildSmartTaskPlan();
  if (replanned) {
    await loadHomeData();
    renderAll();
  }
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

function getEnergyPromptPeriod(date = new Date()) {
  const minutesNow = date.getHours() * 60 + date.getMinutes();
  if (minutesNow >= 6 * 60 && minutesNow < 12 * 60) return "morning";
  const daySchedule = scheduleItems.filter(item => Number(item.day_of_week) === date.getDay());
  const schoolEnd = daySchedule.reduce((latest, item) => {
    const value = String(item.end_time || item.start_time || "").slice(0, 5);
    if (!value) return latest;
    const [hours, minutes] = value.split(":").map(Number);
    return Math.max(latest, hours * 60 + minutes);
  }, 0);
  const afternoonStart = schoolEnd ? schoolEnd + 15 : 14 * 60;
  return minutesNow >= afternoonStart && minutesNow < 21 * 60 ? "afternoon" : null;
}

function initializeEnergyPrompt() {
  const modal = document.getElementById("energyPromptModal");
  if (!modal) return;
  modal.querySelectorAll("[data-prompt-energy]").forEach(button => {
    button.addEventListener("click", async () => {
      const previousLevel = currentEnergy;
      currentEnergy = Number(button.dataset.promptEnergy);
      currentEnergyDate = formatDateForInput(new Date());
      syncEnergyCheckinUI();
      closeModal("energyPromptModal");
      await saveDailyEnergy(currentEnergy, previousLevel, getEnergyPromptPeriod());
      showToast("Am ajustat ritmul zilei după energia ta.", "✓");
    });
  });
  document.getElementById("energyPromptLater")?.addEventListener("click", () => {
    energyPromptDismissedUntil = Date.now() + 60 * 60000;
    closeModal("energyPromptModal");
  });
}

function maybePromptEnergy() {
  if (!currentUser || Date.now() < energyPromptDismissedUntil) return;
  const period = getEnergyPromptPeriod();
  if (!period) return;
  const today = formatDateForInput(new Date());
  const checkins = currentUser.user_metadata?.itera_energy_checkins?.[today] || {};
  if (checkins[period]) return;
  const modal = document.getElementById("energyPromptModal");
  if (!modal || modal.classList.contains("visible")) return;
  if (document.querySelector(".modal-overlay.visible")) return;
  const afternoon = period === "afternoon";
  document.getElementById("energyPromptKicker").textContent = afternoon
    ? "După program"
    : "Startul zilei";
  document.getElementById("energyPromptTitle").textContent = afternoon
    ? "Cum mai este energia ta?"
    : "Cu ce energie începi azi?";
  document.getElementById("energyPromptDescription").textContent = afternoon
    ? "Reașez taskurile rămase fără să îți stric seara."
    : "Îți construiesc un ritm realist pentru ziua de azi.";
  openModal("energyPromptModal");
}

function getRecommendedSessionMinutes() {
  if (currentEnergy <= 2) return 25;
  if (currentEnergy === 3) return 45;
  return 60;
}

function renderNowRecommendation() {
  const todayString = formatDateForInput(new Date());
  const today = parseLocalDate(todayString);
  const openTasks = tasks
    .filter((task) => {
      if (task.completed) return false;
      const personal = isLifeTaskType(task.task_type || task.type);
      return (!personal || task.calendarHidden) && getTaskPlanDate(task) <= todayString;
    })
    .map((task) => {
      const deadline = task.deadline ? parseLocalDate(task.deadline) : null;
      const daysUntil = deadline ? Math.round((deadline - today) / 86400000) : 30;
      const priorityScore = { high: 40, medium: 20, low: 5 }[task.priority] || 10;
      const difficultyScore = { hard: 12, medium: 7, easy: 2 }[task.difficulty] || 5;
      return {
        ...task,
        daysUntil,
        recommendationScore: priorityScore + difficultyScore + Math.max(0, 35 - daysUntil * 7) +
          (daysUntil < 0 ? 120 : 0) - (isLifeTaskType(task.task_type || task.type) && daysUntil >= 0 ? 35 : 0)
      };
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore);

  recommendedTask = openTasks[0] || null;
  const title = document.getElementById("nowRecommendationTitle");
  const reason = document.getElementById("nowRecommendationReason");
  const actionButton = document.getElementById("startRecommendedSession");
  const energyMessage = document.getElementById("energyRecommendation");
  const minutes = getRecommendedSessionMinutes();
  recommendedNavigation = null;

  const energyLabels = {
    1: "Astăzi păstrăm planul foarte ușor.",
    2: "Îți recomandăm sesiuni scurte și o pauză generoasă.",
    3: "Plan echilibrat pentru astăzi.",
    4: "Ai energie pentru o sesiune mai consistentă.",
    5: "Energie bună — folosim momentul fără să exagerăm."
  };
  energyMessage.textContent = energyLabels[currentEnergy];

  if (!recommendedTask) {
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const nextPersonalEvent = getAllCalendarItems()
      .filter((item) =>
        item.date === todayString &&
        item.time &&
        getMinutesFromTime(item.time) >= nowMinutes &&
        isLifeTaskType(item.type) &&
        !item.completed
      )
      .sort(sortEvents)[0];
    if (nextPersonalEvent) {
      title.textContent = `La ${nextPersonalEvent.time} ai „${nextPersonalEvent.title}”.`;
      reason.textContent = "Este un eveniment cu oră fixă, deci nu pornește o sesiune de focus.";
      actionButton.textContent = "Vezi în calendar";
      recommendedNavigation = "calendar";
      return;
    }
    title.textContent = "Ai terminat tot ce era planificat pentru azi.";
    reason.textContent = "Planul este închis. Poți lua pauza fără să te gândești la ce ai uitat.";
    actionButton.textContent = "Vezi taskurile";
    recommendedNavigation = "tasks";
    return;
  }

  actionButton.textContent = isLifeTaskType(recommendedTask.task_type || recommendedTask.type)
    ? "Începe taskul"
    : "Pornește sesiunea";

  const subject = recommendedTask.subject || subjectName(recommendedTask.subject_id);
  const finishTime = new Date(Date.now() + minutes * 60000).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit"
  });
  const personalTask = isLifeTaskType(recommendedTask.task_type || recommendedTask.type);
  const overdueTask = recommendedTask.daysUntil < 0;
  const checklistTask = Boolean(recommendedTask.noTimer);
  const plannedTime = getTaskPlanTime(recommendedTask);
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const plannedMinutes = plannedTime ? getMinutesFromTime(plannedTime) : null;
  const shouldStartNow = plannedMinutes !== null && nowMinutes >= plannedMinutes;
  title.textContent = overdueTask
    ? `Este restant: „${recommendedTask.title}”. Îl închidem acum.`
    : shouldStartNow
    ? `Acum este momentul pentru „${recommendedTask.title}”.`
    : personalTask
      ? `Îți recomand să începi cu „${recommendedTask.title}”.`
      : subject
        ? `Îți recomand să începi cu ${subject.toLowerCase()}.`
        : `Îți recomand să începi cu „${recommendedTask.title}”.`;
  const urgency = recommendedTask.daysUntil <= 0
    ? "are termen astăzi"
    : recommendedTask.daysUntil === 1
      ? "este pentru mâine"
      : `are termen peste ${recommendedTask.daysUntil} zile`;
  reason.textContent = overdueTask
    ? "Nu îl mai mutăm încă o dată. Începe cu primul pas mic și termină-l înainte de următorul lucru."
    : shouldStartNow
    ? `Era planificat la ${plannedTime}. Începe doar primele 5 minute — Itera ține ritmul de acolo.`
    : `„${recommendedTask.title}” ${urgency}. Dacă începi acum, termini înainte de ${finishTime}.`;
  if (overdueTask || shouldStartNow) actionButton.textContent = checklistTask ? "Deschide și bifează" : "Încep acum";
  if (checklistTask) recommendedNavigation = "tasks";
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

function getEnergyCapacity() {
  return { 1: 45, 2: 90, 3: 150, 4: 210, 5: 270 }[currentEnergy] || 150;
}

function normalizeInterval(start, end, fallbackDuration = 60) {
  const startMinutes = getMinutesFromTime(start);
  const explicitEnd = end ? getMinutesFromTime(end) : startMinutes + fallbackDuration;
  return {
    start: startMinutes,
    end: Math.max(startMinutes + 5, explicitEnd)
  };
}

function getDayIntervals(dateString, options = {}) {
  const date = parseLocalDate(dateString);
  const dayOfWeek = date.getDay();
  const includeTasks = options.includeTasks !== false;
  const intervals = [];

  scheduleItems
    .filter((item) => Number(item.day_of_week) === dayOfWeek && item.start_time)
    .forEach((item) => {
      intervals.push({
        ...normalizeInterval(item.start_time, item.end_time),
        id: item.id,
        kind: "schedule",
        title: item.title,
        time: String(item.start_time).slice(0, 5)
      });
    });

  events
    .filter((event) => event.date === dateString && event.time)
    .forEach((event) => {
      intervals.push({
        ...normalizeInterval(event.time, event.endTime, 60),
        id: event.id,
        kind: "event",
        title: event.title,
        time: event.time
      });
    });

  if (includeTasks) {
    tasks
      .filter((task) => !task.completed && getTaskPlanDate(task) === dateString && getTaskPlanTime(task))
      .forEach((task) => {
        intervals.push({
          ...normalizeInterval(getTaskPlanTime(task), "", getTaskMinutes(task)),
          id: task.id,
          kind: "task",
          title: task.title,
          time: getTaskPlanTime(task)
        });
      });
  }

  return intervals.sort((first, second) => first.start - second.start || first.end - second.end);
}

function mergeIntervals(intervals) {
  return intervals.reduce((merged, interval) => {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push({ start: interval.start, end: interval.end });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
    return merged;
  }, []);
}

function getScheduleConflicts(dateString) {
  const intervals = getDayIntervals(dateString);
  const conflicts = [];

  intervals.forEach((first, index) => {
    intervals.slice(index + 1).forEach((second) => {
      if (second.start >= first.end) return;
      if (first.id === second.id && first.kind === second.kind) return;
      conflicts.push({
        first,
        second,
        start: formatClockMinutes(Math.max(first.start, second.start)),
        end: formatClockMinutes(Math.min(first.end, second.end))
      });
    });
  });

  return conflicts;
}

function findAvailableSlot(cursor, duration, busyIntervals, dayEnd) {
  let candidate = cursor;
  for (const interval of busyIntervals) {
    if (interval.end <= candidate) continue;
    if (candidate + duration <= interval.start) {
      return candidate;
    }
    candidate = roundToQuarter(interval.end + 10);
  }
  return candidate + duration <= dayEnd ? candidate : null;
}

function getAvailableStudyMinutes(dateString = formatDateForInput(new Date())) {
  const isToday = dateString === formatDateForInput(new Date());
  const start = isToday
    ? roundToQuarter(new Date().getHours() * 60 + new Date().getMinutes() + 10)
    : 8 * 60;
  const end = 22 * 60 + 30;
  const busy = mergeIntervals(getDayIntervals(dateString, { includeTasks: false }));
  let cursor = start;
  let free = 0;

  busy.forEach((interval) => {
    if (interval.end <= cursor || interval.start >= end) return;
    free += Math.max(0, Math.min(interval.start, end) - cursor);
    cursor = Math.max(cursor, Math.min(interval.end + 10, end));
  });
  free += Math.max(0, end - cursor);
  return Math.max(0, Math.min(free, getEnergyCapacity()));
}

function buildDayPlan() {
  const today = formatDateForInput(new Date());
  const dayTasks = tasks
    .filter((task) => !task.completed && task.deadline && task.deadline <= today)
    .sort(sortTasksForPlan);
  const energyCapacity = getEnergyCapacity();
  const currentDate = new Date();
  let cursor = roundToQuarter(currentDate.getHours() * 60 + currentDate.getMinutes() + 10);
  const dayEnd = 22 * 60 + 30;
  const busyIntervals = mergeIntervals(getDayIntervals(today, { includeTasks: false }));
  const plan = [];
  let plannedMinutes = 0;
  const unscheduled = [];

  for (const task of dayTasks) {
    const duration = getTaskMinutes(task);
    if (plannedMinutes + duration > energyCapacity) {
      unscheduled.push(task);
      continue;
    }
    const slot = findAvailableSlot(cursor, duration, busyIntervals, dayEnd);
    if (slot === null) {
      unscheduled.push(task);
      continue;
    }
    plan.push({
      task,
      start: formatClockMinutes(slot),
      end: formatClockMinutes(slot + duration),
      duration
    });
    plannedMinutes += duration;
    busyIntervals.push({ start: slot, end: slot + duration });
    busyIntervals.sort((first, second) => first.start - second.start);
    cursor = roundToQuarter(slot + duration + (isCareTask(task) ? 0 : 10));
  }

  return {
    entries: plan,
    totalTasks: dayTasks.length,
    plannedMinutes,
    unscheduled,
    availableMinutes: getAvailableStudyMinutes(today)
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
      `Am găsit intervale libere pentru ${plan.entries.length} din ${plan.totalTasks} ${plan.totalTasks === 1 ? "task" : "task-uri"} · ${formatMinutes(plan.plannedMinutes)} în ritmul energiei ${currentEnergy}/5.${plan.unscheduled.length ? ` ${plan.unscheduled.length} rămân pentru reprogramare.` : ""}`;
    list.innerHTML = plan.entries.map((entry, index) => `
      ${index && !isCareTask(plan.entries[index - 1].task) ? '<div class="day-plan-break"><span></span>Pauză scurtă</div>' : ""}
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
  document.getElementById("briefPlanDayButton")?.addEventListener("click", async (event) => {
    const saved = await saveMorningTaskList(event.currentTarget);
    if (!saved) return;
    markMorningBriefSeen();
    closeModal("morningBriefModal");
    if (getRecoveryCandidates().length >= 3) {
      document.getElementById("openRecoveryButton")?.click();
    } else {
      openDayPlanner();
    }
  });
  document.getElementById("applyDayPlanButton")?.addEventListener("click", async (event) => {
    if (!pendingDayPlan.length || !currentUser) return;
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = "Aplic planul…";
    const today = formatDateForInput(new Date());
    const saved = await saveTaskPlanEntries(
      pendingDayPlan.map((entry) => ({ task: entry.task, date: today, time: entry.start }))
    );
    event.currentTarget.disabled = false;
    event.currentTarget.textContent = "Aplică planul";

    if (!saved) {
      showToast("O parte din plan nu a putut fi salvată.", "!");
      return;
    }

    await loadHomeData();
    closeModal("dayPlanModal");
    renderAll();
    showToast("Planul zilei apare acum în timeline și calendar.", "✓");
  });
}

function parseMorningTaskLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:[-–—]\s*)?)?(.+)$/);
  if (!match) return null;
  const title = String(match[3] || "").trim();
  if (!title) return null;
  const plain = normalizeSearchText(title);
  const subjectAliases = {
    matematica: ["mate", "matematica"],
    informatica: ["info", "informatica"],
    "limba romana": ["romana", "limba romana"],
    engleza: ["engleza", "english"],
    franceza: ["franceza", "france"],
    fizica: ["fizica"],
    chimie: ["chimie"],
    biologie: ["bio", "biologie"],
    istorie: ["istorie"],
    geografie: ["geografie", "geo"]
  };
  const subject = subjects.find(item => {
    const normalizedName = normalizeSearchText(item.name);
    const aliases = subjectAliases[normalizedName] || [normalizedName, normalizedName.slice(0, 4)];
    return aliases.some(alias => alias.length >= 3 && new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`).test(plain));
  });
  const inferredLifeType = inferLifeTaskType(title);
  const personal = !subject;
  return {
    user_id: currentUser.id,
    subject_id: subject?.id || null,
    title,
    task_type: subject ? "homework" : (inferredLifeType || "personal"),
    deadline_date: formatDateForInput(new Date()),
    deadline_time: match[1] ? `${String(match[1]).padStart(2, "0")}:${match[2]}` : null,
    priority: "medium",
    estimated_minutes: subject ? 45 : 30,
    notes: personal ? `[itera:task-only] [itera:no-timer]${inferredLifeType ? ` [itera:category=${inferredLifeType}]` : ""}` : null
  };
}

async function saveMorningTaskList(button) {
  const textarea = document.getElementById("morningTaskCapture");
  const status = document.getElementById("morningTaskStatus");
  const payloads = String(textarea?.value || "").split(/\r?\n/).map(parseMorningTaskLine).filter(Boolean);
  if (!payloads.length) return true;
  button.disabled = true;
  button.textContent = "Adaug…";
  const { data, error } = await supabaseClient.from("tasks").insert(payloads).select("*");
  button.disabled = false;
  button.textContent = "Adaugă și planifică";
  if (error) {
    status.textContent = "Lista nu a putut fi salvată. Încearcă din nou.";
    return false;
  }
  tasks = [...(data || []).map(normalizeHomeTask), ...tasks];
  textarea.value = "";
  status.textContent = `${payloads.length} ${payloads.length === 1 ? "task adăugat" : "task-uri adăugate"}.`;
  renderAll();
  await rebuildSmartTaskPlan();
  await loadHomeData({ force: true });
  renderAll();
  window.dispatchEvent(new CustomEvent("itera:task-updated"));
  return true;
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
  if (new Date().getHours() >= 12) return;
  if (currentUser?.user_metadata?.itera_brief_seen_date === today) return;

  const todayTasks = tasks.filter(
    (task) => isActionableTask(task) && !task.completed && getTaskPlanDate(task) === today
  );
  const todayClasses = scheduleItems.filter(
    (item) => Number(item.day_of_week) === new Date().getDay()
  );
  const studyMinutes = todayTasks.reduce((sum, task) => sum + getTaskMinutes(task), 0);
  const displayName =
    profile?.first_name ||
    currentUser?.user_metadata?.first_name ||
    "Itera";
  const isWeekend = [0, 6].includes(new Date().getDay());
  const overdue = tasks.filter(
    (task) => isActionableTask(task) && !task.completed && task.deadline && task.deadline < today
  );
  const upcomingExam = getAllCalendarItems()
    .filter((item) => item.date >= today && /bac|examen|simulare|admitere|cambridge|delf|permis/i.test(`${item.title} ${item.notes || ""}`))
    .sort(sortEvents)[0];
  const nextClass = todayClasses
    .filter((item) => String(item.start_time || "").slice(0, 5) >= new Date().toTimeString().slice(0, 5))
    .sort((first, second) => String(first.start_time).localeCompare(String(second.start_time)))[0];

  document.getElementById("morningBriefTitle").textContent =
    getGreetingTitle(displayName, new Date());
  document.getElementById("morningBriefSummary").textContent =
    overdue.length >= 3
      ? `Ai ${overdue.length} lucruri rămase. Recovery Mode poate păstra doar două priorități și muta restul realist.`
      : isWeekend && !todayTasks.length
      ? "Un weekend în ritmul tău. Nu ai nimic urgent planificat."
      : nextClass
      ? `Următoarea oră este ${nextClass.title}, la ${String(nextClass.start_time).slice(0, 5)}. După program ai aproximativ ${formatMinutes(studyMinutes)} planificate.`
      : todayTasks.length
      ? `Ai ${todayTasks.length} ${todayTasks.length === 1 ? "task" : "task-uri"} și aproximativ ${formatMinutes(studyMinutes)} de studiu.`
      : upcomingExam
      ? `Ziua este aerisită. Următorul obiectiv important este „${upcomingExam.title}”, pe ${formatReadableDate(upcomingExam.date)}.`
      : "Nu ai nimic urgent planificat pentru astăzi.";
  document.getElementById("morningBriefMetrics").innerHTML = `
    <div><strong>${todayClasses.length}</strong><span>ore</span></div>
    <div><strong>${todayTasks.length}</strong><span>task-uri</span></div>
    <div><strong>${currentEnergy}/5</strong><span>energie</span></div>
  `;
  document.getElementById("briefPlanDayButton").textContent = overdue.length >= 3
    ? "Simplifică planul"
    : "Planifică ziua";

  document
    .querySelectorAll('[data-close-modal="morningBriefModal"]')
    .forEach((button) => button.addEventListener("click", markMorningBriefSeen, { once: true }));
  window.setTimeout(() => {
    if (!document.querySelector(".modal-overlay.visible")) openModal("morningBriefModal");
  }, 1150);
}

function getTomorrowDate(offset = 1) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return formatDateForInput(date);
}

function getTomorrowTasks() {
  const tomorrow = getTomorrowDate();
  return tasks.filter((task) => !task.completed && getTaskPlanDate(task) === tomorrow);
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
  const openTasks = tasks.filter((task) => isActionableTask(task) && !task.completed);
  const overdueTasks = openTasks.filter((task) => task.deadline && task.deadline < today);
  const todayTasks = openTasks.filter((task) => getTaskPlanDate(task) === today).sort(sortTasksForPlan);
  const tomorrowTasks = openTasks.filter((task) => getTaskPlanDate(task) === tomorrow).sort(sortTasksForPlan);
  const todayMinutes = todayTasks.reduce((sum, task) => sum + getTaskMinutes(task), 0);
  const tomorrowMinutes = tomorrowTasks.reduce((sum, task) => sum + getTaskMinutes(task), 0);
  const energyCapacity = getEnergyCapacity();
  const tomorrowCapacity = getAvailableStudyMinutes(tomorrow);
  const tomorrowClasses = scheduleItems.filter(
    (item) => Number(item.day_of_week) === parseLocalDate(tomorrow).getDay()
  ).length;
  const todayConflicts = getScheduleConflicts(today);
  const tomorrowConflicts = getScheduleConflicts(tomorrow);
  const insights = [];

  if (todayConflicts.length) {
    const conflict = todayConflicts[0];
    insights.push(
      `Astăzi „${conflict.first.title}” și „${conflict.second.title}” se suprapun între ${conflict.start} și ${conflict.end}.`
    );
  } else if (tomorrowConflicts.length) {
    const conflict = tomorrowConflicts[0];
    insights.push(
      `Mâine „${conflict.first.title}” și „${conflict.second.title}” se suprapun între ${conflict.start} și ${conflict.end}.`
    );
  }

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
      `Mâine ai ${tomorrowTasks.length} ${tomorrowTasks.length === 1 ? "task" : "task-uri"}, ${formatMinutes(tomorrowMinutes)} în total și aproximativ ${formatMinutes(tomorrowCapacity)} disponibile${tomorrowClasses ? `, după ${tomorrowClasses} ore din program` : ""}.`
    );
  } else {
    insights.push("Mâine nu ai task-uri planificate.");
  }

  const tomorrowIsHeavy =
    tomorrowTasks.length >= 4 ||
    tomorrowMinutes > tomorrowCapacity ||
    (tomorrowClasses >= 5 && tomorrowMinutes > 120);
  let action = null;

  if (tomorrowIsHeavy) {
    const movable = tomorrowTasks
      .filter((task) => task.type !== "test" && task.priority !== "high" && !isLifeTaskType(task.type || task.task_type))
      .sort((a, b) => getTaskMinutes(b) - getTaskMinutes(a))
      .slice(0, 2);
    const candidateDays = [2, 3, 4, 5, 6].map((offset) => {
      const date = getTomorrowDate(offset);
      const dayTasks = openTasks.filter((task) => getTaskPlanDate(task) === date);
      return {
        date,
        count: dayTasks.length,
        minutes: dayTasks.reduce((sum, task) => sum + getTaskMinutes(task), 0),
        capacity: getAvailableStudyMinutes(date)
      };
    }).map((day) => ({
      ...day,
      loadRatio: day.minutes / Math.max(30, day.capacity)
    })).sort((a, b) => a.loadRatio - b.loadRatio || a.minutes - b.minutes || a.count - b.count);
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
  const headline = todayConflicts.length || tomorrowConflicts.length
    ? "Am găsit un conflict în program."
    : action
    ? "Am găsit o zi care merită echilibrată."
    : nextTask
      ? "Planul tău are un următor pas clar."
      : "Programul tău este aerisit.";
  const summary = action
    ? "Am ales doar task-uri care nu sunt teste și nu au prioritate ridicată."
    : nextTask
      ? `Următorul pas recomandat este „${nextTask.title}”.`
      : "Nu este nevoie să mutăm nimic acum.";
  const firstDetectedConflict = todayConflicts[0] || tomorrowConflicts[0];
  const preview = firstDetectedConflict
    ? `Am găsit o suprapunere: „${firstDetectedConflict.first.title}” și „${firstDetectedConflict.second.title}”, între ${firstDetectedConflict.start} și ${firstDetectedConflict.end}.`
    : action
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
    const movingIds = new Set(taskIds.map(String));
    const targetTasks = taskIds
      .map((id) => tasks.find((task) => String(task.id) === String(id)))
      .filter(Boolean);
    const date = parseLocalDate(targetDate);
    const weekend = [0, 6].includes(date.getDay());
    const fixed = getDayIntervals(targetDate).filter((item) => !movingIds.has(String(item.id)));
    const busy = mergeIntervals(fixed);
    const scheduleEnd = fixed
      .filter((item) => item.kind === "schedule")
      .reduce((latest, item) => Math.max(latest, item.end), 0);
    let cursor = weekend
      ? 8 * 60 + 30
      : Math.max(15 * 60 + 30, scheduleEnd ? scheduleEnd + 45 : 0);
    const entries = [];
    targetTasks.forEach((task) => {
      const slot = findAvailableSlot(cursor, getTaskMinutes(task), busy, 22 * 60 + 30);
      if (slot === null) return;
      entries.push({ task, date: targetDate, time: formatClockMinutes(slot) });
      busy.push({ start: slot, end: slot + getTaskMinutes(task) + 15 });
      busy.sort((first, second) => first.start - second.start);
      cursor = roundToQuarter(slot + getTaskMinutes(task) + 15);
    });
    const saved = entries.length === targetTasks.length && await saveTaskPlanEntries(entries);
    event.currentTarget.disabled = false;
    event.currentTarget.textContent = originalLabel;

    if (!saved) {
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

async function renderWeeklyReview(targetId = "weeklyReviewPanel") {
  const panel = document.getElementById(targetId);
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

function initializeWeeklyReplay() {
  document.getElementById("openWeeklyReplayButton")?.addEventListener("click", () => {
    openModal("weeklyReplayModal");
    void renderWeeklyReview("weeklyReplayContent");
  });
}

function getExamPlans() {
  return Array.isArray(currentUser?.user_metadata?.itera_exam_plans)
    ? currentUser.user_metadata.itera_exam_plans
    : [];
}

function renderExamSubjectOptions() {
  const container = document.getElementById("examSubjectOptions");
  if (!container) return;
  container.innerHTML = subjects.map((subject, index) => `
    <label><input type="checkbox" value="${subject.id}" ${index < 2 ? "checked" : ""}><span>${escapeHtml(subject.name)}</span></label>
  `).join("");
}

function getExamFormValues() {
  return {
    name: document.getElementById("examName").value.trim(),
    date: document.getElementById("examDate").value,
    sessionsPerWeek: Number(document.getElementById("examSessionsPerWeek").value || 4),
    subjectIds: [...document.querySelectorAll("#examSubjectOptions input:checked")].map((input) => input.value)
  };
}

function buildExamSessions(plan) {
  if (!plan.date || !plan.subjectIds.length) return [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const examDate = parseLocalDate(plan.date);
  const daysUntil = Math.max(0, Math.ceil((examDate - start) / 86400000));
  const horizon = Math.min(14, Math.max(0, daysUntil - 1));
  const count = Math.min(horizon, Math.max(1, Math.ceil(horizon * plan.sessionsPerWeek / 7)));
  if (!count) return [];
  const step = horizon / count;
  return Array.from({ length: count }, (_, index) => {
    const dayOffset = Math.max(1, Math.min(horizon, Math.round(1 + index * step)));
    const date = new Date(start);
    date.setDate(start.getDate() + dayOffset);
    const subjectId = plan.subjectIds[index % plan.subjectIds.length];
    const subject = subjects.find((item) => item.id === subjectId);
    return {
      date: formatDateForInput(date),
      time: [0, 6].includes(date.getDay()) ? "11:00" : "18:00",
      subjectId,
      subjectName: subject?.name || "Recapitulare",
      minutes: getRecommendedSessionMinutes()
    };
  });
}

function updateExamPlanPreview() {
  const preview = document.getElementById("examPlanPreview");
  if (!preview) return;
  const sessions = buildExamSessions(getExamFormValues());
  preview.innerHTML = sessions.length
    ? `<strong>${sessions.length} sesiuni în următoarele două săptămâni</strong><span>${sessions.slice(0, 3).map((item) => `${formatReadableDate(item.date)} · ${escapeHtml(item.subjectName)}`).join("<br>")}${sessions.length > 3 ? "<br>…iar restul se adaptează pe parcurs." : ""}</span>`
    : "<span>Alege data și cel puțin o materie pentru a vedea planul.</span>";
}

function loadExamPlanIntoForm(planId = "") {
  const form = document.getElementById("examModeForm");
  const selector = document.getElementById("examPlanSelector");
  const refreshButton = document.getElementById("refreshExamPlanButton");
  const saved = getExamPlans().find((plan) => plan.id === planId);
  selector.value = saved?.id || "";
  if (saved) {
    form.dataset.planId = saved.id;
    form.dataset.planName = saved.name.toLowerCase();
    document.getElementById("examName").value = saved.name;
    document.getElementById("examDate").value = saved.date;
    document.getElementById("examSessionsPerWeek").value = String(saved.sessionsPerWeek || 4);
    document.querySelectorAll("#examSubjectOptions input").forEach((input) => {
      input.checked = saved.subjectIds.includes(input.value);
    });
    document.getElementById("saveExamPlanButton").textContent = "Actualizează planul";
  } else {
    delete form.dataset.planId;
    delete form.dataset.planName;
    document.getElementById("examName").value = "";
    document.getElementById("examDate").value = "";
    document.getElementById("examSessionsPerWeek").value = "4";
    document.querySelectorAll("#examSubjectOptions input").forEach((input, index) => { input.checked = index < 2; });
    document.getElementById("saveExamPlanButton").textContent = "Creează planul";
  }
  if (refreshButton) refreshButton.disabled = !saved;
  updateExamPlanPreview();
}

function initializeExamMode() {
  const form = document.getElementById("examModeForm");
  document.getElementById("openExamModeButton")?.addEventListener("click", () => {
    renderExamSubjectOptions();
    const activePlans = getExamPlans().filter((plan) => plan.date > formatDateForInput(new Date()));
    const selector = document.getElementById("examPlanSelector");
    selector.innerHTML = `<option value="">Plan nou</option>${activePlans.map((plan) =>
      `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)} · ${formatReadableDate(plan.date)}</option>`
    ).join("")}`;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById("examDate").min = formatDateForInput(tomorrow);
    loadExamPlanIntoForm(activePlans[0]?.id || "");
    openModal("examModeModal");
  });
  document.getElementById("examPlanSelector")?.addEventListener("change", (event) => {
    loadExamPlanIntoForm(event.currentTarget.value);
  });
  form?.addEventListener("input", updateExamPlanPreview);
  form?.addEventListener("submit", createExamPlan);
  document.getElementById("refreshExamPlanButton")?.addEventListener("click", refreshExamPlan);
}

async function createExamPlan(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = getExamFormValues();
  const editingId = form.dataset.planName === values.name.toLowerCase()
    ? form.dataset.planId
    : null;
  const plan = {
    ...values,
    id: editingId || crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: editingId
      ? getExamPlans().find((item) => item.id === editingId)?.createdAt || new Date().toISOString()
      : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!plan.subjectIds.length) {
    showToast("Alege cel puțin o materie.", "!");
    return;
  }
  const sessions = buildExamSessions(plan);
  if (!sessions.length) {
    showToast("Data examenului trebuie să fie în viitor.", "!");
    return;
  }
  const button = document.getElementById("saveExamPlanButton");
  button.disabled = true;
  button.textContent = editingId ? "Actualizez planul…" : "Creez planul…";
  const marker = `[Itera Exam:${plan.id}]`;
  const [oldTasksResult, oldEventsResult] = editingId
    ? await Promise.all([
        supabaseClient.from("tasks").select("id").eq("user_id", currentUser.id).eq("completed", false).ilike("notes", `%${marker}%`),
        supabaseClient.from("calendar_events").select("id").eq("user_id", currentUser.id).ilike("notes", `%${marker}%`)
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (oldTasksResult.error || oldEventsResult.error) {
    button.disabled = false;
    button.textContent = editingId ? "Actualizează planul" : "Creează planul";
    showToast("Planul existent nu a putut fi citit.", "!");
    return;
  }
  const taskPayloads = sessions.map((session) => ({
    user_id: currentUser.id,
    subject_id: session.subjectId,
    title: `${plan.name} · ${session.subjectName}`,
    task_type: "homework",
    deadline_date: session.date,
    deadline_time: session.time,
    estimated_minutes: session.minutes,
    priority: "medium",
    notes: `${marker} Recapitulare adaptivă.`,
    completed: false,
    progress: 0
  }));
  const [taskResult, eventResult] = await Promise.all([
    supabaseClient.from("tasks").insert(taskPayloads).select("id"),
    supabaseClient.from("calendar_events").insert({
      user_id: currentUser.id,
      subject_id: plan.subjectIds[0] || null,
      title: plan.name,
      event_type: "test",
      event_date: plan.date,
      notes: marker
    }).select("id").single()
  ]);
  let metadataError = null;
  if (!taskResult.error && !eventResult.error) {
    const plans = [...getExamPlans().filter((item) => item.id !== plan.id && item.name.toLowerCase() !== plan.name.toLowerCase()), plan].slice(-8);
    const { data, error } = await supabaseClient.auth.updateUser({ data: { itera_exam_plans: plans } });
    metadataError = error;
    if (!error && data?.user) currentUser = data.user;
  }
  button.disabled = false;
  button.textContent = editingId ? "Actualizează planul" : "Creează planul";
  if (taskResult.error || eventResult.error || metadataError) {
    if (!taskResult.error && taskResult.data?.length) {
      await supabaseClient.from("tasks").delete().eq("user_id", currentUser.id)
        .in("id", taskResult.data.map((item) => item.id));
    }
    if (!eventResult.error && eventResult.data?.id) {
      await supabaseClient.from("calendar_events").delete().eq("user_id", currentUser.id)
        .eq("id", eventResult.data.id);
    }
    showToast("Planul nu a putut fi creat complet.", "!");
    return;
  }
  if (editingId) {
    const cleanupResults = await Promise.all([
      oldTasksResult.data?.length
        ? supabaseClient.from("tasks").delete().eq("user_id", currentUser.id).in("id", oldTasksResult.data.map((item) => item.id))
        : Promise.resolve({ error: null }),
      oldEventsResult.data?.length
        ? supabaseClient.from("calendar_events").delete().eq("user_id", currentUser.id).in("id", oldEventsResult.data.map((item) => item.id))
        : Promise.resolve({ error: null })
    ]);
    if (cleanupResults.some((result) => result.error)) {
      showToast("Planul nou este salvat, dar au rămas câteva intrări vechi.", "!");
    }
  }
  await loadHomeData();
  closeModal("examModeModal");
  renderAll();
  showToast("Exam Mode este activ. Primele două săptămâni sunt planificate.", "✓");
}

async function refreshExamPlan() {
  const selectedId = document.getElementById("examPlanSelector")?.value || "";
  const name = document.getElementById("examName").value.trim().toLowerCase();
  const plan = getExamPlans().find((item) => item.id === selectedId)
    || getExamPlans().find((item) => item.name.toLowerCase() === name);
  if (!plan) {
    showToast("Alege mai întâi un plan existent.", "!");
    return;
  }
  const today = formatDateForInput(new Date());
  const marker = `[Itera Exam:${plan.id}]`;
  const allExamTasks = tasks.filter((task) => String(task.notes || "").includes(marker));
  const examTasks = allExamTasks.filter((task) => !task.completed);
  const overdue = examTasks.filter((task) => task.deadline < today);
  const replacements = buildExamSessions(plan);
  if (!replacements.length) {
    showToast("Examenul este prea aproape pentru o redistribuire automată.", "!");
    return;
  }
  const updateResults = await Promise.all(overdue.map(async (task, index) => {
    const slot = replacements[index % replacements.length];
    const result = await supabaseClient.from("tasks")
      .update({ deadline_date: slot.date, deadline_time: slot.time })
      .eq("id", task.id)
      .eq("user_id", currentUser.id);
    return { ...result, task };
  }));
  const occupied = new Set(
    allExamTasks.filter((task) => task.deadline >= today)
      .map((task) => `${task.deadline}:${task.subject_id}`)
  );
  overdue.forEach((task, index) => {
    const slot = replacements[index % replacements.length];
    occupied.add(`${slot.date}:${task.subject_id}`);
  });
  const missingCandidates = replacements.filter((slot) => !occupied.has(`${slot.date}:${slot.subjectId}`));
  const scheduledAfterMoves = allExamTasks.filter((task) => task.deadline >= today).length + overdue.length;
  const missing = missingCandidates.slice(0, Math.max(0, replacements.length - scheduledAfterMoves));
  const insertResult = missing.length
    ? await supabaseClient.from("tasks").insert(missing.map((slot) => ({
        user_id: currentUser.id,
        subject_id: slot.subjectId,
        title: `${plan.name} · ${slot.subjectName}`,
        task_type: "homework",
        deadline_date: slot.date,
        deadline_time: slot.time,
        estimated_minutes: slot.minutes,
        priority: "medium",
        notes: `${marker} Recapitulare adaptivă.`,
        completed: false,
        progress: 0
      }))).select("id")
    : { data: [], error: null };
  if (updateResults.some((result) => result.error) || insertResult.error) {
    const rollbackOperations = updateResults
      .filter((result) => !result.error)
      .map(({ task }) => supabaseClient.from("tasks")
        .update({ deadline_date: task.deadline, deadline_time: task.deadline_time || null })
        .eq("id", task.id)
        .eq("user_id", currentUser.id));
    if (!insertResult.error && insertResult.data?.length) {
      rollbackOperations.push(
        supabaseClient.from("tasks").delete().eq("user_id", currentUser.id)
          .in("id", insertResult.data.map((item) => item.id))
      );
    }
    await Promise.all(rollbackOperations);
    showToast("Unele recapitulări nu au putut fi mutate.", "!");
    return;
  }
  if (!overdue.length && !missing.length) {
    showToast("Planul este deja la zi.", "✓");
    return;
  }
  await loadHomeData();
  updateExamPlanPreview();
  renderAll();
  showToast(
    overdue.length
      ? "Recapitulările restante au fost redistribuite și planul a fost completat."
      : "Următoarele două săptămâni au fost completate.",
    "✓"
  );
}

async function maintainActiveExamPlans() {
  if (!currentUser) return;
  const today = formatDateForInput(new Date());
  const activePlans = getExamPlans().filter((plan) => plan.date > today);
  let movedCount = 0;
  let addedCount = 0;

  for (const plan of activePlans) {
    const marker = `[Itera Exam:${plan.id}]`;
    const allPlanTasks = tasks.filter((task) => String(task.notes || "").includes(marker));
    const planTasks = allPlanTasks.filter((task) => !task.completed);
    const overdue = planTasks.filter((task) => task.deadline < today);
    const slots = buildExamSessions(plan);
    if (!slots.length) continue;
    const occupied = new Set(
      allPlanTasks.filter((task) => task.deadline >= today)
        .map((task) => `${task.deadline}:${task.subject_id}`)
    );

    let movedForPlan = 0;
    for (const task of overdue) {
      const preferredIndex = slots.findIndex((slot) =>
        slot.subjectId === task.subject_id && !occupied.has(`${slot.date}:${slot.subjectId}`)
      );
      const fallbackIndex = slots.findIndex((slot) => !occupied.has(`${slot.date}:${slot.subjectId}`));
      const slot = slots[preferredIndex >= 0 ? preferredIndex : fallbackIndex];
      if (!slot) continue;
      const { error } = await supabaseClient.from("tasks")
        .update({ deadline_date: slot.date, deadline_time: slot.time })
        .eq("id", task.id)
        .eq("user_id", currentUser.id);
      if (!error) {
        occupied.add(`${slot.date}:${task.subject_id}`);
        movedCount += 1;
        movedForPlan += 1;
      }
    }

    const scheduledCount = allPlanTasks.filter((task) => task.deadline >= today).length + movedForPlan;
    const missingSlots = slots
      .filter((slot) => !occupied.has(`${slot.date}:${slot.subjectId}`))
      .slice(0, Math.max(0, slots.length - scheduledCount));
    if (missingSlots.length) {
      const { data, error } = await supabaseClient.from("tasks").insert(missingSlots.map((slot) => ({
        user_id: currentUser.id,
        subject_id: slot.subjectId,
        title: `${plan.name} · ${slot.subjectName}`,
        task_type: "homework",
        deadline_date: slot.date,
        deadline_time: slot.time,
        estimated_minutes: slot.minutes,
        priority: "medium",
        notes: `${marker} Recapitulare adaptivă.`,
        completed: false,
        progress: 0
      }))).select("id");
      if (!error) addedCount += data?.length || missingSlots.length;
    }
  }

  if (movedCount || addedCount) {
    await loadHomeData();
    renderAll();
    const updates = [
      movedCount ? `${movedCount} ${movedCount === 1 ? "sesiune mutată" : "sesiuni mutate"}` : "",
      addedCount ? `${addedCount} ${addedCount === 1 ? "sesiune nouă" : "sesiuni noi"}` : ""
    ].filter(Boolean).join(" și ");
    showToast(`Exam Mode s-a adaptat: ${updates}.`, "✓");
  }
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
      <button class="countdown-empty" type="button" data-home-open-source="calendar">
        <strong>Adaugă primul obiectiv important.</strong>
        <span>Examenele și deadline-urile vor avea aici propriul countdown.</span>
      </button>
    `;
    bindHomeInteractiveItems(list);
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
      <button class="goal-countdown-row" type="button" data-home-open-id="${goal.id || ""}" data-home-open-source="${goal.source || "event"}" data-home-open-date="${goal.date || ""}">
        <span class="goal-countdown-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(goal.title)}</strong>
        <span class="${isComplete ? "completed" : ""}">${status}</span>
      </button>
    `;
  }).join("");
  bindHomeInteractiveItems(list);
}

function renderAchievement() {
  const card = document.getElementById("achievementCard");
  if (!card) return;
  const todayString = formatDateForInput(new Date());
  const todayTasks = tasks.filter(
    (task) => isActionableTask(task) && getTaskPlanDate(task) === todayString
  );
  const currentDate = new Date();
  const mondayOffset = (currentDate.getDay() + 6) % 7;
  const weekStart = new Date(currentDate);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(currentDate.getDate() - mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const completedThisWeek = tasks.filter((task) => {
    if (!isActionableTask(task)) return false;
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

function getRecoveryCandidates() {
  const today = formatDateForInput(new Date());
  return tasks
    .filter((task) => !task.completed && task.deadline && task.deadline <= today)
    .sort(sortTasksForPlan);
}

function buildRecoveryPlan() {
  const candidates = getRecoveryCandidates();
  const today = formatDateForInput(new Date());
  const protectedTasks = candidates.filter((task) =>
    task.type === "test" || task.task_type === "test" || task.priority === "high" ||
    isLifeTaskType(task.type || task.task_type)
  );
  const flexibleTasks = candidates.filter((task) => !protectedTasks.includes(task));
  const keepToday = flexibleTasks.slice(0, Math.max(0, 2 - protectedTasks.length));
  const move = flexibleTasks.slice(keepToday.length);
  const dayLoads = Array.from({ length: 5 }, (_, index) => {
    const date = getTomorrowDate(index + 1);
    return {
      date,
      minutes: tasks.filter((task) => !task.completed && task.deadline === date)
        .reduce((sum, task) => sum + getTaskMinutes(task), 0)
    };
  });
  const updates = [
    ...protectedTasks.map((task) => ({
      task,
      date: getTaskPlanDate(task),
      time: getTaskPlanTime(task) || null,
      protected: true
    })),
    ...keepToday.map((task) => ({ task, date: today, time: null, protected: false })),
    ...move.map((task) => {
      dayLoads.sort((first, second) => first.minutes - second.minutes);
      const target = dayLoads[0];
      target.minutes += getTaskMinutes(task);
      return { task, date: target.date, time: null, protected: false };
    })
  ];
  const candidateIds = new Set(candidates.map((task) => task.id));
  const busyByDate = new Map();
  updates.filter((entry) => !entry.protected).forEach((entry) => {
    if (!busyByDate.has(entry.date)) {
      busyByDate.set(entry.date, mergeIntervals(
        getDayIntervals(entry.date).filter((item) => !candidateIds.has(item.id))
      ));
    }
    const date = parseLocalDate(entry.date);
    const isToday = entry.date === today;
    const earliest = isToday
      ? roundToQuarter(new Date().getHours() * 60 + new Date().getMinutes() + 15)
      : ([0, 6].includes(date.getDay()) ? 8 * 60 + 30 : 16 * 60);
    const busy = busyByDate.get(entry.date);
    const slot = findAvailableSlot(earliest, getTaskMinutes(entry.task), busy, 22 * 60);
    if (slot !== null) {
      entry.time = formatClockMinutes(slot);
      busy.push({ start: slot, end: slot + getTaskMinutes(entry.task) });
      busy.sort((first, second) => first.start - second.start);
    }
  });
  return { candidates, protectedTasks, keepToday, move, updates };
}

function renderRecoveryCard() {
  const card = document.getElementById("recoveryCard");
  if (!card) return;
  const candidates = getRecoveryCandidates();
  const minutes = candidates.reduce((sum, task) => sum + getTaskMinutes(task), 0);
  const overloaded = candidates.length >= 3 || minutes > getEnergyCapacity();
  card.hidden = !overloaded;
  if (!overloaded) return;
  document.getElementById("recoveryTitle").textContent = `${candidates.length} lucruri cer atenție în același timp.`;
  document.getElementById("recoveryDescription").textContent =
    `Planul are ${formatMinutes(minutes)}. Testele, prioritățile mari și planurile personale rămân fixe; restul poate fi distribuit realist.`;
}

function initializeRecoveryMode() {
  document.getElementById("openRecoveryButton")?.addEventListener("click", () => {
    const plan = buildRecoveryPlan();
    pendingRecoveryPlan = plan.updates;
    document.getElementById("recoverySummary").textContent =
      `${plan.protectedTasks.length ? `${plan.protectedTasks.length} priorități rămân fixe. ` : ""}Păstrăm ${plan.keepToday.length} astăzi și redistribuim ${plan.move.length}. Nimic nu este șters.`;
    document.getElementById("recoveryPlanList").innerHTML = plan.updates.map((entry) => `
      <div class="recovery-plan-row ${entry.date === formatDateForInput(new Date()) ? "keep" : "move"}">
        <span>${entry.protected ? "Rămâne fix" : entry.date === formatDateForInput(new Date()) ? `Astăzi${entry.time ? ` · ${entry.time}` : ""}` : `${formatReadableDate(entry.date)}${entry.time ? ` · ${entry.time}` : ""}`}</span>
        <strong>${escapeHtml(entry.task.title)}</strong>
        <small>${escapeHtml(entry.task.subject || "Fără materie")} · ${getTaskMinutes(entry.task)} min</small>
      </div>
    `).join("");
    openModal("recoveryModal");
  });
  document.getElementById("applyRecoveryButton")?.addEventListener("click", applyRecoveryPlan);
}

async function applyRecoveryPlan(event) {
  const changes = pendingRecoveryPlan.filter((entry) => !entry.protected);
  if (!changes.length) {
    showToast("Toate elementele sunt priorități fixe; nu am mutat nimic.", "✓");
    closeModal("recoveryModal");
    return;
  }
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = "Simplific planul…";
  const entries = changes.filter((entry) => entry.time);
  const saved = entries.length === changes.length && await saveTaskPlanEntries(entries);
  event.currentTarget.disabled = false;
  event.currentTarget.textContent = "Aplică planul simplificat";
  if (!saved) {
    showToast("Planul nu a putut fi actualizat complet.", "!");
    return;
  }
  pendingRecoveryPlan = [];
  await loadHomeData();
  closeModal("recoveryModal");
  renderAll();
  showToast("Planul a fost simplificat fără să mutăm testele sau prioritățile mari.", "✓");
}

function initializeFloatingTimer() {
  const timer = document.getElementById("floatingTimer");
  const dragHandle = document.getElementById("floatingTimerDrag");
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  document.getElementById("floatingPauseButton").addEventListener("click", toggleFocusPause);
  document.getElementById("floatingFinishButton").addEventListener("click", () => {
    finishFocusSession({ reason: "manual" });
  });
  document.getElementById("minimizeFloatingTimer").addEventListener("click", () => {
    const minimized = timer.classList.toggle("minimized");
    const button = document.getElementById("minimizeFloatingTimer");
    button.textContent = minimized ? "+" : "−";
    button.setAttribute("aria-label", minimized ? "Extinde timerul" : "Minimizează timerul");
    document.getElementById("focusIslandSummary").setAttribute("aria-hidden", String(!minimized));
    if (minimized && window.matchMedia("(max-width: 760px)").matches) {
      timer.style.removeProperty("left");
      timer.style.removeProperty("right");
      timer.style.removeProperty("top");
      timer.style.removeProperty("bottom");
    }
  });
  document.getElementById("closeFloatingTimer").addEventListener("click", () => {
    finishFocusSession({ reason: "manual" });
  });
  document.getElementById("taskCompletedYes").addEventListener("click", completeFocusedTask);
  document.getElementById("taskCompletedNo").addEventListener("click", () => {
    document.getElementById("taskResumeOptions").hidden = false;
    const suggestion = getSmartResumeSuggestion();
    const button = document.getElementById("smartResumeButton");
    button.dataset.date = suggestion.date;
    button.dataset.time = suggestion.time;
    document.getElementById("smartResumeLabel").textContent =
      `${formatReadableDate(suggestion.date)}, ${suggestion.time}`;
  });
  document.getElementById("smartResumeButton")?.addEventListener("click", (event) => {
    scheduleSmartTaskContinuation(event.currentTarget.dataset.date, event.currentTarget.dataset.time);
  });
  document.querySelectorAll("[data-resume-minutes]").forEach((button) => {
    button.addEventListener("click", () => {
      scheduleTaskContinuation(Number(button.dataset.resumeMinutes));
    });
  });
  document.querySelectorAll("[data-next-timer-mode]").forEach(button => {
    button.addEventListener("click", () => {
      nextTimerMode = button.dataset.nextTimerMode;
      document.querySelectorAll("[data-next-timer-mode]").forEach(item => item.classList.toggle("active", item === button));
      const duration = document.getElementById("focusNextDuration");
      duration.value = nextTimerMode === "break" ? "10" : "45";
    });
  });
  document.getElementById("startNextTimer")?.addEventListener("click", () => {
    const minutes = Number(document.getElementById("focusNextDuration").value) || 10;
    closeModal("focusNextStepModal");
    if (nextTimerMode === "break") {
      startBreakTimer(minutes);
      return;
    }
    const subject = subjects.find(item => String(item.id) === String(focusResumeSubjectId || focusSubjectId)) || {
      id: focusResumeSubjectId || focusSubjectId,
      name: focusResumeSubjectName || focusSubjectName || "Studiu"
    };
    if (subject.id) startSubjectFocus(subject, minutes);
    else startActiveTimer({ mode: "focus", seconds: minutes * 60, subjectName: focusSubjectName || "Studiu" });
  });
  document.getElementById("finishFocusFlow")?.addEventListener("click", closeFocusFlow);
  activeSoundscape = currentUser?.user_metadata?.itera_soundscape || "none";
  syncSoundscapeButtons();
  document.querySelectorAll("[data-soundscape]").forEach((button) => {
    button.addEventListener("click", () => setFocusSoundscape(button.dataset.soundscape, true));
  });

  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    if (timer.classList.contains("minimized") && window.matchMedia("(max-width: 760px)").matches) return;
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
  restoreActiveTimer();
}

function restoreActiveTimer() {
  const state = currentUser?.user_metadata?.itera_active_timer;
  if (!state?.id) return;
  focusTimerId = state.id;
  focusTimerMode = state.mode === "break" ? "break" : "focus";
  focusInitialSeconds = Math.max(1, Number(state.initialSeconds) || 1);
  focusPaused = Boolean(state.paused);
  focusStartedAt = state.startedAt ? new Date(state.startedAt) : new Date();
  focusEndsAt = state.endsAt ? new Date(state.endsAt) : null;
  focusSecondsRemaining = focusPaused
    ? Math.max(0, Number(state.remainingSeconds) || 0)
    : Math.max(0, Math.ceil(((focusEndsAt?.getTime() || Date.now()) - Date.now()) / 1000));
  focusSubjectId = state.subjectId || null;
  focusSubjectName = state.subjectName || (focusTimerMode === "break" ? "Pauză" : "Focus");
  focusResumeSubjectId = state.resumeSubjectId || focusSubjectId;
  focusResumeSubjectName = state.resumeSubjectName || focusSubjectName;
  focusTaskId = state.taskId || null;
  focusTaskTitle = state.taskTitle || null;
  focusTaskSnapshot = focusTaskId ? { id: focusTaskId, title: focusTaskTitle, subject_id: focusSubjectId, estimated_minutes: Math.ceil(focusInitialSeconds / 60) } : null;
  focusSessionSaved = focusTimerMode === "break";
  document.getElementById("floatingTimerType").textContent = focusTimerMode === "break" ? "Pauză" : "Sesiune focus";
  showFloatingTimer(focusSubjectName, focusTimerMode === "break" ? "Respiră, bea apă și revino." : (focusTaskTitle || "Studiu individual"));
  updateFocusTimerDisplay();
  if (focusSecondsRemaining <= 0) {
    window.setTimeout(() => finishFocusSession({ reason: "elapsed" }), 500);
  } else {
    runFocusClock();
  }
}

function getSmartResumeSuggestion() {
  const duration = Math.max(15, Math.ceil(focusInitialSeconds / 60));
  for (let offset = 0; offset < 8; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const dateString = formatDateForInput(date);
    const isWeekend = [0, 6].includes(date.getDay());
    const earliest = offset === 0
      ? roundToQuarter(new Date().getHours() * 60 + new Date().getMinutes() + 30)
      : (isWeekend ? 8 * 60 + 30 : 16 * 60);
    const busy = mergeIntervals(
      getDayIntervals(dateString).filter((item) => !(item.kind === "task" && item.id === focusTaskId))
    );
    const slot = findAvailableSlot(earliest, duration, busy, 22 * 60);
    if (slot !== null) return { date: dateString, time: formatClockMinutes(slot) };
  }
  return { date: getTomorrowDate(), time: "18:00" };
}

async function scheduleSmartTaskContinuation(date, time) {
  if (!focusTaskId || !date || !time) return;
  const actionButton = document.getElementById("smartResumeButton");
  actionButton.disabled = true;
  const taskId = focusTaskId;
  const title = focusTaskTitle;
  const studiedMinutes = await saveCurrentFocusSession();
  if (!studiedMinutes) {
    actionButton.disabled = false;
    return;
  }
  const task = tasks.find((item) => String(item.id) === String(taskId));
  const saved = task && await saveTaskPlanEntries([{ task, date, time }]);
  if (!saved) {
    actionButton.disabled = false;
    showToast("Task-ul nu a putut fi reprogramat.", "!");
    return;
  }
  const startTime = new Date(`${date}T${time}:00`);
  const scheduledFor = new Date(startTime.getTime() - 60000);
  const reminderResult = await globalThis.IteraPush?.queueReminder({
    title: "Continui într-un minut",
    body: `${title} · ${time}`,
    scheduledFor,
    targetUrl: "./index.html#/tasks",
    tag: `smart-resume-${taskId}`,
    notificationType: "task-start",
    sourceId: taskId,
    dedupeKey: `task-start-${taskId}-${date}-${time}`
  });
  actionButton.disabled = false;
  closeTaskSession();
  await loadHomeData();
  renderAll();
  showToast(
    reminderResult?.ok
      ? `Task reprogramat pe ${formatReadableDate(date)}, la ${time}, cu notificare.`
      : `Task reprogramat pe ${formatReadableDate(date)}, la ${time}. Activează notificările pentru reminder.`,
    reminderResult?.ok ? "✓" : "!"
  );
}

function syncSoundscapeButtons() {
  document.querySelectorAll("[data-soundscape]").forEach((button) => {
    button.classList.toggle("active", button.dataset.soundscape === activeSoundscape);
  });
}

function stopFocusSoundscape() {
  try { focusAudioSource?.stop(); } catch (_) {}
  focusAudioSource = null;
  if (focusAudioGain) focusAudioGain.disconnect();
  focusAudioGain = null;
}

async function playFocusCue(kind) {
  if (activeSoundscape === "mute") return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  try {
    focusAudioContext ||= new AudioContext();
    await focusAudioContext.resume();
    const context = focusAudioContext;
    const cueGain = context.createGain();
    const now = context.currentTime;
    const cueMap = {
      start: [523.25, 659.25],
      resume: [493.88, 659.25],
      pause: [493.88, 392],
      stop: [440, 349.23],
      breakStart: [440, 392],
      breakComplete: [523.25, 698.46],
      complete: [523.25, 659.25, 783.99, 1046.5]
    };
    const frequencies = cueMap[kind] || cueMap.start;
    const step = kind === "complete" ? 0.16 : 0.12;
    const noteLength = kind === "complete" ? 0.34 : 0.24;

    cueGain.gain.setValueAtTime(1, now);
    cueGain.connect(context.destination);

    frequencies.forEach((frequency, index) => {
      const startAt = now + index * step;
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      oscillator.type = kind === "complete" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      noteGain.gain.setValueAtTime(0.0001, startAt);
      noteGain.gain.exponentialRampToValueAtTime(kind === "complete" ? 0.032 : 0.04, startAt + 0.025);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, startAt + noteLength);
      oscillator.connect(noteGain).connect(cueGain);
      oscillator.start(startAt);
      oscillator.stop(startAt + noteLength + 0.02);
    });

    window.setTimeout(() => cueGain.disconnect(), 1100);
  } catch (error) {
    console.debug("Itera timer cue unavailable", error);
  }
}

const focusSoundscapeSettings = Object.freeze({
  rain: { filter: "highpass", frequency: 950, q: 0.35, volume: 0.055 },
  cafe: { filter: "bandpass", frequency: 520, q: 0.7, volume: 0.065 },
  library: { filter: "lowpass", frequency: 360, q: 0.4, volume: 0.038 },
  fireplace: { filter: "bandpass", frequency: 720, q: 0.5, volume: 0.052 },
  waves: { filter: "lowpass", frequency: 880, q: 0.35, volume: 0.06 },
  brown: { filter: "lowpass", frequency: 430, q: 0.45, volume: 0.07 }
});

function getSoundscapeSettings(kind) {
  return focusSoundscapeSettings[kind] || focusSoundscapeSettings.rain;
}

async function setFocusSoundscape(kind, persist = false) {
  const soundscapeExists = Object.prototype.hasOwnProperty.call(focusSoundscapeSettings, kind);
  activeSoundscape = soundscapeExists || ["none", "mute"].includes(kind) ? kind : "none";
  syncSoundscapeButtons();
  stopFocusSoundscape();

  if (!["none", "mute"].includes(activeSoundscape)) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      activeSoundscape = "none";
      syncSoundscapeButtons();
      return;
    }
    focusAudioContext ||= new AudioContext();
    await focusAudioContext.resume();
    const seconds = 6;
    const buffer = focusAudioContext.createBuffer(2, focusAudioContext.sampleRate * seconds, focusAudioContext.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        const time = index / focusAudioContext.sampleRate;
        if (activeSoundscape === "rain") {
          smooth = smooth * 0.72 + white * 0.28;
          const distantDrop = Math.sin(time * 17.3 + channel * 1.7) > 0.998
            ? Math.sin(time * 2600) * 0.16
            : 0;
          data[index] = smooth * 0.56 + distantDrop;
        } else if (activeSoundscape === "cafe") {
          smooth = smooth * 0.985 + white * 0.015;
          const roomPulse = 0.62 + Math.sin(time * 1.7 + channel) * 0.16;
          const softMurmur = Math.sin(time * 92 + channel * 0.8) * 0.018;
          const cupClink = Math.sin(time * 9.1 + channel * 2.3) > 0.9995
            ? Math.sin(time * 1840) * 0.12
            : 0;
          data[index] = smooth * roomPulse * 1.18 + softMurmur + cupClink;
        } else if (activeSoundscape === "library") {
          smooth = smooth * 0.994 + white * 0.006;
          const quietRoom = Math.sin(time * 58 + channel) * 0.006;
          const distantPage = Math.sin(time * 2.2 + channel * 0.6) > 0.9997 ? white * 0.08 : 0;
          data[index] = smooth * 1.25 + quietRoom + distantPage;
        } else if (activeSoundscape === "fireplace") {
          smooth = smooth * 0.94 + white * 0.06;
          const crackle = Math.random() > 0.9992 ? white * 0.58 : 0;
          data[index] = smooth * 0.6 + crackle;
        } else if (activeSoundscape === "waves") {
          smooth = smooth * 0.84 + white * 0.16;
          const swell = (Math.sin(time * 0.72 + channel * 0.35) + 1) / 2;
          data[index] = smooth * (0.12 + swell * 0.58);
        } else {
          smooth = smooth * 0.992 + white * 0.008;
          data[index] = smooth * 2.6;
        }
      }
    }
    const source = focusAudioContext.createBufferSource();
    const filter = focusAudioContext.createBiquadFilter();
    const gain = focusAudioContext.createGain();
    source.buffer = buffer;
    source.loop = true;
    const settings = getSoundscapeSettings(activeSoundscape);
    filter.type = settings.filter;
    filter.frequency.value = settings.frequency;
    filter.Q.value = settings.q;
    gain.gain.value = focusPaused ? 0 : settings.volume;
    source.connect(filter).connect(gain).connect(focusAudioContext.destination);
    source.start();
    focusAudioSource = source;
    focusAudioGain = gain;
  }

  if (persist && currentUser) {
    const { data, error } = await supabaseClient.auth.updateUser({ data: { itera_soundscape: activeSoundscape } });
    if (error) {
      showToast("Sunetul funcționează acum, dar preferința nu a putut fi salvată.", "!");
      return;
    }
    if (data?.user) currentUser = data.user;
  }
}

function showFloatingTimer(subject, taskTitle) {
  const timer = document.getElementById("floatingTimer");
  timer.classList.remove("minimized");
  timer.classList.add("visible");
  timer.setAttribute("aria-hidden", "false");
  document.getElementById("floatingTimerSubject").textContent = subject;
  document.getElementById("floatingTimerTask").textContent = taskTitle;
  document.getElementById("focusIslandSubject").textContent = subject;
  document.getElementById("focusIslandSummary").setAttribute("aria-hidden", "true");
  document.getElementById("minimizeFloatingTimer").textContent = "−";
  document.getElementById("minimizeFloatingTimer").setAttribute("aria-label", "Minimizează timerul");
  document.getElementById("floatingPauseButton").textContent = "Pauză";
  emitFocusTimerState();
}

function startTaskFocus(task, subject) {
  startActiveTimer({
    mode: "focus",
    seconds: Math.max(1, Number(task.estimated_minutes || 30)) * 60,
    subjectName: subject?.name || taskTypeLabel(task.task_type || task.type),
    subjectId: task.subject_id || subject?.id || null,
    task
  });
  void playFocusCue("start");
  if (activeSoundscape !== "none") void setFocusSoundscape(activeSoundscape);
}

function startSubjectFocus(subject, durationMinutes = 45) {
  if (!subject?.id) return;
  if (getFocusTimerState().active && !focusPaused) {
    showToast("Ai deja o sesiune în desfășurare. Finalizeaz-o înainte să începi alta.", "!");
    return;
  }
  startActiveTimer({
    mode: "focus",
    seconds: Math.max(5, Number(durationMinutes) || 45) * 60,
    subjectName: subject.name || "Studiu",
    subjectId: subject.id
  });
  void playFocusCue("start");
  if (activeSoundscape !== "none") void setFocusSoundscape(activeSoundscape);
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

  await globalThis.IteraPush?.cancelTaskReminders(taskId);
  closeTaskSession();
  window.dispatchEvent(new CustomEvent("itera:task-updated"));
  await loadHomeData();
  renderAll();
  window.dispatchEvent(new CustomEvent("itera:study-session-saved", {
    detail: { subjectId: focusSubjectId, minutes: studiedMinutes }
  }));
  showToast("Task finalizat și timpul salvat.", "✓");
  openFocusNextStep();
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
  stopFocusSoundscape();
  const previousTimerId = focusTimerId;
  focusTimerId = null;
  focusEndsAt = null;
  void globalThis.IteraPush?.cancelTimerReminders(previousTimerId);
  void persistActiveTimer();
  emitFocusTimerState();
}

globalThis.IteraFocus = Object.freeze({
  startTask: startTaskFocus,
  startSubject: startSubjectFocus,
  getState: getFocusTimerState,
  togglePause: toggleFocusPause,
  finish: finishFocusSession
});

function buildNotifications() {
  const today = parseLocalDate(formatDateForInput(new Date()));
  const taskNotifications = tasks
    .filter((task) => isActionableTask(task) && !task.completed && task.deadline)
    .map((task) => {
      const planDate = getTaskPlanDate(task);
      const days = Math.round((parseLocalDate(planDate) - today) / 86400000);
      if (days > 3) return null;
      return {
        icon: days < 0 ? "!" : "✓",
        title: days < 0 ? `Acum: ${task.title}` : task.title,
        text: days === 0
          ? `Planificat astăzi${getTaskPlanTime(task) ? ` la ${getTaskPlanTime(task)}` : ""} · termen ${formatRelativeDate(task.deadline)}`
          : days === 1
            ? `Planificat mâine${getTaskPlanTime(task) ? ` la ${getTaskPlanTime(task)}` : ""} · termen ${formatRelativeDate(task.deadline)}`
            : days < 0
            ? `Este restant de ${Math.abs(days)} ${Math.abs(days) === 1 ? "zi" : "zile"}. Nu îl mai amâna — deschide-l și fă primul pas.`
              : `Planificat peste ${days} zile · termen ${formatRelativeDate(task.deadline)}`,
        action: "tasks",
        targetId: task.id,
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
      targetId: event.id,
      targetDate: event.date,
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
    <button class="notification-item ${notification.urgent ? "urgent" : ""}" data-notification-route="${notification.action}" data-notification-target="${notification.targetId || ""}" data-notification-date="${notification.targetDate || ""}">
      <span>${notification.icon}</span>
      <div><strong>${escapeHtml(notification.title)}</strong><small>${escapeHtml(notification.text)}</small></div>
      <b>→</b>
    </button>
  `).join("");

  list.querySelectorAll("[data-notification-route]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = document.getElementById("notificationPanel");
      const route = button.dataset.notificationRoute;
      const targetId = button.dataset.notificationTarget;
      panel.classList.remove("visible");
      panel.setAttribute("aria-hidden", "true");
      openPage(route);
      if (route === "tasks" && targetId) {
        globalThis.IteraTasksView?.openTask(targetId);
      } else if (route === "calendar" && targetId) {
        globalThis.IteraCalendarView?.openEvent(targetId, button.dataset.notificationDate);
      }
    });
  });
}

/* RENDER */

function renderAll() {
  updateCurrentDate();
  renderHomeSummary();
  renderTodayTimeline();
  renderTodayTasks();
  renderPersonalHub();
  renderUpcomingEvents();
  renderNowRecommendation();
  renderGoalCountdowns();
  renderOrganizerPreview();
  renderAchievement();
  renderRecoveryCard();
  renderNotifications();
  updateAppBadge();
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

  const taskEvents = tasks.filter(
    (task) => isActionableTask(task) && !task.completed && task.type !== "goal" &&
      getTaskPlanDate(task) && getTaskPlanDate(task) <= todayString
  );

  const remainingTasks = taskEvents.filter(
    (event) => !event.completed
  );

  const totalMinutes = remainingTasks.reduce(
    (sum, event) => sum + Number(event.estimatedMinutes || event.estimated_minutes || event.duration || 0),
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

  const studiedToday = studySessions.reduce(
    (sum, session) => sum + Number(session.duration_minutes || 0),
    0
  );
  const studiedTodayElement = document.getElementById("studiedTodayTime");
  if (studiedTodayElement) studiedTodayElement.textContent = formatMinutes(studiedToday);

  const dailyTasks = tasks.filter((task) => {
    if (!isActionableTask(task) || task.type === "goal") return false;
    const planDate = getTaskPlanDate(task);
    const completedToday = task.completed && task.completed_at &&
      formatDateForInput(new Date(task.completed_at)) === todayString;
    return completedToday || (planDate && planDate <= todayString && !task.completed);
  });
  const completedCount = dailyTasks.filter((task) => task.completed).length;
  const progress = dailyTasks.length
    ? Math.round((completedCount / dailyTasks.length) * 100)
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
      id: item.id,
      title: item.title,
      subject: subjectName(item.subject_id),
      time: String(item.start_time || "").slice(0, 5),
      endTime: String(item.end_time || "").slice(0, 5),
      type: item.item_type || "school",
      source: "schedule"
    }));

  const timelineItems = [
    ...todaySchedule,
    ...events
      .filter((event) => event.date === todayString && event.time)
      .map((event) => ({ ...event, endTime: "", source: "event" })),
    ...tasks
      .filter((task) => getTaskPlanDate(task) === todayString && getTaskPlanTime(task) && !task.completed)
      .map((task) => ({
        id: task.id,
        title: task.title,
        subject: task.subject,
        time: getTaskPlanTime(task),
        endTime: "",
        type: task.type || "homework",
        source: "task"
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
        <button type="button" class="timeline-item ${event.isCurrent ? "current-time" : ""} ${event.source ? "is-actionable" : ""}" ${event.source ? `data-home-open-id="${event.id || ""}" data-home-open-source="${event.source}" data-home-open-date="${todayString}"` : "disabled"}>
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
          ${event.source ? '<span class="home-row-arrow" aria-hidden="true">›</span>' : ""}
        </button>
      `;
    })
    .join("");
  bindHomeInteractiveItems(timeline);
}

function renderTodayTasks() {
  const taskList = document.getElementById(
    "todayTaskList"
  );

  const todayString = formatDateForInput(new Date());
  const taskEvents = tasks
    .filter((task) =>
      isActionableTask(task) && !task.completed && task.type !== "goal" &&
      getTaskPlanDate(task) && getTaskPlanDate(task) <= todayString
    )
    .map(convertTaskToCalendarItem)
    .sort(sortEvents);

  renderTaskCollection(
    taskList,
    taskEvents,
    "Nu ai task-uri pentru astăzi și nimic restant."
  );
}

function renderPersonalHub() {
  const taskList = document.getElementById("personalTaskList");
  const goalList = document.getElementById("personalGoalList");
  if (!taskList || !goalList) return;

  const personalItems = tasks
    .filter(
      (task) =>
        isLifeTaskType(task.type) &&
        task.type !== "goal" &&
        isActionableTask(task) &&
        !task.completed
    )
    .map(convertTaskToCalendarItem)
    .sort(sortEvents)
    .slice(0, 4);

  const personalGoals = tasks
    .filter((task) => task.type === "goal" && !task.completed)
    .map(convertTaskToCalendarItem)
    .sort(sortEvents)
    .slice(0, 3);

  renderTaskCollection(taskList, personalItems, "Nu ai nimic personal planificat încă.");
  renderTaskCollection(goalList, personalGoals, "Adaugă un obiectiv mic sau mare, în ritmul tău.");
}

function updateAppBadge() {
  const today = formatDateForInput(new Date());
  const remaining = tasks.filter(
    (task) => isActionableTask(task) && !task.completed && task.deadline && task.deadline <= today
  ).length;
  if (typeof navigator.setAppBadge === "function") {
    if (remaining) {
      navigator.setAppBadge(remaining).catch(() => {});
    } else {
      navigator.clearAppBadge?.().catch(() => {});
    }
  }
}

function initializeLaunchActions() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action");
  if (!action) return;

  window.setTimeout(() => {
    if (action === "add-task") {
      prepareQuickTaskModal("homework");
    } else if (action === "focus") {
      startRecommendedFocusSession();
    } else if (action === "plan") {
      openDayPlanner();
    }

    params.delete("action");
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );
  }, 500);
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

          <button type="button" class="task-content" data-home-open-id="${event.id}" data-home-open-source="${event.source || "event"}" data-home-open-date="${event.date || ""}" aria-label="Deschide ${escapeHtml(event.title)}">
            <strong>${escapeHtml(event.title)}</strong>

            <span>
              ${
                escapeHtml(event.subject) ||
                getTypeLabel(event.type)
              }
              · ${formatReadableDate(event.date)}
            </span>
          </button>

          <span class="task-time">
            ${formatMinutes(event.duration)}
          </span>
          ${event.source === "task" && !event.noTimer && event.type !== "goal" && Number(event.duration) > 0
            ? `<button type="button" class="home-task-start" data-home-start-task="${event.id}" aria-label="Pornește ${escapeHtml(event.title)}"><span aria-hidden="true">▶</span><b>Start</b></button>`
            : '<span class="home-row-arrow" aria-hidden="true">›</span>'}
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
  bindHomeInteractiveItems(container);
  container.querySelectorAll("[data-home-start-task]").forEach(button => {
    button.addEventListener("click", () => {
      const task = tasks.find(item => String(item.id) === String(button.dataset.homeStartTask));
      const subject = subjects.find(item => String(item.id) === String(task?.subject_id));
      if (task) startTaskFocus(task, subject);
    });
  });
}

function openHomeItem(id, source, date = "") {
  if (source === "task") {
    openPage("tasks");
    globalThis.IteraTasksView?.openTask(id);
    return;
  }
  if (source === "event") {
    openPage("calendar");
    globalThis.IteraCalendarView?.openEvent(id, date);
    return;
  }
  if (source === "schedule") {
    openPage("schedule");
    return;
  }
  if (source === "calendar") openPage("calendar");
}

function bindHomeInteractiveItems(container) {
  container?.querySelectorAll("[data-home-open-source]").forEach(button => {
    button.addEventListener("click", () => openHomeItem(
      button.dataset.homeOpenId,
      button.dataset.homeOpenSource,
      button.dataset.homeOpenDate
    ));
  });
}

async function toggleItemCompletion(
  itemId,
  itemSource
) {
  if (itemSource === "task") {
    const previousTask = tasks.find((task) => task.id === itemId);
    const previousSnapshot = previousTask ? { ...previousTask } : null;
    tasks = tasks.map((task) => {
      if (task.id !== itemId) {
        return task;
      }

      const newCompletedState =
        !task.completed;

      return {
        ...task,

        completed: newCompletedState,

        completed_at: newCompletedState
          ? new Date().toISOString()
          : null,

        progress: newCompletedState
          ? 100
          : 0,

        updatedAt: new Date().toISOString()
      };
    });
    renderAll();

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
      if (previousSnapshot) {
        tasks = tasks.map(item => item.id === itemId ? previousSnapshot : item);
        renderAll();
      }
      showToast("Task-ul nu a putut fi actualizat.", "!");
      return;
    }
    if (task.completed) {
      const removal = await globalThis.IteraPlanning?.removeTask(currentUser, task.id);
      if (removal?.user) currentUser = removal.user;
      await globalThis.IteraPush?.cancelTaskReminders(task.id);
    } else {
      await rebuildSmartTaskPlan();
      await loadHomeData();
    }
    window.dispatchEvent(new CustomEvent("itera:task-updated", {
      detail: { id: itemId, completed: task.completed }
    }));
  } else {
    showToast(
      "Evenimentele nu folosesc starea de task finalizat.",
      "!"
    );
    return;
  }

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
      <button type="button" class="empty-state home-empty-action" data-home-open-source="calendar">
        <span>✦</span>
        <strong>Niciun deadline apropiat.</strong>
        <p>Deschide calendarul pentru a planifica următorul pas.</p>
      </button>
    `;
    bindHomeInteractiveItems(upcomingList);
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
        <button type="button" class="upcoming-item ${urgencyClass}" data-home-open-id="${event.id || ""}" data-home-open-source="${event.source || "event"}" data-home-open-date="${event.date || ""}">
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
          <span class="home-row-arrow" aria-hidden="true">›</span>
        </button>
      `;
    })
    .join("");
  bindHomeInteractiveItems(upcomingList);
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
