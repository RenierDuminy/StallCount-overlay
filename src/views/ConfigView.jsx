import { Field, Input, Select } from "../components/ui/primitives";

const OVERLAY_OPTIONS = [
  { value: "overlays/badge-centre.html", label: "Badge centre", hasTeamLogos: true },
  { value: "overlays/compact-bar.html", label: "Compact bar", hasTeamLogos: true },
  { value: "overlays/corner-box-bottom-left.html", label: "Corner box (Bottom-L)", hasTeamLogos: true },
  { value: "overlays/corner-box.html", label: "Corner box (Top-L)", hasTeamLogos: true },
  { value: "overlays/top-right-list.html", label: "Top-right list" },
  { value: "overlays/wfdf-competitive.html", label: "WFDF competitive", hasEventLogo: true },
  { value: "overlays/wide-bar.html", label: "Wide bar", hasTeamLogos: true },
  { value: "overlay-debug.html", label: "Debug", hasEventLogo: true },
];


function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function formatDateTime(value) {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return `${parsed.toLocaleDateString()} ${parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function ConfigView({
  overlayChoice,
  setOverlayChoice,
  matchId,
  setMatchId,
  teamATheme,
  setTeamATheme,
  teamBTheme,
  setTeamBTheme,
  teamAPalette,
  teamBPalette,
  matchDetails,
  eventDetails,
  isLoadingDetails,
  detailsError,
  trimmedMatchId,
  hasMatchId,
  configLocked,
  canInitialize,
  canPreview,
  showControl,
  overlayPreviewUrl,
  handleInitialize,
  handleUnlock,
  teamALogo,
  setTeamALogo,
  teamBLogo,
  setTeamBLogo,
  eventLogo,
  setEventLogo,
}) {
  const overlayOption = OVERLAY_OPTIONS.find((o) => o.value === overlayChoice);
  const showTeamLogos = Boolean(overlayOption?.hasTeamLogos);
  const showEventLogo = Boolean(overlayOption?.hasEventLogo);

  return (
    <>
      <header className="overlay-header overlay-header--minimal overlay-header--with-actions">
        <div className="overlay-header__text">
          <h1 className="overlay-header__title">Setup</h1>
        </div>
        <div className="overlay-header__actions">
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
              Lock &amp; go live
            </button>
          )}
          <a
            className={`sc-button ${showControl ? "" : "is-disabled"}`}
            href={showControl ? "#control" : undefined}
            aria-disabled={!showControl}
          >
            Control →
          </a>
        </div>
      </header>

      <section className="overlay-section">
        <div className="config-grid">

          {/* Left column: form */}
          <div className="config-form-col">
            <Field label="Overlay">
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
            </Field>

            <Field label="Match ID" action={hasMatchId ? "✓" : null}>
              <Input
                value={matchId}
                onChange={(event) => setMatchId(event.target.value)}
                placeholder="e.g. 5e2b7c94"
                disabled={configLocked}
              />
              {trimmedMatchId ? (
                isLoadingDetails ? (
                  <p className="overlay-option-note">Loading…</p>
                ) : detailsError ? (
                  <p className="overlay-data-state overlay-data-state--error">{detailsError}</p>
                ) : matchDetails ? (
                  <div className="overlay-match-summary">
                    <div className="overlay-match-summary__title">
                      {matchDetails.team_a?.name || "Team A"} vs {matchDetails.team_b?.name || "Team B"}
                    </div>
                    <div className="overlay-match-summary__meta">
                      <span>{formatDateTime(matchDetails.start_time)}</span>
                      {(matchDetails.event?.location || eventDetails?.location) ? (
                        <span>{matchDetails.event?.location || eventDetails?.location}</span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="overlay-option-note">No match found.</p>
                )
              ) : null}
            </Field>

            <Field label="Team colours">
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
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                  </Select>
                  <div
                    className="overlay-team-preview"
                    style={{ backgroundColor: teamAPalette.bg, color: teamAPalette.text }}
                  >
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
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                  </Select>
                  <div
                    className="overlay-team-preview"
                    style={{ backgroundColor: teamBPalette.bg, color: teamBPalette.text }}
                  >
                    <span className="overlay-team-preview__name">
                      {matchDetails?.team_b?.name || "Team B"}
                    </span>
                    <span className="overlay-team-preview__meta">{teamBPalette.bg}</span>
                  </div>
                </div>
              </div>
            </Field>

            {showEventLogo ? (
              <Field label="Event logo">
                <Input
                  type="file"
                  accept="image/*"
                  disabled={configLocked}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const dataUrl = await readFileAsDataUrl(file);
                    setEventLogo(dataUrl);
                  }}
                />
                {eventLogo ? (
                  <div className="overlay-logo-preview">
                    <img src={eventLogo} alt="Event logo" />
                    <button type="button" className="sc-button is-ghost" disabled={configLocked} onClick={() => setEventLogo("")}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <p className="overlay-option-note">Using default StallCount logo</p>
                )}
              </Field>
            ) : null}

            {showTeamLogos ? (
              <Field label="Team logos">
                <div className="overlay-team-toggle-grid">
                  <div className="overlay-team-toggle">
                    <span className="overlay-team-toggle__label">
                      {matchDetails?.team_a?.name || "Team A"}
                    </span>
                    <Input
                      type="file"
                      accept="image/*"
                      disabled={configLocked}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const dataUrl = await readFileAsDataUrl(file);
                        setTeamALogo(dataUrl);
                      }}
                    />
                    {teamALogo ? (
                      <div className="overlay-logo-preview">
                        <img src={teamALogo} alt="Team A logo" />
                        <button type="button" className="sc-button is-ghost" disabled={configLocked} onClick={() => setTeamALogo("")}>
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="overlay-team-toggle">
                    <span className="overlay-team-toggle__label">
                      {matchDetails?.team_b?.name || "Team B"}
                    </span>
                    <Input
                      type="file"
                      accept="image/*"
                      disabled={configLocked}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const dataUrl = await readFileAsDataUrl(file);
                        setTeamBLogo(dataUrl);
                      }}
                    />
                    {teamBLogo ? (
                      <div className="overlay-logo-preview">
                        <img src={teamBLogo} alt="Team B logo" />
                        <button type="button" className="sc-button is-ghost" disabled={configLocked} onClick={() => setTeamBLogo("")}>
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </Field>
            ) : null}
          </div>

          {/* Right column: preview */}
          <div className="config-preview-col">
            <div className="preview-stage" aria-live="polite">
              <img
                className="preview-stage__image"
                src="/overlay-demo.jpg"
                alt=""
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
                  <p className="preview-placeholder__title">
                    {hasMatchId ? "Initializing…" : "Enter a match ID"}
                  </p>
                </div>
              )}
            </div>
          </div>

        </div>
      </section>
    </>
  );
}
