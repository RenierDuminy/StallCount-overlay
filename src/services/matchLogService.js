export const MATCH_LOG_EVENT_CODES = {
  SCORE: "score",
  CALAHAN: "calahan",
  MATCH_START: "match_start",
  MATCH_END: "match_end",
  TIMEOUT: "timeout",
  TIMEOUT_START: "timeout_start",
  TIMEOUT_END: "timeout_end",
  HALFTIME_START: "halftime_start",
  HALFTIME_END: "halftime_end",
  TURNOVER: "turnover",
  STOPPAGE_START: "stoppage_start",
  STOPPAGE_END: "stoppage_end",
  BLOCK: "block",
};

// Numeric ID of the "block" row in match_events — verify if schema changes.
export const BLOCK_EVENT_TYPE_ID = 19;
