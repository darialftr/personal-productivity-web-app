"use strict";

/* A small, dependency-free source of truth for school time.  Views only ask it
 * questions; the defaults are kept here rather than copied into widgets. */
(function (global) {
  const DEFAULTS = Object.freeze({
    lessonMinutes: 50,
    breakMinutes: 10,
    longBreaks: [{ start: "09:50", end: "10:10" }, { start: "14:00", end: "14:20" }]
  });

  const toMinutes = (value) => {
    const [h, m] = String(value || "00:00").slice(0, 5).split(":").map(Number);
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  };
  const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const storageKey = (userId) => `itera:timetable-settings:${userId || "guest"}`;

  function getSettings(userId) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(userId)) || "{}");
      return {
        ...DEFAULTS,
        ...saved,
        longBreaks: Array.isArray(saved.longBreaks) && saved.longBreaks.length ? saved.longBreaks : DEFAULTS.longBreaks
      };
    } catch (_) { return { ...DEFAULTS, longBreaks: [...DEFAULTS.longBreaks] }; }
  }

  function saveSettings(userId, settings) {
    const next = { ...getSettings(userId), ...settings };
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
    return next;
  }

  function nextLessonStart(after, settings) {
    let start = after + Number(settings.breakMinutes || 0);
    settings.longBreaks.forEach((pause) => {
      const begin = toMinutes(pause.start), end = toMinutes(pause.end);
      if (start >= begin && start < end) start = end;
    });
    return start;
  }

  function buildSlots({ startTime = "08:00", lessons = [], settings = DEFAULTS }) {
    const resolved = { ...DEFAULTS, ...settings, longBreaks: settings.longBreaks || DEFAULTS.longBreaks };
    let cursor = toMinutes(startTime);
    return lessons.map((lesson, index) => {
      if (index) cursor = nextLessonStart(cursor, resolved);
      let start = cursor;
      let end = start + Number(resolved.lessonMinutes || DEFAULTS.lessonMinutes);
      resolved.longBreaks.forEach((pause) => {
        const pauseStart = toMinutes(pause.start), pauseEnd = toMinutes(pause.end);
        if (start < pauseStart && end > pauseStart) { start = pauseEnd; end = start + Number(resolved.lessonMinutes || DEFAULTS.lessonMinutes); }
      });
      cursor = end;
      return { ...lesson, start: toTime(start), end: toTime(end), startMinutes: start, endMinutes: end };
    });
  }

  function status(items, subjects, date = new Date()) {
    const day = date.getDay();
    const now = date.getHours() * 60 + date.getMinutes();
    const lessons = (items || []).filter((item) => Number(item.day_of_week) === day && (item.item_type || "school") === "school")
      .map((item) => ({ ...item, startMinutes: toMinutes(item.start_time), endMinutes: toMinutes(item.end_time), subject: subjects?.find((s) => String(s.id) === String(item.subject_id)) }))
      .sort((a, b) => a.startMinutes - b.startMinutes);
    const current = lessons.find((item) => now >= item.startMinutes && now < item.endMinutes) || null;
    const next = lessons.find((item) => item.startMinutes > now) || null;
    const previous = [...lessons].reverse().find((item) => item.endMinutes <= now) || null;
    if (current) return { state: "class", current, next, minutesRemaining: current.endMinutes - now, lessons };
    if (previous && next && now >= previous.endMinutes && now < next.startMinutes) {
      const settings = getSettings(global.IteraCurrentUserId);
      const longBreak = settings.longBreaks.find((pause) => now >= toMinutes(pause.start) && now < toMinutes(pause.end));
      return { state: "break", next, previous, breakStart: previous.endMinutes, breakEnd: next.startMinutes, isLongBreak: Boolean(longBreak), minutesRemaining: next.startMinutes - now, lessons };
    }
    return { state: "before", next, lessons, minutesRemaining: next ? next.startMinutes - now : 0 };
  }

  global.IteraTimetable = Object.freeze({ DEFAULTS, getSettings, saveSettings, buildSlots, status, toMinutes, toTime });
})(window);
