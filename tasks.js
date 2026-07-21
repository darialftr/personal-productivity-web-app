"use strict";

const TASKS_STORAGE_KEY = "itera_tasks";
const PROFILE_STORAGE_KEY = "itera_profile";

const typeLabels = {
  homework: "Temă",
  study: "Învățat",
  test: "Test",
  project: "Proiect",
  personal: "Personal",
  reminder: "Reminder"
};

const priorityLabels = {
  low: "Prioritate mică",
  medium: "Prioritate medie",
  high: "Prioritate mare"
};

const difficultyLabels = {
  "very-easy": "Foarte ușor",
  easy: "Ușor",
  medium: "Mediu",
  hard: "Greu",
  "very-hard": "Foarte greu"
};

let profile = loadProfile();
let tasks = loadTasks();

let activeFilter = "all";
let searchQuery = "";
let taskPendingDeletionId = null;
let toastTimeout = null;

initializePage();

function initializePage() {
  renderProfile();
  populateSubjectSelect();
  setDefaultDeadline();
  initializeEvents();
  renderEverything();
}

/* PROFILE */

function loadProfile() {
  try {
    return (
      JSON.parse(
        localStorage.getItem(PROFILE_STORAGE_KEY)
      ) || {}
    );
  } catch (error) {
    console.error("Profilul nu a putut fi încărcat:", error);
    return {};
  }
}

function renderProfile() {
  const firstName = profile.firstName || "Daria";
  const gradeLevel = profile.gradeLevel || "12";

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
    gradeLevel === "other"
      ? "Elev"
      : `Clasa a ${toRomanNumeral(Number(gradeLevel))}-a`;
}

function toRomanNumeral(number) {
  const numerals = {
    9: "IX",
    10: "X",
    11: "XI",
    12: "XII"
  };

  return numerals[number] || String(number);
}

function populateSubjectSelect() {
  const subjectSelect = document.getElementById(
    "taskSubject"
  );

  const subjects = Array.isArray(profile.subjects)
    ? profile.subjects
    : [];

  subjects.forEach((subject) => {
    const option = document.createElement("option");

    option.value = subject;
    option.textContent = subject;

    subjectSelect.appendChild(option);
  });
}

/* STORAGE */

function loadTasks() {
  try {
    const storedTasks = localStorage.getItem(
      TASKS_STORAGE_KEY
    );

    if (!storedTasks) {
      return [];
    }

    const parsedTasks = JSON.parse(storedTasks);

    return Array.isArray(parsedTasks)
      ? parsedTasks
      : [];
  } catch (error) {
    console.error("Task-urile nu au putut fi citite:", error);
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(
    TASKS_STORAGE_KEY,
    JSON.stringify(tasks)
  );
}

/* EVENTS */

function initializeEvents() {
  document
    .getElementById("addTaskButton")
    .addEventListener("click", openCreateTaskModal);

  document
    .getElementById("mobileAddTaskButton")
    .addEventListener("click", openCreateTaskModal);

  document
    .getElementById("suggestionActionButton")
    .addEventListener("click", handleSuggestionAction);

  document
    .getElementById("closeTaskModalButton")
    .addEventListener("click", () => {
      closeModal("taskModal");
    });

  document
    .getElementById("cancelTaskButton")
    .addEventListener("click", () => {
      closeModal("taskModal");
    });

  document
    .getElementById("taskForm")
    .addEventListener("submit", handleTaskSubmit);

  document
    .getElementById("taskProgress")
    .addEventListener("input", updateProgressInputLabel);

  document
    .getElementById("taskSearchInput")
    .addEventListener("input", (event) => {
      searchQuery = event.target.value
        .trim()
        .toLowerCase();

      renderTaskList();
    });

  document
    .querySelectorAll("[data-filter]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter;

        document
          .querySelectorAll("[data-filter]")
          .forEach((filterButton) => {
            filterButton.classList.toggle(
              "active",
              filterButton === button
            );
          });

        renderTaskList();
      });
    });

  document
    .getElementById("taskSortSelect")
    .addEventListener("change", renderTaskList);

  document
    .getElementById("deleteTaskButton")
    .addEventListener("click", requestEditingTaskDeletion);

  document
    .getElementById("cancelTaskDeletionButton")
    .addEventListener("click", () => {
      taskPendingDeletionId = null;
      closeModal("deleteConfirmationModal");
    });

  document
    .getElementById("confirmTaskDeletionButton")
    .addEventListener("click", confirmTaskDeletion);

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
      .forEach((modal) => {
        closeModal(modal.id);
      });
  });
}

