import { supabase } from "./lib/supabaseClient";
import { MATCH_LOG_EVENT_CODES } from "./services/matchLogService";

const MATCH_FIELDS = `
  id,
  event_id,
  status,
  score_a,
  score_b,
  start_time,
  event:events!matches_event_id_fkey (id, name, rules),
  team_a:teams!matches_team_a_fkey (id, name, short_name, attributes),
  team_b:teams!matches_team_b_fkey (id, name, short_name, attributes)
`;

const DEFAULT_LOGO_SRC = `${import.meta.env.BASE_URL}stallcount-logo.png`;
const EVENT_FIELDS = "id, name, rules";
const MATCH_LOG_FIELDS = `
  id,
  match_id,
  event_type_id,
  team_id,
  actor_id,
  secondary_actor_id,
  created_at,
  abba_line
`;

const MATCH_LOG_PAGE_SIZE = 1000;
const BASE_POSSESSION_EVENT_CODES = new Set([
  MATCH_LOG_EVENT_CODES.MATCH_START,
  MATCH_LOG_EVENT_CODES.SCORE,
  MATCH_LOG_EVENT_CODES.CALAHAN,
  MATCH_LOG_EVENT_CODES.HALFTIME_START,
  MATCH_LOG_EVENT_CODES.HALFTIME_END,
]);


const elements = {
  eventName: document.getElementById("eventName"),
  matchClock: document.getElementById("matchClock"),
  statusLabel: document.getElementById("statusLabel"),
  logo: document.getElementById("eventLogo"),
  logoFallback: document.getElementById("eventLogoFallback"),
  teamABox: document.getElementById("teamABox"),
  teamBBox: document.getElementById("teamBBox"),
  teamAName: document.getElementById("teamAName"),
  teamBName: document.getElementById("teamBName"),
  scoreA: document.getElementById("scoreA"),
  scoreB: document.getElementById("scoreB"),
  breakChanceBannerA: document.getElementById("breakChanceBannerA"),
  breakChanceBannerB: document.getElementById("breakChanceBannerB"),
  meta: document.getElementById("meta"),
  banner: document.getElementById("overlayBanner"),
  bannerPlayerName: document.getElementById("bannerPlayerName"),
  bannerStatGls: document.getElementById("bannerStatGls"),
  bannerStatAst: document.getElementById("bannerStatAst"),
  bannerStatBlk: document.getElementById("bannerStatBlk"),
  bannerStatTrn: document.getElementById("bannerStatTrn"),
  matchStatsBanner: document.getElementById("matchStatsBanner"),
  matchStatsTitle: document.getElementById("matchStatsTitle"),
  matchStatsColumnA: document.getElementById("matchStatsColumnA"),
  matchStatsColumnB: document.getElementById("matchStatsColumnB"),
  matchStatsTeamA: document.getElementById("matchStatsTeamA"),
  matchStatsTeamB: document.getElementById("matchStatsTeamB"),
  matchStatsScoreA: document.getElementById("matchStatsScoreA"),
  matchStatsScoreB: document.getElementById("matchStatsScoreB"),
  matchStatsHoldsA: document.getElementById("matchStatsHoldsA"),
  matchStatsHoldsB: document.getElementById("matchStatsHoldsB"),
  matchStatsBreaksA: document.getElementById("matchStatsBreaksA"),
  matchStatsBreaksB: document.getElementById("matchStatsBreaksB"),
  matchStatsTurnoversA: document.getElementById("matchStatsTurnoversA"),
  matchStatsTurnoversB: document.getElementById("matchStatsTurnoversB"),
  matchStatsBlocksA: document.getElementById("matchStatsBlocksA"),
  matchStatsBlocksB: document.getElementById("matchStatsBlocksB"),
  timeoutA: document.getElementById("timeoutBannerA"),
  timeoutB: document.getElementById("timeoutBannerB"),
  matchEventBanner: document.getElementById("matchEventBanner"),
  matchEventBannerLabel: document.getElementById("matchEventBannerLabel"),
};

const searchParams = new URLSearchParams(window.location.search);
const matchId = (searchParams.get("matchId") || "").trim();
const teamATheme = (searchParams.get("teamATheme") || "primary").trim().toLowerCase();
const teamBTheme = (searchParams.get("teamBTheme") || "primary").trim().toLowerCase();
const manualOverrides = getManualOverrides(searchParams);
const breakChanceEnabled = getBreakChanceEnabled(searchParams);
const isPreview =
  ["1", "true", "yes"].includes((searchParams.get("preview") || "").trim().toLowerCase());

if (isPreview) {
  document.body.classList.add("overlay-preview");
}

const eventCache = new Map();
const matchEventTypes = new Map();
let matchEventTypesLoaded = false;
let currentEvent = null;
let currentEventRules = null;
let matchLogs = [];
const matchLogById = new Map();
let clockInterval = null;
let bannerTimeout = null;
let timeoutTimeout = null;
let matchStatsTimeout = null;
let matchEventTimeout = null;

