"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useRetargetedDragon } from "../lib/useRetargetedDragon";

function LoadingLabel() {
  return (
    <Html center>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.6)",
          whiteSpace: "nowrap",
        }}
      >
        Loading dragon…
      </div>
    </Html>
  );
}

// Laptops/desktops get neither real WebXR immersive-ar (no headset) nor
// Apple AR Quick Look (not iOS) -- see lib/useArCapability.js. Rather than
// leave them with no camera-based experience at all, this composites the
// same dragon model (reused via lib/useRetargetedDragon.js, shared with
// WebXrDragon.jsx, idle/attack animations included) over the device's own
// webcam feed via a
// transparent <Canvas>. There's no depth/surface tracking here (a plain
// webcam has no way to do that) -- it's a camera-passthrough-plus-3D-overlay
// experience, not true markerless AR, but it's a real, working camera-based
// dragon instead of a static orbit-only preview.
//
// Framing is computed from the model's actual bounding box on load rather
// than a hand-picked camera position -- the WebXR path's dragon gets scaled
// by AR hit-test placement, but here there's no such reference, and a fixed
// distance either clipped the model or shrank it to a speck depending on
// viewport size during testing.
function AutoFramedDragon() {
  const { scene, actions } = useRetargetedDragon();
  const { camera } = useThree();
  const attackingRef = useRef(false);
  const framedRef = useRef(false);

  useEffect(() => {
    const idleAction = actions.idle;
    if (!idleAction) return;
    idleAction.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play();
  }, [actions]);

  useEffect(() => {
    if (framedRef.current) return;
    const box = new THREE.Box3().setFromObject(scene);
    if (box.isEmpty()) return;
    framedRef.current = true;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fovRadians = ((camera.fov || 50) * Math.PI) / 180;
    const distance = (maxDim / 2 / Math.tan(fovRadians / 2)) * 1.5;
    camera.position.set(center.x, center.y, center.z + distance);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }, [scene, camera]);

  const handleTapDragon = useCallback(
    (event) => {
      event.stopPropagation();
      const attackAction = actions.attack;
      const idleAction = actions.idle;
      if (!attackAction || attackingRef.current) return;
      attackingRef.current = true;

      attackAction.reset();
      attackAction.setLoop(THREE.LoopOnce, 1);
      attackAction.clampWhenFinished = true;
      if (idleAction) {
        attackAction.crossFadeFrom(idleAction, 0.15, false);
      }
      attackAction.play();

      const mixer = attackAction.getMixer();
      const onFinished = (finishedEvent) => {
        if (finishedEvent.action !== attackAction) return;
        mixer.removeEventListener("finished", onFinished);
        attackingRef.current = false;
        if (idleAction) {
          idleAction.reset().play();
          attackAction.crossFadeTo(idleAction, 0.3, false);
        }
      };
      mixer.addEventListener("finished", onFinished);
    },
    [actions],
  );

  return <primitive object={scene} onClick={handleTapDragon} />;
}

function cameraErrorMessage(err) {
  if (err?.name === "NotAllowedError") {
    return "Camera permission was denied — allow it in your browser's address bar and try again.";
  }
  if (err?.name === "NotFoundError") {
    return "No camera was found on this device.";
  }
  if (err?.name === "NotReadableError") {
    return "The camera is already in use by another app.";
  }
  return err?.message || "Couldn't access the camera.";
}

export default function WebcamDragon() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | starting | active | error
  const [errorMsg, setErrorMsg] = useState("");

  const handleEnable = useCallback(async () => {
    setStatus("starting");
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
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
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "70vh",
        minHeight: 420,
        overflow: "hidden",
        background: "#000",
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
          transform: "scaleX(-1)",
          display: status === "active" ? "block" : "none",
        }}
      />

      {status === "active" && (
        <Canvas
          style={{ position: "absolute", inset: 0 }}
          camera={{ position: [0, 0, 5], fov: 50 }}
          gl={{ alpha: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <ambientLight intensity={0.65} />
          <directionalLight position={[2, 4, 2]} intensity={1.3} />
          <Suspense fallback={<LoadingLabel />}>
            <AutoFramedDragon />
          </Suspense>
        </Canvas>
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
              maxWidth: 360,
              lineHeight: 1.6,
            }}
          >
            This browser can&apos;t do phone-style AR, but the dragon can still
            appear over your webcam. Grant camera access to continue.
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
