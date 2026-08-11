"use strict";

(function (global) {
  const metadataKey = "itera_task_plan";
  const personalTaskOnlyMarker = "[itera:task-only]";
  const personalTypes = ["personal", "selfcare", "home", "health", "errand"];
  const capacityByEnergy = { 1: 45, 2: 90, 3: 150, 4: 210, 5: 270 };

  const isoDate = (date = new Date()) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  };
  const parseDate = value => new Date(`${value}T12:00:00`);
  const addDays = (value, days) => {
    const date = parseDate(value);
    date.setDate(date.getDate() + days);
    return isoDate(date);
  };
  const daysBetween = (first, second) => Math.round((parseDate(second) - parseDate(first)) / 86400000);
  const minutesFromTime = value => {
    if (!value) return null;
    const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
  };
  const clockFromMinutes = value => {
    const safe = Math.max(0, Math.min(1439, Math.round(value)));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  };
  const roundQuarter = value => Math.ceil(value / 15) * 15;
  const taskDuration = task => Math.max(15, Number(task.estimated_minutes || task.estimatedMinutes) || 30);
  const isPersonalEvent = task => {
    const personal = personalTypes.includes(task?.task_type || task?.type);
    if (!personal) return false;
    if (typeof task?.calendarHidden === "boolean") return !task.calendarHidden;
    return !String(task?.notes || "").includes(personalTaskOnlyMarker);
  };
  const isPersonalTask = task => personalTypes.includes(task?.task_type || task?.type) && !isPersonalEvent(task);
  const isCareTask = task => (task?.task_type || task?.type) === "selfcare";
  const isPlannable = task => task && !task.completed && task.task_type !== "goal" && task.type !== "goal" &&
    !isPersonalEvent(task) && Boolean(task.deadline_date || task.deadline);

  function getPlan(user) {
    const value = user?.user_metadata?.[metadataKey];
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function getTaskPlan(user, taskOrId) {
    const id = typeof taskOrId === "object" ? taskOrId?.id : taskOrId;
    if (!id) return null;
    const entry = getPlan(user)[String(id)];
    if (!entry?.date || !entry?.time) return null;
    if (typeof taskOrId === "object") {
      const deadline = taskOrId.deadline_date || taskOrId.deadline || null;
      if (entry.deadlineDate && deadline && entry.deadlineDate !== deadline) return null;
    }
    return entry;
  }

  function mergeIntervals(intervals) {
    return intervals.filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
      .sort((a, b) => a.start - b.start).reduce((merged, interval) => {
        const last = merged.at(-1);
        if (!last || interval.start > last.end) merged.push({ ...interval });
        else last.end = Math.max(last.end, interval.end);
        return merged;
      }, []);
  }

  function firstFreeSlot(start, duration, intervals, latestEnd) {
    let cursor = roundQuarter(start);
    for (const interval of mergeIntervals(intervals)) {
      if (interval.end <= cursor) continue;
      if (cursor + duration <= interval.start) return cursor;
      cursor = roundQuarter(interval.end);
    }
    return cursor + duration <= latestEnd ? cursor : null;
  }

  function fixedIntervals(date, scheduleItems, calendarEvents) {
    const day = parseDate(date).getDay();
    const schedule = scheduleItems.filter(item => Number(item.day_of_week) === day && item.start_time).map(item => {
      const start = minutesFromTime(item.start_time);
      return { start, end: minutesFromTime(item.end_time) ?? start + 60 };
    });
    const events = calendarEvents.filter(item => (item.event_date || item.date) === date && (item.start_time || item.time)).map(item => {
      const start = minutesFromTime(item.start_time || item.time);
      return { start, end: minutesFromTime(item.end_time || item.endTime) ?? start + 60 };
    });
    return mergeIntervals([...schedule, ...events]);
  }

  function personalEventIntervals(date, tasks) {
    return tasks.filter(task => isPersonalEvent(task) && (task.deadline_date || task.deadline) === date &&
      (task.deadline_time || task.deadlineTime)).map(task => {
        const start = minutesFromTime(task.deadline_time || task.deadlineTime);
        return { start, end: start + taskDuration(task) };
      });
  }

  function dayStart(date, scheduleItems, personal = false) {
    const day = parseDate(date).getDay();
    const weekend = day === 0 || day === 6;
    if (weekend) return personal ? 13 * 60 : 8 * 60 + 30;
    const schoolEnd = scheduleItems.filter(item => Number(item.day_of_week) === day && item.end_time)
      .reduce((latest, item) => Math.max(latest, minutesFromTime(item.end_time) || 0), 0);
    const academicStart = Math.max(15 * 60 + 30, schoolEnd ? schoolEnd + 45 : 0);
    return personal ? Math.max(18 * 60, academicStart) : academicStart;
  }

  function preferredPlanningDate(task, today) {
    const deadline = task.deadline_date || task.deadline;
    const days = Math.max(0, daysBetween(today, deadline));
    if (days <= 1) return today;
    const earlyOffset = Math.min(3, Math.max(1, Math.floor(days * 0.35)));
    return addDays(today, Math.min(earlyOffset, days - 1));
  }

  function buildPlan({ tasks = [], scheduleItems = [], calendarEvents = [], user = null, energy = 3,
    today = isoDate(), now = new Date() }) {
    const previous = getPlan(user);
    const openIds = new Set(tasks.filter(task => !task.completed).map(task => String(task.id)));
    const plan = Object.fromEntries(Object.entries(previous).filter(([id]) => openIds.has(id)));
    const candidates = tasks.filter(isPlannable).sort((first, second) => {
      const personalOrder = Number(isPersonalTask(first)) - Number(isPersonalTask(second));
      const priority = { high: 0, medium: 1, low: 2 };
      return personalOrder || String(first.deadline_date || first.deadline).localeCompare(String(second.deadline_date || second.deadline)) ||
        (priority[first.priority] ?? 1) - (priority[second.priority] ?? 1) ||
        String(first.created_at || "").localeCompare(String(second.created_at || ""));
    });
    candidates.forEach(task => { delete plan[String(task.id)]; });

    const days = new Map();
    const ensureDay = date => {
      if (!days.has(date)) {
        const weekend = [0, 6].includes(parseDate(date).getDay());
        days.set(date, {
          busy: mergeIntervals([
            ...fixedIntervals(date, scheduleItems, calendarEvents),
            ...personalEventIntervals(date, tasks)
          ]), academicEnd: 0, used: 0,
          capacity: date === today ? capacityByEnergy[Number(energy)] || capacityByEnergy[3] : weekend ? 210 : capacityByEnergy[3]
        });
      }
      return days.get(date);
    };
    const unscheduled = [];

    for (const task of candidates) {
      const deadline = task.deadline_date || task.deadline;
      const personal = isPersonalTask(task);
      const possibleDates = [];
      if (personal) {
        if (deadline >= today) possibleDates.push(deadline);
      } else {
        const latest = deadline > today ? addDays(deadline, -1) : today;
        const preferred = preferredPlanningDate(task, today);
        for (let date = preferred; date <= latest; date = addDays(date, 1)) possibleDates.push(date);
        for (let date = addDays(preferred, -1); date >= today; date = addDays(date, -1)) possibleDates.push(date);
      }
      const duration = taskDuration(task);
      let chosen = null;

      for (const date of possibleDates) {
        const state = ensureDay(date);
        if (!personal && state.used + duration > state.capacity) continue;
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        let earliest = dayStart(date, scheduleItems, personal);
        const preferredTime = minutesFromTime(task.deadline_time || task.deadlineTime);
        if (preferredTime !== null) earliest = Math.max(earliest, preferredTime);
        if (date === today) earliest = Math.max(earliest, roundQuarter(currentMinutes + 15));
        if (personal) earliest = Math.max(earliest, state.academicEnd ? state.academicEnd + 15 : 0);
        const slot = firstFreeSlot(earliest, duration, state.busy, 22 * 60 + 30);
        if (slot === null) continue;
        chosen = { date, time: clockFromMinutes(slot), slot, state };
        break;
      }

      if (!chosen) { unscheduled.push(task); continue; }
      const breakMinutes = isCareTask(task) ? 0 : duration >= 90 ? 20 : 15;
      chosen.state.busy.push({ start: chosen.slot, end: chosen.slot + duration + breakMinutes });
      chosen.state.busy = mergeIntervals(chosen.state.busy);
      chosen.state.used += duration;
      if (!isPersonalTask(task)) chosen.state.academicEnd = Math.max(chosen.state.academicEnd, chosen.slot + duration);
      const previousEntry = previous[String(task.id)];
      const unchanged = previousEntry && previousEntry.date === chosen.date && previousEntry.time === chosen.time &&
        previousEntry.deadlineDate === deadline && Number(previousEntry.duration) === duration;
      plan[String(task.id)] = {
        date: chosen.date, time: chosen.time, deadlineDate: deadline,
        deadlineTime: task.deadline_time || task.deadlineTime || null, duration,
        kind: isPersonalTask(task) ? "personal" : "study", source: "auto",
        updatedAt: unchanged ? previousEntry.updatedAt : new Date().toISOString()
      };
    }
    return { plan, scheduled: candidates.length - unscheduled.length, total: candidates.length, unscheduled };
  }

  async function savePlan(user, plan) {
    if (!user) return { ok: false, error: new Error("Missing user") };
    const { data, error } = await global.supabaseClient.auth.updateUser({ data: { [metadataKey]: plan } });
    return { ok: !error, error, user: data?.user || user };
  }

  async function removeTask(user, taskId) {
    const plan = { ...getPlan(user) };
    delete plan[String(taskId)];
    return savePlan(user, plan);
  }

  global.IteraPlanning = Object.freeze({ buildPlan, getPlan, getTaskPlan, isPersonalEvent, isPersonalTask,
    isPlannable, savePlan, removeTask, isoDate });
})(window);
