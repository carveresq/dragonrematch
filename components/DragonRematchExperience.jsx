"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { useArCapability } from "../lib/useArCapability";

const WebXrDragon = dynamic(() => import("./WebXrDragon"), {
  ssr: false,
  loading: () => <Placeholder text="Loading AR…" />,
});

const QuickLookDragon = dynamic(() => import("./QuickLookDragon"), {
  ssr: false,
  loading: () => <Placeholder text="Loading preview…" />,
});

const WebcamDragon = dynamic(() => import("./WebcamDragon"), {
  ssr: false,
  loading: () => <Placeholder text="Loading camera…" />,
});

function Placeholder({ text }) {
  return (
    <div
      style={{
        width: "100%",
        minHeight: 360,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        opacity: 0.5,
      }}
    >
      {text}
    </div>
  );
}

const HOW = {
  webxr:
    "Tap Start AR, point your camera at the floor, then tap to place it. Keep the crosshair on the dragon and tap Fire — and when a ring lights up on the floor, walk out of it.",
  camera:
    "Dodge the ring on the floor before it breathes, and click the dragon to fire back. Arrow keys or WASD to move; on a phone, use the pad in the corner.",
  checking: "Checking what your device can do…",
};

export default function DragonRematchExperience() {
  const { mode, quickLook } = useArCapability();
  const [showQuickLook, setShowQuickLook] = useState(false);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#f2f2f2",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 20px 64px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 640 }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            opacity: 0.6,
          }}
        >
          Round 4 — the rematch
        </div>

        <p style={{ marginTop: 14, fontSize: 15, lineHeight: 1.7 }}>
          You already beat it twice. This is the part where it comes back — six
          metres of it, in the room you&apos;re standing in right now, and this
          time it breathes.
        </p>

        <p style={{ marginTop: 10, fontSize: 13, lineHeight: 1.7, opacity: 0.65 }}>
          {HOW[mode] ?? HOW.checking}
        </p>

        <div
          style={{
            marginTop: 28,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "#000",
          }}
        >
          {mode === "webxr" && <WebXrDragon />}
          {mode === "camera" && <WebcamDragon />}
          {mode === "checking" && <Placeholder text="Checking device…" />}
        </div>

        {/* Quick Look is the one thing the interactive scene can't do: real,
            tracked, room-scale placement. It just can't host the fight, so it
            sits beside it rather than instead of it. */}
        {quickLook && mode !== "checking" && (
          <div style={{ marginTop: 18 }}>
            {!showQuickLook ? (
              <button
                type="button"
                onClick={() => setShowQuickLook(true)}
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  padding: "11px 20px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.3)",
                  background: "transparent",
                  color: "rgba(255,255,255,0.75)",
                  cursor: "pointer",
                }}
              >
                Or just view it in your space
              </button>
            ) : (
              <>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    opacity: 0.45,
                    marginBottom: 8,
                  }}
                >
                  Apple AR — placement only, no fight
                </div>
                <QuickLookDragon compact />
              </>
            )}
          </div>
        )}

        <div
          style={{
            marginTop: 24,
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.35,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          Dragon Rematch — carveresq.com
        </div>
      </div>
    </main>
  );
}
