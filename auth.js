"use strict";

let authMode = "login";

const loginTabButton = document.getElementById(
  "loginTabButton"
);

const registerTabButton = document.getElementById(
  "registerTabButton"
);

const firstNameField = document.getElementById(
  "firstNameField"
);

const firstNameInput = document.getElementById(
  "firstNameInput"
);

const emailInput = document.getElementById(
  "emailInput"
);

const passwordInput = document.getElementById(
  "passwordInput"
);

const authForm = document.getElementById(
  "authForm"
);

const authSubmitButton = document.getElementById(
  "authSubmitButton"
);

const formMessage = document.getElementById(
  "formMessage"
);

initializeAuthPage();

async function initializeAuthPage() {
  initializeEvents();

  const {
    data: { session }
  } = await supabaseClient.auth.getSession();

  if (session) {
    window.location.replace("index.html");
    return;
  }

  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const authError = hash.get("error_description");

  if (authError) {
    showFormMessage(authError.replaceAll("+", " "), "error");
  } else if (query.get("confirmed") === "1") {
    showFormMessage("Email confirmat. Acum te poți autentifica în Itera.", "success");
  } else if (query.get("logged_out") === "1") {
    showFormMessage("Ai ieșit din cont în siguranță.", "success");
  }
}

function initializeEvents() {
  loginTabButton.addEventListener("click", () => {
    switchAuthMode("login");
  });

  registerTabButton.addEventListener("click", () => {
    switchAuthMode("register");
  });

  authForm.addEventListener(
    "submit",
    handleAuthSubmit
  );

  document
    .getElementById("passwordToggleButton")
    .addEventListener("click", togglePasswordVisibility);

  document
    .getElementById("forgotPasswordButton")
    .addEventListener("click", handleForgotPassword);
}

function switchAuthMode(mode) {
  authMode = mode;

  const isRegister = mode === "register";

  loginTabButton.classList.toggle(
    "active",
    !isRegister
  );

  registerTabButton.classList.toggle(
    "active",
    isRegister
  );

  firstNameField.classList.toggle(
    "hidden",
    !isRegister
  );

  firstNameInput.required = isRegister;

  document.getElementById(
    "authEyebrow"
  ).textContent = isRegister
    ? "Început nou"
    : "Bine ai revenit";

  document.getElementById(
    "authTitle"
  ).textContent = isRegister
    ? "Creează-ți contul"
    : "Intră în contul tău";

  document.getElementById(
    "authDescription"
  ).textContent = isRegister
    ? "Datele tale vor fi sincronizate între dispozitive."
    : "Continuă de unde ai rămas.";

  authSubmitButton.textContent = isRegister
    ? "Creează cont"
    : "Autentificare";

  document.getElementById(
    "forgotPasswordButton"
  ).classList.toggle(
    "hidden",
    isRegister
  );

  passwordInput.autocomplete = isRegister
    ? "new-password"
    : "current-password";

  clearFormMessage();
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const email = emailInput.value
    .trim()
    .toLowerCase();

  const password = passwordInput.value;

  const firstName = firstNameInput.value.trim();

  if (!email || !password) {
    showFormMessage(
      "Completează emailul și parola.",
      "error"
    );

    return;
  }

  if (password.length < 8) {
    showFormMessage(
      "Parola trebuie să aibă minimum 8 caractere.",
      "error"
    );

    return;
  }

  if (
    authMode === "register" &&
    !firstName
  ) {
    showFormMessage(
      "Completează prenumele.",
      "error"
    );

    return;
  }

  setLoadingState(true);

  try {
    if (authMode === "register") {
      await registerUser(
        email,
        password,
        firstName
      );
    } else {
      await loginUser(email, password);
    }
  } catch (error) {
    console.error(error);

    showFormMessage(
      translateAuthError(error.message),
      "error"
    );
  } finally {
    setLoadingState(false);
  }
}

async function registerUser(
  email,
  password,
  firstName
) {
  const { data, error } =
    await supabaseClient.auth.signUp({
      email,
      password,

      options: {
        emailRedirectTo: getAuthPageUrl("confirmed"),
        data: {
          first_name: firstName,
          itera_theme: "neutral",
          itera_mode: "light",
          itera_theme_version: 2
        }
      }
    });

  if (error) {
    throw error;
  }

  if (data.session) {
    window.location.replace("index.html");
    return;
  }

  showFormMessage(
    "Contul a fost creat. Verifică emailul pentru confirmare.",
    "success"
  );

  authForm.reset();
}

function getAuthPageUrl(state) {
  const url = new URL("auth.html", window.location.href);
  url.searchParams.set(state, "1");
  return url.href;
}
async function loginUser(email, password) {
  const { error } =
    await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    throw error;
  }

  window.location.replace("index.html");
}

async function handleForgotPassword() {
  const email = emailInput.value
    .trim()
    .toLowerCase();

  if (!email) {
    showFormMessage(
      "Scrie mai întâi adresa de email.",
      "error"
    );

    emailInput.focus();
    return;
  }

  const redirectUrl = getAuthPageUrl("recovery");

  setLoadingState(true);

  try {
    const { error } =
      await supabaseClient.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: redirectUrl
        }
      );

    if (error) {
      throw error;
    }

    showFormMessage(
      "Ți-am trimis un email pentru resetarea parolei.",
      "success"
    );
  } catch (error) {
    console.error(error);

    showFormMessage(
      translateAuthError(error.message),
      "error"
    );
  } finally {
    setLoadingState(false);
  }
}

function togglePasswordVisibility() {
  const isPassword =
    passwordInput.type === "password";

  passwordInput.type = isPassword
    ? "text"
    : "password";

  document.getElementById(
    "passwordToggleButton"
  ).textContent = isPassword
    ? "🙈"
    : "👁";
}

function setLoadingState(isLoading) {
  authSubmitButton.disabled = isLoading;

  authSubmitButton.textContent = isLoading
    ? "Se încarcă..."
    : authMode === "register"
      ? "Creează cont"
      : "Autentificare";
}

function showFormMessage(message, type) {
  formMessage.textContent = message;

  formMessage.classList.remove(
    "error",
    "success"
  );

  formMessage.classList.add(type);
}

function clearFormMessage() {
  formMessage.textContent = "";

  formMessage.classList.remove(
    "error",
    "success"
  );
}

function translateAuthError(message) {
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes(
      "invalid login credentials"
    )
  ) {
    return "Emailul sau parola sunt incorecte.";
  }

  if (
    lowerMessage.includes(
      "email not confirmed"
    )
  ) {
    return "Confirmă mai întâi adresa de email.";
  }

  if (
    lowerMessage.includes(
      "user already registered"
    )
  ) {
    return "Există deja un cont cu acest email.";
  }

  if (
    lowerMessage.includes(
      "password should be"
    )
  ) {
    return "Parola nu este suficient de puternică.";
  }

  if (
    lowerMessage.includes(
      "rate limit"
    ) ||
    lowerMessage.includes(
      "email rate limit exceeded"
    ) ||
    lowerMessage.includes(
      "over_email_send_rate_limit"
    )
  ) {
    return "Emailurile de confirmare au atins limita temporară Supabase. Contul tău este în regulă — încearcă din nou peste aproximativ o oră.";
  }

  return message;
}
