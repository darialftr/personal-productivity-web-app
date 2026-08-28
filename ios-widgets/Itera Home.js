// Itera Home — Scriptable widget for iPadOS
// Run once inside Scriptable to sign in. Your password is never stored; only
// the Supabase session is kept in the iPad Keychain.

const SUPABASE_URL = "https://yxpghxgasfokxxzbtcax.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_G9NfEK1vNnYgs02fSTg7aA_OJU2U5XO";
const SESSION_KEY = "itera-scriptable-session-v1";
const ITERA_URL = "https://darialftr.github.io/personal-productivity-web-app/";

async function requestJson(url, method = "GET", body = null, token = null) {
  const request = new Request(url);
  request.method = method;
  request.headers = { apikey: PUBLISHABLE_KEY };
  // Publishable keys are opaque values, not user JWTs. Only data requests
  // receive a Bearer access token after the person has signed in.
  if (token) request.headers.Authorization = `Bearer ${token}`;
  if (body) { request.headers["Content-Type"] = "application/json"; request.body = JSON.stringify(body); }
  return request.loadJSON();
}

async function signIn() {
  const alert = new Alert();
  alert.title = "Conectează widgetul Itera";
  alert.message = "Sesiunea este păstrată în Keychain-ul iPad-ului.";
  alert.addTextField("Email", ""); alert.addSecureTextField("Parola", "");
  alert.addAction("Conectează"); alert.addCancelAction("Renunță");
  if (await alert.presentAlert() === -1) return null;
  const email = alert.textFieldValue(0).trim(), password = alert.textFieldValue(1);
  if (!email || !password) throw new Error("Completează emailul și parola.");
  const session = await requestJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, "POST", { email, password });
  if (!session.access_token) throw new Error(session.error_description || "Autentificarea nu a reușit.");
  Keychain.set(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function session() {
  if (!Keychain.contains(SESSION_KEY)) return signIn();
  let saved = JSON.parse(Keychain.get(SESSION_KEY));
  if (Date.now() < Number(saved.expires_at || 0) * 1000 - 60000) return saved;
  const refreshed = await requestJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, "POST", { refresh_token: saved.refresh_token });
  if (!refreshed.access_token) { Keychain.remove(SESSION_KEY); return signIn(); }
  Keychain.set(SESSION_KEY, JSON.stringify(refreshed));
  return refreshed;
}

const pad = value => String(value).padStart(2, "0");
const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const minutes = time => { const [h, m] = String(time || "00:00").slice(0, 5).split(":").map(Number); return h * 60 + m; };
const clock = value => String(value || "").slice(0, 5);
const addText = (stack, text, font, color) => { const row = stack.addText(text); row.font = font; row.textColor = color; row.lineLimit = 1; return row; };

async function getData(saved) {
  const today = dateKey(new Date()), user = saved.user.id, token = saved.access_token;
  const base = `${SUPABASE_URL}/rest/v1/`;
  const [tasks, subjects, schedule] = await Promise.all([
    requestJson(`${base}tasks?select=title,task_type,subject_id,deadline_date,priority&user_id=eq.${user}&completed=eq.false&deadline_date=eq.${today}&order=priority.desc&limit=6`, "GET", null, token),
    requestJson(`${base}subjects?select=id,name,color&user_id=eq.${user}&is_active=eq.true`, "GET", null, token),
    requestJson(`${base}schedule_items?select=title,subject_id,start_time,end_time,location,item_type,day_of_week&user_id=eq.${user}&day_of_week=eq.${new Date().getDay()}&order=start_time`, "GET", null, token)
  ]);
  return { tasks: Array.isArray(tasks) ? tasks : [], subjects: Array.isArray(subjects) ? subjects : [], schedule: Array.isArray(schedule) ? schedule.filter(item => (item.item_type || "school") === "school") : [] };
}

