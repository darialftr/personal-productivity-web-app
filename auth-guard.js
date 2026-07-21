"use strict";

protectCurrentPage();

async function protectCurrentPage() {
  const {
    data: { session },
    error
  } = await supabaseClient.auth.getSession();

  if (error || !session) {
    window.location.replace("auth.html");
  }
}
