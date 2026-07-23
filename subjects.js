"use strict";

/* =====================================================
   ITERA — SUBJECTS
===================================================== */

const state = {
  session: null,
  userId: null,

  subjects: [],
  grades: [],
  studySessions: [],
  tasks: [],
  calendarEvents: [],

  toastTimeout: null
};

/* =====================================================
   ELEMENTE
===================================================== */

const elements = {
  subjectsCount: document.getElementById("subjectsCount"),
  overallAverage: document.getElementById("overallAverage"),
  totalStudyTime: document.getElementById("totalStudyTime"),

  loadingState: document.getElementById("loadingState"),
  emptyState: document.getElementById("emptyState"),
  errorState: document.getElementById("errorState"),
  errorMessage: document.getElementById("errorMessage"),
  subjectsGrid: document.getElementById("subjectsGrid"),

  retryButton: document.getElementById("retryButton"),

  userName: document.getElementById("userName"),
  userAvatar: document.getElementById("userAvatar"),

  addSubjectButton: document.getElementById("addSubjectButton"),
  emptyAddSubjectButton: document.getElementById(
    "emptyAddSubjectButton"
  ),

  subjectModal: document.getElementById("subjectModal"),
  closeSubjectModalButton: document.getElementById(
    "closeSubjectModalButton"
  ),
  cancelSubjectButton: document.getElementById(
    "cancelSubjectButton"
  ),

  subjectForm: document.getElementById("subjectForm"),
  subjectNameInput: document.getElementById("subjectNameInput"),
  teacherNameInput: document.getElementById("teacherNameInput"),
  subjectFormError: document.getElementById("subjectFormError"),
  saveSubjectButton: document.getElementById("saveSubjectButton"),

  toast: document.getElementById("toast")
};

/* =====================================================
   CONFIGURARE VIZUALĂ
===================================================== */

const subjectThemes = [
  {
    accent: "#615df1",
    soft: "#ecebff",
    icon: "∑"
  },
  {
    accent: "#e26a8d",
    soft: "#fff0f5",
    icon: "A"
  },
  {
    accent: "#328cc1",
    soft: "#eaf6fc",
    icon: "</>"
  },
  {
    accent: "#e49b32",
    soft: "#fff5e4",
    icon: "⚛"
  },
  {
    accent: "#40a77c",
    soft: "#eaf8f2",
    icon: "⌁"
  },
  {
    accent: "#9a67c7",
    soft: "#f5edfc",
    icon: "✦"
  },
  {
    accent: "#cf685e",
    soft: "#fff0ee",
    icon: "◉"
  },
  {
    accent: "#5874bd",
    soft: "#edf1fb",
    icon: "B"
  }
];

/* =====================================================
   PORNIRE
===================================================== */

document.addEventListener("DOMContentLoaded", initializePage);

async function initializePage() {
  bindEvents();
  await loadPage();
}

/* =====================================================
   EVENIMENTE
===================================================== */

function bindEvents() {
  elements.retryButton?.addEventListener("click", loadPage);

  elements.addSubjectButton?.addEventListener(
    "click",
    openSubjectModal
  );

  elements.emptyAddSubjectButton?.addEventListener(
    "click",
    openSubjectModal
  );

  elements.closeSubjectModalButton?.addEventListener(
    "click",
    closeSubjectModal
  );

  elements.cancelSubjectButton?.addEventListener(
    "click",
    closeSubjectModal
  );

  elements.subjectModal?.addEventListener("click", event => {
    if (event.target === elements.subjectModal) {
      closeSubjectModal();
    }
  });

  elements.subjectForm?.addEventListener(
    "submit",
    handleAddSubject
  );

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeSubjectModal();
    }
  });
}

/* =====================================================
   ÎNCĂRCARE
===================================================== */

async function loadPage() {
  showLoadingState();

  try {
    await loadSession();
    await loadProfile();
    await loadAllData();

    renderPage();
  } catch (error) {
    console.error("Eroare la încărcarea materiilor:", error);

    showErrorState(
      error?.message ||
        "Nu am putut încărca materiile. Încearcă din nou."
    );
  }
}

