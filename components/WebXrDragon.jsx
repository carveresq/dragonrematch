"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  XR,
  IfInSessionMode,
  XRDomOverlay,
  createXRStore,
  useXRHitTest,
  useXRRequestHitTest,
} from "@react-three/xr";
import * as THREE from "three";

import DragonScene from "./DragonScene";
import DragonHud from "./DragonHud";

const overlayStyles = {
  wrap: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: "8vh",
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
  },
  button: {
    pointerEvents: "auto",
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
  },
};

const hitMatrixHelper = new THREE.Matrix4();

function PlacementReticle() {
  const ref = useRef(null);

  useXRHitTest((results, getWorldMatrix) => {
    if (!ref.current || results.length === 0) {
      if (ref.current) ref.current.visible = false;
      return;
    }
    const ok = getWorldMatrix(hitMatrixHelper, results[0]);
    if (!ok) {
      ref.current.visible = false;
      return;
    }
    ref.current.visible = true;
    ref.current.position.setFromMatrixPosition(hitMatrixHelper);
  }, "viewer");

  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} visible={false}>
      <ringGeometry args={[0.12, 0.16, 32]} />
      <meshBasicMaterial color="#7cfc9a" transparent opacity={0.85} />
    </mesh>
  );
}

function PlacementController({ onSnapshot, fireRef }) {
  const [placedMatrix, setPlacedMatrix] = useState(null);
  const requestHitTest = useXRRequestHitTest();

  const handlePlace = useCallback(async () => {
    if (!requestHitTest) return;
    const hit = await requestHitTest("viewer", ["plane", "mesh"]);
    if (!hit || hit.results.length === 0) return;
    const matrix = new THREE.Matrix4();
    const ok = hit.getWorldMatrix(matrix, hit.results[0]);
    if (!ok) return;
    setPlacedMatrix(matrix);
  }, [requestHitTest]);

  return (
    <>
      {!placedMatrix && (
        <>
          <PlacementReticle />
          <IfInSessionMode allow="immersive-ar">
            <XRDomOverlay>
              <div style={overlayStyles.wrap}>
                <button type="button" style={overlayStyles.button} onClick={handlePlace}>
                  Tap to place the dragon
                </button>
              </div>
            </XRDomOverlay>
          </IfInSessionMode>
        </>
      )}
      {placedMatrix && (
        /* The anchor group is driven straight from the hit-test matrix with
           matrixAutoUpdate off, so anything set on THIS group's transform is
           overwritten every frame. The dragon's fitted scale therefore has to
           live on a group nested inside it -- DragonRig owns that group. Do
           not "simplify" by scaling here; it silently does nothing.

           groundY is 0 because inside this anchor the detected floor IS the
           local origin. DragonScene never assumes that on its own, which is
           what lets the same scene run in the camera path where it is not. */
        <group matrix={placedMatrix} matrixAutoUpdate={false}>
          <DragonScene mode="xr" groundY={0} onSnapshot={onSnapshot} fireRef={fireRef} />
        </group>
      )}
    </>
  );
}

/**
 * Real AR on Android. Aiming is a fixed centre crosshair rather than touching
 * the dragon directly: you point by turning the phone and tap to fire. That
 * avoids depending on @react-three/xr delivering a touch as a 3D pointer
 * inside an immersive session -- which could not be verified without an
 * Android device -- and a gun sight is the better feel anyway.
 *
 * The tap goes through the same fireAt(ndcX, ndcY) the camera path uses, with
 * the centre of the view (0, 0) substituted for the cursor, so there is one
 * raycast-and-damage path rather than two.
 */
export default function WebXrDragon() {
  const store = useMemo(() => createXRStore(), []);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const fireRef = useRef(null);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      await store.enterAR();
    } catch (err) {
      // e.g. camera permission denied, or no immersive-ar support after all --
      // surface it instead of leaving the user staring at a dead button.
      setStartError(
        err?.message || "Couldn't start AR. Check camera permission and try again.",
      );
    } finally {
      setStarting(false);
    }
  }, [store]);

  const handleFire = useCallback(() => {
    fireRef.current?.(0, 0);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "76vh", minHeight: 460 }}>
      <button
        type="button"
        onClick={handleStart}
        disabled={starting}
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 5,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          padding: "13px 26px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.55)",
          background: starting ? "rgba(255,255,255,0.15)" : "#111",
          color: "#fff",
          cursor: starting ? "default" : "pointer",
        }}
      >
        {starting ? "Starting…" : "Start AR"}
      </button>
      {startError && (
        <div
          style={{
            position: "absolute",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 5,
            maxWidth: "80%",
            textAlign: "center",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            letterSpacing: "0.04em",
            color: "#ff8a8a",
          }}
        >
          {startError}
        </div>
      )}
      <Canvas shadows style={{ width: "100%", height: "100%" }} camera={{ position: [0, 1.2, 2] }}>
        <XR store={store}>
          <PlacementController onSnapshot={setSnapshot} fireRef={fireRef} />
          <IfInSessionMode allow="immersive-ar">
            <XRDomOverlay>
              {/* In AR you move by walking, so no dodge pad -- but the
                  crosshair and the fire button have to be in the overlay,
                  since nothing drawn in WebGL can be tapped as UI. */}
              <DragonHud
                snapshot={snapshot}
                showDodgePad={false}
                showReticle
                onFire={handleFire}
                onReplay={() => window.location.reload()}
              />
            </XRDomOverlay>
          </IfInSessionMode>
        </XR>
      </Canvas>
    </div>
  );
}
