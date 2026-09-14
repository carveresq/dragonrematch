"use client";

import { useEffect, useState } from "react";

// "checking" | "webxr" | "quicklook" | "webcam"
//
// Deliberately capability-detected, not UA-sniffed for the webxr check: as of
// Sep 2026, Safari/iOS has no `immersive-ar` WebXR session support at all,
// while Chrome/Android does. navigator.xr?.isSessionSupported('immersive-ar')
// is the correct way to ask "can this browser actually do it," and degrades
// safely on any browser that doesn't expose navigator.xr in the first place.
//
// Quick Look genuinely does need a device check (there's no feature-detection
// API for "can launch AR Quick Look") -- it's an iOS/iPadOS-only system
// viewer, so anything else that falls through here (a real laptop with a
// plain webcam: macOS/Windows/Linux Chrome/Firefox/Safari) gets the
// "webcam" capability instead of being funneled into a Quick Look button
// that would never do anything on that device.
function isAppleQuickLookDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports its platform as "MacIntel" like a real Mac, but
    // exposes multi-touch where an actual Mac trackpad/mouse reports 0-1.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function useArCapability() {
  const [capability, setCapability] = useState("checking");

  useEffect(() => {
    let cancelled = false;

    function fallback() {
      return isAppleQuickLookDevice() ? "quicklook" : "webcam";
    }

    async function detect() {
      if (typeof navigator === "undefined" || !navigator.xr) {
        if (!cancelled) setCapability(fallback());
        return;
      }
      try {
        const supported = await navigator.xr.isSessionSupported("immersive-ar");
        if (!cancelled) setCapability(supported ? "webxr" : fallback());
      } catch {
        if (!cancelled) setCapability(fallback());
      }
    }

    detect();
    return () => {
      cancelled = true;
    };
  }, []);

  return capability;
}
