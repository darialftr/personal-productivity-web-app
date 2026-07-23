"use strict";

const state = {
  session: null,
  userId: null,
  subjectId: null,
  subject: null,
  profile: null,
  grades: [],
  studySessions: [],
  books: [],
  resources: [],
  tasks: [],
  events: [],
  goals: [],
  timerStartedAt: null,
  timerInterval: null,
  toastTimeout: null
};

const el = {
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  errorMessage: document.getElementById("errorMessage"),
  subjectPage: document.getElementById("subjectPage"),

  userName: document.getElementById("userName"),
  userAvatar: document.getElementById("userAvatar"),

  subjectIcon: document.getElementById("subjectIcon"),
  subjectName: document.getElementById("subjectName"),
  subjectTeacher: document.getElementById("subjectTeacher"),

  subjectAverage: document.getElementById("subjectAverage"),
  subjectStudyTime: document.getElementById("subjectStudyTime"),
  activeTasksCount: document.getElementById("activeTasksCount"),
  nextTestValue: document.getElementById("nextTestValue"),

  largeAverage: document.getElementById("largeAverage"),
  gradesList: document.getElementById("gradesList"),
  gradesEmpty: document.getElementById("gradesEmpty"),

  timerDisplay: document.getElementById("timerDisplay"),
  timerCaption: document.getElementById("timerCaption"),
  timerButton: document.getElementById("timerButton"),
  studySessionsCount: document.getElementById("studySessionsCount"),

  booksCount: document.getElementById("booksCount"),
  resourcesCount: document.getElementById("resourcesCount"),
  materialsPreview: document.getElementById("materialsPreview"),

  activityList: document.getElementById("activityList"),
  activityEmpty: document.getElementById("activityEmpty"),

  goalsList: document.getElementById("goalsList"),
  goalsEmpty: document.getElementById("goalsEmpty"),

  openGradeModalButton: document.getElementById("openGradeModalButton"),
  gradeModal: document.getElementById("gradeModal"),
  closeGradeModalButton: document.getElementById("closeGradeModalButton"),
  cancelGradeButton: document.getElementById("cancelGradeButton"),
  gradeForm: document.getElementById("gradeForm"),
  gradeInput: document.getElementById("gradeInput"),
  gradeDescriptionInput: document.getElementById("gradeDescriptionInput"),
  gradeFormError: document.getElementById("gradeFormError"),
  saveGradeButton: document.getElementById("saveGradeButton"),

  toast: document.getElementById("toast")
};

document.addEventListener("DOMContentLoaded", initializeSubjectPage);

async function initializeSubjectPage() {
  bindEvents();

  try {
    state.subjectId = new URLSearchParams(window.location.search).get("id");

    if (!state.subjectId) {
      throw new Error("Materia nu a fost specificată.");
    }

    await loadSession();

    await Promise.all([
      loadProfile(),
      loadSubject()
    ]);

    await loadSubjectData();

    renderPage();
    showPage();
  } catch (error) {
    console.error("Eroare subject page:", error);
    showError(error?.message || "Nu am putut încărca materia.");
  }
}

function bindEvents() {
  el.openGradeModalButton?.addEventListener("click", openGradeModal);

  el.closeGradeModalButton?.addEventListener(
    "click",
    closeGradeModal
  );

  el.cancelGradeButton?.addEventListener(
    "click",
    closeGradeModal
  );

  el.gradeForm?.addEventListener(
    "submit",
    handleAddGrade
  );

  el.timerButton?.addEventListener(
    "click",
    toggleTimer
  );

  el.gradeModal?.addEventListener("click", event => {
    if (event.target === el.gradeModal) {
      closeGradeModal();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeGradeModal();
    }
  });
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
  const { data } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", state.userId)
    .maybeSingle();

  state.profile = data;

  const name =
    data?.name ||
    data?.full_name ||
    data?.first_name ||
    state.session.user.user_metadata?.name ||
    state.session.user.email?.split("@")[0] ||
    "Utilizator";

  el.userName.textContent = name;
  el.userAvatar.textContent = getInitials(name);
}

async function loadSubject() {
  const { data, error } = await supabaseClient
    .from("subjects")
    .select("*")
    .eq("id", state.subjectId)
    .eq("user_id", state.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Materia nu a fost găsită.");
  }

  state.subject = data;
}