async function loadSession() {
  const {
    data: { session },
    error
  } = await supabaseClient.auth.getSession();

  if (error) {
    throw error;
  }

  if (!session) {
    window.location.replace("auth.html");
    throw new Error("Nu există o sesiune activă.");
  }

  state.session = session;
  state.userId = session.user.id;
}

async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", state.userId)
    .maybeSingle();

  /*
    În unele proiecte, profiles poate folosi user_id
    în loc de id. Încercăm și varianta aceasta.
  */

  let profile = data;

  if (error || !profile) {
    const fallbackResult = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("user_id", state.userId)
      .maybeSingle();

    profile = fallbackResult.data;
  }

  const profileName =
    profile?.name ||
    profile?.full_name ||
    profile?.first_name ||
    state.session.user.user_metadata?.name ||
    state.session.user.email?.split("@")[0] ||
    "Utilizator";

  elements.userName.textContent = profileName;
  elements.userAvatar.textContent = getInitials(profileName);
}

async function loadAllData() {
  const [
    subjectsResult,
    gradesResult,
    sessionsResult,
    tasksResult,
    eventsResult
  ] = await Promise.all([
    supabaseClient
      .from("subjects")
      .select("*")
      .eq("user_id", state.userId),

    supabaseClient
      .from("subject_grades")
      .select("*")
      .eq("user_id", state.userId),

    supabaseClient
      .from("subject_study_sessions")
      .select("*")
      .eq("user_id", state.userId),

    supabaseClient
      .from("tasks")
      .select("*")
      .eq("user_id", state.userId),

    supabaseClient
      .from("calendar_events")
      .select("*")
      .eq("user_id", state.userId)
  ]);

  if (subjectsResult.error) {
    throw subjectsResult.error;
  }

  if (gradesResult.error) {
    throw gradesResult.error;
  }

  if (sessionsResult.error) {
    throw sessionsResult.error;
  }

  /*
    Task-urile sau calendarul nu trebuie să blocheze
    întreaga pagină dacă apare o eroare secundară.
  */

  if (tasksResult.error) {
    console.warn(
      "Task-urile nu au putut fi încărcate:",
      tasksResult.error
    );
  }

  if (eventsResult.error) {
    console.warn(
      "Calendarul nu a putut fi încărcat:",
      eventsResult.error
    );
  }

  state.subjects = sortSubjects(subjectsResult.data || []);
  state.grades = gradesResult.data || [];
  state.studySessions = sessionsResult.data || [];
  state.tasks = tasksResult.data || [];
  state.calendarEvents = eventsResult.data || [];
}

/* =====================================================
   RANDARE
===================================================== */

function renderPage() {
  renderSummary();

  if (state.subjects.length === 0) {
    showEmptyState();
    return;
  }

  renderSubjectCards();
  showSubjectsState();
}

function renderSummary() {
  const allValidGrades = state.grades
    .map(item => Number(item.grade))
    .filter(Number.isFinite);

  const generalAverage =
    allValidGrades.length > 0
      ? calculateAverage(allValidGrades)
      : null;

  const totalMinutes = state.studySessions.reduce(
    (total, session) =>
      total + getSessionDuration(session),
    0
  );

  elements.subjectsCount.textContent = state.subjects.length;

  elements.overallAverage.textContent =
    generalAverage === null
      ? "—"
      : formatAverage(generalAverage);

  elements.totalStudyTime.textContent =
    formatStudyTime(totalMinutes);
}

function renderSubjectCards() {
  elements.subjectsGrid.innerHTML = "";

  const fragment = document.createDocumentFragment();

  state.subjects.forEach((subject, index) => {
    fragment.appendChild(
      createSubjectCard(subject, index)
    );
  });

  elements.subjectsGrid.appendChild(fragment);
}

