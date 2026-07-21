"use strict";

const LEGACY_PROFILE_STORAGE_KEY = "itera_profile";
const totalSteps = 5;

let currentStep = 1;
let isSaving = false;

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

const SUBJECT_CONFIG = {
  "Limba română": {
    color: "#f3a9c5",
    icon: "R"
  },
  "Matematică": {
    color: "#d8c6ec",
    icon: "M"
  },
  "Informatică": {
    color: "#bfd8ec",
    icon: "I"
  },
  "Biologie": {
    color: "#bfd9c5",
    icon: "B"
  },
  "Fizică": {
    color: "#f1c7ae",
    icon: "F"
  },
  "Chimie": {
    color: "#eadcae",
    icon: "C"
  },
  "Engleză": {
    color: "#bfd8ec",
    icon: "E"
  },
  "Franceză": {
    color: "#f3a9c5",
    icon: "F"
  },
  "Istorie": {
    color: "#f1c7ae",
    icon: "I"
  },
  "Geografie": {
    color: "#bfd9c5",
    icon: "G"
  }
};

initializeOnboarding();

async function initializeOnboarding() {
  initializeSubjectSelection();
  initializeGoalSelection();
  initializeCustomSubject();
  initializeNavigation();

  restoreLegacyProfile();
  updateStepInterface();

  await checkExistingSupabaseProfile();
}

/* EXISTING PROFILE */

async function checkExistingSupabaseProfile() {
  try {
    const {
      data: { user },
      error: userError
    } = await supabaseClient.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      window.location.href = "login.html";
      return;
    }

    const { data: profile, error: profileError } =
      await supabaseClient
        .from("profiles")
        .select(`
          first_name,
          grade,
          university,
          study_goals,
          personal_goals,
          onboarding_completed
        `)
        .eq("id", user.id)
        .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    /*
      Dacă onboarding-ul este deja salvat complet în Supabase,
      utilizatorul nu mai trebuie trimis din nou prin configurare.
    */
    if (profile?.onboarding_completed) {
      window.location.href = "index.html";
      return;
    }

    if (profile) {
      populateFromSupabaseProfile(profile);
    }
  } catch (error) {
    console.error(
      "Profilul existent nu a putut fi verificat:",
      error
    );
  }
}

function populateFromSupabaseProfile(profile) {
  if (profile.first_name) {
    document.getElementById("firstName").value =
      profile.first_name;
  }

  if (profile.grade) {
    document.getElementById("gradeLevel").value =
      String(profile.grade);
  }

  if (profile.university) {
    document.getElementById("universityGoal").value =
      profile.university;
  }

  const savedGoals = [
    ...(Array.isArray(profile.study_goals)
      ? profile.study_goals
      : []),

    ...(Array.isArray(profile.personal_goals)
      ? profile.personal_goals
      : [])
  ];

  if (savedGoals.length > 0) {
    selectedGoals.clear();

    savedGoals.forEach((goal) => {
      selectedGoals.add(goal);
    });

    synchronizeGoalButtons();
  }
}

/* LEGACY LOCALSTORAGE MIGRATION */

function restoreLegacyProfile() {
  const rawProfile = localStorage.getItem(
    LEGACY_PROFILE_STORAGE_KEY
  );

  if (!rawProfile) {
    return;
  }

  try {
    const profile = JSON.parse(rawProfile);

    if (profile.firstName) {
      document.getElementById("firstName").value =
        profile.firstName;
    }

    if (profile.gradeLevel) {
      document.getElementById("gradeLevel").value =
        profile.gradeLevel;
    }

    if (profile.universityGoal) {
      document.getElementById("universityGoal").value =
        profile.universityGoal;
    }

    if (Array.isArray(profile.subjects)) {
      selectedSubjects.clear();

      profile.subjects.forEach((subject) => {
        addSubjectToSelectionInterface(subject);
      });

      synchronizeSubjectButtons();
    }

    if (Array.isArray(profile.goals)) {
      selectedGoals.clear();

      profile.goals.forEach((goal) => {
        selectedGoals.add(goal);
      });

      synchronizeGoalButtons();
    }

    if (profile.schedulePreferences) {
      const preferences = profile.schedulePreferences;

      if (preferences.schoolStartTime) {
        document.getElementById(
          "schoolStartTime"
        ).value = preferences.schoolStartTime;
      }

      if (preferences.schoolEndTime) {
        document.getElementById(
          "schoolEndTime"
        ).value = preferences.schoolEndTime;
      }

      if (preferences.preferredStudyTime) {
        document.getElementById(
          "preferredStudyTime"
        ).value = preferences.preferredStudyTime;
      }

      if (preferences.dailyStudyGoal) {
        document.getElementById(
          "dailyStudyGoal"
        ).value = String(
          preferences.dailyStudyGoal
        );
      }
    }
  } catch (error) {
    console.error(
      "Datele vechi din localStorage nu au putut fi citite:",
      error
    );
  }
}

