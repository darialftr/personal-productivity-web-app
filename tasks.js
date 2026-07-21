"use strict";

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

let currentUser = null;
let profile = null;
let subjects = [];
let tasks = [];

let activeFilter = "all";
let searchQuery = "";
let taskPendingDeletionId = null;
let toastTimeout = null;
let isSaving = false;

initializePage();

async function initializePage() {
  initializeEvents();
  setDefaultDeadline();
  renderLoadingState();

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
      loadTasks()
    ]);

    renderProfile();
    populateSubjectSelect();
    renderEverything();
  } catch (error) {
    console.error("Eroare la inițializarea paginii:", error);

    renderPageError(
      "Datele nu au putut fi încărcate. Reîncarcă pagina."
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
    id: currentUser.id,
    first_name:
      currentUser.user_metadata?.first_name || "Itera",
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
  ).textContent = formatGrade(grade);
}

function formatGrade(grade) {
  if (!grade) {
    return "Cont Itera";
  }

  const normalizedGrade = String(grade)
    .trim()
    .toLowerCase();

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

  return gradeMap[normalizedGrade] || grade;
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
  const subjectSelect = document.getElementById(
    "taskSubject"
  );

  subjectSelect.innerHTML = `
    <option value="">
      Fără materie
    </option>
  `;

  subjects.forEach((subject) => {
    const option = document.createElement("option");

    option.value = subject.id;
    option.textContent = subject.name;

    subjectSelect.appendChild(option);
  });
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
        completed_at,
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
    .order("created_at", {
      ascending: false
    });

  if (error) {
    throw error;
  }

  tasks = (data || []).map(normalizeTask);
}

function normalizeTask(task) {
  return {
    id: task.id,
    userId: task.user_id,
    subjectId: task.subject_id,

    title: task.title,
    type: task.task_type,

    deadline: task.deadline_date,
    deadlineTime: normalizeTime(task.deadline_time),

    priority: task.priority,
    difficulty: task.difficulty,

    estimatedMinutes:
      Number(task.estimated_minutes) || 0,

    progress:
      Number(task.progress) || 0,

    notes: task.notes || "",
    completed: Boolean(task.completed),

    completedAt: task.completed_at,
    createdAt: task.created_at,
    updatedAt: task.updated_at,

    subject: task.subjects?.name || "",
    subjectData: task.subjects || null
  };
}

function normalizeTime(timeValue) {
  if (!timeValue) {
    return "";
  }

  return String(timeValue).slice(0, 5);
}

/* EVENTS */

function initializeEvents() {
  document
    .getElementById("addTaskButton")
    .addEventListener(
      "click",
      openCreateTaskModal
    );

  document
    .getElementById("mobileAddTaskButton")
    .addEventListener(
      "click",
      openCreateTaskModal
    );

  document
    .getElementById("suggestionActionButton")
    .addEventListener(
      "click",
      handleSuggestionAction
    );

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
    .addEventListener(
      "submit",
      handleTaskSubmit
    );

  document
    .getElementById("taskProgress")
    .addEventListener(
      "input",
      updateProgressInputLabel
    );

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
    .addEventListener(
      "change",
      renderTaskList
    );

  document
    .getElementById("deleteTaskButton")
    .addEventListener(
      "click",
      requestEditingTaskDeletion
    );

  document
    .getElementById("cancelTaskDeletionButton")
    .addEventListener("click", () => {
      taskPendingDeletionId = null;
      closeModal("deleteConfirmationModal");
    });

  document
    .getElementById("confirmTaskDeletionButton")
    .addEventListener(
      "click",
      confirmTaskDeletion
    );

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

  window.addEventListener("focus", async () => {
    if (!currentUser) {
      return;
    }

    try {
      await loadTasks();
      renderEverything();
    } catch (error) {
      console.error(
        "Task-urile nu au putut fi reîmprospătate:",
        error
      );
    }
  });
}

/* MODALS */

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

  if (
    !document.querySelector(
      ".modal-overlay.visible"
    )
  ) {
    document.body.style.overflow = "";
  }
}

function openCreateTaskModal() {
  const form = document.getElementById(
    "taskForm"
  );

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
    document.getElementById(
      "taskTitle"
    ).focus();
  }, 180);
}

function openEditTaskModal(taskId) {
  const task = tasks.find(
    (currentTask) =>
      currentTask.id === taskId
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
  ).value = task.subjectId || "";

  document.getElementById(
    "taskDeadline"
  ).value = task.deadline || "";

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
  ).value = String(
    task.estimatedMinutes
  );

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
  const deadlineInput =
    document.getElementById("taskDeadline");

  const tomorrow = new Date();

  tomorrow.setDate(
    tomorrow.getDate() + 1
  );

  deadlineInput.value =
    toDateInputValue(tomorrow);
}