/* MODALS */

function openModal(modalId) {
  const modal = document.getElementById(modalId);

  modal.classList.add("visible");
  modal.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);

  modal.classList.remove("visible");
  modal.setAttribute("aria-hidden", "true");

  if (!document.querySelector(".modal-overlay.visible")) {
    document.body.style.overflow = "";
  }
}

function openCreateTaskModal() {
  const form = document.getElementById("taskForm");

  form.reset();

  document.getElementById(
    "editingTaskId"
  ).value = "";

  document.getElementById(
    "taskModalKicker"
  ).textContent = "Task nou";

  document.getElementById(
    "taskModalTitle"
  ).textContent = "Adaugă un task";

  document.getElementById(
    "saveTaskButton"
  ).textContent = "Salvează";

  document.getElementById(
    "deleteTaskButton"
  ).classList.add("hidden");

  document.getElementById(
    "taskPriority"
  ).value = "medium";

  document.getElementById(
    "taskDifficulty"
  ).value = "medium";

  document.getElementById(
    "taskEstimatedMinutes"
  ).value = "60";

  document.getElementById(
    "taskProgress"
  ).value = "0";

  document.getElementById(
    "taskProgressValue"
  ).textContent = "0%";

  document.getElementById(
    "taskFormError"
  ).textContent = "";

  setDefaultDeadline();

  openModal("taskModal");

  setTimeout(() => {
    document.getElementById("taskTitle").focus();
  }, 180);
}

function openEditTaskModal(taskId) {
  const task = tasks.find(
    (currentTask) => currentTask.id === taskId
  );

  if (!task) {
    return;
  }

  document.getElementById(
    "editingTaskId"
  ).value = task.id;

  document.getElementById(
    "taskTitle"
  ).value = task.title;

  document.getElementById(
    "taskType"
  ).value = task.type;

  document.getElementById(
    "taskSubject"
  ).value = task.subject || "";

  document.getElementById(
    "taskDeadline"
  ).value = task.deadline;

  document.getElementById(
    "taskDeadlineTime"
  ).value = task.deadlineTime || "";

  document.getElementById(
    "taskPriority"
  ).value = task.priority;

  document.getElementById(
    "taskDifficulty"
  ).value = task.difficulty;

  document.getElementById(
    "taskEstimatedMinutes"
  ).value = String(task.estimatedMinutes);

  document.getElementById(
    "taskProgress"
  ).value = String(task.progress);

  document.getElementById(
    "taskProgressValue"
  ).textContent = `${task.progress}%`;

  document.getElementById(
    "taskNotes"
  ).value = task.notes || "";

  document.getElementById(
    "taskModalKicker"
  ).textContent = "Modifică task-ul";

  document.getElementById(
    "taskModalTitle"
  ).textContent = "Editează task-ul";

  document.getElementById(
    "saveTaskButton"
  ).textContent = "Salvează modificările";

  document.getElementById(
    "deleteTaskButton"
  ).classList.remove("hidden");

  document.getElementById(
    "taskFormError"
  ).textContent = "";

  openModal("taskModal");
}

function setDefaultDeadline() {
  const deadlineInput = document.getElementById(
    "taskDeadline"
  );

  const tomorrow = new Date();

  tomorrow.setDate(tomorrow.getDate() + 1);

  deadlineInput.value = toDateInputValue(tomorrow);
}

function updateProgressInputLabel() {
  const value = document.getElementById(
    "taskProgress"
  ).value;

  document.getElementById(
    "taskProgressValue"
  ).textContent = `${value}%`;
}

/* FORM */

