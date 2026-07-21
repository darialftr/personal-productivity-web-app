"use strict";

const PROFILE_STORAGE_KEY = "itera_profile";

const totalSteps = 5;

let currentStep = 1;

const selectedSubjects = new Set([
  "Limba română",
  "Matematică",
  "Informatică"
]);

const selectedGoals = new Set([
  "school",
  "bac",
  "admission"
]);

initializeOnboarding();

function initializeOnboarding() {
  checkExistingProfile();
  initializeSubjectSelection();
  initializeGoalSelection();
  initializeCustomSubject();
  initializeNavigation();
  updateStepInterface();
}

function checkExistingProfile() {
  const existingProfile = localStorage.getItem(
    PROFILE_STORAGE_KEY
  );

  if (existingProfile) {
    window.location.href = "index.html";
  }
}

/* SUBJECTS */

function initializeSubjectSelection() {
  document
    .querySelectorAll(".subject-option")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const subject = button.dataset.subject;

        if (selectedSubjects.has(subject)) {
          selectedSubjects.delete(subject);
          button.classList.remove("selected");
        } else {
          selectedSubjects.add(subject);
          button.classList.add("selected");
        }

        clearError();
      });
    });
}

function initializeCustomSubject() {
  const input = document.getElementById(
    "customSubjectInput"
  );

  document
    .getElementById("addCustomSubjectButton")
    .addEventListener("click", addCustomSubject);

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    addCustomSubject();
  });
}

function addCustomSubject() {
  const input = document.getElementById(
    "customSubjectInput"
  );

  const subjectName = input.value.trim();

  if (!subjectName) {
    showError("Scrie numele materiei pe care vrei să o adaugi.");
    return;
  }

  const normalizedExists = [...selectedSubjects].some(
    (subject) =>
      subject.toLowerCase() === subjectName.toLowerCase()
  );

  if (normalizedExists) {
    showError("Materia aceasta este deja selectată.");
    return;
  }

  selectedSubjects.add(subjectName);

  const subjectGrid = document.getElementById(
    "subjectGrid"
  );

  const button = document.createElement("button");

  button.type = "button";
  button.className = "subject-option selected";
  button.dataset.subject = subjectName;

  button.innerHTML = `
    <span class="subject-icon subject-pink">
      ${escapeHtml(subjectName.charAt(0).toUpperCase())}
    </span>

    <strong>${escapeHtml(subjectName)}</strong>
  `;

  button.addEventListener("click", () => {
    if (selectedSubjects.has(subjectName)) {
      selectedSubjects.delete(subjectName);
      button.classList.remove("selected");
    } else {
      selectedSubjects.add(subjectName);
      button.classList.add("selected");
    }

    clearError();
  });

  subjectGrid.appendChild(button);

  input.value = "";

  clearError();
  showToast("Materia a fost adăugată.");
}

/* GOALS */

function initializeGoalSelection() {
  document
    .querySelectorAll(".goal-option")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const goal = button.dataset.goal;

        if (selectedGoals.has(goal)) {
          selectedGoals.delete(goal);
          button.classList.remove("selected");
        } else {
          selectedGoals.add(goal);
          button.classList.add("selected");
        }

        clearError();
      });
    });
}

/* NAVIGATION */

function initializeNavigation() {
  document
    .getElementById("continueButton")
    .addEventListener("click", handleContinue);

  document
    .getElementById("backButton")
    .addEventListener("click", handleBack);
}

function handleContinue() {
  if (!validateCurrentStep()) {
    return;
  }

  if (currentStep === totalSteps) {
    finishOnboarding();
    return;
  }

  currentStep += 1;

  if (currentStep === totalSteps) {
    updateSummary();
  }

  updateStepInterface();
}

function handleBack() {
  if (currentStep <= 1) {
    return;
  }

  currentStep -= 1;

  updateStepInterface();
}

