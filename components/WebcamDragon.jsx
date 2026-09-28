"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";

import DragonScene from "./DragonScene";
import DragonHud from "./DragonHud";
import { useDeviceOrientation } from "../lib/useDeviceOrientation";

// Laptops and desktops get neither real WebXR immersive-ar (no headset) nor
// Apple AR Quick Look (not iOS) -- and as of this round, iPhones and iPads are
// routed here too rather than into Quick Look. See lib/useArCapability.js for
// why: Quick Look is Apple's own system viewer, so a page can put a model in
// it but cannot put fire, lasers, a health bar or a dodge mechanic in it. The
// interactive fight has to live somewhere the page still controls the frame,
// which means a <Canvas> composited over the device's own camera feed.
//
// There is no depth or surface tracking here -- a plain camera feed has no way
// to do that -- so this is camera-passthrough-plus-3D-overlay rather than true
// markerless AR. What it is not is a static preview: the dragon is the same
// 6 m creature, on the same timings, with the same fight as the AR path.
//
// Framing is NOT auto-fitted to the model's bounding box any more. It used to
// be, and that quietly defeated the whole point of this round: fitting the
// camera to the model normalises the dragon's size away, so making it bigger
// changed nothing on screen. The scene now works in metres (see DragonScene),
// and the camera sits at a fixed 1.6 m eye height looking slightly up.

/* Hoisted to module scope, and carrying NO position.
 *
 * react-three-fiber re-applies the `camera` prop whenever its identity
 * changes, and an object literal written inline in JSX is a new identity on
 * every single render. DragonScene moves this camera every frame (that is how
 * you dodge), so an inline literal fights it: the player advances exactly one
 * frame's worth, gets snapped back to the prop's position, and the dodge
 * silently does not work. That was measured -- 0.06 m of travel at 4.6 m/s is
 * one frame at 75 Hz, repeating forever.
 *
 * Position is deliberately omitted rather than merely frozen, so there is one
 * owner of where the camera is: DragonScene. Lens settings stay here.
 */
const CAMERA = { fov: 55, near: 0.1, far: 200 };
const GL = { alpha: true, antialias: true };

function cameraErrorMessage(err) {
  if (err?.name === "NotAllowedError") {
    return "Camera permission was denied — allow it in your browser's address bar and try again.";
  }
  if (err?.name === "NotFoundError") return "No camera was found on this device.";
  if (err?.name === "NotReadableError") return "The camera is already in use by another app.";
  return err?.message || "Couldn't access the camera.";
}