function handleTaskSubmit(event) {
  event.preventDefault();

  const title = document
    .getElementById("taskTitle")
    .value
    .trim();

  const deadline = document.getElementById(
    "taskDeadline"
  ).value;

  if (!title) {
    showFormError("Scrie titlul task-ului.");
    return;
  }

  if (!deadline) {
    showFormError("Alege deadline-ul task-ului.");
    return;
  }

  const progress = Number(
    document.getElementById("taskProgress").value
  );

  const taskData = {
    title,

    type: document.getElementById(
      "taskType"
    ).value,

    subject: document.getElementById(
      "taskSubject"
    ).value,

    deadline,

    deadlineTime: document.getElementById(
      "taskDeadlineTime"
    ).value,

    priority: document.getElementById(
      "taskPriority"
    ).value,

    difficulty: document.getElementById(
      "taskDifficulty"
    ).value,

    estimatedMinutes: Number(
      document.getElementById(
        "taskEstimatedMinutes"
      ).value
    ),

    progress,

    notes: document
      .getElementById("taskNotes")
      .value
      .trim(),

    completed: progress === 100
  };

  const editingTaskId = document.getElementById(
    "editingTaskId"
  ).value;

  if (editingTaskId) {
    tasks = tasks.map((task) => {
      if (task.id !== editingTaskId) {
        return task;
      }

      return {
        ...task,
        ...taskData,
        updatedAt: new Date().toISOString()
      };
    });

    showToast(
      "Task-ul a fost actualizat.",
      "✓"
    );
  } else {
    tasks.push({
      id: createId(),
      ...taskData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    showToast(
      "Task-ul a fost adăugat.",
      "＋"
    );
  }

  saveTasks();
  renderEverything();
  closeModal("taskModal");
}

function showFormError(message) {
  document.getElementById(
    "taskFormError"
  ).textContent = message;
}

/* DELETE */

function requestEditingTaskDeletion() {
  const editingTaskId = document.getElementById(
    "editingTaskId"
  ).value;

  if (!editingTaskId) {
    return;
  }

  taskPendingDeletionId = editingTaskId;

  closeModal("taskModal");
  openModal("deleteConfirmationModal");
}

function confirmTaskDeletion() {
  if (!taskPendingDeletionId) {
    return;
  }

  tasks = tasks.filter(
    (task) => task.id !== taskPendingDeletionId
  );

  taskPendingDeletionId = null;

  saveTasks();
  renderEverything();

  closeModal("deleteConfirmationModal");

  showToast(
    "Task-ul a fost șters.",
    "×"
  );
}

/* COMPLETE */

function toggleTaskCompletion(taskId) {
  tasks = tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const newCompletedState = !task.completed;

    return {
      ...task,
      completed: newCompletedState,
      progress: newCompletedState ? 100 : 0,
      updatedAt: new Date().toISOString()
    };
  });

  saveTasks();
  renderEverything();

  const changedTask = tasks.find(
    (task) => task.id === taskId
  );

  showToast(
    changedTask?.completed
      ? "Task finalizat. Bravo!"
      : "Task-ul a fost redeschis.",
    changedTask?.completed ? "✓" : "↺"
  );
}

/* FILTERING */

function getFilteredTasks() {
  let filteredTasks = [...tasks];

  if (activeFilter === "completed") {
    filteredTasks = filteredTasks.filter(
      (task) => task.completed
    );
  } else if (activeFilter !== "all") {
    filteredTasks = filteredTasks.filter(
      (task) =>
        task.type === activeFilter &&
        !task.completed
    );
  } else {
    filteredTasks = filteredTasks.filter(
      (task) => !task.completed
    );
  }

  if (searchQuery) {
    filteredTasks = filteredTasks.filter((task) => {
      const searchableText = [
        task.title,
        task.subject,
        task.notes,
        typeLabels[task.type]
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchQuery);
    });
  }

  return sortTasks(filteredTasks);
}

function sortTasks(taskArray) {
  const sortMode = document.getElementById(
    "taskSortSelect"
  ).value;

  const sortedTasks = [...taskArray];

  if (sortMode === "priority") {
    const priorityWeight = {
      high: 3,
      medium: 2,
      low: 1
    };

    sortedTasks.sort(
      (firstTask, secondTask) =>
        priorityWeight[secondTask.priority] -
        priorityWeight[firstTask.priority]
    );
  } else if (sortMode === "progress") {
    sortedTasks.sort(
      (firstTask, secondTask) =>
        secondTask.progress - firstTask.progress
    );
  } else if (sortMode === "created") {
    sortedTasks.sort(
      (firstTask, secondTask) =>
        new Date(secondTask.createdAt) -
        new Date(firstTask.createdAt)
    );
  } else {
    sortedTasks.sort((firstTask, secondTask) => {
      const firstDate = getTaskDeadlineDate(firstTask);
      const secondDate = getTaskDeadlineDate(secondTask);

      return firstDate - secondDate;
    });
  }

  return sortedTasks;
}

/* RENDER */

function renderEverything() {
  renderSummary();
  renderTaskList();
  renderWeeklyProgress();
  renderSuggestion();
}

