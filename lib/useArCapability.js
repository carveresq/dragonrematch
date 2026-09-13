"use client";

import { useEffect, useState } from "react";

// "checking" | "webxr" | "quicklook"
//
// Deliberately capability-detected, not UA-sniffed: as of Sep 2026, Safari/iOS
// has no `immersive-ar` WebXR session support at all, while Chrome/Android does.
// navigator.xr?.isSessionSupported('immersive-ar') is the correct way to ask
// "can this browser actually do it," and degrades safely on any browser that
// doesn't expose navigator.xr in the first place.
export function useArCapability() {
  const [capability, setCapability] = useState("checking");

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (typeof navigator === "undefined" || !navigator.xr) {
        if (!cancelled) setCapability("quicklook");
        return;
      }
      try {
        const supported = await navigator.xr.isSessionSupported("immersive-ar");
        if (!cancelled) setCapability(supported ? "webxr" : "quicklook");
      } catch {
        if (!cancelled) setCapability("quicklook");
      }
    }

    detect();
    return () => {
      cancelled = true;
    };
  }, []);

  return capability;
}