function handleOverlayBannerPayload(payload) {
  if (payload?.type === "playerStats") {
    showBanner(payload);
    return;
  }
  if (payload?.type === "matchStats") {
    showMatchStatsBanner(payload);
    return;
  }
  if (payload?.type === "timeout") {
    const team = (payload.team || "").toString().trim().toUpperCase();
    if (team === "A" || team === "B") {
      showTimeoutBanner(team);
    }
    return;
  }
  if (payload?.type === "matchEvent") {
    showMatchEventBanner(payload);
  }
}

function formatTeamName(team) {
  if (!team) return "TBD";
  return team.name || "TBD";
}

function normalizeAttributes(attributes) {
  if (!attributes) return null;
  if (typeof attributes === "string") {
    try {
      return JSON.parse(attributes);
    } catch (error) {
      return null;
    }
  }
  if (typeof attributes === "object") return attributes;
  return null;
}

function resolveTeamColors(attributes, theme) {
  const normalized = normalizeAttributes(attributes) || {};
  const isSecondary = theme === "secondary";
  const background = isSecondary ? normalized.secondaryColor : normalized.primaryColor;
  const text = isSecondary ? normalized.textOnSecondary : normalized.textOnPrimary;
  return {
    background: background || null,
    text: text || null,
    accent: normalized.accentColor || null,
  };
}

function clampColorChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseCssColor(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
      };
    }

    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  const rgbMatch = normalized.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+\s*)?\)$/i,
  );
  if (rgbMatch) {
    return {
      r: clampColorChannel(Number(rgbMatch[1])),
      g: clampColorChannel(Number(rgbMatch[2])),
      b: clampColorChannel(Number(rgbMatch[3])),
    };
  }

  return null;
}

