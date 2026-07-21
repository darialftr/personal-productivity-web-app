"use strict";

const SUPABASE_URL =
  "https://yxpghxgasfokxxzbtcax.supabase.co/rest/v1/";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_G9NfEK1vNnYgs02fSTg7aA_OJU2U5XO";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
