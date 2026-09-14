"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useRetargetedDragon } from "../lib/useRetargetedDragon";

export function Dragon() {
  const { scene, actions } = useRetargetedDragon();
  const attackingRef = useRef(false);

  useEffect(() => {
    const idleAction = actions.idle;
    if (!idleAction) return;
    idleAction.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play();
  }, [actions]);

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

  // No fallback path currently triggers: if either animation clip failed to
  // retarget, `actions.idle`/`actions.attack` are simply undefined, and the
  // dragon renders in its authored rest (T/bind) pose instead of erroring --
  // that's the documented worst-case MVP fallback (static pose, no motion).
  return <primitive object={scene} onClick={handleTapDragon} />;
}

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

function PlacementController() {
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
        <group matrix={placedMatrix} matrixAutoUpdate={false}>
          <Dragon />
        </group>
      )}
    </>
  );
}

export default function WebXrDragon() {
  const store = useMemo(() => createXRStore(), []);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

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

  return (
    <div style={{ position: "relative", width: "100%", height: "70vh", minHeight: 420 }}>
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
          <ambientLight intensity={0.65} />
          <directionalLight position={[2, 4, 2]} intensity={1.3} castShadow />
          <PlacementController />
        </XR>
      </Canvas>
    </div>
  );
}
