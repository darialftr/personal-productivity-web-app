# Activarea notificărilor Itera

## 1. Baza de date

În Supabase Dashboard → SQL Editor, rulează:

1. `supabase-push-setup.sql`
2. după publicarea funcțiilor, `supabase-push-cron.sql`

În al doilea fișier înlocuiește:

- `PROJECT_REF` cu `yxpghxgasfokxxzbtcax`
- `CRON_SECRET` cu valoarea `PUSH_CRON_SECRET` din `PUSH_SECRETS.local.txt`

Activează extensiile `pg_cron`, `pg_net` și `vault` dacă SQL Editor solicită acest lucru.

## 2. Secretele funcțiilor

În Supabase Dashboard → Edge Functions → Secrets, adaugă valorile din
`PUSH_SECRETS.local.txt`:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_CRON_SECRET`

Fișierul local cu secrete este exclus din Git și nu trebuie publicat.

## 3. Funcțiile Edge

Publică:

- `push-config`
- `send-push`

Ambele sunt în directorul `supabase/functions`.

## 4. Telefon

### iPhone

1. Deschide Itera în Safari.
2. Share → Add to Home Screen.
3. Deschide Itera de pe ecranul principal.
4. Clopoțel → Activează notificările.
5. Apasă „Trimite un test”.

### Android

1. Deschide Itera în Chrome.
2. Instalează aplicația când apare opțiunea.
3. Clopoțel → Activează notificările.
4. Apasă „Trimite un test”.