/* SUBJECTS */

function initializeSubjectSelection() {
  document
    .querySelectorAll(".subject-option")
    .forEach((button) => {
      attachSubjectButtonListener(button);
    });
}

function attachSubjectButtonListener(button) {
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
    showError(
      "Scrie numele materiei pe care vrei să o adaugi."
    );

    return;
  }

  const normalizedExists = [...selectedSubjects].some(
    (subject) =>
      subject.toLowerCase() ===
      subjectName.toLowerCase()
  );

  if (normalizedExists) {
    showError("Materia aceasta este deja selectată.");
    return;
  }

  addSubjectToSelectionInterface(subjectName);

  input.value = "";

  clearError();
  showToast("Materia a fost adăugată.");
}

function addSubjectToSelectionInterface(subjectName) {
  selectedSubjects.add(subjectName);

  const existingButton = [
    ...document.querySelectorAll(".subject-option")
  ].find(
    (button) =>
      button.dataset.subject.toLowerCase() ===
      subjectName.toLowerCase()
  );

  if (existingButton) {
    existingButton.classList.add("selected");
    return;
  }

  const subjectGrid = document.getElementById(
    "subjectGrid"
  );

  const button = document.createElement("button");

  button.type = "button";
  button.className = "subject-option selected";
  button.dataset.subject = subjectName;

  button.innerHTML = `
    <span class="subject-icon subject-pink">
      ${escapeHtml(
        subjectName.charAt(0).toUpperCase()
      )}
    </span>

    <strong>${escapeHtml(subjectName)}</strong>
  `;

  attachSubjectButtonListener(button);
  subjectGrid.appendChild(button);
}