async function loadSubjectData() {
  const [
    gradesResult,
    sessionsResult,
    booksResult,
    resourcesResult,
    tasksResult,
    eventsResult,
    goalsResult
  ] = await Promise.all([
    safeQuery("subject_grades"),
    safeQuery("subject_study_sessions"),
    safeQuery("subject_books"),
    safeQuery("subject_resources"),
    safeQuery("tasks"),
    safeQuery("calendar_events"),
    safeQuery("subject_goals")
  ]);

  state.grades = filterBySubject(
    gradesResult.data || []
  );

  state.studySessions = filterBySubject(
    sessionsResult.data || []
  );

  state.books = filterBySubject(
    booksResult.data || []
  );

  state.resources = filterBySubject(
    resourcesResult.data || []
  );

  state.tasks = filterBySubject(
    tasksResult.data || []
  );

  state.events = filterBySubject(
    eventsResult.data || []
  );

  state.goals = filterBySubject(
    goalsResult.data || []
  );
}

async function safeQuery(table) {
  const result = await supabaseClient
    .from(table)
    .select("*")
    .eq("user_id", state.userId);

  if (result.error) {
    console.warn(
      `Nu am putut încărca ${table}:`,
      result.error
    );

    return {
      data: []
    };
  }

  return result;
}

function filterBySubject(items) {
  const subjectName = normalizeText(
    getSubjectName(state.subject)
  );

  return items.filter(item => {
    if (
      String(item.subject_id || "") ===
      String(state.subjectId)
    ) {
      return true;
    }

    return (
      normalizeText(
        item.subject || item.subject_name
      ) === subjectName
    );
  });
}

function renderPage() {
  const name = getSubjectName(state.subject);
  const teacher = getTeacherName(state.subject);
  const icon = getSubjectIcon(name);

  document.title = `${name} | Itera`;

  el.subjectName.textContent = name;
  el.subjectIcon.textContent = icon;

  if (teacher) {
    el.subjectTeacher.textContent = teacher;
    el.subjectTeacher.classList.remove("hidden");
  }

  renderOverview();
  renderGrades();
  renderStudy();
  renderMaterials();
  renderActivity();
  renderGoals();
}

function renderOverview() {
  const average = getAverage();
  const totalMinutes = getTotalStudyMinutes();
  const activeTasks = getActiveTasks();
  const nextTest = getNextTest();

  el.subjectAverage.textContent =
    average === null
      ? "—"
      : formatAverage(average);

  el.subjectStudyTime.textContent =
    formatStudyTime(totalMinutes);

  el.activeTasksCount.textContent =
    activeTasks.length;

  el.nextTestValue.textContent =
    nextTest
      ? formatShortDate(getItemDate(nextTest))
      : "—";
}

function renderGrades() {
  const validGrades = getValidGrades();
  const average = getAverage();

  el.largeAverage.textContent =
    average === null
      ? "—"
      : formatAverage(average);

  el.gradesList.innerHTML = "";

  if (!validGrades.length) {
    el.gradesEmpty.classList.remove("hidden");
    return;
  }

  el.gradesEmpty.classList.add("hidden");

  [...validGrades]
    .sort(
      (a, b) =>
        getItemTimestamp(b.item) -
        getItemTimestamp(a.item)
    )
    .forEach(({ item, value }) => {
      const chip = document.createElement("div");

      chip.className = "grade-chip";

      const description =
        item.description ||
        item.title ||
        item.note ||
        "";

      chip.innerHTML = `
        <span>${escapeHTML(formatGrade(value))}</span>
        ${
          description
            ? `<small>${escapeHTML(description)}</small>`
            : ""
        }
      `;

      el.gradesList.appendChild(chip);
    });
}

function renderStudy() {
  el.subjectStudyTime.textContent =
    formatStudyTime(getTotalStudyMinutes());

  el.studySessionsCount.textContent =
    state.studySessions.length;
}

function renderMaterials() {
  el.booksCount.textContent = pluralize(
    state.books.length,
    "fișier",
    "fișiere"
  );

  el.resourcesCount.textContent = pluralize(
    state.resources.length,
    "element",
    "elemente"
  );

  const combined = [
    ...state.books.map(item => ({
      ...item,
      kind: "Carte"
    })),

    ...state.resources.map(item => ({
      ...item,
      kind: "Resursă"
    }))
  ].slice(0, 3);

  el.materialsPreview.innerHTML = "";

  combined.forEach(item => {
    const node = document.createElement("div");

    node.className = "preview-item";

    node.textContent =
      `${item.kind}: ${
        item.title ||
        item.name ||
        item.file_name ||
        item.url ||
        "Fără titlu"
      }`;

    el.materialsPreview.appendChild(node);
  });
}