function updateProgressInputLabel() {
  const value = document.getElementById(
    "taskProgress"
  ).value;

  document.getElementById(
    "taskProgressValue"
  ).textContent = `${value}%`;
}

/* CREATE / UPDATE */

async function handleTaskSubmit(event) {
  event.preventDefault();

  if (isSaving) {
    return;
  }

  const title = document
    .getElementById("taskTitle")
    .value
    .trim();

  const deadline = document.getElementById(
    "taskDeadline"
  ).value;

  if (!title) {
    showFormError(
      "Scrie titlul task-ului."
    );
    return;
  }

  if (!deadline) {
    showFormError(
      "Alege deadline-ul task-ului."
    );
    return;
  }

  if (!currentUser) {
    showFormError(
      "Sesiunea a expirat. Autentifică-te din nou."
    );
    return;
  }

  const progress = Number(
    document.getElementById(
      "taskProgress"
    ).value
  );

  const completed = progress === 100;

  const taskData = {
    user_id: currentUser.id,

    subject_id:
      document.getElementById(
        "taskSubject"
      ).value || null,

    title,

    task_type:
      document.getElementById(
        "taskType"
      ).value,

    deadline_date: deadline,

    deadline_time:
      document.getElementById(
        "taskDeadlineTime"
      ).value || null,

    priority:
      document.getElementById(
        "taskPriority"
      ).value,

    difficulty:
      document.getElementById(
        "taskDifficulty"
      ).value,

    estimated_minutes: Number(
      document.getElementById(
        "taskEstimatedMinutes"
      ).value
    ),

    progress,

    notes:
      document
        .getElementById("taskNotes")
        .value
        .trim() || null,

    completed,

    completed_at:
      completed
        ? new Date().toISOString()
        : null
  };

  const editingTaskId =
    document.getElementById(
      "editingTaskId"
    ).value;

  setSaveButtonLoading(true);
  showFormError("");

  try {
    if (editingTaskId) {
      await updateTask(
        editingTaskId,
        taskData
      );

      showToast(
        "Task-ul a fost actualizat.",
        "✓"
      );
    } else {
      await createTask(taskData);

      showToast(
        "Task-ul a fost adăugat.",
        "＋"
      );
    }

    await loadTasks();
    renderEverything();

    closeModal("taskModal");
  } catch (error) {
    console.error(
      "Task-ul nu a putut fi salvat:",
      error
    );

    showFormError(
      translateDatabaseError(error)
    );
  } finally {
    setSaveButtonLoading(false);
  }
}

async function createTask(taskData) {
  const { error } = await supabaseClient
    .from("tasks")
    .insert(taskData);

  if (error) {
    throw error;
  }
}

async function updateTask(
  taskId,
  taskData
) {
  const { error } = await supabaseClient
    .from("tasks")
    .update(taskData)
    .eq("id", taskId)
    .eq("user_id", currentUser.id);

  if (error) {
    throw error;
  }
}

function setSaveButtonLoading(loading) {
  isSaving = loading;

  const button = document.getElementById(
    "saveTaskButton"
  );

  button.disabled = loading;

  if (loading) {
    button.textContent = "Se salvează...";
    return;
  }

  const editingTaskId =
    document.getElementById(
      "editingTaskId"
    ).value;

  button.textContent = editingTaskId
    ? "Salvează modificările"
    : "Salvează";
}

function showFormError(message) {
  document.getElementById(
    "taskFormError"
  ).textContent = message;
}

/* DELETE */

function requestEditingTaskDeletion() {
  const editingTaskId =
    document.getElementById(
      "editingTaskId"
    ).value;

  if (!editingTaskId) {
    return;
  }

  taskPendingDeletionId =
    editingTaskId;

  closeModal("taskModal");
  openModal(
    "deleteConfirmationModal"
  );
}

