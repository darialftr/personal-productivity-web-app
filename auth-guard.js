"use strict";

protectCurrentPage();

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
    return;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", session.user.id)
    .maybeSingle();

  if (!profileError && !profile?.onboarding_completed) {
    window.location.replace("onboarding.html");
  }
}
