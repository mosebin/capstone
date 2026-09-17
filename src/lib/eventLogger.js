const TEAM_ID_KEY = 'neo-node-team-id';
const SESSION_ID_KEY = 'neo-node-session-id';
const EVENT_LOG_KEY = 'neo-node-event-log';
const SESSION_ACTIVE_KEY = 'neo-node-session-active';
const SESSION_STARTED_AT_KEY = 'neo-node-session-started-at';
const TEAM_QUERY_PARAM = 'team';
export const EVENT_LOG_SESSION_SECONDS = 30 * 60;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatTimestampForFile(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getEventLogStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // fall through
  }
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

export function getTeamId() {
  try {
    return sessionStorage.getItem(TEAM_ID_KEY) || null;
  } catch {
    return null;
  }
}

export function setTeamId(teamId) {
  try {
    const normalized = String(teamId || '').trim().toUpperCase();
    if (!normalized) return;
    sessionStorage.setItem(TEAM_ID_KEY, normalized);
  } catch {
    // ignore storage failures
  }
}

export function clearTeamId() {
  try {
    sessionStorage.removeItem(TEAM_ID_KEY);
  } catch {
    // ignore storage failures
  }
}

export function getSessionId() {
  try {
    let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    }
    return sessionId;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getStoredSessionId() {
  try {
    return sessionStorage.getItem(SESSION_ID_KEY) || null;
  } catch {
    return null;
  }
}

function getSessionStartedAt() {
  try {
    const startedAt = Number(sessionStorage.getItem(SESSION_STARTED_AT_KEY));
    return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null;
  } catch {
    return null;
  }
}

export function getEventLogSessionState(now = Date.now()) {
  try {
    const active = sessionStorage.getItem(SESSION_ACTIVE_KEY) === 'true';
    const startedAt = getSessionStartedAt();
    const elapsedSeconds = active && startedAt
      ? Math.max(0, Math.floor((now - startedAt) / 1000))
      : 0;
    const remainingSeconds = active
      ? Math.max(0, EVENT_LOG_SESSION_SECONDS - elapsedSeconds)
      : EVENT_LOG_SESSION_SECONDS;
    return {
      active,
      startedAt,
      sessionId: getStoredSessionId(),
      elapsedSeconds,
      remainingSeconds,
      expired: active && remainingSeconds <= 0,
    };
  } catch {
    return {
      active: false,
      startedAt: null,
      sessionId: null,
      elapsedSeconds: 0,
      remainingSeconds: EVENT_LOG_SESSION_SECONDS,
      expired: false,
    };
  }
}

export function getEventLog() {
  try {
    const storage = getEventLogStorage();
    const raw = storage?.getItem(EVENT_LOG_KEY) || '[]';
    const parsed = safeParseJson(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearEventLog() {
  try {
    getEventLogStorage()?.removeItem(EVENT_LOG_KEY);
    sessionStorage.removeItem(EVENT_LOG_KEY);
  } catch {
    // ignore
  }
}

export function logEvent(type, payload = {}, options = {}) {
  const sessionState = getEventLogSessionState();
  if (!options.force && (!sessionState.active || sessionState.expired)) return null;
  const teamId = getTeamId() || 'UNKNOWN_TEAM';
  const sessionId = sessionState.sessionId || getSessionId();
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event_type: type,
    type,
    team_id: teamId,
    teamId,
    session_id: sessionId,
    sessionId,
    timestamp: new Date().toISOString(),
    payload: payload || {},
  };
  try {
    const events = getEventLog();
    events.push(event);
    getEventLogStorage()?.setItem(EVENT_LOG_KEY, JSON.stringify(events));
  } catch {
    // ignore storage failures
  }
  return event;
}

export function startEventLogSession() {
  const startedAt = Date.now();
  const sessionId = `session-${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    clearEventLog();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    sessionStorage.setItem(SESSION_STARTED_AT_KEY, String(startedAt));
    sessionStorage.setItem(SESSION_ACTIVE_KEY, 'true');
  } catch {
    // Storage failures should not block the app UI.
  }
  logEvent('session_start', {
    started_at: new Date(startedAt).toISOString(),
    duration_seconds: EVENT_LOG_SESSION_SECONDS,
  }, { force: true });
  return getEventLogSessionState();
}

export function endEventLogSession({ reason = 'manual', download = true } = {}) {
  const state = getEventLogSessionState();
  if (state.active) {
    logEvent('session_end', {
      reason,
      elapsed_seconds: state.elapsedSeconds,
      ended_at: new Date().toISOString(),
    }, { force: true });
  }
  if (download) exportEventLogAsFile();
  try {
    sessionStorage.setItem(SESSION_ACTIVE_KEY, 'false');
    sessionStorage.removeItem(SESSION_STARTED_AT_KEY);
  } catch {
    // ignore storage failures
  }
  return getEventLogSessionState();
}

export function exportEventLogAsFile() {
  const events = getEventLog();
  const teamId = getTeamId() || 'UNKNOWN_TEAM';
  const sessionState = getEventLogSessionState();
  const blob = new Blob([
    JSON.stringify({
      team_id: teamId,
      session_id: sessionState.sessionId || getSessionId(),
      exported_at: new Date().toISOString(),
      session_started_at: sessionState.startedAt ? new Date(sessionState.startedAt).toISOString() : null,
      events,
    }, null, 2),
  ], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${teamId}_events_${formatTimestampForFile()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export const downloadEventLog = exportEventLogAsFile;

export function getTeamIdFromQuery() {
  if (typeof window === 'undefined') return null;
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get(TEAM_QUERY_PARAM)?.trim() || null;
}

export function ensureTeamIdFromQuery() {
  const queryTeamId = getTeamIdFromQuery();
  if (queryTeamId) {
    setTeamId(queryTeamId);
    return queryTeamId;
  }
  return getTeamId();
}