export default function WebcamDragon() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const controlsRef = useRef({ x: 0, z: 0 });
  const [status, setStatus] = useState("idle"); // idle | starting | active | error
  const [errorMsg, setErrorMsg] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [runId, setRunId] = useState(0);
  const [placed, setPlaced] = useState(false);
  const placeRef = useRef(null);
  const { status: tiltStatus, orientationRef, request: requestTilt } = useDeviceOrientation();

  /* ?nocam=1 mounts the fight over a flat backdrop with no getUserMedia call.
     It exists so the scene can be driven and screenshotted without a camera
     permission prompt in the way -- automated checks stall on that dialog, and
     "the dragon renders" and "the fight actually works" are different
     questions. Harmless in production: it only skips the camera. */
  const noCam = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("nocam") === "1";
  }, []);

  useEffect(() => {
    if (!noCam) return;
    // nocam stands in for the Enable Camera press, so it has to ask for tilt
    // too -- otherwise the debug path silently exercises the desktop
    // behaviour and the phone behaviour goes unchecked.
    requestTilt();
    setStatus("active");
  }, [noCam, requestTilt]);

  const handleEnable = useCallback(async () => {
    setStatus("starting");
    setErrorMsg("");
    try {
      /* Asked here, inside the button press, because iOS 13+ only honours
         DeviceOrientationEvent.requestPermission() from a user gesture -- ask
         a tick later and it rejects. Failing is fine: without tilt the scene
         places itself and plays with the dodge pad, it just cannot be looked
         away from. */
      await requestTilt();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("active");
    } catch (err) {
      setErrorMsg(cameraErrorMessage(err));
      setStatus("error");
    }
  }, [requestTilt]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const handleReplay = useCallback(() => {
    setSnapshot(null);
    setPlaced(false);
    setRunId((n) => n + 1);
  }, []);

  const handlePlace = useCallback(() => { placeRef.current?.(); }, []);

  // Only phones reach this: with no tilt the scene places itself.
  const awaitingPlacement = tiltStatus === "granted" && !placed;

  const hitFlash = snapshot?.playerHitFlashUntil ?? 0;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "76vh",
        minHeight: 460,
        overflow: "hidden",
        background: "#05070a",
        touchAction: "none",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: status === "active" && !noCam ? "block" : "none",
        }}
      />

      {status === "active" && (
        <>
          <Canvas
            key={runId}
            style={{ position: "absolute", inset: 0 }}
            camera={CAMERA}
            gl={GL}
            onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          >
            <DragonScene
              mode="camera"
              groundY={0}
              controlsRef={controlsRef}
              onSnapshot={setSnapshot}
              orientationRef={orientationRef}
              placeRef={placeRef}
              onPlacedChange={setPlaced}
            />
          </Canvas>

          {!awaitingPlacement && (
            <DragonHud
              snapshot={snapshot}
              controlsRef={controlsRef}
              showDodgePad
              onReplay={handleReplay}
            />
          )}

          {/* Placement. Point the phone where you want it to stand and tap --
              from then on the dragon holds that spot in the room and you turn
              to find it, rather than it following the middle of the screen. */}
          {awaitingPlacement && (
            <div
              style={{
                position: "absolute", inset: 0, display: "flex",
                flexDirection: "column", alignItems: "center", justifyContent: "flex-end",
                gap: 14, paddingBottom: 38, pointerEvents: "none",
              }}
            >
              <div
                style={{
                  position: "absolute", top: "50%", left: "50%",
                  width: 120, height: 120, marginLeft: -60, marginTop: -60,
                  borderRadius: "50%", border: "1px solid rgba(124,252,154,0.85)",
                  boxShadow: "0 0 24px rgba(124,252,154,0.35)",
                }}
              />
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: "rgba(255,255,255,0.8)", textAlign: "center",
                  textShadow: "0 1px 6px rgba(0,0,0,0.9)",
                }}
              >
                Point at the floor where it should stand
              </div>
              <button
                type="button"
                onClick={handlePlace}
                style={{
                  pointerEvents: "auto",
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  padding: "14px 28px", borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.6)",
                  background: "rgba(10,10,10,0.8)", color: "#fff", cursor: "pointer",
                }}
              >
                Place the dragon
              </button>
            </div>
          )}

          {/* A hit is easy to miss when you are looking at the dragon rather
              than at the bar -- so the whole frame takes the hit too. */}
          <div
            /* Namespaced: the sibling <Canvas> is keyed on runId, and both
               start at 0, which React reads as a duplicate key among the
               fragment's children. */
            key={`hit-${hitFlash}`}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              boxShadow: "inset 0 0 120px 20px rgba(255,60,30,0.75)",
              opacity: 0,
              animation: hitFlash ? "cesq-player-hit 450ms ease-out" : "none",
            }}
          />
          <style>{`@keyframes cesq-player-hit { 0% { opacity: 1 } 100% { opacity: 0 } }`}</style>
        </>
      )}

      {status !== "active" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 24,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              letterSpacing: "0.04em",
              color: "rgba(255,255,255,0.78)",
              maxWidth: 380,
              lineHeight: 1.6,
            }}
          >
            Round 4 happens over your camera. Grant access, then dodge the fire
            on the floor and shoot back.
          </p>
          <button
            type="button"
            onClick={handleEnable}
            disabled={status === "starting"}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "13px 26px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.55)",
              background: status === "starting" ? "rgba(255,255,255,0.15)" : "#111",
              color: "#fff",
              cursor: status === "starting" ? "default" : "pointer",
            }}
          >
            {status === "starting" ? "Starting…" : "Enable Camera"}
          </button>
          {status === "error" && (
            <div
              style={{
                maxWidth: "80%",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                letterSpacing: "0.04em",
                color: "#ff8a8a",
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