function updateStepInterface() {
  document
    .querySelectorAll(".setup-step")
    .forEach((step) => {
      step.classList.toggle(
        "active-step",
        Number(step.dataset.step) === currentStep
      );
    });

  const percentage = Math.round(
    (currentStep / totalSteps) * 100
  );

  document.getElementById(
    "stepLabel"
  ).textContent = `Pasul ${currentStep} din ${totalSteps}`;

  document.getElementById(
    "progressPercentage"
  ).textContent = `${percentage}%`;

  document.getElementById(
    "progressFill"
  ).style.width = `${percentage}%`;

  document.getElementById(
    "backButton"
  ).classList.toggle(
    "hidden",
    currentStep === 1
  );

  const continueButton = document.getElementById(
    "continueButton"
  );

  if (currentStep === totalSteps) {
    continueButton.innerHTML = `
      Intră în Itera
      <span>→</span>
    `;
  } else {
    continueButton.innerHTML = `
      Continuă
      <span>→</span>
    `;
  }

  clearError();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* VALIDATION */

function validateCurrentStep() {
  clearError();

  if (currentStep === 1) {
    const firstName = document
      .getElementById("firstName")
      .value
      .trim();

    const gradeLevel = document.getElementById(
      "gradeLevel"
    ).value;

    if (!firstName) {
      showError("Scrie prenumele tău pentru a continua.");
      return false;
    }

    if (!gradeLevel) {
      showError("Alege clasa în care vei fi.");
      return false;
    }
  }

  if (currentStep === 2) {
    if (selectedSubjects.size === 0) {
      showError("Selectează cel puțin o materie.");
      return false;
    }
  }

  if (currentStep === 3) {
    const schoolStart = document.getElementById(
      "schoolStartTime"
    ).value;

    const schoolEnd = document.getElementById(
      "schoolEndTime"
    ).value;

    if (!schoolStart || !schoolEnd) {
      showError("Completează intervalul școlar.");
      return false;
    }

    if (schoolStart >= schoolEnd) {
      showError(
        "Ora de terminare trebuie să fie după ora de început."
      );

      return false;
    }
  }

  if (currentStep === 4) {
    if (selectedGoals.size === 0) {
      showError("Selectează cel puțin un obiectiv.");
      return false;
    }
  }

  return true;
}

/* SUMMARY */

function updateSummary() {
  const firstName = document
    .getElementById("firstName")
    .value
    .trim();

  const gradeLevel = document.getElementById(
    "gradeLevel"
  ).value;

  const studyGoal = Number(
    document.getElementById("dailyStudyGoal").value
  );

  document.getElementById(
    "summaryAvatar"
  ).textContent =
    firstName.charAt(0).toUpperCase();

  document.getElementById(
    "summaryName"
  ).textContent = firstName;

  document.getElementById(
    "summaryGrade"
  ).textContent =
    gradeLevel === "other"
      ? "Alt nivel de studiu"
      : `Clasa a ${toRomanNumeral(Number(gradeLevel))}-a`;

  document.getElementById(
    "summarySubjectsCount"
  ).textContent = String(selectedSubjects.size);

  document.getElementById(
    "summaryStudyGoal"
  ).textContent = formatMinutes(studyGoal);

  document.getElementById(
    "summaryGoalsCount"
  ).textContent = String(selectedGoals.size);
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

function formatMinutes(minutes) {
  if (minutes < 60) {
    return `${minutes} minute`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return hours === 1
      ? "1 oră"
      : `${hours} ore`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

/* SAVE PROFILE */

function finishOnboarding() {
  const profile = {
    firstName: document
      .getElementById("firstName")
      .value
      .trim(),

    gradeLevel: document.getElementById(
      "gradeLevel"
    ).value,

    subjects: [...selectedSubjects],

    schedulePreferences: {
      schoolStartTime: document.getElementById(
        "schoolStartTime"
      ).value,

      schoolEndTime: document.getElementById(
        "schoolEndTime"
      ).value,

      preferredStudyTime: document.getElementById(
        "preferredStudyTime"
      ).value,

      dailyStudyGoal: Number(
        document.getElementById("dailyStudyGoal").value
      )
    },

    goals: [...selectedGoals],

    universityGoal: document
      .getElementById("universityGoal")
      .value
      .trim(),

    setupCompleted: true,

    createdAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify(profile)
    );

    window.location.href = "schedule.html";
  } catch (error) {
    console.error("Profilul nu a putut fi salvat:", error);

    showError(
      "Profilul nu a putut fi salvat. Verifică setările browserului."
    );
  }
}

/* ERRORS */

function showError(message) {
  document.getElementById(
    "formError"
  ).textContent = message;
}

function clearError() {
  document.getElementById(
    "formError"
  ).textContent = "";
}

/* TOAST */

let toastTimeout = null;

function showToast(message) {
  const toast = document.getElementById("toast");

  document.getElementById(
    "toastMessage"
  ).textContent = message;

  toast.classList.add("visible");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.classList.remove("visible");
  }, 2500);
}

/* SECURITY */

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