function renderActivity() {
  const activeTasks = getActiveTasks();

  const futureEvents = state.events
    .filter(item => {
      const date = getItemDate(item);

      return (
        date &&
        date >= startOfToday()
      );
    })
    .sort(
      (a, b) =>
        getItemDate(a) -
        getItemDate(b)
    );

  const combined = [
    ...activeTasks.map(item => ({
      ...item,
      _kind: "Task"
    })),

    ...futureEvents.map(item => ({
      ...item,
      _kind: "Eveniment"
    }))
  ]
    .sort((a, b) => {
      const first =
        getItemDate(a)?.getTime() ||
        Number.MAX_SAFE_INTEGER;

      const second =
        getItemDate(b)?.getTime() ||
        Number.MAX_SAFE_INTEGER;

      return first - second;
    })
    .slice(0, 6);

  el.activityList.innerHTML = "";

  if (!combined.length) {
    el.activityEmpty.classList.remove("hidden");
    return;
  }

  el.activityEmpty.classList.add("hidden");

  combined.forEach(item => {
    const row = document.createElement("div");

    row.className = "activity-item";

    const date = getItemDate(item);

    row.innerHTML = `
      <div>
        <strong>
          ${escapeHTML(
            item.title ||
            item.name ||
            item._kind
          )}
        </strong>

        <span>
          ${escapeHTML(item._kind)}
        </span>
      </div>

      <span class="activity-date">
        ${
          date
            ? escapeHTML(formatShortDate(date))
            : "Fără dată"
        }
      </span>
    `;

    el.activityList.appendChild(row);
  });
}

function renderGoals() {
  el.goalsList.innerHTML = "";

  if (!state.goals.length) {
    el.goalsEmpty.classList.remove("hidden");
    return;
  }

  el.goalsEmpty.classList.add("hidden");

  state.goals
    .slice(0, 5)
    .forEach(goal => {
      const row = document.createElement("div");

      row.className = "goal-item";

      const completed =
        goal.completed === true ||
        goal.is_completed === true ||
        [
          "done",
          "completed",
          "finalizat"
        ].includes(
          normalizeText(goal.status)
        );

      row.innerHTML = `
        <div>
          <strong>
            ${escapeHTML(
              goal.title ||
              goal.name ||
              goal.goal ||
              "Obiectiv"
            )}
          </strong>

          <span>
            ${
              completed
                ? "Finalizat"
                : "În progres"
            }
          </span>
        </div>

        <span>
          ${completed ? "✓" : "○"}
        </span>
      `;

      el.goalsList.appendChild(row);
    });
}

function openGradeModal() {
  el.gradeForm.reset();

  el.gradeFormError.classList.add(
    "hidden"
  );

  el.gradeModal.classList.remove(
    "hidden"
  );

  document.body.style.overflow = "hidden";

  setTimeout(() => {
    el.gradeInput.focus();
  }, 50);
}

function closeGradeModal() {
  el.gradeModal.classList.add(
    "hidden"
  );

  document.body.style.overflow = "";

  el.gradeForm.reset();

  el.gradeFormError.classList.add(
    "hidden"
  );
}

async function handleAddGrade(event) {
  event.preventDefault();

  const grade = Number(
    el.gradeInput.value
  );

  const description =
    el.gradeDescriptionInput.value.trim();

  if (
    !Number.isFinite(grade) ||
    grade < 1 ||
    grade > 10
  ) {
    showGradeError(
      "Nota trebuie să fie între 1 și 10."
    );

    return;
  }

  el.saveGradeButton.disabled = true;
  el.saveGradeButton.textContent =
    "Se salvează...";

  try {
    let payload = {
      user_id: state.userId,
      subject_id: state.subjectId,
      grade
    };

    if (description) {
      payload.description = description;
    }

    let result = await supabaseClient
      .from("subject_grades")
      .insert(payload)
      .select()
      .single();

    if (
      result.error &&
      description
    ) {
      delete payload.description;

      result = await supabaseClient
        .from("subject_grades")
        .insert(payload)
        .select()
        .single();
    }

    if (result.error) {
      throw result.error;
    }

    state.grades.push(result.data);

    closeGradeModal();
    renderOverview();
    renderGrades();

    showToast(
      "Nota a fost adăugată."
    );
  } catch (error) {
    console.error(
      "Eroare la adăugarea notei:",
      error
    );

    showGradeError(
      error?.message ||
      "Nota nu a putut fi salvată."
    );
  } finally {
    el.saveGradeButton.disabled = false;

    el.saveGradeButton.textContent =
      "Salvează nota";
  }
}

