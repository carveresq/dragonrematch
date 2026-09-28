"use client";

import { useEffect, useState } from "react";

/**
 * What kind of Round 4 can this device actually run?
 *
 *   { mode: "checking" | "webxr" | "camera", quickLook: boolean }
 *
 * WebXR is capability-detected, not UA-sniffed: as of Sep 2026 Safari/iOS has
 * no `immersive-ar` session support at all while Chrome/Android does, and
 * navigator.xr?.isSessionSupported('immersive-ar') is the correct way to ask,
 * degrading safely on any browser with no navigator.xr at all.
 *
 * WHAT CHANGED THIS ROUND, AND WHY
 *
 * iPhones and iPads used to be routed into Apple's AR Quick Look viewer as
 * their primary experience. They are now routed to "camera" like everything
 * else, and Quick Look is offered alongside as a secondary button.
 *
 * The reason is a hard limit, not a preference: Quick Look is a system viewer.
 * A web page can hand it a USDZ and that is the end of the page's involvement
 * -- it cannot add the fire, the lasers, the ground telegraph, the health bar,
 * or the dodge. Leaving iOS on Quick Look would have meant the one round
 * that is actually a fight was unreachable on the device most visitors open
 * the link on. iOS Safari has supported getUserMedia over HTTPS since iOS 11,
 * and the site is HTTPS, so the interactive scene runs there fine.
 *
 * Quick Look is still genuinely better at one thing -- real, tracked,
 * room-scale placement -- so it stays, as "view it in your space".
 */
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
  const [capability, setCapability] = useState({ mode: "checking", quickLook: false });

  useEffect(() => {
    let cancelled = false;
    const quickLook = isAppleQuickLookDevice();

    async function detect() {
      if (typeof navigator === "undefined" || !navigator.xr) {
        if (!cancelled) setCapability({ mode: "camera", quickLook });
        return;
      }
      try {
        const supported = await navigator.xr.isSessionSupported("immersive-ar");
        if (!cancelled) setCapability({ mode: supported ? "webxr" : "camera", quickLook });
      } catch {
        if (!cancelled) setCapability({ mode: "camera", quickLook });
      }
    }

    detect();
    return () => { cancelled = true; };
  }, []);

  return capability;
}
