"use strict";

const SCHEDULE_STORAGE_KEY = "itera_schedule";
const PROFILE_STORAGE_KEY = "itera_profile";

const days = [
  {
    id: "monday",
    name: "Luni",
    short: "Lu",
    jsDay: 1
  },
  {
    id: "tuesday",
    name: "Marți",
    short: "Ma",
    jsDay: 2
  },
  {
    id: "wednesday",
    name: "Miercuri",
    short: "Mi",
    jsDay: 3
  },
  {
    id: "thursday",
    name: "Joi",
    short: "Jo",
    jsDay: 4
  },
  {
    id: "friday",
    name: "Vineri",
    short: "Vi",
    jsDay: 5
  },
  {
    id: "saturday",
    name: "Sâmbătă",
    short: "Sâ",
    jsDay: 6
  },
  {
    id: "sunday",
    name: "Duminică",
    short: "Du",
    jsDay: 0
  }
];

const typeLabels = {
  class: "Oră la școală",
  tutoring: "Meditație",
  study: "Studiu individual",
  personal: "Activitate personală",
  other: "Altă activitate"
};

let profile = loadProfile();
let scheduleItems = loadSchedule();

let selectedMobileDay = getCurrentDayId();
let selectedActionItemId = null;
let toastTimeout = null;

initializePage();

function initializePage() {
  renderProfile();
  populateSubjectSelect();
  initializeButtons();
  initializeMobileDaySelector();
  renderEverything();
}

/* PROFILE */