function toRgbString(color, alpha = 1) {
  if (!color) return null;
  if (alpha >= 1) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function mixColors(colorA, colorB, ratio = 0.5) {
  if (!colorA || !colorB) return colorA || colorB || null;
  const mix = Math.max(0, Math.min(1, ratio));
  return {
    r: clampColorChannel(colorA.r + (colorB.r - colorA.r) * mix),
    g: clampColorChannel(colorA.g + (colorB.g - colorA.g) * mix),
    b: clampColorChannel(colorA.b + (colorB.b - colorA.b) * mix),
  };
}

function getRelativeLuminance(color) {
  if (!color) return 0;
  const normalize = (channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const r = normalize(color.r);
  const g = normalize(color.g);
  const b = normalize(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function deriveBannerPalette(colors) {
  const fallbackBackground = colors?.background || "#1f2933";
  const fallbackText = colors?.text || "#ffffff";
  const fallbackAccent = colors?.accent || fallbackBackground;

  const backgroundRgb = parseCssColor(fallbackBackground);
  const accentRgb = parseCssColor(fallbackAccent) || backgroundRgb;
  const darkRgb = { r: 15, g: 23, b: 42 };
  const lightRgb = { r: 248, g: 250, b: 252 };
  const isLightTeam = backgroundRgb ? getRelativeLuminance(backgroundRgb) > 0.58 : false;
  const surfaceText = darkRgb;
  const surfaceBg = lightRgb;
  const mutedText = toRgbString(darkRgb, 0.62);
  const dividerColor = toRgbString(darkRgb, 0.12);
  const borderColor = isLightTeam
    ? mixColors(backgroundRgb || lightRgb, darkRgb, 0.18)
    : mixColors(accentRgb || backgroundRgb || darkRgb, darkRgb, 0.1);
  const accentColor = accentRgb || backgroundRgb || darkRgb;
  const shadowColor = darkRgb;

  return {
    teamBg: fallbackBackground,
    teamText: fallbackText,
    surfaceBg: toRgbString(surfaceBg),
    surfaceText: toRgbString(surfaceText),
    mutedText,
    dividerColor,
    borderColor: toRgbString(borderColor || accentColor),
    accentColor: toRgbString(accentColor),
    shadowColor: toRgbString(shadowColor, 0.12),
  };
}

function normalizeRules(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

function findTimeCapMinutes(value, seen = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Object.prototype.hasOwnProperty.call(value, "timeCapMinutes")) {
    const raw = value.timeCapMinutes;
    const parsed = typeof raw === "string" ? Number(raw) : raw;
    if (Number.isFinite(parsed)) return parsed;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findTimeCapMinutes(item, seen);
      if (Number.isFinite(nested)) return nested;
    }
    return null;
  }

  for (const key of Object.keys(value)) {
    const nested = findTimeCapMinutes(value[key], seen);
    if (Number.isFinite(nested)) return nested;
  }

  return null;
}

function getTimeCapSeconds() {
  const normalizedRules = normalizeRules(currentEventRules) || normalizeRules(currentMatch?.event?.rules);
  const minutes = findTimeCapMinutes(normalizedRules);
  if (!Number.isFinite(minutes)) return null;
  return Math.max(0, minutes * 60);
}

function getManualOverrides(params) {
  const rawEnabled = (params.get("manual") || "").trim().toLowerCase();
  const enabled = rawEnabled === "1" || rawEnabled === "true" || rawEnabled === "yes";
  if (!enabled) return null;

  const scoreA = parseNumberParam(params.get("manualScoreA"));
  const scoreB = parseNumberParam(params.get("manualScoreB"));
  const clock = (params.get("manualClock") || "").trim();
  const statusLabel = normalizeManualStatus(params.get("manualStatus"));

  return {
    enabled,
    scoreA,
    scoreB,
    clock,
    statusLabel,
  };
}

function getBreakChanceEnabled(params) {
  const value = (params.get("breakChance") || "").trim().toLowerCase();
  if (!value) return true;
  return !["0", "false", "no", "off"].includes(value);
}

function parseNumberParam(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeManualStatus(value) {
  if (!value) return "";
  const normalized = value.toString().trim().toLowerCase();
  if (!normalized) return "";
  if (["starting", "starting_soon", "soon", "pre"].includes(normalized)) return "STARTING SOON";
  if (["1", "1st", "first"].includes(normalized)) return "1ST";
  if (["half", "halftime"].includes(normalized)) return "HALF";
  if (["2", "2nd", "second"].includes(normalized)) return "2ND";
  if (["soft", "softcap", "soft_cap"].includes(normalized)) return "SOFT CAP";
  if (["final", "finished", "completed"].includes(normalized)) return "FINAL";
  return normalized.toUpperCase();
}

function applyTeamColors(element, colors) {
  if (!element || !colors) return;
  if (colors.background) {
    element.style.setProperty("--team-bg", colors.background);
  } else {
    element.style.removeProperty("--team-bg");
  }
  if (colors.text) {
    element.style.setProperty("--team-text", colors.text);
  } else {
    element.style.removeProperty("--team-text");
  }
}

const STATUS_LABELS = {
  live: "LIVE",
  halftime: "HALFTIME",
  finished: "FINAL",
  completed: "FINAL",
  scheduled: "SCHEDULED",
  ready: "READY",
  pending: "PENDING",
  canceled: "CANCELED",
};

function resolveEventCode(eventType) {
  const rawCode = (eventType?.code || "").toString().trim().toLowerCase();
  if (rawCode) {
    const normalizedCode = rawCode.replace(/\s+/g, "_");
    if (normalizedCode.includes("half") && normalizedCode.includes("time") && normalizedCode.includes("end")) {
      return MATCH_LOG_EVENT_CODES.HALFTIME_END;
    }
    if (normalizedCode.includes("half") && normalizedCode.includes("time") && normalizedCode.includes("start")) {
      return MATCH_LOG_EVENT_CODES.HALFTIME_START;
    }
    if (normalizedCode.includes("match") && normalizedCode.includes("start")) {
      return MATCH_LOG_EVENT_CODES.MATCH_START;
    }
    if (normalizedCode.includes("match") && normalizedCode.includes("end")) {
      return MATCH_LOG_EVENT_CODES.MATCH_END;
    }
    return normalizedCode;
  }

  const description = (eventType?.description || "").toString().trim().toLowerCase();
  if (!description) return "";

  if (description.includes("calahan")) return MATCH_LOG_EVENT_CODES.CALAHAN;
  if (description.includes("score")) return MATCH_LOG_EVENT_CODES.SCORE;
  if (description.includes("timeout")) return MATCH_LOG_EVENT_CODES.TIMEOUT;
  if (description.includes("halftime end") || description.includes("end halftime")) {
    return MATCH_LOG_EVENT_CODES.HALFTIME_END;
  }
  if (description.includes("halftime start") || description.includes("halftime")) {
    return MATCH_LOG_EVENT_CODES.HALFTIME_START;
  }
  if (description.includes("turnover")) return MATCH_LOG_EVENT_CODES.TURNOVER;
  if (description.includes("block")) return MATCH_LOG_EVENT_CODES.BLOCK;
  if (description.includes("stoppage")) return MATCH_LOG_EVENT_CODES.STOPPAGE_START;
  if (description.includes("match start")) return MATCH_LOG_EVENT_CODES.MATCH_START;
  if (description.includes("match end")) return MATCH_LOG_EVENT_CODES.MATCH_END;

  return description.replace(/\s+/g, "_");
}

function getMatchLogTimeline() {
  if (!matchLogs.length) return [];
  return matchLogs
    .filter((log) => log?.created_at)
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function resolveOpposingTeamId(teamId, match) {
  if (!teamId || !match) return null;
  const teamAId = match?.team_a?.id;
  const teamBId = match?.team_b?.id;
  if (teamId === teamAId) return teamBId || null;
  if (teamId === teamBId) return teamAId || null;
  return null;
}

function deriveBreakChanceState(match) {
  if (!breakChanceEnabled) return { isActive: false, teamId: null };
  const targetMatch = match || currentMatch;
  if (!targetMatch) return { isActive: false, teamId: null };
  const timeline = getMatchLogTimeline();
  let baseTeamId = null;
  let possessionTeamId = null;

  timeline.forEach((log) => {
    const eventType = log?.eventType || matchEventTypes.get(log?.event_type_id);
    const eventCode = resolveEventCode(eventType);
    if (!eventCode) return;
    const teamId = log?.team_id || null;

    const isBaseEvent =
      BASE_POSSESSION_EVENT_CODES.has(eventCode) ||
      eventCode.includes("score") ||
      eventCode.includes("goal") ||
      eventCode.includes("calahan") ||
      eventCode.includes("half");

    if (isBaseEvent) {
      if (teamId) {
        baseTeamId = teamId;
        possessionTeamId = resolveOpposingTeamId(teamId, targetMatch);
      } else {
        baseTeamId = null;
        possessionTeamId = null;
      }
      return;
    }

    if (eventCode === MATCH_LOG_EVENT_CODES.BLOCK) {
      if (teamId) {
        possessionTeamId = teamId;
      }
      return;
    }

    if (eventCode === MATCH_LOG_EVENT_CODES.TURNOVER) {
      if (teamId) {
        possessionTeamId = resolveOpposingTeamId(teamId, targetMatch);
      }
    }
  });

  const isActive = Boolean(baseTeamId && possessionTeamId && baseTeamId === possessionTeamId);
  return { isActive, teamId: isActive ? baseTeamId : null };
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getDerivedClockInfo() {
  const timeCapSeconds = getTimeCapSeconds();
  if (!Number.isFinite(timeCapSeconds)) {
    return { clockText: "", secondsRemaining: null, hasStarted: false, isPaused: false };
  }

  const timeline = getMatchLogTimeline();
  let matchStartMs = null;
  let pausedMs = 0;
  let pauseStartMs = null;
  let hasMatchEnd = false;

  timeline.forEach((log) => {
    const eventType = log?.eventType || matchEventTypes.get(log?.event_type_id);
    const eventCode = resolveEventCode(eventType);
    if (!eventCode) return;

    const timestamp = new Date(log.created_at).getTime();
    if (Number.isNaN(timestamp)) return;

    if (!matchStartMs && eventCode === MATCH_LOG_EVENT_CODES.MATCH_START) {
      matchStartMs = timestamp;
    }

    if (!matchStartMs) return;

    if (eventCode === MATCH_LOG_EVENT_CODES.STOPPAGE_START && !pauseStartMs) {
      pauseStartMs = timestamp;
    }
    if (eventCode === MATCH_LOG_EVENT_CODES.STOPPAGE_END && pauseStartMs) {
      pausedMs += Math.max(0, timestamp - pauseStartMs);
      pauseStartMs = null;
    }
    if (eventCode === MATCH_LOG_EVENT_CODES.MATCH_END) {
      hasMatchEnd = true;
    }
  });

  if (!matchStartMs) {
    return { clockText: "", secondsRemaining: null, hasStarted: false, isPaused: false };
  }

  const now = Date.now();
  let effectivePausedMs = pausedMs;
  let isPaused = false;
  if (pauseStartMs) {
    effectivePausedMs += Math.max(0, now - pauseStartMs);
    isPaused = true;
  }

  const elapsedMs = Math.max(0, now - matchStartMs - effectivePausedMs);
  let secondsRemaining = Math.max(0, Math.ceil(timeCapSeconds - elapsedMs / 1000));
  if (hasMatchEnd) secondsRemaining = 0;

  return {
    clockText: formatSeconds(secondsRemaining),
    secondsRemaining,
    hasStarted: true,
    isPaused,
  };
}

function getMatchPhaseFromLogs() {
  let hasMatchStart = false;
  let hasHalftimeStart = false;
  let hasHalftimeEnd = false;
  let hasMatchEnd = false;

  matchLogs.forEach((log) => {
    const eventType = log?.eventType || matchEventTypes.get(log?.event_type_id);
    const eventCode = resolveEventCode(eventType);
    if (!eventCode) return;

    if (eventCode === MATCH_LOG_EVENT_CODES.MATCH_START) hasMatchStart = true;
    if (eventCode === MATCH_LOG_EVENT_CODES.HALFTIME_START) hasHalftimeStart = true;
    if (eventCode === MATCH_LOG_EVENT_CODES.HALFTIME_END) hasHalftimeEnd = true;
    if (eventCode === MATCH_LOG_EVENT_CODES.MATCH_END) hasMatchEnd = true;
  });

  if (hasMatchEnd) return "final";
  if (hasHalftimeStart && !hasHalftimeEnd) return "halftime";
  if (hasHalftimeEnd) return "second";
  if (hasMatchStart) return "first";
  return "starting";
}

function deriveStatusLabel({ clockSeconds } = {}) {
  const phase = getMatchPhaseFromLogs();
  if (phase === "final") return "FINAL";
  if (Number.isFinite(clockSeconds) && clockSeconds <= 0) return "SOFT CAP";
  if (phase === "halftime") return "HALFTIME";
  if (phase === "second") {
    return "2ND HALF";
  }
  if (phase === "first") return "1ST HALF";
  return "STARTING SOON";
}

function refreshClockInterval(clockInfo) {
  const hasManualClock = manualOverrides?.enabled && manualOverrides.clock;
  const shouldRun = Boolean(clockInfo?.hasStarted) && !hasManualClock;

  if (shouldRun && !clockInterval) {
    clockInterval = window.setInterval(() => {
      if (currentMatch) {
        updateOverlay(currentMatch, currentScoreboard);
      }
    }, 1000);
  }

  if (!shouldRun && clockInterval) {
    window.clearInterval(clockInterval);
    clockInterval = null;
  }
}

function updateBreakChanceBanner(match) {
  if (!elements.breakChanceBannerA && !elements.breakChanceBannerB) return;
  if (!breakChanceEnabled) {
    elements.breakChanceBannerA?.classList.remove("is-active");
    elements.breakChanceBannerB?.classList.remove("is-active");
    return;
  }

  const { isActive, teamId } = deriveBreakChanceState(match);
  const teamAId = match?.team_a?.id;
  const teamBId = match?.team_b?.id;
  const showA = isActive && teamId && teamId === teamAId;
  const showB = isActive && teamId && teamId === teamBId;

  elements.breakChanceBannerA?.classList.toggle("is-active", Boolean(showA));
  elements.breakChanceBannerB?.classList.toggle("is-active", Boolean(showB));
}

function formatStatusLabel({ period, half, status }) {
  const pickValue = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string") return value;
    return "";
  };

  const raw = pickValue(period) || pickValue(half) || pickValue(status);
  if (!raw) return "";

  const normalized = raw.toString().trim().toLowerCase();
  if (["1", "first", "1st"].includes(normalized)) return "1ST HALF";
  if (["2", "second", "2nd"].includes(normalized)) return "2ND HALF";
  if (["half", "halftime"].includes(normalized)) return "HALFTIME";
  if (["final", "finished", "completed"].includes(normalized)) return "FINAL";
  return raw.toString().toUpperCase();
}

function applyLogo(src) {
  if (!elements.logo) return;
  if (!src) {
    elements.logo.removeAttribute("src");
    elements.logo.parentElement?.classList.remove("has-image");
    return;
  }

  elements.logo.src = src;
  elements.logo.onload = () => {
    elements.logo.parentElement?.classList.add("has-image");
  };
  elements.logo.onerror = () => {
    elements.logo.removeAttribute("src");
    elements.logo.parentElement?.classList.remove("has-image");
  };
}

function getInitials(text, max = 3) {
  if (!text) return "SC";
  const words = text
    .toString()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "SC";
  const letters = words.map((word) => word[0]).join("");
  return letters.slice(0, max).toUpperCase();
}

function formatClock(clock) {
  if (clock && typeof clock === "string" && clock.trim()) {
    return clock.trim();
  }
  return "--:--";
}

function setMeta(text, isError = false) {
  if (!elements.meta) return;
  elements.meta.textContent = text;
  elements.meta.classList.toggle("meta-error", Boolean(isError));
}

function cacheEventData(eventData) {
  if (!eventData) return null;
  if (eventData.id) {
    eventCache.set(eventData.id, eventData);
  }
  currentEvent = eventData;
  if (eventData.rules) {
    currentEventRules = eventData.rules;
  }
  return eventData;
}

async function ensureEventData(match) {
  const eventFromMatch = match?.event;
  if (eventFromMatch?.id) {
    return cacheEventData(eventFromMatch);
  }

  const eventId = match?.event_id;
  if (!eventId) return null;

  if (eventCache.has(eventId)) {
    return cacheEventData(eventCache.get(eventId));
  }

  const { data, error } = await supabase.from("events").select(EVENT_FIELDS).eq("id", eventId).maybeSingle();
  if (error || !data) return null;
  return cacheEventData(data);
}

async function loadMatchEventTypesOnce() {
  if (matchEventTypesLoaded) return matchEventTypes;
  matchEventTypesLoaded = true;

  const { data, error } = await supabase.from("match_events").select("id, code, description");
  if (error || !Array.isArray(data)) return matchEventTypes;

  data.forEach((eventType) => {
    matchEventTypes.set(eventType.id, eventType);
  });
  return matchEventTypes;
}

function hydrateMatchLog(log) {
  if (!log) return null;
  const eventType = matchEventTypes.get(log.event_type_id);
  if (!eventType) return log;
  return { ...log, eventType };
}

function storeMatchLog(log) {
  if (!log?.id) return;
  const hydrated = hydrateMatchLog(log);
  const existingIndex = matchLogs.findIndex((entry) => entry.id === log.id);
  if (existingIndex >= 0) {
    matchLogs[existingIndex] = hydrated;
  } else {
    matchLogs = [...matchLogs, hydrated];
  }
  matchLogById.set(log.id, hydrated);
}

function removeMatchLog(logId) {
  if (!logId) return;
  matchLogById.delete(logId);
  matchLogs = matchLogs.filter((entry) => entry.id !== logId);
}

function hydrateStoredMatchLogs() {
  if (!matchLogs.length) return;
  matchLogs = matchLogs.map((log) => hydrateMatchLog(log));
  matchLogs.forEach((log) => {
    if (log?.id) {
      matchLogById.set(log.id, log);
    }
  });
}

async function loadMatchLogsSnapshot() {
  if (!matchId) return [];

  await loadMatchEventTypesOnce();

  let from = 0;
  let keepLoading = true;

  while (keepLoading) {
    const { data, error } = await supabase
      .from("match_logs")
      .select(MATCH_LOG_FIELDS)
      .eq("match_id", matchId)
      .order("created_at", { ascending: true })
      .range(from, from + MATCH_LOG_PAGE_SIZE - 1);

    if (error || !data || data.length === 0) {
      keepLoading = false;
      break;
    }

    data.forEach((log) => storeMatchLog(log));

    if (data.length < MATCH_LOG_PAGE_SIZE) {
      keepLoading = false;
    } else {
      from += MATCH_LOG_PAGE_SIZE;
    }
  }

  hydrateStoredMatchLogs();
  return matchLogs;
}

function updateOverlay(match, scoreboard) {
  if (!match) return;
  const eventName =
    currentEvent?.name ||
    match.event?.name ||
    scoreboard?.eventName ||
    "Event";
  const teamAName = formatTeamName(match.team_a);
  const teamBName = formatTeamName(match.team_b);
  const teamAColors = resolveTeamColors(match.team_a?.attributes, teamATheme);
  const teamBColors = resolveTeamColors(match.team_b?.attributes, teamBTheme);
  const manualScoreA = manualOverrides?.enabled ? manualOverrides.scoreA : null;
  const manualScoreB = manualOverrides?.enabled ? manualOverrides.scoreB : null;
  const clockInfo = getDerivedClockInfo();
  const scoreA = Number.isFinite(manualScoreA)
    ? manualScoreA
    : Number.isFinite(scoreboard?.scoreA)
      ? scoreboard.scoreA
      : match.score_a;
  const scoreB = Number.isFinite(manualScoreB)
    ? manualScoreB
    : Number.isFinite(scoreboard?.scoreB)
      ? scoreboard.scoreB
      : match.score_b;
  const derivedStatusLabel = deriveStatusLabel({ clockSeconds: clockInfo.secondsRemaining });
  const status = scoreboard?.status || match.status;
  const fallbackStatusLabel =
    formatStatusLabel({ period: scoreboard?.period, half: scoreboard?.half, status }) ||
    STATUS_LABELS[(status || "").toString().toLowerCase()] ||
    (status ? status.toString().toUpperCase() : "LIVE");
  const statusLabel =
    (manualOverrides?.enabled && manualOverrides.statusLabel) ||
    derivedStatusLabel ||
    fallbackStatusLabel;
  const manualClockValue = manualOverrides?.enabled ? manualOverrides.clock : "";
  const hideClock = statusLabel === "STARTING SOON" && !manualClockValue;
  const derivedClock = clockInfo.clockText || "";
  const matchClock =
    manualClockValue ||
    derivedClock ||
    (hideClock ? "" : formatClock(scoreboard?.clock));
  const logo = scoreboard?.eventLogo || scoreboard?.logo || DEFAULT_LOGO_SRC;

  if (elements.eventName) elements.eventName.textContent = eventName;
  if (elements.logoFallback) elements.logoFallback.textContent = getInitials(eventName);
  if (elements.statusLabel) elements.statusLabel.textContent = statusLabel || "LIVE";
  if (elements.matchClock) elements.matchClock.textContent = matchClock;
  if (elements.matchClock?.parentElement) {
    elements.matchClock.parentElement.classList.toggle("is-hidden", hideClock);
  }
  if (elements.teamAName) elements.teamAName.textContent = teamAName;
  if (elements.teamBName) elements.teamBName.textContent = teamBName;
  if (elements.scoreA) elements.scoreA.textContent = Number.isFinite(scoreA) ? scoreA : 0;
  if (elements.scoreB) elements.scoreB.textContent = Number.isFinite(scoreB) ? scoreB : 0;
  applyTeamColors(elements.teamABox, teamAColors);
  applyTeamColors(elements.teamBBox, teamBColors);
  updateMatchStatsHeader({ teamAName, teamBName, scoreA, scoreB, teamAColors, teamBColors });
  applyLogo(logo);
  refreshClockInterval(clockInfo);
  updateBreakChanceBanner(match);
}

function applyBannerStats(stats) {
  if (!stats) return;
  if (elements.bannerStatGls) elements.bannerStatGls.textContent = stats.goals ?? stats.gls ?? "0";
  if (elements.bannerStatAst) elements.bannerStatAst.textContent = stats.assists ?? stats.ast ?? "0";
  if (elements.bannerStatBlk) elements.bannerStatBlk.textContent = stats.blocks ?? stats.blk ?? "0";
  if (elements.bannerStatTrn) elements.bannerStatTrn.textContent = stats.turnovers ?? stats.trn ?? "0";
}

function setMatchStatsValue(element, value) {
  if (!element) return;
  const text = value === null || value === undefined || value === "" ? "--" : String(value);
  element.textContent = text;
}

function updateMatchStatsHeader({ teamAName, teamBName, scoreA, scoreB, teamAColors, teamBColors }) {
  if (elements.matchStatsTeamA) elements.matchStatsTeamA.textContent = teamAName;
  if (elements.matchStatsTeamB) elements.matchStatsTeamB.textContent = teamBName;
  if (elements.matchStatsScoreA) {
    elements.matchStatsScoreA.textContent = Number.isFinite(scoreA) ? scoreA : 0;
  }
  if (elements.matchStatsScoreB) {
    elements.matchStatsScoreB.textContent = Number.isFinite(scoreB) ? scoreB : 0;
  }
  applyTeamColors(elements.matchStatsColumnA, teamAColors);
  applyTeamColors(elements.matchStatsColumnB, teamBColors);
}

function resolveBannerTeamStyles(teamId, teamSlot) {
  const slot =
    teamSlot === "A" || teamSlot === "B"
      ? teamSlot
      : teamId && currentMatch?.team_a?.id === teamId
        ? "A"
        : teamId && currentMatch?.team_b?.id === teamId
          ? "B"
          : null;

  if (slot === "A") {
    return {
      slot,
      colors: resolveTeamColors(currentMatch?.team_a?.attributes, teamATheme),
    };
  }

  if (slot === "B") {
    return {
      slot,
      colors: resolveTeamColors(currentMatch?.team_b?.attributes, teamBTheme),
    };
  }

  return { slot: null, colors: null };
}

function applyBannerTheme(payload) {
  if (!elements.banner) return;

  const { slot, colors } = resolveBannerTeamStyles(payload?.teamId, payload?.teamSlot);
  const palette = deriveBannerPalette(colors);
  elements.banner.classList.toggle("is-team-a", slot === "A");
  elements.banner.classList.toggle("is-team-b", slot === "B");

  elements.banner.style.setProperty("--banner-team-bg", palette.teamBg);
  elements.banner.style.setProperty("--banner-team-text", palette.teamText);
  elements.banner.style.setProperty("--banner-surface-bg", palette.surfaceBg);
  elements.banner.style.setProperty("--banner-surface-text", palette.surfaceText);
  elements.banner.style.setProperty("--banner-surface-muted", palette.mutedText);
  elements.banner.style.setProperty("--banner-divider-color", palette.dividerColor);
  elements.banner.style.setProperty("--banner-border-color", palette.borderColor);
  elements.banner.style.setProperty("--banner-team-accent", palette.accentColor);
  elements.banner.style.setProperty("--banner-shadow-color", palette.shadowColor);
}

function applyMatchStatsPayload(payload) {
  const stats = payload?.stats || {};
  setMatchStatsValue(elements.matchStatsHoldsA, stats.holdsA);
  setMatchStatsValue(elements.matchStatsHoldsB, stats.holdsB);
  setMatchStatsValue(elements.matchStatsBreaksA, stats.breaksA);
  setMatchStatsValue(elements.matchStatsBreaksB, stats.breaksB);
  setMatchStatsValue(elements.matchStatsTurnoversA, stats.turnoversA);
  setMatchStatsValue(elements.matchStatsTurnoversB, stats.turnoversB);
  setMatchStatsValue(elements.matchStatsBlocksA, stats.blocksA);
  setMatchStatsValue(elements.matchStatsBlocksB, stats.blocksB);

  if (elements.matchStatsTitle && payload?.title) {
    elements.matchStatsTitle.textContent = payload.title;
  }
}

function showBanner(payload) {
  if (!elements.banner) return;
  if (!payload?.playerName) return;

  applyBannerTheme(payload);

  if (elements.bannerPlayerName) {
    elements.bannerPlayerName.textContent = payload.playerName.toUpperCase();
  }
  applyBannerStats(payload.stats);

  elements.banner.classList.remove("is-active");
  void elements.banner.offsetWidth;
  elements.banner.classList.add("is-active");
  if (bannerTimeout) {
    window.clearTimeout(bannerTimeout);
  }
  bannerTimeout = window.setTimeout(() => {
    elements.banner?.classList.remove("is-active");
  }, 6200);
}

function showMatchStatsBanner(payload) {
  if (!elements.matchStatsBanner) return;
  applyMatchStatsPayload(payload);
  elements.matchStatsBanner.classList.remove("is-active");
  void elements.matchStatsBanner.offsetWidth;
  elements.matchStatsBanner.classList.add("is-active");

  if (matchStatsTimeout) {
    window.clearTimeout(matchStatsTimeout);
  }
  matchStatsTimeout = window.setTimeout(() => {
    elements.matchStatsBanner?.classList.remove("is-active");
  }, 8000);
}

function showTimeoutBanner(team) {
  const target =
    team === "A" ? elements.timeoutA : team === "B" ? elements.timeoutB : null;
  if (!target) return;

  target.classList.remove("is-active");
  void target.offsetWidth;
  target.classList.add("is-active");

  if (timeoutTimeout) {
    window.clearTimeout(timeoutTimeout);
  }
  timeoutTimeout = window.setTimeout(() => {
    target?.classList.remove("is-active");
  }, 4200);
}

function getMatchEventLabel(payload) {
  const rawCode = (payload?.eventCode || "").toString().trim().toLowerCase();
  const rawDescription = (payload?.eventDescription || "").toString().trim();
  const combined = `${rawCode} ${rawDescription.toLowerCase()}`.trim();

  if (combined.includes("half")) return "HALFTIME";
  if (combined.includes("stoppage")) return "STOPPAGE";
  if (combined.includes("timeout")) return "TIMEOUT";
  if (rawDescription) return rawDescription.toUpperCase();
  if (rawCode) return rawCode.replace(/_/g, " ").toUpperCase();
  return "MATCH EVENT";
}

function showMatchEventBanner(payload) {
  if (!elements.matchEventBanner || !elements.matchEventBannerLabel) return;

  elements.matchEventBannerLabel.textContent = getMatchEventLabel(payload);
  elements.matchEventBanner.classList.remove("is-active");
  void elements.matchEventBanner.offsetWidth;
  elements.matchEventBanner.classList.add("is-active");

  if (matchEventTimeout) {
    window.clearTimeout(matchEventTimeout);
  }
  matchEventTimeout = window.setTimeout(() => {
    elements.matchEventBanner?.classList.remove("is-active");
  }, 4600);
}

async function loadMatch() {
  if (!matchId) {
    setMeta("Add ?matchId=<id> to the URL.", true);
    return null;
  }

  setMeta("Loading match...");

  const { data, error } = await supabase
    .from("matches")
    .select(MATCH_FIELDS)
    .eq("id", matchId)
    .maybeSingle();

  if (error) {
    setMeta(error.message || "Unable to load match.", true);
    return null;
  }

  if (!data) {
    setMeta("Match not found or not public.", true);
    return null;
  }

  updateOverlay(data, currentScoreboard);
  setMeta("");
  const eventData = await ensureEventData(data);
  if (eventData) {
    updateOverlay(data, currentScoreboard);
  }
  return data;
}

let currentMatch = null;
let currentScoreboard = null;

loadMatch().then((match) => {
  currentMatch = match;
  if (match) {
    ensureEventData(match);
  }
});

async function loadScoreboardSnapshot() {
  if (!matchId) return null;
  const { data, error } = await supabase
    .from("scoreboard_match_snapshots")
    .select("payload, updated_at")
    .eq("match_id", matchId)
    .maybeSingle();

  if (error) {
    return null;
  }

  const payload = data?.payload && typeof data.payload === "object" ? data.payload : null;
  currentScoreboard = payload;
  if (currentMatch) {
    updateOverlay(currentMatch, currentScoreboard);
  }
  if (data?.updated_at) {
    setMeta("");
  }
  return payload;
}

loadScoreboardSnapshot();
loadMatchLogsSnapshot().then(() => {
  if (currentMatch) {
    updateOverlay(currentMatch, currentScoreboard);
  }
});

if (matchId) {
  const overlayBannerChannel = supabase
    .channel(`overlay-banner:${matchId}`)
    .on("broadcast", { event: "overlay-banner" }, ({ payload }) => {
      handleOverlayBannerPayload(payload);
    })
    .subscribe();

  loadMatchEventTypesOnce().then(() => {
    hydrateStoredMatchLogs();
    if (currentMatch) {
      updateOverlay(currentMatch, currentScoreboard);
    }
  });

  const channel = supabase
    .channel(`overlay:match:${matchId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "matches",
        filter: `id=eq.${matchId}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          setMeta("Match removed.", true);
          return;
        }

        const incoming = payload.new;
        if (!incoming) return;

        currentMatch = {
          ...(currentMatch || {}),
          event_id: incoming.event_id ?? currentMatch?.event_id,
          start_time: incoming.start_time ?? currentMatch?.start_time,
          event: incoming.event ?? currentMatch?.event,
          score_a: incoming.score_a ?? currentMatch?.score_a,
          score_b: incoming.score_b ?? currentMatch?.score_b,
          status: incoming.status ?? currentMatch?.status,
        };

        updateOverlay(currentMatch, currentScoreboard);
        ensureEventData(currentMatch).then((eventData) => {
          if (eventData) {
            updateOverlay(currentMatch, currentScoreboard);
          }
        });
        setMeta("");
      },
    )
    .subscribe();

  const scoreboardChannel = supabase
    .channel(`overlay:scoreboard:${matchId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "scoreboard_match_snapshots",
        filter: `match_id=eq.${matchId}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          currentScoreboard = null;
          if (currentMatch) {
            updateOverlay(currentMatch, currentScoreboard);
          }
          return;
        }

        const incoming = payload.new?.payload;
        if (!incoming || typeof incoming !== "object") return;

        currentScoreboard = incoming;
        if (currentMatch) {
          updateOverlay(currentMatch, currentScoreboard);
        }
        if (payload.new?.updated_at) {
          setMeta("");
        }
      },
    )
    .subscribe();

  const matchLogsChannel = supabase
    .channel(`overlay:match_logs:${matchId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "match_logs",
        filter: `match_id=eq.${matchId}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          removeMatchLog(payload.old?.id);
          if (currentMatch) {
            updateOverlay(currentMatch, currentScoreboard);
          }
          return;
        }

        const incoming = payload.new;
        if (!incoming) return;
        storeMatchLog(incoming);
        const eventType = matchEventTypes.get(incoming.event_type_id);
        const eventCode = resolveEventCode(eventType);
        if (
          eventCode === MATCH_LOG_EVENT_CODES.TIMEOUT ||
          eventCode === MATCH_LOG_EVENT_CODES.TIMEOUT_START
        ) {
          if (incoming.team_id && currentMatch) {
            const teamId = incoming.team_id;
            if (teamId === currentMatch.team_a?.id) showTimeoutBanner("A");
            if (teamId === currentMatch.team_b?.id) showTimeoutBanner("B");
          }
        }
        if (currentMatch) {
          updateOverlay(currentMatch, currentScoreboard);
        }
      },
    )
    .subscribe();

  window.addEventListener("beforeunload", () => {
    supabase.removeChannel(overlayBannerChannel);
    supabase.removeChannel(channel);
    supabase.removeChannel(scoreboardChannel);
    supabase.removeChannel(matchLogsChannel);
  });
}

window.addEventListener("storage", (event) => {
  if (event.key !== "overlayBanner") return;
  if (!event.newValue) return;
  try {
    const payload = JSON.parse(event.newValue);
    handleOverlayBannerPayload(payload);
  } catch (error) {
    // ignore malformed payloads
  }
});
