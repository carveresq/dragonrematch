"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Turns the phone into the camera, so the dragon stays where it was put.
 *
 * Without this the camera-overlay path pins the dragon dead-centre with a
 * lookAt every frame -- which means it is not standing in your room at all,
 * it is stuck to your lens. Turning the phone moved the whole world with it.
 * Feeding real device orientation in is what makes "it is over there" true.
 *
 * WHAT THIS CANNOT DO: orientation is rotation only. A plain camera feed gives
 * no positional tracking, so walking toward the dragon does not close the
 * distance -- only WebXR (the Android path) knows where the phone actually is
 * in the room. Integrating DeviceMotion acceleration to fake it drifts into
 * nonsense within seconds and is not worth shipping. Translation stays on the
 * dodge pad; rotation is real.
 *
 * iOS 13+ gates the events behind a permission call that MUST happen inside a
 * user gesture, which is why this exposes request() rather than just asking on
 * mount.
 */

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
// -90 degrees about X: device frame (screen up is +Y) -> three's camera frame
// (looking down -Z).
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

const DEG = Math.PI / 180;

export function deviceQuaternion(out, alphaDeg, betaDeg, gammaDeg, screenDeg) {
  euler.set(betaDeg * DEG, alphaDeg * DEG, -gammaDeg * DEG, "YXZ");
  out.setFromEuler(euler);
  out.multiply(q1);
  out.multiply(q0.setFromAxisAngle(zee, -screenDeg * DEG));
  return out;
}

export function useDeviceOrientation() {
  // "unsupported" | "idle" | "granted" | "denied"
  const [status, setStatus] = useState("idle");
  const ref = useRef({ active: false, quaternion: new THREE.Quaternion() });

  const supported = useMemo(
    () => typeof window !== "undefined" && typeof window.DeviceOrientationEvent !== "undefined",
    [],
  );

  useEffect(() => { if (!supported) setStatus("unsupported"); }, [supported]);

  const request = useCallback(async () => {
    if (!supported) return false;
    const DOE = window.DeviceOrientationEvent;
    try {
      if (typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") { setStatus("denied"); return false; }
      }
    } catch {
      setStatus("denied");
      return false;
    }
    setStatus("granted");
    return true;
  }, [supported]);

  useEffect(() => {
    if (status !== "granted") return undefined;

    const onOrientation = (event) => {
      if (event.alpha == null && event.beta == null && event.gamma == null) return;
      const screenDeg = window.screen?.orientation?.angle ?? window.orientation ?? 0;
      deviceQuaternion(
        ref.current.quaternion,
        event.alpha || 0,
        event.beta || 0,
        event.gamma || 0,
        screenDeg,
      );
      // Only trust it once real values have arrived -- a desktop browser can
      // fire the event with all-null fields forever.
      ref.current.active = true;
    };

    window.addEventListener("deviceorientation", onOrientation, true);
    return () => window.removeEventListener("deviceorientation", onOrientation, true);
  }, [status]);

  return { status, supported, orientationRef: ref, request };
}