function schoolStatus(schedule, subjects) {
  const now = new Date(), currentMinute = now.getHours() * 60 + now.getMinutes();
  const lessons = schedule.map(item => ({ ...item, start: minutes(item.start_time), end: minutes(item.end_time), subject: subjects.find(subject => subject.id === item.subject_id) })).sort((a,b) => a.start - b.start);
  const current = lessons.find(item => currentMinute >= item.start && currentMinute < item.end);
  const next = lessons.find(item => item.start > currentMinute);
  const previous = [...lessons].reverse().find(item => item.end <= currentMinute);
  if (current) return { label: "ACUM", title: current.subject?.name || current.title, detail: `Se termină la ${clock(current.end_time)} · ${current.end - currentMinute} min`, next };
  if (previous && next && currentMinute < next.start) return { label: [590, 840].some(value => currentMinute >= value && currentMinute < value + 20) ? "PAUZĂ LUNGĂ" : "PAUZĂ", title: `${clock(previous.end_time)}–${clock(next.start_time)}`, detail: `${next.start - currentMinute} min · apoi ${next.subject?.name || next.title}`, next };
  if (next) return { label: "URMĂTOAREA ORĂ", title: next.subject?.name || next.title, detail: `Începe la ${clock(next.start_time)}${next.location ? ` · ${next.location}` : ""}`, next };
  return { label: "PROGRAM", title: lessons.length ? "Gata pentru azi" : "Fără ore în orar", detail: lessons.length ? "Ai terminat pentru azi." : "Adaugă orarul în Itera." };
}

function buildWidget(data) {
  const widget = new ListWidget();
  const gradient = new LinearGradient(); gradient.colors = [new Color("#fff4f6"), new Color("#f4eaff")]; gradient.locations = [0, 1]; widget.backgroundGradient = gradient; widget.setPadding(16, 16, 15, 16); widget.url = ITERA_URL;
  const status = schoolStatus(data.schedule, data.subjects), rose = new Color("#bf5575"), ink = new Color("#332c38"), muted = new Color("#786e78");
  addText(widget, "ITERA  ·  " + status.label, Font.boldSystemFont(10), rose); widget.addSpacer(4); addText(widget, status.title, Font.boldSystemFont(18), ink); addText(widget, status.detail, Font.systemFont(12), muted); widget.addSpacer(10);
  const heading = widget.addStack(); heading.layoutHorizontally(); addText(heading, "PENTRU AZI", Font.boldSystemFont(10), rose); heading.addSpacer(); addText(heading, `${data.tasks.length} lucruri`, Font.systemFont(10), muted); widget.addSpacer(5);
  if (!data.tasks.length) addText(widget, "Ai spațiu pentru tine azi ✿", Font.systemFont(13), muted);
  data.tasks.slice(0, config.widgetFamily === "small" ? 2 : 4).forEach(task => { const row = widget.addStack(); row.layoutHorizontally(); row.centerAlignContent(); const dot = row.addText(task.task_type === "test" ? "★" : "•"); dot.font = Font.boldSystemFont(14); dot.textColor = task.task_type === "test" ? new Color("#8c63b8") : rose; row.addSpacer(6); addText(row, task.title, Font.systemFont(13), ink); });
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000); return widget;
}

try {
  const saved = await session();
  if (!saved) Script.complete();
  const widget = buildWidget(await getData(saved));
  if (config.runsInWidget) Script.setWidget(widget); else await widget.presentMedium();
} catch (error) {
  const widget = new ListWidget(); widget.backgroundColor = new Color("#fff4f6"); widget.setPadding(16,16,16,16); addText(widget, "Itera", Font.boldSystemFont(18), new Color("#bf5575")); widget.addSpacer(6); addText(widget, error.message || "Deschide Scriptable și conectează widgetul.", Font.systemFont(13), new Color("#786e78")); widget.url = "scriptable:///run";
  if (config.runsInWidget) Script.setWidget(widget); else await widget.presentMedium();
}
Script.complete();