function showGradeError(message) {
  el.gradeFormError.textContent = message;

  el.gradeFormError.classList.remove(
    "hidden"
  );
}

function toggleTimer() {
  if (state.timerStartedAt) {
    stopTimer();
  } else {
    startTimer();
  }
}

function startTimer() {
  state.timerStartedAt = new Date();

  updateTimer();

  state.timerInterval =
    window.setInterval(
      updateTimer,
      1000
    );

  el.timerButton.textContent =
    "■ Oprește și salvează";

  el.timerButton.classList.add(
    "running"
  );

  el.timerCaption.textContent =
    "Sesiunea este în desfășurare.";
}

async function stopTimer() {
  const endedAt = new Date();
  const startedAt = state.timerStartedAt;

  const durationMinutes = Math.max(
    1,
    Math.round(
      (
        endedAt.getTime() -
        startedAt.getTime()
      ) / 60000
    )
  );

  window.clearInterval(
    state.timerInterval
  );

  state.timerInterval = null;
  state.timerStartedAt = null;

  el.timerButton.disabled = true;

  el.timerButton.textContent =
    "Se salvează...";

  try {
    const payload = {
      user_id: state.userId,
      subject_id: state.subjectId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_minutes: durationMinutes
    };

    const {
      data,
      error
    } = await supabaseClient
      .from("subject_study_sessions")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw error;
    }

    state.studySessions.push(data);

    renderOverview();
    renderStudy();

    showToast(
      "Sesiunea a fost salvată."
    );
  } catch (error) {
    console.error(
      "Eroare salvare sesiune:",
      error
    );

    showToast(
      error?.message ||
      "Sesiunea nu a putut fi salvată.",
      "error"
    );
  } finally {
    el.timerDisplay.textContent =
      "00:00:00";

    el.timerCaption.textContent =
      "Pornește o sesiune pentru această materie.";

    el.timerButton.disabled = false;

    el.timerButton.textContent =
      "▶ Începe sesiunea";

    el.timerButton.classList.remove(
      "running"
    );
  }
}

function updateTimer() {
  if (!state.timerStartedAt) {
    return;
  }

  const seconds = Math.floor(
    (
      Date.now() -
      state.timerStartedAt.getTime()
    ) / 1000
  );

  const hours = Math.floor(
    seconds / 3600
  );

  const minutes = Math.floor(
    (seconds % 3600) / 60
  );

  const remainingSeconds =
    seconds % 60;

  el.timerDisplay.textContent = [
    hours,
    minutes,
    remainingSeconds
  ]
    .map(value =>
      String(value).padStart(2, "0")
    )
    .join(":");
}

function getValidGrades() {
  return state.grades
    .map(item => ({
      item,

      value: Number(
        item.grade ??
        item.value ??
        item.score
      )
    }))
    .filter(entry =>
      Number.isFinite(entry.value)
    );
}

function getAverage() {
  const values = getValidGrades()
    .map(entry => entry.value);

  if (!values.length) {
    return null;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / values.length
  );
}

function getTotalStudyMinutes() {
  return state.studySessions.reduce(
    (total, item) => {
      const stored = Number(
        item.duration_minutes
      );

      if (
        Number.isFinite(stored) &&
        stored > 0
      ) {
        return total + stored;
      }

      if (
        item.started_at &&
        item.ended_at
      ) {
        const difference =
          new Date(item.ended_at) -
          new Date(item.started_at);

        if (difference > 0) {
          return (
            total +
            Math.round(
              difference / 60000
            )
          );
        }
      }

      return total;
    },
    0
  );
}

function getActiveTasks() {
  return state.tasks.filter(item => {
    const status = normalizeText(
      item.status ||
      item.state
    );

    return !(
      item.completed === true ||
      item.is_completed === true ||
      [
        "done",
        "completed",
        "finalizat",
        "terminat"
      ].includes(status)
    );
  });
}