function createSubjectCard(subject, index) {
  const subjectId = String(subject.id);
  const subjectName = getSubjectName(subject);
  const teacherName = getTeacherName(subject);

  const grades = state.grades
    .filter(grade => String(grade.subject_id) === subjectId)
    .map(grade => Number(grade.grade))
    .filter(Number.isFinite);

  const average =
    grades.length > 0 ? calculateAverage(grades) : null;

  const studiedMinutes = state.studySessions
    .filter(
      session => String(session.subject_id) === subjectId
    )
    .reduce(
      (total, session) =>
        total + getSessionDuration(session),
      0
    );

  const activeTasks = getActiveTasksForSubject(subject);

  const nextTest = getNextTestForSubject(subject);

  const theme =
    subjectThemes[index % subjectThemes.length];

  const card = document.createElement("article");

  card.className = "subject-card";
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute(
    "aria-label",
    `Deschide materia ${subjectName}`
  );

  card.style.setProperty(
    "--subject-accent",
    theme.accent
  );

  card.style.setProperty(
    "--subject-soft",
    theme.soft
  );

  card.innerHTML = `
    <div class="subject-card-header">
      <div class="subject-card-title-group">
        <div class="subject-icon">
          ${escapeHTML(getSubjectIcon(subjectName, theme.icon))}
        </div>

        <div>
          <h2 class="subject-name">
            ${escapeHTML(subjectName)}
          </h2>

          <span class="subject-teacher">
            ${
              teacherName
                ? escapeHTML(teacherName)
                : "Profesor neadăugat"
            }
          </span>
        </div>
      </div>

      <span class="subject-arrow" aria-hidden="true">
        →
      </span>
    </div>

    <div class="subject-stats">
      <div class="subject-stat">
        <span class="subject-stat-label">
          Media
        </span>

        <strong class="subject-stat-value">
          ${
            average === null
              ? "—"
              : formatAverage(average)
          }
        </strong>
      </div>

      <div class="subject-stat">
        <span class="subject-stat-label">
          Timp studiat
        </span>

        <strong class="subject-stat-value">
          ${formatStudyTime(studiedMinutes)}
        </strong>
      </div>
    </div>

    <div class="subject-card-footer">
      <div class="subject-footer-item">
        <span class="subject-footer-icon">✓</span>

        <span>
          ${formatActiveTasks(activeTasks.length)}
        </span>
      </div>

      <div class="subject-footer-item">
        <span class="subject-footer-icon">□</span>

        <span>
          ${
            nextTest
              ? escapeHTML(formatNextTest(nextTest))
              : "Fără teste apropiate"
          }
        </span>
      </div>
    </div>
  `;

  const openSubject = () => {
    window.location.href =
      `subject.html?id=${encodeURIComponent(subject.id)}`;
  };

  card.addEventListener("click", openSubject);

  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSubject();
    }
  });

  return card;
}

/* =====================================================
   TASK-URI
===================================================== */

function getActiveTasksForSubject(subject) {
  return state.tasks.filter(task => {
    const belongsToSubject =
      String(task.subject_id || "") === String(subject.id) ||
      normalizeText(task.subject || task.subject_name) ===
        normalizeText(getSubjectName(subject));

    if (!belongsToSubject) {
      return false;
    }

    const status = normalizeText(
      task.status || task.state || ""
    );

    const isCompleted =
      task.completed === true ||
      task.is_completed === true ||
      [
        "completed",
        "complete",
        "done",
        "finalizat",
        "terminat"
      ].includes(status);

    return !isCompleted;
  });
}

/* =====================================================
   CALENDAR ȘI TESTE
===================================================== */

function getNextTestForSubject(subject) {
  const today = startOfToday();

  const matchingEvents = state.calendarEvents
    .filter(event => {
      const belongsToSubject =
        String(event.subject_id || "") ===
          String(subject.id) ||
        normalizeText(
          event.subject || event.subject_name
        ) === normalizeText(getSubjectName(subject));

      if (!belongsToSubject) {
        return false;
      }

      const eventType = normalizeText(
        event.event_type || event.type || ""
      );

      const title = normalizeText(event.title || "");

      const isTest =
        [
          "test",
          "exam",
          "examen",
          "teza",
          "teză",
          "simulare",
          "evaluare"
        ].some(word => {
          const normalizedWord = normalizeText(word);

          return (
            eventType.includes(normalizedWord) ||
            title.includes(normalizedWord)
          );
        });

      const eventDate = getEventDate(event);

      return (
        isTest &&
        eventDate &&
        eventDate.getTime() >= today.getTime()
      );
    })
    .sort(
      (firstEvent, secondEvent) =>
        getEventDate(firstEvent) -
        getEventDate(secondEvent)
    );

  return matchingEvents[0] || null;
}