async function confirmTaskDeletion() {
  if (!taskPendingDeletionId) {
    return;
  }

  const deleteButton =
    document.getElementById(
      "confirmTaskDeletionButton"
    );

  deleteButton.disabled = true;
  deleteButton.textContent =
    "Se șterge...";

  try {
    const { error } = await supabaseClient
      .from("tasks")
      .delete()
      .eq(
        "id",
        taskPendingDeletionId
      )
      .eq(
        "user_id",
        currentUser.id
      );

    if (error) {
      throw error;
    }

    taskPendingDeletionId = null;

    await loadTasks();
    renderEverything();

    closeModal(
      "deleteConfirmationModal"
    );

    showToast(
      "Task-ul a fost șters.",
      "×"
    );
  } catch (error) {
    console.error(
      "Task-ul nu a putut fi șters:",
      error
    );

    showToast(
      "Task-ul nu a putut fi șters.",
      "!"
    );
  } finally {
    deleteButton.disabled = false;
    deleteButton.textContent =
      "Da, șterge";
  }
}

/* COMPLETE */

async function toggleTaskCompletion(
  taskId
) {
  const task = tasks.find(
    (currentTask) =>
      currentTask.id === taskId
  );

  if (!task) {
    return;
  }

  const newCompletedState =
    !task.completed;

  const previousTasks = [...tasks];

  tasks = tasks.map(
    (currentTask) => {
      if (currentTask.id !== taskId) {
        return currentTask;
      }

      return {
        ...currentTask,

        completed:
          newCompletedState,

        progress:
          newCompletedState
            ? 100
            : 0,

        completedAt:
          newCompletedState
            ? new Date().toISOString()
            : null
      };
    }
  );

  renderEverything();

  try {
    const { error } = await supabaseClient
      .from("tasks")
      .update({
        completed:
          newCompletedState,

        progress:
          newCompletedState
            ? 100
            : 0,

        completed_at:
          newCompletedState
            ? new Date().toISOString()
            : null
      })
      .eq("id", taskId)
      .eq("user_id", currentUser.id);

    if (error) {
      throw error;
    }

    showToast(
      newCompletedState
        ? "Task finalizat. Bravo!"
        : "Task-ul a fost redeschis.",
      newCompletedState ? "✓" : "↺"
    );
  } catch (error) {
    console.error(
      "Statusul task-ului nu a putut fi schimbat:",
      error
    );

    tasks = previousTasks;
    renderEverything();

    showToast(
      "Modificarea nu a putut fi salvată.",
      "!"
    );
  }
}

/* FILTERING */

function getFilteredTasks() {
  let filteredTasks = [...tasks];

  if (activeFilter === "completed") {
    filteredTasks =
      filteredTasks.filter(
        (task) => task.completed
      );
  } else if (
    activeFilter !== "all"
  ) {
    filteredTasks =
      filteredTasks.filter(
        (task) =>
          task.type === activeFilter &&
          !task.completed
      );
  } else {
    filteredTasks =
      filteredTasks.filter(
        (task) => !task.completed
      );
  }

  if (searchQuery) {
    filteredTasks =
      filteredTasks.filter((task) => {
        const searchableText = [
          task.title,
          task.subject,
          task.notes,
          typeLabels[task.type]
        ]
          .join(" ")
          .toLowerCase();

        return searchableText.includes(
          searchQuery
        );
      });
  }

  return sortTasks(filteredTasks);
}

