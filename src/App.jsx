import { useEffect, useMemo, useState } from "react";
import { Card, Chip, Field, Input, SectionHeader, SectionShell, Select } from "./components/ui/primitives";
import { MatchEventCard } from "./components/eventCards";
import { supabase } from "./lib/supabaseClient";
import { MATCH_LOG_EVENT_CODES } from "./services/matchLogService";

const OVERLAY_OPTIONS = [
  {
    value: "overlay-wfdf-competitive.html",
    label: "WFDF competitive (fixed 16:9)",
    description: "Fixed 1920x1080 canvas that scales for any OBS viewport.",
  },
  {
    value: "custom",
    label: "Custom file",
    description: "Point to a different overlay HTML file.",
  },
];

const BASE_PATH = import.meta.env.BASE_URL || "/";
const NORMALIZED_BASE = BASE_PATH.endsWith("/") ? BASE_PATH : `${BASE_PATH}/`;
const MATCH_DETAIL_FIELDS = `
  id,
  event_id,
  status,
  score_a,
  score_b,
  start_time,
  starting_team_id,
  event:events!matches_event_id_fkey (id, name, type, start_date, end_date, location, rules, Status),
  team_a:teams!matches_team_a_fkey (id, name, attributes),
  team_b:teams!matches_team_b_fkey (id, name, attributes)
`;
const MATCH_LOG_FIELDS =
  "id, match_id, event_type_id, team_id, actor_id, secondary_actor_id, created_at, abba_line";
const MATCH_LOG_PAGE_SIZE = 1000;
const APP_SETTINGS_STORAGE_KEY = "stallcount:overlay-control-settings";
const BUTTON_DURATION_SECONDS = {
  playerStats: 6,
  matchStats: 8,
  timeout: 4,
};

const eventTypeCache = new Map();
let eventTypeCacheLoaded = false;
const eventCache = new Map();
const rosterCache = new Map();

function readPersistedAppSettings() {
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function getInitialMatchId() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("matchId")) {
    return (searchParams.get("matchId") || "").trim();
  }
  return (readPersistedAppSettings().matchId || "").toString().trim();
}

function getInitialOverlayChoice() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("overlay")) {
    const overlayValue = (searchParams.get("overlay") || "").trim();
    return overlayValue && overlayValue !== "overlay-wfdf-competitive.html"
      ? "custom"
      : "overlay-wfdf-competitive.html";
  }

  return readPersistedAppSettings().overlayChoice === "custom"
    ? "custom"
    : "overlay-wfdf-competitive.html";
}

function getInitialCustomOverlay() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("overlay")) {
    const overlayValue = (searchParams.get("overlay") || "").trim();
    return overlayValue && overlayValue !== "overlay-wfdf-competitive.html" ? overlayValue : "";
  }
  return (readPersistedAppSettings().customOverlay || "").toString().trim();
}

function getInitialTeamTheme(teamKey) {
  const searchParams = new URLSearchParams(window.location.search);
  const persistedValue = (readPersistedAppSettings()[teamKey] || "primary").toString().trim().toLowerCase();
  const value = (searchParams.get(teamKey) || persistedValue || "primary").trim().toLowerCase();
  return value === "secondary" ? "secondary" : "primary";
}

function getInitialManualEnabled() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("manual")) {
    const value = (searchParams.get("manual") || "").trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes";
  }
  return Boolean(readPersistedAppSettings().manualOverrideEnabled);
}

function getInitialManualStatus() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("manualStatus")) {
    return (searchParams.get("manualStatus") || "starting_soon").trim().toLowerCase();
  }
  return (readPersistedAppSettings().manualStatus || "starting_soon").toString().trim().toLowerCase();
}

function getInitialManualClock() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("manualClock")) {
    return (searchParams.get("manualClock") || "").trim();
  }
  return (readPersistedAppSettings().manualClock || "").toString().trim();
}

function getInitialManualScore(key) {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has(key)) {
    return (searchParams.get(key) || "").trim();
  }
  return (readPersistedAppSettings()[key] || "").toString().trim();
}

function getInitialBreakChanceEnabled() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("breakChance")) {
    const value = (searchParams.get("breakChance") || "").trim().toLowerCase();
    if (!value) return true;
    return !["0", "false", "no", "off"].includes(value);
  }

  const persistedValue = readPersistedAppSettings().breakChanceEnabled;
  return typeof persistedValue === "boolean" ? persistedValue : true;
}

function getInitialIsInitialized() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("matchId")) {
    return Boolean((searchParams.get("matchId") || "").trim());
  }

  const persistedValue = readPersistedAppSettings().isInitialized;
  if (typeof persistedValue === "boolean") {
    return persistedValue;
  }

  return Boolean(getInitialMatchId());
}

function getInitialBannerPlayerId() {
  return (readPersistedAppSettings().bannerPlayerId || "").toString().trim();
}

function getInitialView() {
  const hash = window.location.hash.replace("#", "").replace("/", "").trim().toLowerCase();
  if (hash === "control") return "control";
  if (hash === "config") return "config";
  const persistedView = (readPersistedAppSettings().activeView || "").toString().trim().toLowerCase();
  if (persistedView === "control") return "control";
  if (persistedView === "config") return "config";
  return "config";
}

function parseTeamAttributes(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function getTeamPalette(attributes, theme) {
  const parsed = parseTeamAttributes(attributes);
  const primary = {
    bg: parsed.primaryColor || "#0b1f19",
    text: parsed.textOnPrimary || "#e8f4ed",
    label: "Primary",
  };
  const secondary = {
    bg: parsed.secondaryColor || "#f8fafc",
    text: parsed.textOnSecondary || "#0f172a",
    label: "Secondary",
  };
  return theme === "secondary" ? secondary : primary;
}

function normalizeOverlayPath(value) {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed.slice(1);
  return trimmed;
}

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value);
}

function formatTimedButtonLabel(label, seconds) {
  if (!Number.isFinite(seconds)) return label;
  return `${label} (${seconds}s)`;
}

function buildOverlayUrl({ overlayFile, matchId, teamATheme, teamBTheme, manualOverrides, breakChanceEnabled }) {
  if (!overlayFile) return "";
  const trimmed = overlayFile.trim();
  if (!trimmed) return "";

  const url = isAbsoluteUrl(trimmed)
    ? new URL(trimmed)
    : new URL(`${NORMALIZED_BASE}${normalizeOverlayPath(trimmed)}`, window.location.origin);

  if (matchId) {
    url.searchParams.set("matchId", matchId.trim());
  }
  if (teamATheme) {
    url.searchParams.set("teamATheme", teamATheme);
  }
  if (teamBTheme) {
    url.searchParams.set("teamBTheme", teamBTheme);
  }
  if (manualOverrides?.enabled) {
    url.searchParams.set("manual", "1");
    if (manualOverrides.status) {
      url.searchParams.set("manualStatus", manualOverrides.status);
    }
    if (manualOverrides.clock) {
      url.searchParams.set("manualClock", manualOverrides.clock);
    }
    if (manualOverrides.scoreA !== "") {
      url.searchParams.set("manualScoreA", manualOverrides.scoreA);
    }
    if (manualOverrides.scoreB !== "") {
      url.searchParams.set("manualScoreB", manualOverrides.scoreB);
    }
  }
  if (breakChanceEnabled === false) {
    url.searchParams.set("breakChance", "0");
  } else {
    url.searchParams.delete("breakChance");
  }

  return url.toString();
}

