import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

const MATCH_FIELDS = `
  id,
  status,
  score_a,
  score_b,
  team_a:teams!matches_team_a_fkey (id, name, short_name),
  team_b:teams!matches_team_b_fkey (id, name, short_name)
`;

const STATUS_LABELS = {
  live: "LIVE",
  halftime: "HALF",
  finished: "FINAL",
  completed: "FINAL",
  scheduled: "SCHEDULED",
  ready: "READY",
  pending: "PENDING",
  canceled: "CANCELED",
};

function getMatchIdFromUrl() {
  const searchParams = new URLSearchParams(window.location.search);
  const queryMatchId = searchParams.get("matchId");
  if (queryMatchId) return queryMatchId.trim();

  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function formatTeamName(team) {
  if (!team) return "TBD";
  return team.short_name || team.name || "TBD";
}

function formatStatus(status) {
  if (!status) return "LIVE";
  return STATUS_LABELS[status] || status.toUpperCase();
}

export default function App() {
  const matchId = useMemo(getMatchIdFromUrl, []);
  const [match, setMatch] = useState(null);
  const [status, setStatus] = useState(matchId ? "loading" : "missing-id");
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadMatch() {
      if (!matchId) return;
      setStatus("loading");
      setError("");

      const { data, error: loadError } = await supabase
        .from("matches")
        .select(MATCH_FIELDS)
        .eq("id", matchId)
        .maybeSingle();

      if (!isActive) return;

      if (loadError) {
        setStatus("error");
        setError(loadError.message || "Unable to load match.");
        return;
      }

      if (!data) {
        setStatus("missing");
        setMatch(null);
        return;
      }

      setMatch(data);
      setStatus("ready");
      setLastUpdatedAt(new Date().toISOString());
    }

    if (matchId) {
      loadMatch();
    } else {
      setStatus("missing-id");
      setMatch(null);
    }

    return () => {
      isActive = false;
    };
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return () => {};

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
            setStatus("missing");
            setMatch(null);
            return;
          }

          const incoming = payload.new;
          if (!incoming) return;

          setMatch((current) => {
            if (!current) return current;
            return {
              ...current,
              score_a: incoming.score_a ?? current.score_a,
              score_b: incoming.score_b ?? current.score_b,
              status: incoming.status ?? current.status,
            };
          });
          setStatus((current) => (current === "ready" ? current : "ready"));
          setLastUpdatedAt(new Date().toISOString());
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  const teamAName = formatTeamName(match?.team_a);
  const teamBName = formatTeamName(match?.team_b);
  const scoreA = Number.isFinite(match?.score_a) ? match.score_a : 0;
  const scoreB = Number.isFinite(match?.score_b) ? match.score_b : 0;
  const statusLabel = formatStatus(match?.status);
  const updatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div className="overlay-root">
      <div className="scorebar">
        <div className="team">
          <span className="team-name">{teamAName}</span>
          <span className="score">{scoreA}</span>
        </div>
        <div className="center-stack">
          <span className="status-pill">{statusLabel}</span>
          <span className="match-id">{matchId || "NO MATCH ID"}</span>
        </div>
        <div className="team">
          <span className="score">{scoreB}</span>
          <span className="team-name">{teamBName}</span>
        </div>
      </div>

      <div className={`meta ${status === "error" ? "meta-error" : ""}`}>
        {status === "missing-id" && "Add ?matchId=<id> or /<id> to the URL."}
        {status === "missing" && "Match not found or no longer public."}
        {status === "error" && error}
        {status === "ready" && `Last update ${updatedLabel}`}
        {status === "loading" && "Loading match..."}
      </div>
    </div>
  );
}
