"use strict";

globalThis.IteraAuthSessionPromise = protectCurrentPage();

async function protectCurrentPage() {
  const {
    data: { session },
    error
  } = await supabaseClient.auth.getSession();

  if (error || !session) {
    window.location.replace("auth.html");
    return;
  }

  const isAppShell = /(?:^|\/)index\.html$/.test(window.location.pathname)
    || window.location.pathname.endsWith("/");

  if (!isAppShell) {
    return session;
  }

  globalThis.IteraOnboardingProfilePromise = supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();

  void globalThis.IteraOnboardingProfilePromise.then(({ data: profile, error: profileError }) => {
    if (!profileError && !profile?.onboarding_completed) {
      window.location.replace("onboarding.html");
    }
  });

  return session;
}