export default function App() {
  const overlayBannerChannelRef = useMemo(() => ({ current: null }), []);
  const [overlayChoice, setOverlayChoice] = useState(getInitialOverlayChoice());
  const [customOverlay, setCustomOverlay] = useState(getInitialCustomOverlay());
  const [matchId, setMatchId] = useState(getInitialMatchId());
  const [isInitialized, setIsInitialized] = useState(getInitialIsInitialized());
  const [teamATheme, setTeamATheme] = useState(getInitialTeamTheme("teamATheme"));
  const [teamBTheme, setTeamBTheme] = useState(getInitialTeamTheme("teamBTheme"));
  const [copied, setCopied] = useState(false);
  const [activeView, setActiveView] = useState(getInitialView());
  const [manualOverrideEnabled, setManualOverrideEnabled] = useState(getInitialManualEnabled());
  const [manualStatus, setManualStatus] = useState(getInitialManualStatus());
  const [manualClock, setManualClock] = useState(getInitialManualClock());
  const [manualScoreA, setManualScoreA] = useState(getInitialManualScore("manualScoreA"));
  const [manualScoreB, setManualScoreB] = useState(getInitialManualScore("manualScoreB"));
  const [breakChanceEnabled, setBreakChanceEnabled] = useState(getInitialBreakChanceEnabled());
  const [bannerPlayerId, setBannerPlayerId] = useState(getInitialBannerPlayerId());
  const [bannerStatus, setBannerStatus] = useState("");
  const [matchEventButtons, setMatchEventButtons] = useState([]);
  const [matchEventError, setMatchEventError] = useState("");
  const [matchDetails, setMatchDetails] = useState(null);
  const [eventDetails, setEventDetails] = useState(null);
  const [matchLogs, setMatchLogs] = useState([]);
  const [eventTypesVersion, setEventTypesVersion] = useState(0);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isLoadingRoster, setIsLoadingRoster] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [logsError, setLogsError] = useState("");
  const [rosterError, setRosterError] = useState("");
  const [rosterPlayersById, setRosterPlayersById] = useState({});
  const [rosterByTeam, setRosterByTeam] = useState({});

  const trimmedMatchId = matchId.trim();
  const hasMatchId = Boolean(trimmedMatchId);
  const resolvedOverlayFile = overlayChoice === "custom" ? customOverlay : overlayChoice;
  const overlayUrl = useMemo(
    () =>
      trimmedMatchId
        ? buildOverlayUrl({
            overlayFile: resolvedOverlayFile,
            matchId: trimmedMatchId,
            teamATheme,
            teamBTheme,
            manualOverrides: {
              enabled: manualOverrideEnabled,
              status: manualStatus,
              clock: manualClock,
              scoreA: manualScoreA,
              scoreB: manualScoreB,
            },
            breakChanceEnabled,
          })
        : "",
    [
      resolvedOverlayFile,
      trimmedMatchId,
      teamATheme,
      teamBTheme,
      manualOverrideEnabled,
      manualStatus,
      manualClock,
      manualScoreA,
      manualScoreB,
      breakChanceEnabled,
    ],
  );
  const overlayPreviewUrl = useMemo(() => {
    if (!overlayUrl) return "";
    try {
      const previewUrl = new URL(overlayUrl);
      previewUrl.searchParams.set("preview", "1");
      return previewUrl.toString();
    } catch (error) {
      return overlayUrl;
    }
  }, [overlayUrl]);
  const teamAPalette = useMemo(
    () => getTeamPalette(matchDetails?.team_a?.attributes, teamATheme),
    [matchDetails?.team_a?.attributes, teamATheme],
  );
  const teamBPalette = useMemo(
    () => getTeamPalette(matchDetails?.team_b?.attributes, teamBTheme),
    [matchDetails?.team_b?.attributes, teamBTheme],
  );
  const teamARoster = rosterByTeam[matchDetails?.team_a?.id] || [];
  const teamBRoster = rosterByTeam[matchDetails?.team_b?.id] || [];
  const bannerPlayerOptions = useMemo(() => {
    const combined = [...teamARoster, ...teamBRoster].filter((player) => player?.name);
    const withNumbers = [];
    const withoutNumbers = [];

    combined.forEach((player) => {
      const parsedNumber = Number(player.number);
      if (Number.isFinite(parsedNumber)) {
        withNumbers.push({ id: player.id, name: player.name, number: parsedNumber, teamId: player.teamId });
      } else {
        withoutNumbers.push({ id: player.id, name: player.name, number: null, teamId: player.teamId });
      }
    });

    withNumbers.sort((a, b) => {
      if (a.number !== b.number) return a.number - b.number;
      return a.name.localeCompare(b.name);
    });
    withoutNumbers.sort((a, b) => a.name.localeCompare(b.name));

    return [...withNumbers, ...withoutNumbers];
  }, [teamARoster, teamBRoster]);
  const selectedBannerPlayer = useMemo(
    () => bannerPlayerOptions.find((player) => player.id === bannerPlayerId) || null,
    [bannerPlayerOptions, bannerPlayerId],
  );
  const bannerEventGroups = useMemo(() => {
    const scoreOnly = [];
    const stoppage = [];
    let halftimeEvent = null;

    matchEventButtons.forEach((eventType) => {
      const code = (eventType?.code || "").toString().toLowerCase();
      const description = (eventType?.description || "").toString().toLowerCase();
      const combined = `${code} ${description}`.trim();

      if (!halftimeEvent && combined.includes("half")) {
        halftimeEvent = eventType;
      }

      if (combined.includes("stoppage")) {
        stoppage.push(eventType);
        return;
      }

      if (combined.includes("score") || combined.includes("goal") || combined.includes("calahan")) {
        scoreOnly.push(eventType);
      }
    });

    return { scoreOnly, stoppage, halftimeEvent };
  }, [matchEventButtons]);

  const canPreview = Boolean(overlayUrl && hasMatchId);
  const canInitialize = Boolean(trimmedMatchId);
  const configLocked = isInitialized;
  const showControl = isInitialized && hasMatchId;
  const isControlView = activeView === "control";
  const isConfigView = activeView === "config";

  const overlayOption = OVERLAY_OPTIONS.find((option) => option.value === overlayChoice);
  const overlayDescription = overlayOption?.description;

  const handleCopy = async () => {
    if (!overlayUrl) return;
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch (error) {
      setCopied(false);
    }
  };

  const handleInitialize = () => {
    if (!canInitialize) return;
    setIsInitialized(true);
  };

  const handleUnlock = () => {
    setIsInitialized(false);
  };

  const publishOverlayPayload = async (payload) => {
    try {
      window.localStorage.setItem("overlayBanner", JSON.stringify(payload));
    } catch (error) {
      // Ignore local storage failures and still try realtime delivery.
    }

    try {
      await overlayBannerChannelRef.current?.send({
        type: "broadcast",
        event: "overlay-banner",
        payload,
      });
    } catch (error) {
      // Keep the control surface responsive even if realtime delivery fails.
    }
  };

  const handleTriggerBanner = async () => {
    if (!trimmedMatchId || !selectedBannerPlayer?.id) return;

    try {
      const { data, error } = await supabase
        .from("player_match_stats")
        .select("team_id, goals, assists, blocks, turnovers")
        .eq("match_id", trimmedMatchId)
        .eq("player_id", selectedBannerPlayer.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const resolvedTeamId = data?.team_id || selectedBannerPlayer.teamId || null;
      const teamSlot =
        resolvedTeamId && resolvedTeamId === matchDetails?.team_a?.id
          ? "A"
          : resolvedTeamId && resolvedTeamId === matchDetails?.team_b?.id
            ? "B"
            : null;

      const payload = {
        type: "playerStats",
        playerId: selectedBannerPlayer.id,
        playerName: selectedBannerPlayer.name,
        teamId: resolvedTeamId,
        teamSlot,
        stats: {
          goals: data?.goals ?? 0,
          assists: data?.assists ?? 0,
          blocks: data?.blocks ?? 0,
          turnovers: data?.turnovers ?? 0,
        },
        ts: Date.now(),
      };

      await publishOverlayPayload(payload);
      setBannerStatus(`Banner queued for ${selectedBannerPlayer.name}.`);
      window.setTimeout(() => setBannerStatus(""), 3000);
    } catch (error) {
      setBannerStatus("Unable to load player match stats.");
      window.setTimeout(() => setBannerStatus(""), 3000);
    }
  };

  const handleTriggerMatchStats = async () => {
    const stats = matchStats || {};
    const payload = {
      type: "matchStats",
      title: "Match stats",
      stats: {
        holdsA: stats.holdsA ?? "",
        holdsB: stats.holdsB ?? "",
        breaksA: stats.breaksA ?? "",
        breaksB: stats.breaksB ?? "",
        turnoversA: stats.turnoversA ?? "",
        turnoversB: stats.turnoversB ?? "",
        blocksA: stats.blocksA ?? "",
        blocksB: stats.blocksB ?? "",
      },
      ts: Date.now(),
    };
    try {
      await publishOverlayPayload(payload);
      setBannerStatus("Match stats banner queued.");
      window.setTimeout(() => setBannerStatus(""), 3000);
    } catch (error) {
      setBannerStatus("Unable to trigger match stats banner.");
      window.setTimeout(() => setBannerStatus(""), 3000);
    }
  };

  const handleTriggerTimeout = async (team) => {
    if (!team) return;
    const payload = {
      type: "timeout",
      team,
      ts: Date.now(),
    };
    try {
      await publishOverlayPayload(payload);
      setBannerStatus(`Timeout banner queued for Team ${team}.`);
      window.setTimeout(() => setBannerStatus(""), 3000);
    } catch (error) {
      setBannerStatus("Unable to trigger timeout banner.");
      window.setTimeout(() => setBannerStatus(""), 3000);
    }
  };

  const handleTriggerMatchEvent = async (eventType, team) => {
    if (!eventType?.id) return;
    const payload = {
      type: "matchEvent",
      eventTypeId: eventType.id,
      eventCode: eventType.code,
      eventDescription: eventType.description,
      team: team || null,
      ts: Date.now(),
    };
    try {
      await publishOverlayPayload(payload);
      setBannerStatus(`Match event queued (${eventType.description || eventType.code || eventType.id}) for Team ${team}.`);
      window.setTimeout(() => setBannerStatus(""), 3000);
    } catch (error) {
      setBannerStatus("Unable to trigger match event.");
      window.setTimeout(() => setBannerStatus(""), 3000);
    }
  };

  useEffect(() => {
    if (overlayBannerChannelRef.current) {
      supabase.removeChannel(overlayBannerChannelRef.current);
      overlayBannerChannelRef.current = null;
    }

    if (!trimmedMatchId) return undefined;

    const channel = supabase.channel(`overlay-banner:${trimmedMatchId}`);
    overlayBannerChannelRef.current = channel;
    channel.subscribe();

    return () => {
      if (overlayBannerChannelRef.current === channel) {
        overlayBannerChannelRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [overlayBannerChannelRef, trimmedMatchId]);

  useEffect(() => {
    if (!trimmedMatchId && isInitialized) {
      setIsInitialized(false);
    }
  }, [trimmedMatchId, isInitialized]);

  useEffect(() => {
    if (bannerPlayerId && !selectedBannerPlayer) {
      setBannerPlayerId("");
    }
  }, [bannerPlayerId, selectedBannerPlayer]);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveView(getInitialView());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    const nextSettings = {
      overlayChoice,
      customOverlay,
      matchId: trimmedMatchId,
      isInitialized,
      teamATheme,
      teamBTheme,
      activeView,
      manualOverrideEnabled,
      manualStatus,
      manualClock,
      manualScoreA,
      manualScoreB,
      breakChanceEnabled,
      bannerPlayerId,
    };

    try {
      window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
    } catch (error) {
      // Ignore storage write failures.
    }
  }, [
    overlayChoice,
    customOverlay,
    trimmedMatchId,
    isInitialized,
    teamATheme,
    teamBTheme,
    activeView,
    manualOverrideEnabled,
    manualStatus,
    manualClock,
    manualScoreA,
    manualScoreB,
    breakChanceEnabled,
    bannerPlayerId,
  ]);

  useEffect(() => {
    let isActive = true;

    const loadEventTypesOnce = async () => {
      if (eventTypeCacheLoaded) return;
      const { data, error } = await supabase.from("match_events").select("id, code, description");
      if (error || !Array.isArray(data)) {
        eventTypeCacheLoaded = true;
        return;
      }
      data.forEach((eventType) => {
        eventTypeCache.set(eventType.id, eventType);
      });
      eventTypeCacheLoaded = true;
      if (isActive) {
        setEventTypesVersion((value) => value + 1);
      }
    };

    const loadMatchEventButtons = async () => {
      setMatchEventError("");
      const { data, error } = await supabase.from("match_events").select("id, code, description").order("id");
      if (!isActive) return;
      if (error || !Array.isArray(data)) {
        setMatchEventButtons([]);
        setMatchEventError(error?.message || "Unable to load match events.");
        return;
      }
      setMatchEventButtons(data);
    };

    const loadMatchDetails = async () => {
      if (!trimmedMatchId) return;

      setIsLoadingDetails(true);
      setDetailsError("");

      const { data, error } = await supabase
        .from("matches")
        .select(MATCH_DETAIL_FIELDS)
        .eq("id", trimmedMatchId)
        .maybeSingle();

      if (!isActive) return;

      if (error || !data) {
        setDetailsError(error?.message || "Unable to load match details.");
        setMatchDetails(null);
        setEventDetails(null);
        setIsLoadingDetails(false);
        return;
      }

      setMatchDetails(data);
      if (data.event?.id) {
        eventCache.set(data.event.id, data.event);
      }
      setEventDetails(data.event || (data.event_id ? eventCache.get(data.event_id) : null));
      setIsLoadingDetails(false);
    };

    const loadMatchLogs = async () => {
      if (!trimmedMatchId) return;
      setIsLoadingLogs(true);
      setLogsError("");

      let from = 0;
      const logs = [];
      let keepLoading = true;

      while (keepLoading) {
        const { data, error } = await supabase
          .from("match_logs")
          .select(MATCH_LOG_FIELDS)
          .eq("match_id", trimmedMatchId)
          .order("created_at", { ascending: true })
          .range(from, from + MATCH_LOG_PAGE_SIZE - 1);

        if (!isActive) return;

        if (error) {
          setLogsError(error.message || "Unable to load match logs.");
          keepLoading = false;
          break;
        }

        if (!data || data.length === 0) {
          keepLoading = false;
          break;
        }

        logs.push(...data);

        if (data.length < MATCH_LOG_PAGE_SIZE) {
          keepLoading = false;
        } else {
          from += MATCH_LOG_PAGE_SIZE;
        }
      }

      if (!isActive) return;
      setMatchLogs(logs);
      setIsLoadingLogs(false);
    };

    if (!trimmedMatchId) {
      setMatchDetails(null);
      setEventDetails(null);
      setMatchLogs([]);
      setRosterPlayersById({});
      setRosterByTeam({});
      setIsLoadingDetails(false);
      setIsLoadingLogs(false);
      setIsLoadingRoster(false);
      setDetailsError("");
      setLogsError("");
      setRosterError("");
      return () => {
        isActive = false;
      };
    }

    loadEventTypesOnce();
    loadMatchEventButtons();
    loadMatchDetails();
    loadMatchLogs();

    return () => {
      isActive = false;
    };
  }, [trimmedMatchId]);

  useEffect(() => {
    let isActive = true;
    const eventId = matchDetails?.event_id;
    const teamIds = [matchDetails?.team_a?.id, matchDetails?.team_b?.id].filter(Boolean);

    if (!eventId) {
      setRosterPlayersById({});
      setRosterByTeam({});
      setIsLoadingRoster(false);
      setRosterError("");
      return () => {
        isActive = false;
      };
    }

    const sortedTeamIds = [...teamIds].sort();
    const cacheKey = `${eventId}:${sortedTeamIds.join(",") || "all"}`;
    const cached = rosterCache.get(cacheKey);
    if (cached) {
      setRosterPlayersById(cached.playersById || {});
      setRosterByTeam(cached.rosterByTeam || {});
      setRosterError("");
      setIsLoadingRoster(false);
      return () => {
        isActive = false;
      };
    }

    const loadRoster = async () => {
      setIsLoadingRoster(true);
      setRosterError("");

      let query = supabase
        .from("team_roster")
        .select("team_id, is_captain, is_spirit_captain, player:player_id (id, name, jersey_number)")
        .eq("event_id", eventId);

      if (sortedTeamIds.length) {
        query = query.in("team_id", sortedTeamIds);
      }

      const { data, error } = await query;

      if (!isActive) return;

      if (error) {
        setRosterError(error.message || "Unable to load team roster.");
        setIsLoadingRoster(false);
        return;
      }

      const playersById = {};
      const rosterByTeam = {};
      (data || []).forEach((row) => {
        if (!row.player?.id) return;
        const playerName = row.player.name || row.player.id;
        playersById[row.player.id] = playerName;

        if (!row.team_id) return;
        if (!rosterByTeam[row.team_id]) {
          rosterByTeam[row.team_id] = [];
        }
        rosterByTeam[row.team_id].push({
          id: row.player.id,
          teamId: row.team_id,
          name: playerName,
          number: row.player.jersey_number,
          isCaptain: Boolean(row.is_captain),
          isSpiritCaptain: Boolean(row.is_spirit_captain),
        });
      });

      Object.values(rosterByTeam).forEach((players) =>
        players.sort((a, b) => {
          const captainRankA = a.isCaptain ? 0 : a.isSpiritCaptain ? 1 : 2;
          const captainRankB = b.isCaptain ? 0 : b.isSpiritCaptain ? 1 : 2;
          if (captainRankA !== captainRankB) return captainRankA - captainRankB;

          const numA = Number.isFinite(Number(a.number)) ? Number(a.number) : null;
          const numB = Number.isFinite(Number(b.number)) ? Number(b.number) : null;
          if (numA !== null && numB !== null) return String(a.name).localeCompare(b.name);
          if (numA !== null && numB === null) return -1;
          if (numA === null && numB !== null) return 1;
          return String(a.name).localeCompare(b.name);
        }),
      );
      rosterCache.set(cacheKey, { playersById, rosterByTeam });
      setRosterPlayersById(playersById);
      setRosterByTeam(rosterByTeam);
      setIsLoadingRoster(false);
    };

    loadRoster();

    return () => {
      isActive = false;
    };
  }, [matchDetails?.event_id, matchDetails?.team_a?.id, matchDetails?.team_b?.id]);

  useEffect(() => {
    if (!trimmedMatchId) return () => {};

    const matchLogsChannel = supabase
      .channel(`overlay-control:match_logs:${trimmedMatchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "match_logs",
          filter: `match_id=eq.${trimmedMatchId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const removedId = payload.old?.id;
            if (!removedId) return;
            setMatchLogs((current) => current.filter((log) => log.id !== removedId));
            return;
          }

          const incoming = payload.new;
          if (!incoming) return;
          setMatchLogs((current) => {
            const existingIndex = current.findIndex((log) => log.id === incoming.id);
            if (existingIndex >= 0) {
              const next = [...current];
              next[existingIndex] = incoming;
              return next;
            }
            return [...current, incoming].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            );
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(matchLogsChannel);
    };
  }, [trimmedMatchId]);

  const formatDate = (value) => {
    if (!value) return "--";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString();
  };

  const formatDateTime = (value) => {
    if (!value) return "--";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return `${parsed.toLocaleDateString()} ${parsed.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  };

  const resolveEventCode = (eventType) => {
    const rawCode = (eventType?.code || "").toString().trim().toLowerCase();
    if (rawCode) return rawCode;

    const description = (eventType?.description || "").toString().trim().toLowerCase();
    if (!description) return "";

    if (description.includes("calahan")) return MATCH_LOG_EVENT_CODES.CALAHAN;
    if (description.includes("score")) return MATCH_LOG_EVENT_CODES.SCORE;
    if (description.includes("timeout")) return MATCH_LOG_EVENT_CODES.TIMEOUT;
    if (description.includes("halftime")) return MATCH_LOG_EVENT_CODES.HALFTIME_START;
    if (description.includes("turnover")) return MATCH_LOG_EVENT_CODES.TURNOVER;
    if (description.includes("block")) return MATCH_LOG_EVENT_CODES.BLOCK;
    if (description.includes("stoppage")) return MATCH_LOG_EVENT_CODES.STOPPAGE_START;
    if (description.includes("match start")) return MATCH_LOG_EVENT_CODES.MATCH_START;
    if (description.includes("match end")) return MATCH_LOG_EVENT_CODES.MATCH_END;

    return description.replace(/\s+/g, "_");
  };

  const resolvePlayerName = (playerId) => {
    if (!playerId) return "";
    return rosterPlayersById[playerId] || "Unknown player";
  };

  const eventCardLogs = useMemo(() => {
    if (!matchLogs.length) return [];
    const teamAId = matchDetails?.team_a?.id;
    const teamBId = matchDetails?.team_b?.id;
    let totalA = 0;
    let totalB = 0;

    const chronologicalLogs = [...matchLogs]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((log, index) => {
        const eventType = eventTypeCache.get(log.event_type_id);
        const eventCode = resolveEventCode(eventType);
        const eventDescription = eventType?.description || eventType?.code || "Match event";
        const team = log.team_id === teamAId ? "A" : log.team_id === teamBId ? "B" : null;
        const isScoreEvent =
          eventCode === MATCH_LOG_EVENT_CODES.SCORE ||
          eventCode === MATCH_LOG_EVENT_CODES.CALAHAN ||
          eventCode.includes("score") ||
          eventCode.includes("calahan");

        if (isScoreEvent) {
          if (team === "A") totalA += 1;
          if (team === "B") totalB += 1;
        }

        return {
          id: log.id,
          eventTypeId: log.event_type_id,
          eventCode,
          eventDescription,
          timestamp: log.created_at,
          team,
          teamId: log.team_id,
          abbaLine: log.abba_line,
          scorerId: log.actor_id,
          scorerName: resolvePlayerName(log.actor_id) || (log.actor_id ? "Unknown player" : ""),
          assistName: resolvePlayerName(log.secondary_actor_id),
          totalA,
          totalB,
          scoreOrderIndex: index,
        };
      });

    return chronologicalLogs.slice().reverse();
  }, [
    matchLogs,
    matchDetails?.team_a?.id,
    matchDetails?.team_b?.id,
    rosterPlayersById,
    eventTypesVersion,
  ]);

  const matchStats = useMemo(() => {
    if (!matchDetails) return null;
    const teamAId = matchDetails?.team_a?.id || null;
    const teamBId = matchDetails?.team_b?.id || null;
    const toTeamKey = (teamId) => {
      if (!teamId) return null;
      if (teamId === teamAId) return "teamA";
      if (teamId === teamBId) return "teamB";
      return null;
    };
    const getOppositeTeam = (teamKey) => {
      if (teamKey === "teamA") return "teamB";
      if (teamKey === "teamB") return "teamA";
      return null;
    };
    const normalizeTeamKey = (teamKey) => (teamKey === "teamA" || teamKey === "teamB" ? teamKey : null);
    const inferInitialOffense = () => {
      if (matchDetails?.starting_team_id === teamAId) return "teamB";
      if (matchDetails?.starting_team_id === teamBId) return "teamA";
      return "teamA";
    };
    const fallbackOffense = normalizeTeamKey(inferInitialOffense()) || "teamA";
    let pointStartingOffense = fallbackOffense;
    let pointStartingDefense = getOppositeTeam(pointStartingOffense);
    let currentPossession = pointStartingOffense;
    let pointTurnovers = 0;
    const resetPointState = (nextOffense) => {
      const normalized = normalizeTeamKey(nextOffense) || fallbackOffense;
      pointStartingOffense = normalized;
      pointStartingDefense = getOppositeTeam(normalized);
      currentPossession = pointStartingOffense;
      pointTurnovers = 0;
    };
    resetPointState(fallbackOffense);

    const createTotals = () => ({
      holds: 0,
      breaks: 0,
      turnovers: 0,
      blocks: 0,
    });
    const totals = {
      teamA: createTotals(),
      teamB: createTotals(),
    };

    let scoreA = 0;
    let scoreB = 0;
    let hasScoreEvents = false;

    const orderedLogs = [...matchLogs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    for (const log of orderedLogs) {
      const eventType = eventTypeCache.get(log.event_type_id);
      const eventCode = resolveEventCode(eventType);
      const eventCodeLower = (eventCode || "").toLowerCase();
      const eventLabel = (eventType?.description || eventType?.code || "").toString();
      const normalizedLabel = eventLabel.trim().toLowerCase();
      const teamKey = toTeamKey(log.team_id);

      if (
        eventCodeLower === MATCH_LOG_EVENT_CODES.SCORE ||
        eventCodeLower === MATCH_LOG_EVENT_CODES.CALAHAN
      ) {
        hasScoreEvents = true;
        if (teamKey === "teamA") scoreA += 1;
        if (teamKey === "teamB") scoreB += 1;

        if (teamKey) {
          if (teamKey === pointStartingOffense) {
            totals[teamKey].holds += 1;
          } else if (teamKey === pointStartingDefense) {
            totals[teamKey].breaks += 1;
          }
        }

        const nextOffense = teamKey ? getOppositeTeam(teamKey) : getOppositeTeam(pointStartingOffense);
        resetPointState(nextOffense);
        continue;
      }

      const isTurnoverEvent = eventCodeLower === MATCH_LOG_EVENT_CODES.TURNOVER;
      const isBlockEvent = eventCodeLower === MATCH_LOG_EVENT_CODES.BLOCK || normalizedLabel.includes("block");

      if (isTurnoverEvent || isBlockEvent) {
        const reportedTeamKey = teamKey;
        const previouslyHoldingTeam = currentPossession;
        let gainingTeamKey = reportedTeamKey;
        if (previouslyHoldingTeam && reportedTeamKey && reportedTeamKey === previouslyHoldingTeam && !isBlockEvent) {
          gainingTeamKey = getOppositeTeam(reportedTeamKey);
        }
        if (!gainingTeamKey && previouslyHoldingTeam) {
          gainingTeamKey = getOppositeTeam(previouslyHoldingTeam);
        }

        const losingTeamKey =
          previouslyHoldingTeam || (gainingTeamKey ? getOppositeTeam(gainingTeamKey) : null);
        if (losingTeamKey && totals[losingTeamKey]) {
          totals[losingTeamKey].turnovers += 1;
        }

        pointTurnovers += 1;
        if (gainingTeamKey) {
          currentPossession = gainingTeamKey;
          if (isBlockEvent && totals[gainingTeamKey]) {
            totals[gainingTeamKey].blocks += 1;
          }
        }
      }
    }

    if (!hasScoreEvents) {
      const fallbackScoreA = Number(matchDetails?.score_a);
      const fallbackScoreB = Number(matchDetails?.score_b);
      if (Number.isFinite(fallbackScoreA)) scoreA = fallbackScoreA;
      if (Number.isFinite(fallbackScoreB)) scoreB = fallbackScoreB;
    }

    return {
      scoreA,
      scoreB,
      holdsA: totals.teamA.holds,
      holdsB: totals.teamB.holds,
      breaksA: totals.teamA.breaks,
      breaksB: totals.teamB.breaks,
      turnoversA: totals.teamA.turnovers,
      turnoversB: totals.teamB.turnovers,
      blocksA: totals.teamA.blocks,
      blocksB: totals.teamB.blocks,
    };
  }, [matchDetails, matchLogs, eventTypesVersion]);

  const noop = () => {};

  const formatStatValue = (value) => {
    if (value === null || value === undefined || value === "") {
      return "--";
    }
    return value;
  };

  const renderRulesValue = (value, keyPrefix = "") => {
    if (value === null || value === undefined) {
      return <span className="rules-empty">--</span>;
    }

    if (Array.isArray(value)) {
      if (!value.length) return <span className="rules-empty">Empty list</span>;
      return (
        <ul className="rules-list">
          {value.map((item, index) => (
            <li className="rules-item" key={`${keyPrefix}-${index}`}>
              <span className="rules-key">[{index + 1}]</span>
              <div className="rules-value">{renderRulesValue(item, `${keyPrefix}-${index}`)}</div>
            </li>
          ))}
        </ul>
      );
    }

    if (typeof value === "object") {
      const entries = Object.entries(value);
      if (!entries.length) return <span className="rules-empty">No details</span>;
      return (
        <ul className="rules-list">
          {entries.map(([key, itemValue]) => (
            <li className="rules-item" key={`${keyPrefix}-${key}`}>
              <span className="rules-key">{key}</span>
              <div className="rules-value">{renderRulesValue(itemValue, `${keyPrefix}-${key}`)}</div>
            </li>
          ))}
        </ul>
      );
    }

    return <span className="rules-leaf">{String(value)}</span>;
  };

  return (
    <div className={`sc-page overlay-page ${isControlView ? "overlay-page--control" : ""}`}>
      <div className="sc-page__glow" aria-hidden="true" />
      <SectionShell className="overlay-shell">
        {isConfigView ? (
          <header className="overlay-header overlay-header--minimal">
            <div className="overlay-header__text">
              <Chip>Overlay</Chip>
              <h1 className="overlay-header__title">Configuration</h1>
              <p className="overlay-header__subtitle">
                Initialize the overlay and confirm the live preview.
              </p>
            </div>
          </header>
        ) : (
          <header className="overlay-header overlay-header--minimal overlay-header--compact overlay-header--with-actions">
            <div className="overlay-header__text">
              <h1 className="overlay-header__title overlay-header__title--compact">Control</h1>
            </div>
            <div className="overlay-header__actions">
              <button
                type="button"
                className={`sc-button is-ghost ${overlayUrl ? "" : "is-disabled"}`}
                onClick={handleCopy}
                disabled={!overlayUrl}
              >
                {copied ? "Copied" : "Copy URL"}
              </button>
              <a
                className={`sc-button ${canPreview ? "" : "is-disabled"}`}
                href={canPreview ? overlayUrl : undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!canPreview}
              >
                Open overlay
              </a>
              <a className="sc-button is-ghost" href="#config">
                Back
              </a>
            </div>
          </header>
        )}

        {isConfigView ? (
          <section className="overlay-section">
            <SectionHeader
              title="Configuration"
              description="Set the overlay source and match. Once initialized, configuration locks."
              divider
            />

            <div className="overlay-config-layout">
              <Card className="overlay-card overlay-config-card">
                <div className="overlay-form">
                  <Field
                    label="Overlay file"
                    hint="Defaults to the WFDF competitive overlay shipped with this project."
                  >
                    <Select
                      value={overlayChoice}
                      onChange={(event) => setOverlayChoice(event.target.value)}
                      disabled={configLocked}
                    >
                      {OVERLAY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    {overlayDescription ? (
                      <p className="overlay-option-note">{overlayDescription}</p>
                    ) : null}
                  </Field>

                  {overlayChoice === "custom" ? (
                    <Field
                      label="Custom overlay path"
                      hint="Choose an HTML overlay file to use for the preview and URL."
                    >
                      <Input
                        type="file"
                        accept=".html,.htm,text/html"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          setCustomOverlay(file ? file.name : "");
                        }}
                        disabled={configLocked}
                      />
                      {customOverlay ? <p className="overlay-option-note">Selected: {customOverlay}</p> : null}
                    </Field>
                  ) : null}

                  <Field
                    label="Match ID"
                    hint="Required for live data and preview updates."
                    action={hasMatchId ? "Ready" : "Required"}
                  >
                    <Input
                      value={matchId}
                      onChange={(event) => setMatchId(event.target.value)}
                      placeholder="e.g. 5e2b7c94"
                      disabled={configLocked}
                    />
                    {trimmedMatchId ? (
                      isLoadingDetails ? (
                        <p className="overlay-option-note">Loading match details...</p>
                      ) : detailsError ? (
                        <p className="overlay-data-state overlay-data-state--error">{detailsError}</p>
                      ) : matchDetails ? (
                        <div className="overlay-match-summary">
                          <div className="overlay-match-summary__title">
                            {(matchDetails.team_a?.name || "Team A")} vs {(matchDetails.team_b?.name || "Team B")}
                          </div>
                          <div className="overlay-match-summary__meta">
                            <span>Start: {formatDateTime(matchDetails.start_time)}</span>
                            <span>Venue: {matchDetails.event?.location || eventDetails?.location || "--"}</span>
                          </div>
                        </div>
                      ) : (
                        <p className="overlay-option-note">No match information found for this ID.</p>
                      )
                    ) : null}
                  </Field>

                  <Field
                    label="Team colors"
                    hint="Pick primary or secondary team colors from the attributes payload."
                  >
                    <div className="overlay-team-toggle-grid">
                      <div className="overlay-team-toggle">
                        <span className="overlay-team-toggle__label">
                          {matchDetails?.team_a?.name || "Team A"}
                        </span>
                        <Select
                          value={teamATheme}
                          onChange={(event) => setTeamATheme(event.target.value)}
                          disabled={configLocked}
                        >
                          <option value="primary">Primary color</option>
                          <option value="secondary">Secondary color</option>
                        </Select>
                        <div
                          className="overlay-team-preview"
                          style={{ backgroundColor: teamAPalette.bg, color: teamAPalette.text }}
                        >
                          <span className="overlay-team-preview__kicker">Demo ({teamAPalette.label})</span>
                          <span className="overlay-team-preview__name">
                            {matchDetails?.team_a?.name || "Team A"}
                          </span>
                          <span className="overlay-team-preview__meta">{teamAPalette.bg}</span>
                        </div>
                      </div>
                      <div className="overlay-team-toggle">
                        <span className="overlay-team-toggle__label">
                          {matchDetails?.team_b?.name || "Team B"}
                        </span>
                        <Select
                          value={teamBTheme}
                          onChange={(event) => setTeamBTheme(event.target.value)}
                          disabled={configLocked}
                        >
                          <option value="primary">Primary color</option>
                          <option value="secondary">Secondary color</option>
                        </Select>
                        <div
                          className="overlay-team-preview"
                          style={{ backgroundColor: teamBPalette.bg, color: teamBPalette.text }}
                        >
                          <span className="overlay-team-preview__kicker">Demo ({teamBPalette.label})</span>
                          <span className="overlay-team-preview__name">
                            {matchDetails?.team_b?.name || "Team B"}
                          </span>
                          <span className="overlay-team-preview__meta">{teamBPalette.bg}</span>
                        </div>
                      </div>
                    </div>
                  </Field>
                </div>
              </Card>

              <Card className="overlay-card overlay-preview-card overlay-preview-card--lite">
                <SectionHeader
                  title="Preview"
                  description="Light 16:9 preview of the live overlay."
                  action={<Chip variant="tag">16:9</Chip>}
                  divider
                />

                <div className="preview-stage" aria-live="polite">
                  <img
                    className="preview-stage__image"
                    src="/overlay-demo.jpg"
                    alt="Preview base"
                    loading="lazy"
                  />
                  {canPreview ? (
                    <iframe
                      title="Overlay preview"
                      className="preview-frame preview-frame--overlay"
                      src={overlayPreviewUrl}
                    />
                  ) : (
                    <div className="preview-placeholder">
                      <div>
                        <p className="preview-placeholder__title">Preview waiting</p>
                        <p className="preview-placeholder__body">
                          Add a match ID to load the overlay preview in this 16:9 frame.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              <div className="overlay-config-actions">
                <p className="overlay-lock-hint">
                  {configLocked
                    ? "Configuration locked. Unlock to make changes."
                    : "Lock configuration to enable controls."}
                </p>
                <div className="overlay-config-actions__buttons">
                  {configLocked ? (
                    <button type="button" className="sc-button is-ghost" onClick={handleUnlock}>
                      Unlock
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`sc-button ${canInitialize ? "" : "is-disabled"}`}
                      onClick={handleInitialize}
                      disabled={!canInitialize}
                    >
                      Lock configuration
                    </button>
                  )}
                  <a
                    className={`sc-button is-ghost ${showControl ? "" : "is-disabled"}`}
                    href={showControl ? "#control" : undefined}
                    aria-disabled={!showControl}
                  >
                    Control section
                  </a>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {isControlView ? (
          <section className="overlay-section">
            {showControl ? (
              <div className="overlay-control-layout">
                <div className="overlay-control-stack">
                  <Card className="overlay-card overlay-banner-card">
                    <SectionHeader
                      title="Banners"
                      description="Trigger on-air banners that slide behind the score bar."
                      divider
                    />

                    <div className="overlay-banner-grid">
                      <div className="overlay-banner-block">
                        <div className="overlay-banner-block__title">Break chance</div>
                        <label className="overlay-manual-toggle">
                          <input
                            type="checkbox"
                            checked={breakChanceEnabled}
                            onChange={(event) => setBreakChanceEnabled(event.target.checked)}
                          />
                          <div>
                            <div className="overlay-manual-toggle__title">Break chance banner</div>
                            <div className="overlay-manual-toggle__hint">
                              Show when the base-possession team regains possession.
                            </div>
                          </div>
                        </label>
                      </div>

                      <div className="overlay-banner-block">
                        <div className="overlay-banner-block__title">Player stats</div>
                        <Field
                          label="Player stats banner"
                          hint="Choose a player to trigger the banner."
                        >
                          <Select
                            value={bannerPlayerId}
                            onChange={(event) => setBannerPlayerId(event.target.value)}
                          >
                            <option value="">Select player</option>
                            {bannerPlayerOptions.map((player) => (
                              <option key={player.id || `${player.name}-${player.number || "na"}`} value={player.id}>
                                {Number.isFinite(Number(player.number)) ? `#${player.number} ` : ""}
                                {player.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <button
                          type="button"
                          className={`sc-button ${selectedBannerPlayer ? "" : "is-disabled"}`}
                          onClick={handleTriggerBanner}
                          disabled={!selectedBannerPlayer}
                        >
                          {formatTimedButtonLabel("Show player stats banner", BUTTON_DURATION_SECONDS.playerStats)}
                        </button>
                      </div>

                      <div className="overlay-banner-block">
                        <div className="overlay-banner-block__title">Match stats</div>
                        <div className="overlay-matchstats-table">
                          <div className="overlay-matchstats-table__title">Match stats</div>
                          <table className="overlay-matchstats-table__grid">
                            <thead>
                              <tr>
                                <th>{matchDetails?.team_a?.name || "Team A"}</th>
                                <th></th>
                                <th>{matchDetails?.team_b?.name || "Team B"}</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>{formatStatValue(matchStats?.scoreA)}</td>
                                <td>Score</td>
                                <td>{formatStatValue(matchStats?.scoreB)}</td>
                              </tr>
                              <tr>
                                <td>{formatStatValue(matchStats?.holdsA)}</td>
                                <td>Holds</td>
                                <td>{formatStatValue(matchStats?.holdsB)}</td>
                              </tr>
                              <tr>
                                <td>{formatStatValue(matchStats?.breaksA)}</td>
                                <td>Breaks</td>
                                <td>{formatStatValue(matchStats?.breaksB)}</td>
                              </tr>
                              <tr>
                                <td>{formatStatValue(matchStats?.turnoversA)}</td>
                                <td>Turnovers</td>
                                <td>{formatStatValue(matchStats?.turnoversB)}</td>
                              </tr>
                              <tr>
                                <td>{formatStatValue(matchStats?.blocksA)}</td>
                                <td>Blocks</td>
                                <td>{formatStatValue(matchStats?.blocksB)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <button type="button" className="sc-button is-ghost" onClick={handleTriggerMatchStats}>
                          {formatTimedButtonLabel("Show match stats overlay", BUTTON_DURATION_SECONDS.matchStats)}
                        </button>
                      </div>

                      <div className="overlay-banner-block">
                        <div className="overlay-banner-block__title">Timeouts</div>
                        <div className="overlay-banner-actions">
                          <button
                            type="button"
                            className="sc-button is-ghost"
                            onClick={() => handleTriggerTimeout("A")}
                          >
                            {formatTimedButtonLabel(
                              `Timeout ${matchDetails?.team_a?.name || "Team A"}`,
                              BUTTON_DURATION_SECONDS.timeout,
                            )}
                          </button>
                          <button
                            type="button"
                            className="sc-button is-ghost"
                            onClick={() => handleTriggerTimeout("B")}
                          >
                            {formatTimedButtonLabel(
                              `Timeout ${matchDetails?.team_b?.name || "Team B"}`,
                              BUTTON_DURATION_SECONDS.timeout,
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="overlay-banner-block">
                        <div className="overlay-banner-block__title">Halftime + stoppage</div>
                        <div className="overlay-banner-actions">
                          <button
                            type="button"
                            className={`sc-button is-ghost ${bannerEventGroups.halftimeEvent ? "" : "is-disabled"}`}
                            disabled={!bannerEventGroups.halftimeEvent}
                            onClick={() => handleTriggerMatchEvent(bannerEventGroups.halftimeEvent)}
                          >
                            Halftime
                          </button>
                          <button
                            type="button"
                            className={`sc-button is-ghost ${bannerEventGroups.stoppage.length ? "" : "is-disabled"}`}
                            disabled={!bannerEventGroups.stoppage.length}
                            onClick={() => handleTriggerMatchEvent(bannerEventGroups.stoppage[0])}
                          >
                            Stoppage
                          </button>
                        </div>
                        {matchEventError ? (
                          <p className="overlay-banner-status overlay-banner-status--error">{matchEventError}</p>
                        ) : null}
                      </div>

                      {bannerStatus ? (
                        <p className="overlay-banner-status">{bannerStatus}</p>
                      ) : null}
                    </div>
                  </Card>

                  <Card className="overlay-card overlay-roster-card">
                    <SectionHeader
                      title="Team rosters"
                      description="Players loaded for the active event."
                      action={<Chip variant="ghost">{teamARoster.length + teamBRoster.length} players</Chip>}
                      divider
                    />

                    {isLoadingRoster ? (
                      <p className="overlay-data-state">Loading team roster...</p>
                    ) : rosterError ? (
                      <p className="overlay-data-state overlay-data-state--error">{rosterError}</p>
                    ) : teamARoster.length || teamBRoster.length ? (
                      <div className="overlay-roster-grid">
                        <div>
                          <div className="overlay-roster-title">{matchDetails?.team_a?.name || "Team A"}</div>
                          <ul className="overlay-roster-list">
                            {teamARoster.length ? (
                              teamARoster.map((player, index) => (
                                <li className="overlay-roster-item" key={`team-a-${index}`}>
                                  <span className="overlay-roster-number">
                                    {Number.isFinite(Number(player.number)) ? player.number : ""}
                                  </span>
                                  <span className="overlay-roster-name">{player.name}</span>
                                  {player.isCaptain ? (
                                    <span className="overlay-roster-tag overlay-roster-tag--captain" aria-label="Captain">
                                      C
                                    </span>
                                  ) : null}
                                  {player.isSpiritCaptain ? (
                                    <span
                                      className="overlay-roster-tag overlay-roster-tag--spirit"
                                      aria-label="Spirit captain"
                                    >
                                      SC
                                    </span>
                                  ) : null}
                                </li>
                              ))
                            ) : (
                              <li className="overlay-roster-empty">No players loaded.</li>
                            )}
                          </ul>
                        </div>
                        <div>
                          <div className="overlay-roster-title">{matchDetails?.team_b?.name || "Team B"}</div>
                          <ul className="overlay-roster-list">
                            {teamBRoster.length ? (
                              teamBRoster.map((player, index) => (
                                <li className="overlay-roster-item" key={`team-b-${index}`}>
                                  <span className="overlay-roster-number">
                                    {Number.isFinite(Number(player.number)) ? player.number : ""}
                                  </span>
                                  <span className="overlay-roster-name">{player.name}</span>
                                  {player.isCaptain ? (
                                    <span className="overlay-roster-tag overlay-roster-tag--captain" aria-label="Captain">
                                      C
                                    </span>
                                  ) : null}
                                  {player.isSpiritCaptain ? (
                                    <span
                                      className="overlay-roster-tag overlay-roster-tag--spirit"
                                      aria-label="Spirit captain"
                                    >
                                      SC
                                    </span>
                                  ) : null}
                                </li>
                              ))
                            ) : (
                              <li className="overlay-roster-empty">No players loaded.</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <p className="overlay-data-state">No roster data available.</p>
                    )}
                  </Card>

                  <Card className="overlay-card overlay-rules-card">
                    <SectionHeader
                      title="Rules"
                      description="Event details and rules."
                      divider
                    />

                    {isLoadingDetails ? (
                      <p className="overlay-data-state">Loading event details...</p>
                    ) : detailsError ? (
                      <p className="overlay-data-state overlay-data-state--error">{detailsError}</p>
                    ) : eventDetails ? (
                      <div className="overlay-data-body">
                        <dl className="overlay-definition-list">
                          <div className="overlay-definition-item">
                            <dt>Event ID</dt>
                            <dd>{eventDetails.id}</dd>
                          </div>
                          <div className="overlay-definition-item">
                            <dt>Name</dt>
                            <dd>{eventDetails.name || "--"}</dd>
                          </div>
                          <div className="overlay-definition-item">
                            <dt>Type</dt>
                            <dd>{eventDetails.type || "--"}</dd>
                          </div>
                          <div className="overlay-definition-item">
                            <dt>Status</dt>
                            <dd>{eventDetails.Status || "--"}</dd>
                          </div>
                          <div className="overlay-definition-item">
                            <dt>Start date</dt>
                            <dd>{formatDate(eventDetails.start_date)}</dd>
                          </div>
                          <div className="overlay-definition-item">
                            <dt>End date</dt>
                            <dd>{formatDate(eventDetails.end_date)}</dd>
                          </div>
                          <div className="overlay-definition-item">
                            <dt>Location</dt>
                            <dd>{eventDetails.location || "--"}</dd>
                          </div>
                        </dl>

                        <div className="overlay-rules">
                          <div className="overlay-rules-header">Rules</div>
                          <div className="overlay-rules-body">
                            {eventDetails.rules ? (
                              renderRulesValue(eventDetails.rules, "rules")
                            ) : (
                              <span className="rules-empty">No rules provided</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="overlay-data-state">No event data available.</p>
                    )}
                  </Card>
                </div>

                <Card className="overlay-card overlay-log-card">
                  <SectionHeader
                    title="Match log"
                    description="Realtime feed of match events."
                    action={<Chip variant="ghost">{matchLogs.length} entries</Chip>}
                    divider
                  />

                  {isLoadingLogs ? (
                    <p className="overlay-data-state">Loading match logs...</p>
                  ) : logsError ? (
                    <p className="overlay-data-state overlay-data-state--error">{logsError}</p>
                  ) : eventCardLogs.length ? (
                    <div className="overlay-log-list">
                      {eventCardLogs.map((log, index) => (
                        <MatchEventCard
                          key={log.id}
                          log={log}
                          chronologicalIndex={index}
                          editIndex={index}
                          displayTeamA={matchDetails?.team_a?.name || "Team A"}
                          displayTeamB={matchDetails?.team_b?.name || "Team B"}
                          displayTeamAShort={matchDetails?.team_a?.name || "Team A"}
                          displayTeamBShort={matchDetails?.team_b?.name || "Team B"}
                          openScoreModal={noop}
                          openSimpleEventModal={noop}
                          openPossessionEditModal={noop}
                          editLocation="none"
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="overlay-data-state">No match logs yet.</p>
                  )}
                </Card>
              </div>
            ) : (
              <Card className="overlay-card overlay-control-locked">
                <p className="overlay-data-state">
                  Initialize the configuration to unlock overlay controls, rules, and match logs.
                </p>
              </Card>
            )}
          </section>
        ) : null}
      </SectionShell>
    </div>
  );
}