function sortTasks(taskArray) {
  const sortMode =
    document.getElementById(
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
        priorityWeight[
          secondTask.priority
        ] -
        priorityWeight[
          firstTask.priority
        ]
    );
  } else if (
    sortMode === "progress"
  ) {
    sortedTasks.sort(
      (firstTask, secondTask) =>
        secondTask.progress -
        firstTask.progress
    );
  } else if (
    sortMode === "created"
  ) {
    sortedTasks.sort(
      (firstTask, secondTask) =>
        new Date(
          secondTask.createdAt
        ) -
        new Date(
          firstTask.createdAt
        )
    );
  } else {
    sortedTasks.sort(
      (
        firstTask,
        secondTask
      ) => {
        const firstDate =
          getTaskDeadlineDate(
            firstTask
          );

        const secondDate =
          getTaskDeadlineDate(
            secondTask
          );

        return (
          firstDate -
          secondDate
        );
      }
    );
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

function renderLoadingState() {
  document.getElementById(
    "taskList"
  ).innerHTML = `
    <p class="empty-message">
      Se încarcă task-urile...
    </p>
  `;
}

function renderPageError(message) {
  document.getElementById(
    "taskList"
  ).innerHTML = `
    <div class="empty-state">
      <div>
        <div class="empty-state-icon">
          !
        </div>

        <h3>
          Nu am putut încărca pagina
        </h3>

        <p>
          ${escapeHtml(message)}
        </p>

        <button
          type="button"
          class="primary-button"
          id="reloadTasksButton"
        >
          Reîncarcă
        </button>
      </div>
    </div>
  `;

  document
    .getElementById(
      "reloadTasksButton"
    )
    .addEventListener(
      "click",
      () => {
        window.location.reload();
      }
    );
}

function renderSummary() {
  const openTasks = tasks.filter(
    (task) => !task.completed
  );

  const completedTasks =
    tasks.filter(
      (task) => task.completed
    );

  const todayValue =
    toDateInputValue(new Date());

  const todayTasks =
    openTasks.filter(
      (task) =>
        task.deadline === todayValue
    );

  const highPriorityTasks =
    openTasks.filter(
      (task) =>
        task.priority === "high"
    );

  document.getElementById(
    "openTasksCount"
  ).textContent = openTasks.length;

  document.getElementById(
    "todayTasksCount"
  ).textContent = todayTasks.length;

  document.getElementById(
    "highPriorityCount"
  ).textContent =
    highPriorityTasks.length;

  document.getElementById(
    "completedTasksCount"
  ).textContent =
    completedTasks.length;
}

function renderTaskList() {
  const taskList =
    document.getElementById(
      "taskList"
    );

  const filteredTasks =
    getFilteredTasks();

  updateTaskListTitle();

  if (
    filteredTasks.length === 0
  ) {
    taskList.innerHTML = `
      <div class="empty-state">
        <div>
          <div class="empty-state-icon">
            ✿
          </div>

          <h3>
            Nu există task-uri aici
          </h3>

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
      .getElementById(
        "emptyStateAddButton"
      )
      .addEventListener(
        "click",
        openCreateTaskModal
      );

    return;
  }

  taskList.innerHTML =
    filteredTasks
      .map(createTaskMarkup)
      .join("");

  taskList
    .querySelectorAll(
      "[data-complete-task]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          toggleTaskCompletion(
            button.dataset
              .completeTask
          );
        }
      );
    });

  taskList
    .querySelectorAll(
      "[data-edit-task]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          openEditTaskModal(
            button.dataset
              .editTask
          );
        }
      );
    });
}

function createTaskMarkup(task) {
  const overdue =
    !task.completed &&
    task.deadline &&
    getTaskDeadlineDate(task) <
      startOfToday();

  const deadlineLabel =
    formatDeadline(task);

  const progress =
    Number(task.progress) || 0;

  return `
    <article
      class="task-card
        ${task.completed
          ? "completed"
          : ""}
        ${overdue
          ? "overdue"
          : ""}"
    >
      <button
        type="button"
        class="task-complete-button
          ${task.completed
            ? "checked"
            : ""}"
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
          <h3>
            ${escapeHtml(task.title)}
          </h3>

          <span
            class="task-type-tag
              ${escapeHtml(task.type)}"
          >
            ${escapeHtml(
              typeLabels[task.type] ||
              "Task"
            )}
          </span>
        </div>

        <div class="task-meta">
          ${
            task.subject
              ? `
                <span class="meta-pill">
                  ◇ ${escapeHtml(
                    task.subject
                  )}
                </span>
              `
              : ""
          }

          <span
            class="meta-pill
              ${overdue
                ? "overdue"
                : ""}"
          >
            ${overdue ? "!" : "□"}
            ${escapeHtml(
              deadlineLabel
            )}
          </span>

          <span class="meta-pill">
            ◷ ${formatDuration(
              task.estimatedMinutes
            )}
          </span>

          <span
            class="meta-pill
              ${
                task.priority === "high"
                  ? "high-priority"
                  : ""
              }"
          >
            ${escapeHtml(
              priorityLabels[
                task.priority
              ] ||
              "Prioritate medie"
            )}
          </span>

          <span class="meta-pill">
            ${escapeHtml(
              difficultyLabels[
                task.difficulty
              ] ||
              "Mediu"
            )}
          </span>
        </div>

        ${
          task.notes
            ? `
              <p class="task-notes">
                ${escapeHtml(
                  task.notes
                )}
              </p>
            `
            : ""
        }

        <div class="task-progress-area">
          <div class="task-progress-header">
            <span>Progres</span>

            <strong>
              ${progress}%
            </strong>
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
    labels[activeFilter] ||
    "Task-uri";
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

  const completedCount =
    tasks.filter(
      (task) => task.completed
    ).length;

  const percentage = Math.round(
    (
      completedCount /
      tasks.length
    ) * 100
  );

  updateProgressCircle(
    percentage
  );

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

function updateProgressCircle(
  percentage
) {
  const degrees =
    percentage * 3.6;

  const circle =
    document.getElementById(
      "progressCircle"
    );

  circle.style.background = `
    conic-gradient(
      var(--primary-dark)
        ${degrees}deg,
      #f5e4eb
        ${degrees}deg
    )
  `;

  document.getElementById(
    "weeklyProgressValue"
  ).textContent =
    `${percentage}%`;
}

function renderSuggestion() {
  const openTasks = tasks
    .filter(
      (task) => !task.completed
    )
    .sort(
      (
        firstTask,
        secondTask
      ) =>
        getTaskDeadlineDate(
          firstTask
        ) -
        getTaskDeadlineDate(
          secondTask
        )
    );

  const title =
    document.getElementById(
      "focusSuggestionTitle"
    );

  const text =
    document.getElementById(
      "focusSuggestionText"
    );

  const button =
    document.getElementById(
      "suggestionActionButton"
    );

  if (openTasks.length === 0) {
    title.textContent =
      "Totul este sub control";

    text.textContent =
      "Nu ai încă task-uri urgente.";

    button.textContent =
      "Adaugă un task";

    button.dataset.action = "add";

    return;
  }

  const suggestedTask =
    openTasks.find(
      (task) =>
        task.priority === "high"
    ) || openTasks[0];

  title.textContent =
    suggestedTask.title;

  text.textContent =
    `Acesta este task-ul pe care ar fi bine ` +
    `să îl începi următorul. Deadline: ` +
    `${formatDeadline(
      suggestedTask
    )}.`;

  button.textContent =
    "Deschide task-ul";

  button.dataset.action =
    suggestedTask.id;
}

function handleSuggestionAction() {
  const action =
    document.getElementById(
      "suggestionActionButton"
    ).dataset.action;

  if (
    !action ||
    action === "add"
  ) {
    openCreateTaskModal();
    return;
  }

  openEditTaskModal(action);
}

/* DATE HELPERS */

function getTaskDeadlineDate(task) {
  if (!task.deadline) {
    return new Date(
      "9999-12-31T23:59:00"
    );
  }

  const time =
    task.deadlineTime || "23:59";

  return new Date(
    `${task.deadline}T${time}:00`
  );
}

function startOfToday() {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  return today;
}

function formatDeadline(task) {
  if (!task.deadline) {
    return "Fără deadline";
  }

  const taskDate = new Date(
    `${task.deadline}T12:00:00`
  );

  const today = startOfToday();

  const tomorrow = new Date(today);

  tomorrow.setDate(
    tomorrow.getDate() + 1
  );

  const taskDay = new Date(taskDate);

  taskDay.setHours(0, 0, 0, 0);

  let dateText;

  if (
    taskDay.getTime() ===
    today.getTime()
  ) {
    dateText = "Astăzi";
  } else if (
    taskDay.getTime() ===
    tomorrow.getTime()
  ) {
    dateText = "Mâine";
  } else {
    dateText =
      new Intl.DateTimeFormat(
        "ro-RO",
        {
          day: "numeric",
          month: "short"
        }
      ).format(taskDate);
  }

  if (task.deadlineTime) {
    return (
      `${dateText}, ` +
      `${task.deadlineTime}`
    );
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
  const numericMinutes =
    Number(minutes) || 0;

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

  return (
    `${hours}h ` +
    `${remainingMinutes}m`
  );
}

/* ERRORS */

function translateDatabaseError(error) {
  const message =
    String(
      error?.message || ""
    ).toLowerCase();

  if (
    message.includes(
      "row-level security"
    )
  ) {
    return (
      "Nu ai permisiunea de a salva acest task. " +
      "Autentifică-te din nou."
    );
  }

  if (
    message.includes(
      "foreign key"
    )
  ) {
    return (
      "Materia selectată nu mai există. " +
      "Alege altă materie."
    );
  }

  if (
    message.includes(
      "duplicate"
    )
  ) {
    return (
      "Acest task există deja."
    );
  }

  if (
    message.includes(
      "failed to fetch"
    )
  ) {
    return (
      "Nu există conexiune la internet."
    );
  }

  return (
    error?.message ||
    "Task-ul nu a putut fi salvat."
  );
}

/* TOAST */

function showToast(
  message,
  icon = "✓"
) {
  const toast =
    document.getElementById(
      "toast"
    );

  document.getElementById(
    "toastMessage"
  ).textContent = message;

  document.getElementById(
    "toastIcon"
  ).textContent = icon;

  toast.classList.add(
    "visible"
  );

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(
    () => {
      toast.classList.remove(
        "visible"
      );
    },
    2600
  );
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