function getEventDate(event) {
  const value =
    event.event_date ||
    event.start_date ||
    event.date ||
    event.start_time;

  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatNextTest(event) {
  const date = getEventDate(event);

  if (!date) {
    return "Test programat";
  }

  return `Test: ${new Intl.DateTimeFormat("ro-RO", {
    day: "numeric",
    month: "short"
  }).format(date)}`;
}

/* =====================================================
   MODAL — ADĂUGARE MATERIE
===================================================== */

function openSubjectModal() {
  elements.subjectForm?.reset();
  hideFormError();

  elements.subjectModal?.classList.remove("hidden");

  document.body.style.overflow = "hidden";

  window.setTimeout(() => {
    elements.subjectNameInput?.focus();
  }, 50);
}

function closeSubjectModal() {
  elements.subjectModal?.classList.add("hidden");
  document.body.style.overflow = "";

  elements.subjectForm?.reset();
  hideFormError();
}

async function handleAddSubject(event) {
  event.preventDefault();

  const subjectName =
    elements.subjectNameInput.value.trim();

  const teacherName =
    elements.teacherNameInput.value.trim();

  if (!subjectName) {
    showFormError("Scrie numele materiei.");
    return;
  }

  const alreadyExists = state.subjects.some(
    subject =>
      normalizeText(getSubjectName(subject)) ===
      normalizeText(subjectName)
  );

  if (alreadyExists) {
    showFormError("Această materie există deja.");
    return;
  }

  setSaveButtonLoading(true);
  hideFormError();

  try {
    const payload = createSubjectInsertPayload(
      subjectName,
      teacherName
    );

    let { data, error } = await supabaseClient
      .from("subjects")
      .insert(payload)
      .select()
      .single();

    /*
      Dacă tabelul folosește subject_name în loc de name,
      încercăm automat varianta alternativă.
    */

    if (
      error &&
      String(error.message || "")
        .toLowerCase()
        .includes("name")
    ) {
      const fallbackPayload = {
        user_id: state.userId,
        subject_name: subjectName
      };

      if (teacherName) {
        fallbackPayload.teacher = teacherName;
      }

      const fallbackResult = await supabaseClient
        .from("subjects")
        .insert(fallbackPayload)
        .select()
        .single();

      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) {
      throw error;
    }

    state.subjects.push(data);
    state.subjects = sortSubjects(state.subjects);

    closeSubjectModal();
    renderPage();

    showToast("Materia a fost adăugată.");
  } catch (error) {
    console.error("Eroare la adăugarea materiei:", error);

    showFormError(
      error?.message ||
        "Materia nu a putut fi adăugată."
    );
  } finally {
    setSaveButtonLoading(false);
  }
}

function createSubjectInsertPayload(
  subjectName,
  teacherName
) {
  const existingSubject = state.subjects[0];

  const payload = {
    user_id: state.userId
  };

  if (existingSubject) {
    if ("subject_name" in existingSubject) {
      payload.subject_name = subjectName;
    } else if ("title" in existingSubject) {
      payload.title = subjectName;
    } else {
      payload.name = subjectName;
    }

    if (teacherName) {
      if ("teacher_name" in existingSubject) {
        payload.teacher_name = teacherName;
      } else if ("teacher" in existingSubject) {
        payload.teacher = teacherName;
      } else if ("professor" in existingSubject) {
        payload.professor = teacherName;
      }
    }

    return payload;
  }

  payload.name = subjectName;

  if (teacherName) {
    payload.teacher = teacherName;
  }

  return payload;
}

/* =====================================================
   STĂRI PAGINĂ
===================================================== */

function showLoadingState() {
  elements.loadingState.classList.remove("hidden");
  elements.emptyState.classList.add("hidden");
  elements.errorState.classList.add("hidden");
  elements.subjectsGrid.classList.add("hidden");
}

function showSubjectsState() {
  elements.loadingState.classList.add("hidden");
  elements.emptyState.classList.add("hidden");
  elements.errorState.classList.add("hidden");
  elements.subjectsGrid.classList.remove("hidden");
}

function showEmptyState() {
  elements.loadingState.classList.add("hidden");
  elements.errorState.classList.add("hidden");
  elements.subjectsGrid.classList.add("hidden");
  elements.emptyState.classList.remove("hidden");
}

function showErrorState(message) {
  elements.loadingState.classList.add("hidden");
  elements.emptyState.classList.add("hidden");
  elements.subjectsGrid.classList.add("hidden");
  elements.errorState.classList.remove("hidden");

  elements.errorMessage.textContent = message;
}

/* =====================================================
   UTILITARE — MATERII
===================================================== */

function getSubjectName(subject) {
  return (
    subject.name ||
    subject.subject_name ||
    subject.title ||
    "Materie fără nume"
  );
}

function getTeacherName(subject) {
  return (
    subject.teacher_name ||
    subject.teacher ||
    subject.professor ||
    ""
  );
}

function getSubjectIcon(subjectName, fallbackIcon) {
  const normalizedName = normalizeText(subjectName);

  if (normalizedName.includes("matematic")) {
    return "∑";
  }

  if (
    normalizedName.includes("romana") ||
    normalizedName.includes("română")
  ) {
    return "A";
  }

  if (normalizedName.includes("informatic")) {
    return "</>";
  }

  if (normalizedName.includes("fizic")) {
    return "⚛";
  }

  if (
    normalizedName.includes("biolog") ||
    normalizedName.includes("stiinte")
  ) {
    return "⌁";
  }

  if (normalizedName.includes("chim")) {
    return "◌";
  }

  if (
    normalizedName.includes("englez") ||
    normalizedName.includes("francez") ||
    normalizedName.includes("limba")
  ) {
    return "B";
  }

  if (normalizedName.includes("istor")) {
    return "⌛";
  }

  if (normalizedName.includes("geograf")) {
    return "◎";
  }

  return fallbackIcon;
}

function sortSubjects(subjects) {
  return [...subjects].sort((first, second) =>
    getSubjectName(first).localeCompare(
      getSubjectName(second),
      "ro",
      {
        sensitivity: "base"
      }
    )
  );
}

/* =====================================================
   UTILITARE — CALCULE
===================================================== */

function calculateAverage(values) {
  if (!values.length) {
    return null;
  }

  const total = values.reduce(
    (sum, value) => sum + value,
    0
  );

  return total / values.length;
}

function formatAverage(value) {
  return new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function getSessionDuration(session) {
  const storedDuration = Number(
    session.duration_minutes
  );

  if (
    Number.isFinite(storedDuration) &&
    storedDuration > 0
  ) {
    return storedDuration;
  }

  if (session.started_at && session.ended_at) {
    const startedAt = new Date(session.started_at);
    const endedAt = new Date(session.ended_at);

    const difference =
      endedAt.getTime() - startedAt.getTime();

    if (
      Number.isFinite(difference) &&
      difference > 0
    ) {
      return Math.round(difference / 60000);
    }
  }

  return 0;
}

function formatStudyTime(totalMinutes) {
  const safeMinutes = Math.max(
    0,
    Math.round(Number(totalMinutes) || 0)
  );

  if (safeMinutes < 60) {
    return `${safeMinutes} min`;
  }

  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function formatActiveTasks(count) {
  if (count === 0) {
    return "Niciun task activ";
  }

  if (count === 1) {
    return "1 task activ";
  }

  return `${count} task-uri active`;
}

/* =====================================================
   UTILITARE GENERALE
===================================================== */

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ro-RO")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getInitials(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) {
    return "U";
  }

  return words
    .slice(0, 2)
    .map(word => word.charAt(0).toUpperCase())
    .join("");
}

function startOfToday() {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  return today;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =====================================================
   FORMULAR
===================================================== */

function showFormError(message) {
  elements.subjectFormError.textContent = message;
  elements.subjectFormError.classList.remove("hidden");
}

function hideFormError() {
  elements.subjectFormError.textContent = "";
  elements.subjectFormError.classList.add("hidden");
}

function setSaveButtonLoading(isLoading) {
  elements.saveSubjectButton.disabled = isLoading;

  elements.saveSubjectButton.textContent = isLoading
    ? "Se salvează..."
    : "Salvează materia";
}

/* =====================================================
   TOAST
===================================================== */

function showToast(message, type = "success") {
  window.clearTimeout(state.toastTimeout);

  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden", "error");

  if (type === "error") {
    elements.toast.classList.add("error");
  }

  state.toastTimeout = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 3200);
}
