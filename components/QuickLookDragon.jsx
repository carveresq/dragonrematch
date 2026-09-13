"use client";

// Registers the <model-viewer> custom element. This file is only ever loaded
// client-side (see DragonRematchExperience's next/dynamic ssr:false import),
// so the side-effecting custom element registration never runs in a Node/SSR
// context.
import "@google/model-viewer";

export default function QuickLookDragon() {
  return (
    <div style={{ width: "100%" }}>
      {/* @google/model-viewer: first-class ar-scale + ios-src (USDZ) + ar-modes
          support for launching Apple AR Quick Look directly -- WebXR immersive-ar
          isn't available in Safari/iOS as of Sep 2026, so this is the fallback
          path rather than a second attempt at the same @react-three/xr flow. */}
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
          height: "56vh",
          minHeight: 360,
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
