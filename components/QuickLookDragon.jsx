"use client";

// Registers the <model-viewer> custom element. This file is only ever loaded
// client-side (see DragonRematchExperience's next/dynamic ssr:false import),
// so the side-effecting custom element registration never runs in a Node/SSR
// context.
import "@google/model-viewer";

/**
 * Apple AR Quick Look, demoted this round from "the iOS experience" to a
 * secondary button beside it.
 *
 * Quick Look is a system viewer: it renders a USDZ in the user's real room
 * with proper tracking, which is the one thing it does better than anything
 * the page can draw itself -- and it is also the end of the page's control.
 * No fire, no lasers, no ground telegraph, no health bar can be added to it,
 * because none of that is the page's to add. So the fight lives in
 * WebcamDragon and this stays for what it is good at.
 *
 * Note the dragon here is whatever size the USDZ was authored at, NOT the 6 m
 * the interactive scene stands it at: ar-scale="fixed" honours the asset's own
 * units, and re-exporting dragon.usdz at real-world scale is an asset job
 * rather than a code one. It is the one place in the exhibit where the size
 * work does not reach.
 */
export default function QuickLookDragon({ compact = false }) {
  return (
    <div style={{ width: "100%" }}>
      <model-viewer
        src="/models/dragon.glb"
        ios-src="/models/dragon.usdz"
        alt="Dragon Rematch — Round 4 dragon, 3D preview"
        ar
        ar-modes="quick-look"
        ar-scale="fixed"
        camera-controls
        auto-rotate
        shadow-intensity="1"
        exposure="1"
        style={{
          width: "100%",
          height: compact ? "34vh" : "56vh",
          minHeight: compact ? 220 : 360,
          background: "transparent",
          "--poster-color": "transparent",
        }}
      >
        <button
          slot="ar-button"
          type="button"
          style={{
            position: "absolute",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "14px 24px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.55)",
            background: "rgba(10,10,10,0.78)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          View in your space
        </button>
      </model-viewer>
    </div>
  );
}