function loadProfile() {
  try {
    const savedProfile = JSON.parse(
      localStorage.getItem(PROFILE_STORAGE_KEY)
    );

    return savedProfile || {};
  } catch (error) {
    console.error("Profilul nu a putut fi citit:", error);
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
  const values = {
    9: "IX",
    10: "X",
    11: "XI",
    12: "XII"
  };

  return values[number] || String(number);
}

/* SUBJECTS */

function populateSubjectSelect() {
  const select = document.getElementById(
    "scheduleSubject"
  );

  const subjects = Array.isArray(profile.subjects)
    ? profile.subjects
    : [];

  subjects.forEach((subject) => {
    const option = document.createElement("option");

    option.value = subject;
    option.textContent = subject;

    select.appendChild(option);
  });
}

/* STORAGE */

function loadSchedule() {
  try {
    const storedSchedule = localStorage.getItem(
      SCHEDULE_STORAGE_KEY
    );

    if (!storedSchedule) {
      return createStarterSchedule();
    }

    const parsedSchedule = JSON.parse(storedSchedule);

    if (!Array.isArray(parsedSchedule)) {
      throw new Error("Format invalid.");
    }

    return parsedSchedule;
  } catch (error) {
    console.error("Orarul nu a putut fi încărcat:", error);
    return [];
  }
}

function saveSchedule() {
  localStorage.setItem(
    SCHEDULE_STORAGE_KEY,
    JSON.stringify(scheduleItems)
  );
}

function createStarterSchedule() {
  const subjects = Array.isArray(profile.subjects)
    ? profile.subjects
    : [];

  if (subjects.length === 0) {
    return [];
  }

  const starterItems = [];

  const starterDays = [
    "monday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday"
  ];

  const starterTimes = [
    ["08:00", "08:50"],
    ["09:00", "09:50"],
    ["08:00", "08:50"],
    ["10:00", "10:50"],
    ["09:00", "09:50"],
    ["08:00", "08:50"]
  ];

  subjects.slice(0, 6).forEach((subject, index) => {
    starterItems.push({
      id: createId(),
      title: subject,
      type: "class",
      subject,
      day: starterDays[index],
      startTime: starterTimes[index][0],
      endTime: starterTimes[index][1],
      location: "",
      notes: "",
      color: getDefaultColor(index)
    });
  });

  localStorage.setItem(
    SCHEDULE_STORAGE_KEY,
    JSON.stringify(starterItems)
  );

  return starterItems;
}

function getDefaultColor(index) {
  const colors = [
    "pink",
    "lilac",
    "blue",
    "green",
    "peach",
    "yellow"
  ];

  return colors[index % colors.length];
}

function createId() {
  return `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

/* BUTTONS */

function initializeButtons() {
  document
    .getElementById("addScheduleItemButton")
    .addEventListener("click", () => {
      prepareCreateModal(selectedMobileDay);
    });

  document
    .getElementById("mobileAddScheduleButton")
    .addEventListener("click", () => {
      prepareCreateModal(selectedMobileDay);
    });

  document
    .getElementById("mobileMainAddButton")
    .addEventListener("click", () => {
      prepareCreateModal(selectedMobileDay);
    });

  document
    .getElementById("closeScheduleModal")
    .addEventListener("click", () => {
      closeModal("scheduleModal");
    });

  document
    .getElementById("cancelScheduleButton")
    .addEventListener("click", () => {
      closeModal("scheduleModal");
    });

  document
    .getElementById("scheduleForm")
    .addEventListener("submit", handleScheduleSubmit);

  document
    .getElementById("deleteScheduleButton")
    .addEventListener("click", deleteEditingItem);

  document
    .getElementById("clearScheduleButton")
    .addEventListener("click", () => {
      openModal("resetModal");
    });

  document
    .getElementById("cancelResetButton")
    .addEventListener("click", () => {
      closeModal("resetModal");
    });

  document
    .getElementById("confirmResetButton")
    .addEventListener("click", clearEntireSchedule);

  document
    .getElementById("closeItemActionsModal")
    .addEventListener("click", () => {
      closeModal("itemActionsModal");
    });

  document
    .getElementById("editSelectedItemButton")
    .addEventListener("click", editSelectedItem);

  document
    .getElementById("duplicateSelectedItemButton")
    .addEventListener("click", duplicateSelectedItem);

  document
    .getElementById("deleteSelectedItemButton")
    .addEventListener("click", deleteSelectedItem);

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

  document
    .getElementById("scheduleSubject")
    .addEventListener("change", handleSubjectSelection);
}

function handleSubjectSelection() {
  const subject = document.getElementById(
    "scheduleSubject"
  ).value;

  const titleInput = document.getElementById(
    "scheduleTitle"
  );

  if (
    subject &&
    (
      !titleInput.value.trim() ||
      titleInput.dataset.autoFilled === "true"
    )
  ) {
    titleInput.value = subject;
    titleInput.dataset.autoFilled = "true";
  }
}

function initializeMobileDaySelector() {
  document
    .querySelectorAll("[data-mobile-day]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        selectedMobileDay = button.dataset.mobileDay;

        renderMobileDaySelector();
        renderMobileSchedule();
      });
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

  const anyVisibleModal = document.querySelector(
    ".modal-overlay.visible"
  );

  if (!anyVisibleModal) {
    document.body.style.overflow = "";
  }
}

/* FORM */

function prepareCreateModal(dayId = "monday") {
  const form = document.getElementById(
    "scheduleForm"
  );

  form.reset();

  document.getElementById(
    "editingScheduleId"
  ).value = "";

  document.getElementById(
    "scheduleModalTitle"
  ).textContent = "Adaugă în orar";

  document.getElementById(
    "modalKicker"
  ).textContent = "Activitate săptămânală";

  document.getElementById(
    "saveScheduleButton"
  ).textContent = "Salvează";

  document.getElementById(
    "deleteScheduleButton"
  ).classList.add("hidden");

  document.getElementById(
    "scheduleDay"
  ).value = dayId;

  document.getElementById(
    "scheduleType"
  ).value = "class";

  document.getElementById(
    "scheduleColor"
  ).value = "pink";

  document.getElementById(
    "scheduleStartTime"
  ).value = "08:00";

  document.getElementById(
    "scheduleEndTime"
  ).value = "08:50";

  document.getElementById(
    "scheduleFormError"
  ).textContent = "";

  document.getElementById(
    "scheduleTitle"
  ).dataset.autoFilled = "false";

  openModal("scheduleModal");

  setTimeout(() => {
    document.getElementById(
      "scheduleTitle"
    ).focus();
  }, 200);
}

function prepareEditModal(itemId) {
  const item = scheduleItems.find(
    (scheduleItem) => scheduleItem.id === itemId
  );

  if (!item) {
    return;
  }

  document.getElementById(
    "editingScheduleId"
  ).value = item.id;

  document.getElementById(
    "scheduleTitle"
  ).value = item.title;

  document.getElementById(
    "scheduleType"
  ).value = item.type;

  document.getElementById(
    "scheduleSubject"
  ).value = item.subject || "";

  document.getElementById(
    "scheduleDay"
  ).value = item.day;

  document.getElementById(
    "scheduleColor"
  ).value = item.color || "pink";

  document.getElementById(
    "scheduleStartTime"
  ).value = item.startTime;

  document.getElementById(
    "scheduleEndTime"
  ).value = item.endTime;

  document.getElementById(
    "scheduleLocation"
  ).value = item.location || "";

  document.getElementById(
    "scheduleNotes"
  ).value = item.notes || "";

  document.getElementById(
    "scheduleModalTitle"
  ).textContent = "Editează activitatea";

  document.getElementById(
    "modalKicker"
  ).textContent = "Modifică orarul";

  document.getElementById(
    "saveScheduleButton"
  ).textContent = "Salvează modificările";

  document.getElementById(
    "deleteScheduleButton"
  ).classList.remove("hidden");

  document.getElementById(
    "scheduleFormError"
  ).textContent = "";

  document.getElementById(
    "scheduleTitle"
  ).dataset.autoFilled = "false";

  openModal("scheduleModal");
}

function handleScheduleSubmit(event) {
  event.preventDefault();

  const title = document
    .getElementById("scheduleTitle")
    .value
    .trim();

  const startTime = document.getElementById(
    "scheduleStartTime"
  ).value;

  const endTime = document.getElementById(
    "scheduleEndTime"
  ).value;

  if (!title) {
    showFormError("Scrie titlul activității.");
    return;
  }

  if (!startTime || !endTime) {
    showFormError("Completează ora de început și ora de final.");
    return;
  }

  if (startTime >= endTime) {
    showFormError(
      "Ora de final trebuie să fie după ora de început."
    );

    return;
  }

  const itemData = {
    title,
    type: document.getElementById(
      "scheduleType"
    ).value,

    subject: document.getElementById(
      "scheduleSubject"
    ).value,

    day: document.getElementById(
      "scheduleDay"
    ).value,

    color: document.getElementById(
      "scheduleColor"
    ).value,

    startTime,
    endTime,

    location: document
      .getElementById("scheduleLocation")
      .value
      .trim(),

    notes: document
      .getElementById("scheduleNotes")
      .value
      .trim()
  };

  const editingId = document.getElementById(
    "editingScheduleId"
  ).value;

  if (editingId) {
    scheduleItems = scheduleItems.map((item) => {
      if (item.id !== editingId) {
        return item;
      }

      return {
        ...item,
        ...itemData
      };
    });

    showToast(
      "Activitatea a fost actualizată.",
      "✓"
    );
  } else {
    scheduleItems.push({
      id: createId(),
      ...itemData
    });

    showToast(
      "Activitatea a fost adăugată.",
      "✓"
    );
  }

  sortSchedule();
  saveSchedule();
  renderEverything();

  selectedMobileDay = itemData.day;

  closeModal("scheduleModal");
}

function showFormError(message) {
  document.getElementById(
    "scheduleFormError"
  ).textContent = message;
}

/* ITEM ACTIONS */

function openItemActions(itemId) {
  const item = scheduleItems.find(
    (scheduleItem) => scheduleItem.id === itemId
  );

  if (!item) {
    return;
  }

  selectedActionItemId = item.id;

  const preview = document.getElementById(
    "actionColorPreview"
  );

  preview.className =
    `action-color-preview ${item.color || "pink"}`;

  preview.textContent =
    item.title.charAt(0).toUpperCase();

  document.getElementById(
    "actionTypeLabel"
  ).textContent =
    typeLabels[item.type] || "Activitate";

  document.getElementById(
    "actionItemTitle"
  ).textContent = item.title;

  document.getElementById(
    "actionItemDetails"
  ).textContent =
    `${getDayName(item.day)} · ` +
    `${item.startTime}–${item.endTime}` +
    `${item.location ? ` · ${item.location}` : ""}`;

  openModal("itemActionsModal");
}

function editSelectedItem() {
  if (!selectedActionItemId) {
    return;
  }

  const itemId = selectedActionItemId;

  closeModal("itemActionsModal");
  prepareEditModal(itemId);
}

function duplicateSelectedItem() {
  const item = scheduleItems.find(
    (scheduleItem) =>
      scheduleItem.id === selectedActionItemId
  );

  if (!item) {
    return;
  }

  scheduleItems.push({
    ...item,
    id: createId(),
    title: `${item.title} — copie`
  });

  sortSchedule();
  saveSchedule();
  renderEverything();

  closeModal("itemActionsModal");

  showToast(
    "Activitatea a fost duplicată.",
    "＋"
  );
}

function deleteSelectedItem() {
  if (!selectedActionItemId) {
    return;
  }

  scheduleItems = scheduleItems.filter(
    (item) => item.id !== selectedActionItemId
  );

  saveSchedule();
  renderEverything();

  selectedActionItemId = null;

  closeModal("itemActionsModal");

  showToast(
    "Activitatea a fost ștearsă.",
    "×"
  );
}

function deleteEditingItem() {
  const editingId = document.getElementById(
    "editingScheduleId"
  ).value;

  if (!editingId) {
    return;
  }

  scheduleItems = scheduleItems.filter(
    (item) => item.id !== editingId
  );

  saveSchedule();
  renderEverything();

  closeModal("scheduleModal");

  showToast(
    "Activitatea a fost ștearsă.",
    "×"
  );
}

/* RESET */

function clearEntireSchedule() {
  scheduleItems = [];

  saveSchedule();
  renderEverything();

  closeModal("resetModal");

  showToast(
    "Orarul a fost resetat.",
    "×"
  );
}

/* RENDER */

function renderEverything() {
  sortSchedule();

  renderSummary();
  renderDesktopWeek();
  renderMobileDaySelector();
  renderMobileSchedule();
}

function sortSchedule() {
  scheduleItems.sort((firstItem, secondItem) => {
    const firstDayIndex = days.findIndex(
      (day) => day.id === firstItem.day
    );

    const secondDayIndex = days.findIndex(
      (day) => day.id === secondItem.day
    );

    if (firstDayIndex !== secondDayIndex) {
      return firstDayIndex - secondDayIndex;
    }

    return firstItem.startTime.localeCompare(
      secondItem.startTime
    );
  });
}

function renderSummary() {
  document.getElementById(
    "weeklyActivitiesCount"
  ).textContent = String(scheduleItems.length);

  const totalMinutes = scheduleItems.reduce(
    (sum, item) =>
      sum +
      getDurationInMinutes(
        item.startTime,
        item.endTime
      ),
    0
  );

  document.getElementById(
    "weeklyHoursCount"
  ).textContent = formatDuration(totalMinutes);

  const countsByDay = days.map((day) => {
    return {
      ...day,
      count: scheduleItems.filter(
        (item) => item.day === day.id
      ).length
    };
  });

  const busiestDay = countsByDay.reduce(
    (currentBusiest, day) =>
      day.count > currentBusiest.count
        ? day
        : currentBusiest,
    countsByDay[0]
  );

  document.getElementById(
    "busiestDayLabel"
  ).textContent =
    busiestDay.count > 0
      ? busiestDay.name
      : "—";
}

function renderDesktopWeek() {
  const grid = document.getElementById(
    "desktopWeekGrid"
  );

  const currentJsDay = new Date().getDay();

  grid.innerHTML = days
    .map((day) => {
      const dayItems = scheduleItems.filter(
        (item) => item.day === day.id
      );

      const isToday =
        day.jsDay === currentJsDay;

      return `
        <article
          class="day-column ${isToday ? "today" : ""}"
        >
          <header class="day-column-header">
            <div>
              <span>
                ${isToday ? "Astăzi" : "Zi"}
              </span>

              <strong>${escapeHtml(day.name)}</strong>
            </div>

            <button
              type="button"
              class="day-add-button"
              data-add-day="${day.id}"
              aria-label="Adaugă în ${escapeHtml(day.name)}"
            >
              ＋
            </button>
          </header>

          <div class="day-items">
            ${
              dayItems.length > 0
                ? dayItems
                    .map(createDesktopItemMarkup)
                    .join("")
                : createEmptyDayMarkup()
            }
          </div>
        </article>
      `;
    })
    .join("");

  grid
    .querySelectorAll("[data-add-day]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        prepareCreateModal(button.dataset.addDay);
      });
    });

  grid
    .querySelectorAll("[data-schedule-item]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        openItemActions(
          button.dataset.scheduleItem
        );
      });
    });
}

function createDesktopItemMarkup(item) {
  return `
    <button
      type="button"
      class="schedule-item ${item.color || "pink"}"
      data-schedule-item="${item.id}"
    >
      <span class="schedule-item-time">
        ${escapeHtml(item.startTime)}–${escapeHtml(item.endTime)}
      </span>

      <strong class="schedule-item-title">
        ${escapeHtml(item.title)}
      </strong>

      ${
        item.location
          ? `
            <span class="schedule-item-location">
              ${escapeHtml(item.location)}
            </span>
          `
          : ""
      }
    </button>
  `;
}

function createEmptyDayMarkup() {
  return `
    <div class="empty-day">
      <span>＋</span>

      <p>
        Nu ai nimic adăugat în această zi.
      </p>
    </div>
  `;
}

function renderMobileDaySelector() {
  document
    .querySelectorAll("[data-mobile-day]")
    .forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.mobileDay === selectedMobileDay
      );
    });
}

function renderMobileSchedule() {
  const container = document.getElementById(
    "mobileScheduleList"
  );

  const selectedDay = days.find(
    (day) => day.id === selectedMobileDay
  );

  document.getElementById(
    "mobileSelectedDayTitle"
  ).textContent =
    selectedDay?.name || "Luni";

  const dayItems = scheduleItems.filter(
    (item) => item.day === selectedMobileDay
  );

  if (dayItems.length === 0) {
    container.innerHTML = `
      <div class="mobile-empty-state">
        <span>✿</span>

        <strong>O zi liberă</strong>

        <p>
          Nu ai adăugat încă nicio activitate pentru această zi.
        </p>

        <button
          type="button"
          id="mobileEmptyAddButton"
        >
          ＋ Adaugă activitate
        </button>
      </div>
    `;

    document
      .getElementById("mobileEmptyAddButton")
      .addEventListener("click", () => {
        prepareCreateModal(selectedMobileDay);
      });

    return;
  }

  container.innerHTML = dayItems
    .map((item) => {
      const details =
        item.location ||
        item.subject ||
        typeLabels[item.type] ||
        "Activitate";

      return `
        <button
          type="button"
          class="mobile-schedule-item"
          data-mobile-schedule-item="${item.id}"
        >
          <span class="mobile-item-time">
            <span>${escapeHtml(item.startTime)}</span>
            <span>${escapeHtml(item.endTime)}</span>
          </span>

          <span
            class="mobile-item-color ${item.color || "pink"}"
          ></span>

          <span class="mobile-item-content">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(details)}</span>
          </span>

          <span class="mobile-item-arrow">›</span>
        </button>
      `;
    })
    .join("");

  container
    .querySelectorAll("[data-mobile-schedule-item]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        openItemActions(
          button.dataset.mobileScheduleItem
        );
      });
    });
}

/* TIME */

function getDurationInMinutes(startTime, endTime) {
  const [startHour, startMinute] = startTime
    .split(":")
    .map(Number);

  const [endHour, endMinute] = endTime
    .split(":")
    .map(Number);

  return (
    endHour * 60 +
    endMinute -
    (startHour * 60 + startMinute)
  );
}

function formatDuration(totalMinutes) {
  if (totalMinutes <= 0) {
    return "0h";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function getCurrentDayId() {
  const currentJsDay = new Date().getDay();

  const matchingDay = days.find(
    (day) => day.jsDay === currentJsDay
  );

  return matchingDay?.id || "monday";
}

function getDayName(dayId) {
  return (
    days.find((day) => day.id === dayId)?.name ||
    "Zi necunoscută"
  );
}

/* TOAST */

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
