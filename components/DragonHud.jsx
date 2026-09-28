"use client";

import { useCallback } from "react";

import { DRAGON_MAX_HP, PLAYER_LIVES } from "../lib/dragonBout";

const mono = "'IBM Plex Mono', monospace";

const PHASE_LABEL = {
  intro: "It has seen you",
  stalk: "Circling",
  telegraph: "Move — it has your position",
  breathe: "Fire",
  winded: "Winded — hit it now",
  won: "",
  lost: "",
};

/* Named so the tell is learnable. "It is aiming ahead of you" is the only
   warning that a straight run walks into the fire, and no amount of watching
   the floor conveys it in time. */
const KIND_LABEL = {
  spot: "Aimed at you",
  lead: "Aiming ahead of you — change direction",
  wide: "Wide burn — leave the area",
  multi: "Three bursts — find the gap",
  sweep: "Sweeping — outrun it",
};

function Bar({ label, value, max, color, trackColor }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.75, minWidth: 54 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 6, background: trackColor, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 160ms linear" }} />
      </div>
    </div>
  );
}

/**
 * Health, lives, and -- on touch -- the only way to dodge.
 *
 * The dodge pad is not a nicety. iOS now gets the interactive scene rather
 * than Apple's Quick Look viewer, and a phone has no keyboard, so without
 * these buttons the entire dodge mechanic (and with it one of the two ways to
 * win) would be unreachable on the device most people will open this on.
 *
 * Plain DOM rather than drei's <Html>: this same markup is mounted inside an
 * XRDomOverlay on the AR path, where a WebGL-space overlay would be drawn into
 * the scene instead of onto the headset/phone display.
 */