function getNextTest() {
  return (
    state.events
      .filter(item => {
        const date = getItemDate(item);

        if (
          !date ||
          date < startOfToday()
        ) {
          return false;
        }

        const value = normalizeText(
          `${
            item.event_type ||
            item.type ||
            ""
          } ${
            item.title ||
            ""
          }`
        );

        return [
          "test",
          "examen",
          "exam",
          "teza",
          "simulare",
          "evaluare"
        ].some(word =>
          value.includes(
            normalizeText(word)
          )
        );
      })
      .sort(
        (a, b) =>
          getItemDate(a) -
          getItemDate(b)
      )[0] || null
  );
}

function getItemDate(item) {
  const value =
    item.due_date ||
    item.event_date ||
    item.start_date ||
    item.date ||
    item.start_time ||
    item.deadline;

  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}

function getItemTimestamp(item) {
  const value =
    item.created_at ||
    item.date ||
    item.updated_at;

  const date = value
    ? new Date(value)
    : null;

  return (
    date &&
    !Number.isNaN(date.getTime())
  )
    ? date.getTime()
    : 0;
}

function getSubjectName(subject) {
  return (
    subject?.name ||
    subject?.subject_name ||
    subject?.title ||
    "Materie"
  );
}

function getTeacherName(subject) {
  return (
    subject?.teacher_name ||
    subject?.teacher ||
    subject?.professor ||
    ""
  );
}

function getSubjectIcon(name) {
  const value = normalizeText(name);

  if (
    value.includes("matematic")
  ) {
    return "Σ";
  }

  if (
    value.includes("informatic")
  ) {
    return "</>";
  }

  if (
    value.includes("fizic")
  ) {
    return "⚛";
  }

  if (
    value.includes("chim")
  ) {
    return "◌";
  }

  if (
    value.includes("biolog")
  ) {
    return "⌁";
  }

  if (
    value.includes("istor")
  ) {
    return "⌛";
  }

  if (
    value.includes("geograf")
  ) {
    return "◎";
  }

  if (
    value.includes("romana")
  ) {
    return "A";
  }

  if (
    value.includes("englez") ||
    value.includes("francez")
  ) {
    return "B";
  }

  return getSubjectName(
    state.subject
  )
    .charAt(0)
    .toUpperCase();
}

function formatAverage(value) {
  return new Intl.NumberFormat(
    "ro-RO",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  ).format(value);
}

function formatGrade(value) {
  return Number.isInteger(value)
    ? String(value)
    : new Intl.NumberFormat(
        "ro-RO",
        {
          maximumFractionDigits: 2
        }
      ).format(value);
}

function formatStudyTime(
  totalMinutes
) {
  const minutes = Math.max(
    0,
    Math.round(
      Number(totalMinutes) || 0
    )
  );

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(
    minutes / 60
  );

  const remainder =
    minutes % 60;

  return remainder
    ? `${hours}h ${remainder}m`
    : `${hours}h`;
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat(
    "ro-RO",
    {
      day: "numeric",
      month: "short"
    }
  ).format(date);
}

function pluralize(
  count,
  singular,
  plural
) {
  return `${count} ${
    count === 1
      ? singular
      : plural
  }`;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ro-RO")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    );
}

function getInitials(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words.length
    ? words
        .slice(0, 2)
        .map(word =>
          word[0].toUpperCase()
        )
        .join("")
    : "U";
}

function startOfToday() {
  const date = new Date();

  date.setHours(
    0,
    0,
    0,
    0
  );

  return date;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

function showPage() {
  el.loadingState.classList.add(
    "hidden"
  );

  el.errorState.classList.add(
    "hidden"
  );

  el.subjectPage.classList.remove(
    "hidden"
  );
}

function showError(message) {
  el.loadingState.classList.add(
    "hidden"
  );

  el.subjectPage.classList.add(
    "hidden"
  );

  el.errorState.classList.remove(
    "hidden"
  );

  el.errorMessage.textContent =
    message;
}

function showToast(
  message,
  type = "success"
) {
  window.clearTimeout(
    state.toastTimeout
  );

  el.toast.textContent = message;

  el.toast.classList.remove(
    "hidden",
    "error"
  );

  if (type === "error") {
    el.toast.classList.add(
      "error"
    );
  }

  state.toastTimeout =
    window.setTimeout(() => {
      el.toast.classList.add(
        "hidden"
      );
    }, 3200);
}