function synchronizeSubjectButtons() {
  document
    .querySelectorAll(".subject-option")
    .forEach((button) => {
      button.classList.toggle(
        "selected",
        selectedSubjects.has(button.dataset.subject)
      );
    });
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

function synchronizeGoalButtons() {
  document
    .querySelectorAll(".goal-option")
    .forEach((button) => {
      button.classList.toggle(
        "selected",
        selectedGoals.has(button.dataset.goal)
      );
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

async function handleContinue() {
  if (isSaving || !validateCurrentStep()) {
    return;
  }

  if (currentStep === totalSteps) {
    await finishOnboarding();
    return;
  }

  currentStep += 1;

  if (currentStep === totalSteps) {
    updateSummary();
  }

  updateStepInterface();
}

function handleBack() {
  if (isSaving || currentStep <= 1) {
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
  ).textContent =
    `Pasul ${currentStep} din ${totalSteps}`;

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
      showError(
        "Scrie prenumele tău pentru a continua."
      );

      return false;
    }

    if (!gradeLevel) {
      showError(
        "Alege clasa în care vei fi."
      );

      return false;
    }
  }

  if (
    currentStep === 2 &&
    selectedSubjects.size === 0
  ) {
    showError(
      "Selectează cel puțin o materie."
    );

    return false;
  }

  if (currentStep === 3) {
    const schoolStart = document.getElementById(
      "schoolStartTime"
    ).value;

    const schoolEnd = document.getElementById(
      "schoolEndTime"
    ).value;

    if (!schoolStart || !schoolEnd) {
      showError(
        "Completează intervalul școlar."
      );

      return false;
    }

    if (schoolStart >= schoolEnd) {
      showError(
        "Ora de terminare trebuie să fie după ora de început."
      );

      return false;
    }
  }

  if (
    currentStep === 4 &&
    selectedGoals.size === 0
  ) {
    showError(
      "Selectează cel puțin un obiectiv."
    );

    return false;
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
    document.getElementById(
      "dailyStudyGoal"
    ).value
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
      : `Clasa a ${toRomanNumeral(
          Number(gradeLevel)
        )}-a`;

  document.getElementById(
    "summarySubjectsCount"
  ).textContent =
    String(selectedSubjects.size);

  document.getElementById(
    "summaryStudyGoal"
  ).textContent =
    formatMinutes(studyGoal);

  document.getElementById(
    "summaryGoalsCount"
  ).textContent =
    String(selectedGoals.size);
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

/* SAVE TO SUPABASE */

async function finishOnboarding() {
  if (isSaving) {
    return;
  }

  isSaving = true;
  setSavingState(true);

  try {
    const {
      data: { user },
      error: userError
    } = await supabaseClient.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      throw new Error(
        "Utilizatorul nu este autentificat."
      );
    }

    const goals = [...selectedGoals];

    const studyGoals = goals.filter(
      (goal) => goal !== "habits"
    );

    const personalGoals = goals.filter(
      (goal) => goal === "habits"
    );

    const profilePayload = {
      id: user.id,

      first_name: document
        .getElementById("firstName")
        .value
        .trim(),

      grade: document.getElementById(
        "gradeLevel"
      ).value,

      university: document
        .getElementById("universityGoal")
        .value
        .trim() || null,

      study_goals: studyGoals,
      personal_goals: personalGoals,

      onboarding_completed: true,
      updated_at: new Date().toISOString()
    };

    const {
      error: profileError
    } = await supabaseClient
      .from("profiles")
      .upsert(profilePayload, {
        onConflict: "id"
      });

    if (profileError) {
      throw new Error(
        `Profilul nu a putut fi salvat: ${profileError.message}`
      );
    }

    showToast("Profilul a fost salvat.");

    const {
      error: deleteSubjectsError
    } = await supabaseClient
      .from("subjects")
      .delete()
      .eq("user_id", user.id);

    if (deleteSubjectsError) {
      throw new Error(
        `Materiile vechi nu au putut fi actualizate: ${deleteSubjectsError.message}`
      );
    }

    const subjectsPayload = [
      ...selectedSubjects
    ].map((subjectName, index) => {
      const config =
        SUBJECT_CONFIG[subjectName] || {
          color: "#f3a9c5",
          icon: subjectName
            .charAt(0)
            .toUpperCase()
        };

      return {
        user_id: user.id,
        name: subjectName,
        color: config.color,
        icon: config.icon,
        teacher_name: null,
        room: null,
        is_active: true,
        position: index + 1,
        updated_at: new Date().toISOString()
      };
    });

    const {
      error: subjectsError
    } = await supabaseClient
      .from("subjects")
      .insert(subjectsPayload);

    if (subjectsError) {
      throw new Error(
        `Materiile nu au putut fi salvate: ${subjectsError.message}`
      );
    }

    showToast("Materiile au fost adăugate.");

    /*
      Ștergem vechiul profil local numai după ce
      salvarea în Supabase a reușit complet.
    */
    localStorage.removeItem(
      LEGACY_PROFILE_STORAGE_KEY
    );

    window.location.href = "schedule.html";
  } catch (error) {
    console.error(
      "Onboarding-ul nu a putut fi salvat:",
      error
    );

    showError(
      error.message ||
      "Datele nu au putut fi salvate. Încearcă din nou."
    );

    isSaving = false;
    setSavingState(false);
  }
}

function setSavingState(saving) {
  const continueButton = document.getElementById(
    "continueButton"
  );

  const backButton = document.getElementById(
    "backButton"
  );

  continueButton.disabled = saving;
  backButton.disabled = saving;

  if (saving) {
    continueButton.innerHTML = `
      Se pregătește spațiul tău...
    `;
  } else {
    continueButton.innerHTML = `
      Intră în Itera
      <span>→</span>
    `;
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