export default function DragonHud({
  snapshot,
  controlsRef,
  showDodgePad = true,
  showReticle = false,
  onReplay,
  onFire,
}) {
  const hp = snapshot?.hp ?? DRAGON_MAX_HP;
  const lives = snapshot?.lives ?? PLAYER_LIVES;
  const phase = snapshot?.phase ?? "intro";
  const result = snapshot?.result ?? null;
  /* Standing in the strike zone. In first person this is genuinely hard to
     see -- the zone is centred on your own feet while you are looking at the
     dragon -- so it gets the loudest treatment in the HUD rather than relying
     on the player noticing the floor. */
  const inside = Boolean(snapshot?.playerInside) && !result;
  const score = snapshot?.score ?? 0;
  const kind = snapshot?.kind ?? null;
  const nearestSafe = snapshot?.nearestSafe;

  const press = useCallback(
    (axis, value) => (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (controlsRef?.current) controlsRef.current[axis] = value;
    },
    [controlsRef],
  );

  const release = useCallback(
    (axis) => (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (controlsRef?.current) controlsRef.current[axis] = 0;
    },
    [controlsRef],
  );

  const padButton = (glyph, axis, value, title) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onPointerDown={press(axis, value)}
      onPointerUp={release(axis)}
      onPointerLeave={release(axis)}
      onPointerCancel={release(axis)}
      style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.35)",
        background: "rgba(8,10,14,0.66)",
        color: "#fff",
        fontSize: 18,
        lineHeight: 1,
        cursor: "pointer",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      {glyph}
    </button>
  );

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }}>
      {/* Status */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          right: 14,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "12px 14px",
          borderRadius: 12,
          background: "linear-gradient(180deg, rgba(6,8,12,0.78), rgba(6,8,12,0.42))",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <Bar label="Dragon" value={hp} max={DRAGON_MAX_HP} color="linear-gradient(90deg,#ff6a2b,#ffd24a)" trackColor="rgba(255,255,255,0.14)" />
        <Bar label="You" value={lives} max={PLAYER_LIVES} color="linear-gradient(90deg,#4ad6ff,#8ef6ff)" trackColor="rgba(255,255,255,0.14)" />
        {!result && (
          <div
            style={{
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              opacity: inside || phase === "telegraph" || phase === "winded" ? 1 : 0.55,
              color: inside ? "#ff4d2b" : phase === "telegraph" ? "#ffd24a" : phase === "winded" ? "#8ef6ff" : "#fff",
            }}
          >
            {inside
              ? "Step out — you're in it"
              : phase === "telegraph" && kind && KIND_LABEL[kind]
                ? KIND_LABEL[kind]
                : PHASE_LABEL[phase] ?? ""}
          </div>
        )}

        {/* Live distance to the nearest marked escape, and the running score.
            The distance is the useful number: it updates as you move, so you
            can tell whether you are going to make it. */}
        {!result && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.7 }}>
            <span style={{ color: phase === "telegraph" ? "#7cfc9a" : "inherit" }}>
              {phase === "telegraph" && typeof nearestSafe === "number"
                ? `Safe in ${nearestSafe.toFixed(1)} m`
                : "\u00a0"}
            </span>
            <span>{score > 0 ? `${score} pts` : "\u00a0"}</span>
          </div>
        )}
      </div>

      {/* Edge glow while you are standing in the strike zone. */}
      {inside && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            boxShadow: "inset 0 0 90px 8px rgba(255,77,43,0.55)",
            animation: "cesq-danger-pulse 620ms ease-in-out infinite",
          }}
        />
      )}
      <style>{"@keyframes cesq-danger-pulse{0%,100%{opacity:.45}50%{opacity:1}}"}</style>

      {showReticle && !result && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 36,
            height: 36,
            marginLeft: -18,
            marginTop: -18,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.7)",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.4) inset",
          }}
        >
          <div style={{ position: "absolute", top: "50%", left: "50%", width: 3, height: 3, marginLeft: -1.5, marginTop: -1.5, background: "#fff", borderRadius: "50%" }} />
        </div>
      )}

      {/* Dodge pad */}
      {showDodgePad && !result && (
        <div
          style={{
            position: "absolute",
            left: 14,
            bottom: 18,
            display: "grid",
            gridTemplateColumns: "repeat(3, 48px)",
            gridTemplateRows: "repeat(2, 48px)",
            gap: 6,
            pointerEvents: "auto",
          }}
        >
          {/* Labelled by what they do on screen, not "circle the dragon":
              under device orientation these move you relative to where you
              are LOOKING, and you may not be looking at the dragon at all. */}
          <div />
          {padButton("↑", "z", -1, "Move forward")}
          <div />
          {padButton("←", "x", -1, "Step left")}
          {padButton("↓", "z", 1, "Move back")}
          {padButton("→", "x", 1, "Step right")}
        </div>
      )}

      {onFire && !result && (
        <button
          type="button"
          onClick={onFire}
          style={{
            position: "absolute",
            right: 18,
            bottom: 34,
            pointerEvents: "auto",
            width: 78,
            height: 78,
            borderRadius: "50%",
            border: "1px solid rgba(142,246,255,0.7)",
            background: "rgba(8,24,32,0.7)",
            color: "#8ef6ff",
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer",
            touchAction: "none",
          }}
        >
          Fire
        </button>
      )}

      {result && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            background: "rgba(4,6,10,0.66)",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: result === "won" ? "#ffd24a" : "#ff8a8a",
            }}
          >
            Round 4
          </div>
          <div style={{ fontSize: 26, letterSpacing: "0.02em", textAlign: "center", padding: "0 24px" }}>
            {result === "won" ? "You finished it." : "It finished you."}
          </div>
          <div style={{ fontFamily: mono, fontSize: 12, opacity: 0.6, textAlign: "center", maxWidth: 320, lineHeight: 1.6, padding: "0 24px" }}>
            {result === "won"
              ? `Four rounds, and the last one in your own room.${score > 0 ? ` ${score} points for the running.` : ""}`
              : `Two hits was all it needed. Follow the green markers — they only appear where you can actually get to.${score > 0 ? ` ${score} points.` : ""}`}
          </div>
          <button
            type="button"
            onClick={onReplay}
            style={{
              marginTop: 6,
              fontFamily: mono,
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "13px 26px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.55)",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Again
          </button>
        </div>
      )}
    </div>
  );
}
