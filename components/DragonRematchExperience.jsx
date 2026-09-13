"use client";

import dynamic from "next/dynamic";
import { useArCapability } from "../lib/useArCapability";

const WebXrDragon = dynamic(() => import("./WebXrDragon"), {
  ssr: false,
  loading: () => <Placeholder text="Loading AR…" />,
});

const QuickLookDragon = dynamic(() => import("./QuickLookDragon"), {
  ssr: false,
  loading: () => <Placeholder text="Loading preview…" />,
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

export default function DragonRematchExperience() {
  const capability = useArCapability();

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
          You already beat it twice. This is the part where it comes back —
          full size, in the room you&apos;re standing in right now.
        </p>

        <p
          style={{
            marginTop: 10,
            fontSize: 13,
            lineHeight: 1.7,
            opacity: 0.65,
          }}
        >
          {capability === "webxr" &&
            "Tap Start AR, point your camera at the floor or a table, then tap where you want it. Tap the dragon once it's placed to make it attack."}
          {capability === "quicklook" &&
            "WebXR AR isn't available in this browser yet. Here's a 3D preview — tap below to drop it into your space with Apple's AR viewer."}
          {capability === "checking" && "Checking what your device can do…"}
        </p>

        <div
          style={{
            marginTop: 28,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "#000",
          }}
        >
          {capability === "webxr" && <WebXrDragon />}
          {capability === "quicklook" && <QuickLookDragon />}
          {capability === "checking" && <Placeholder text="Checking device…" />}
        </div>

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