function renderSummary() {
  const openTasks = tasks.filter(
    (task) => !task.completed
  );

  const completedTasks = tasks.filter(
    (task) => task.completed
  );

  const todayValue = toDateInputValue(new Date());

  const todayTasks = openTasks.filter(
    (task) => task.deadline === todayValue
  );

  const highPriorityTasks = openTasks.filter(
    (task) => task.priority === "high"
  );

  document.getElementById(
    "openTasksCount"
  ).textContent = openTasks.length;

  document.getElementById(
    "todayTasksCount"
  ).textContent = todayTasks.length;

  document.getElementById(
    "highPriorityCount"
  ).textContent = highPriorityTasks.length;

  document.getElementById(
    "completedTasksCount"
  ).textContent = completedTasks.length;
}

function renderTaskList() {
  const taskList = document.getElementById(
    "taskList"
  );

  const filteredTasks = getFilteredTasks();

  updateTaskListTitle();

  if (filteredTasks.length === 0) {
    taskList.innerHTML = `
      <div class="empty-state">
        <div>
          <div class="empty-state-icon">✿</div>

          <h3>Nu există task-uri aici</h3>

          <p>
            Adaugă un task nou sau schimbă filtrul selectat.
          </p>

          <button
            type="button"
            class="primary-button"
            id="emptyStateAddButton"
          >
            ＋ Adaugă task
          </button>
        </div>
      </div>
    `;

    document
      .getElementById("emptyStateAddButton")
      .addEventListener("click", openCreateTaskModal);

    return;
  }

  taskList.innerHTML = filteredTasks
    .map(createTaskMarkup)
    .join("");

  taskList
    .querySelectorAll("[data-complete-task]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        toggleTaskCompletion(
          button.dataset.completeTask
        );
      });
    });

  taskList
    .querySelectorAll("[data-edit-task]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        openEditTaskModal(
          button.dataset.editTask
        );
      });
    });
}

function createTaskMarkup(task) {
  const overdue =
    !task.completed &&
    getTaskDeadlineDate(task) < startOfToday();

  const deadlineLabel = formatDeadline(task);
  const progress = Number(task.progress) || 0;

  return `
    <article
      class="task-card
        ${task.completed ? "completed" : ""}
        ${overdue ? "overdue" : ""}"
    >
      <button
        type="button"
        class="task-complete-button
          ${task.completed ? "checked" : ""}"
        data-complete-task="${task.id}"
        aria-label="${
          task.completed
            ? "Redeschide task-ul"
            : "Marchează ca finalizat"
        }"
      >
        ${task.completed ? "✓" : ""}
      </button>

      <div class="task-card-content">
        <div class="task-title-row">
          <h3>${escapeHtml(task.title)}</h3>

          <span class="task-type-tag ${task.type}">
            ${escapeHtml(typeLabels[task.type] || "Task")}
          </span>
        </div>

        <div class="task-meta">
          ${
            task.subject
              ? `
                <span class="meta-pill">
                  ◇ ${escapeHtml(task.subject)}
                </span>
              `
              : ""
          }

          <span class="meta-pill ${overdue ? "overdue" : ""}">
            ${overdue ? "!" : "□"}
            ${escapeHtml(deadlineLabel)}
          </span>

          <span class="meta-pill">
            ◷ ${formatDuration(task.estimatedMinutes)}
          </span>

          <span
            class="meta-pill
              ${
                task.priority === "high"
                  ? "high-priority"
                  : ""
              }"
          >
            ${escapeHtml(priorityLabels[task.priority])}
          </span>

          <span class="meta-pill">
            ${escapeHtml(difficultyLabels[task.difficulty])}
          </span>
        </div>

        ${
          task.notes
            ? `
              <p class="task-notes">
                ${escapeHtml(task.notes)}
              </p>
            `
            : ""
        }

        <div class="task-progress-area">
          <div class="task-progress-header">
            <span>Progres</span>
            <strong>${progress}%</strong>
          </div>

          <div class="task-progress-track">
            <div
              class="task-progress-bar"
              style="width: ${progress}%"
            ></div>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="task-action-button"
        data-edit-task="${task.id}"
        aria-label="Editează task-ul"
      >
        ›
      </button>
    </article>
  `;
}

