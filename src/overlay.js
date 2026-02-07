import { supabase } from "./lib/supabaseClient";

const MATCH_FIELDS = `
  id,
  status,
  score_a,
  score_b,
  start_time,
  event:events!matches_event_id_fkey (id, name),
  team_a:teams!matches_team_a_fkey (id, name, short_name),
  team_b:teams!matches_team_b_fkey (id, name, short_name)
`;


const elements = {
  eventName: document.getElementById("eventName"),
  matchTime: document.getElementById("matchTime"),
  periodLabel: document.getElementById("periodLabel"),
  logo: document.getElementById("eventLogo"),
  logoFallback: document.getElementById("eventLogoFallback"),
  teamAFlag: document.getElementById("teamAFlag"),
  teamBFlag: document.getElementById("teamBFlag"),
  teamASeed: document.getElementById("teamASeed"),
  teamBSeed: document.getElementById("teamBSeed"),
  teamAName: document.getElementById("teamAName"),
  teamBName: document.getElementById("teamBName"),
  scoreA: document.getElementById("scoreA"),
  scoreB: document.getElementById("scoreB"),
  meta: document.getElementById("meta"),
};

const searchParams = new URLSearchParams(window.location.search);
const matchId = (searchParams.get("matchId") || "").trim();
const logoParam = (searchParams.get("logo") || "").trim();
const flagAParam = (searchParams.get("flagA") || "").trim();
const flagBParam = (searchParams.get("flagB") || "").trim();
const seedAParam = (searchParams.get("seedA") || "").trim();
const seedBParam = (searchParams.get("seedB") || "").trim();

function formatTeamName(team) {
  if (!team) return "TBD";
  return team.short_name || team.name || "TBD";
}

function formatPeriod({ period, half, status }) {
  const pickValue = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string") return value;
    return "";
  };

  const raw = pickValue(period) || pickValue(half) || pickValue(status);
  if (!raw) return "";

  const normalized = raw.toString().trim().toLowerCase();
  if (["live", "ready", "pending", "scheduled"].includes(normalized)) return "";
  if (["1", "first", "1st"].includes(normalized)) return "1ST";
  if (["2", "second", "2nd"].includes(normalized)) return "2ND";
  if (["half", "halftime"].includes(normalized)) return "HALF";
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

function applyFlag(element, src) {
  if (!element) return;
  if (!src) {
    element.removeAttribute("src");
    element.classList.remove("is-visible");
    return;
  }

  element.src = src;
  element.onload = () => {
    element.classList.add("is-visible");
  };
  element.onerror = () => {
    element.removeAttribute("src");
    element.classList.remove("is-visible");
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

function formatMatchTime({ startTime, clock }) {
  if (clock && typeof clock === "string" && clock.trim()) {
    return clock.trim();
  }
  if (!startTime) return "--:--";
  const parsed = new Date(startTime);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setMeta(text, isError = false) {
  if (!elements.meta) return;
  elements.meta.textContent = text;
  elements.meta.classList.toggle("meta-error", Boolean(isError));
}

function updateOverlay(match, scoreboard) {
  if (!match) return;
  const eventName = scoreboard?.eventName || match.event?.name || "Event";
  const teamAName = scoreboard?.teamA || formatTeamName(match.team_a);
  const teamBName = scoreboard?.teamB || formatTeamName(match.team_b);
  const scoreA = Number.isFinite(scoreboard?.scoreA) ? scoreboard.scoreA : match.score_a;
  const scoreB = Number.isFinite(scoreboard?.scoreB) ? scoreboard.scoreB : match.score_b;
  const status = scoreboard?.status || match.status;
  const matchTime = formatMatchTime({ startTime: match.start_time, clock: scoreboard?.clock });
  const periodLabel = formatPeriod({ period: scoreboard?.period, half: scoreboard?.half, status });
  const logo = logoParam || scoreboard?.eventLogo || scoreboard?.logo;
  const teamAFlag = flagAParam || scoreboard?.teamAFlag || scoreboard?.flagA;
  const teamBFlag = flagBParam || scoreboard?.teamBFlag || scoreboard?.flagB;
  const teamASeed = seedAParam || scoreboard?.teamASeed || scoreboard?.seedA || "";
  const teamBSeed = seedBParam || scoreboard?.teamBSeed || scoreboard?.seedB || "";

  if (elements.eventName) elements.eventName.textContent = eventName;
  if (elements.logoFallback) elements.logoFallback.textContent = getInitials(eventName);
  if (elements.matchTime) elements.matchTime.textContent = matchTime;
  if (elements.periodLabel) elements.periodLabel.textContent = periodLabel || "1ST";
  if (elements.teamAName) elements.teamAName.textContent = teamAName;
  if (elements.teamBName) elements.teamBName.textContent = teamBName;
  if (elements.scoreA) elements.scoreA.textContent = Number.isFinite(scoreA) ? scoreA : 0;
  if (elements.scoreB) elements.scoreB.textContent = Number.isFinite(scoreB) ? scoreB : 0;
  if (elements.teamASeed) elements.teamASeed.textContent = teamASeed;
  if (elements.teamBSeed) elements.teamBSeed.textContent = teamBSeed;
  applyLogo(logo);
  applyFlag(elements.teamAFlag, teamAFlag);
  applyFlag(elements.teamBFlag, teamBFlag);
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
  setMeta(`Last update ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  return data;
}

let currentMatch = null;
let currentScoreboard = null;

loadMatch().then((match) => {
  currentMatch = match;
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
    setMeta(
      `Last update ${new Date(data.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    );
  }
  return payload;
}

loadScoreboardSnapshot();

if (matchId) {
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
          start_time: incoming.start_time ?? currentMatch?.start_time,
          event: incoming.event ?? currentMatch?.event,
          score_a: incoming.score_a ?? currentMatch?.score_a,
          score_b: incoming.score_b ?? currentMatch?.score_b,
          status: incoming.status ?? currentMatch?.status,
        };

        updateOverlay(currentMatch, currentScoreboard);
        setMeta(`Last update ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
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
          setMeta(
            `Last update ${new Date(payload.new.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          );
        }
      },
    )
    .subscribe();

  window.addEventListener("beforeunload", () => {
    supabase.removeChannel(channel);
    supabase.removeChannel(scoreboardChannel);
  });
}