function updateTaskListTitle() {
  const labels = {
    all: "Task-uri active",
    homework: "Temele tale",
    study: "Sesiuni de studiu",
    test: "Teste și evaluări",
    project: "Proiectele tale",
    personal: "Task-uri personale",
    completed: "Task-uri finalizate"
  };

  document.getElementById(
    "taskListTitle"
  ).textContent =
    labels[activeFilter] || "Task-uri";
}

function renderWeeklyProgress() {
  if (tasks.length === 0) {
    updateProgressCircle(0);

    document.getElementById(
      "weeklyProgressMessage"
    ).textContent =
      "Adaugă primul task pentru a începe.";

    return;
  }

  const completedCount = tasks.filter(
    (task) => task.completed
  ).length;

  const percentage = Math.round(
    (completedCount / tasks.length) * 100
  );

  updateProgressCircle(percentage);

  let message =
    "Ai început bine. Continuă în același ritm.";

  if (percentage === 100) {
    message =
      "Ai terminat toate task-urile. Extraordinar!";
  } else if (percentage >= 70) {
    message =
      "Ești foarte aproape de final.";
  } else if (percentage >= 40) {
    message =
      "Ai trecut de partea cea mai grea.";
  } else if (percentage === 0) {
    message =
      "Începe cu cel mai mic task din listă.";
  }

  document.getElementById(
    "weeklyProgressMessage"
  ).textContent = message;
}

function updateProgressCircle(percentage) {
  const degrees = percentage * 3.6;

  const circle = document.getElementById(
    "progressCircle"
  );

  circle.style.background = `
    conic-gradient(
      var(--primary-dark) ${degrees}deg,
      #f5e4eb ${degrees}deg
    )
  `;

  document.getElementById(
    "weeklyProgressValue"
  ).textContent = `${percentage}%`;
}

function renderSuggestion() {
  const openTasks = tasks
    .filter((task) => !task.completed)
    .sort((firstTask, secondTask) => {
      return (
        getTaskDeadlineDate(firstTask) -
        getTaskDeadlineDate(secondTask)
      );
    });

  const title = document.getElementById(
    "focusSuggestionTitle"
  );

  const text = document.getElementById(
    "focusSuggestionText"
  );

  const button = document.getElementById(
    "suggestionActionButton"
  );

  if (openTasks.length === 0) {
    title.textContent = "Totul este sub control";

    text.textContent =
      "Nu ai încă task-uri urgente.";

    button.textContent = "Adaugă un task";
    button.dataset.action = "add";

    return;
  }

  const suggestedTask =
    openTasks.find(
      (task) => task.priority === "high"
    ) || openTasks[0];

  title.textContent = suggestedTask.title;

  text.textContent =
    `Acesta este task-ul pe care ar fi bine ` +
    `să îl începi următorul. Deadline: ` +
    `${formatDeadline(suggestedTask)}.`;

  button.textContent = "Deschide task-ul";
  button.dataset.action = suggestedTask.id;
}

function handleSuggestionAction() {
  const action = document.getElementById(
    "suggestionActionButton"
  ).dataset.action;

  if (!action || action === "add") {
    openCreateTaskModal();
    return;
  }

  openEditTaskModal(action);
}

/* DATE HELPERS */

function getTaskDeadlineDate(task) {
  const time = task.deadlineTime || "23:59";

  return new Date(`${task.deadline}T${time}:00`);
}

function startOfToday() {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  return today;
}

function formatDeadline(task) {
  const taskDate = new Date(
    `${task.deadline}T12:00:00`
  );

  const today = startOfToday();

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const taskDay = new Date(taskDate);
  taskDay.setHours(0, 0, 0, 0);

  let dateText;

  if (taskDay.getTime() === today.getTime()) {
    dateText = "Astăzi";
  } else if (
    taskDay.getTime() === tomorrow.getTime()
  ) {
    dateText = "Mâine";
  } else {
    dateText = new Intl.DateTimeFormat(
      "ro-RO",
      {
        day: "numeric",
        month: "short"
      }
    ).format(taskDate);
  }

  if (task.deadlineTime) {
    return `${dateText}, ${task.deadlineTime}`;
  }

  return dateText;
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDuration(minutes) {
  const numericMinutes = Number(minutes) || 0;

  if (numericMinutes < 60) {
    return `${numericMinutes} min`;
  }

  const hours = Math.floor(
    numericMinutes / 60
  );

  const remainingMinutes =
    numericMinutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

/* UTILITIES */

function createId() {
  return `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

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
  }, 2600);
}

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
