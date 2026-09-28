"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import DragonRig from "./DragonRig";
import FireBreath from "./FireBreath";
import GroundThreat from "./GroundThreat";
import LaserBolts from "./LaserBolts";
import {
  createBout,
  tickBout,
  tryFireLaser,
  laserDamageFor,
  damageDragon,
  boutIsOver,
  isInsideFootprint,
} from "../lib/dragonBout";
import { DRAGON_TARGET_HEIGHT_M } from "../lib/dragonScale";

/* Camera-mode framing. The dragon is 6 m, so these are chosen in metres and
   not by eye: an eye height of 1.6 m looking up at a point a third of the way
   up the body is what makes it read as towering. Distance alone does not --
   a level camera at any range just makes it look like a model on a table. */
const EYE_HEIGHT = 1.6;
const START_DISTANCE = 10;
const MIN_DISTANCE = 5.5;
const MAX_DISTANCE = 16;
const MOVE_SPEED = 4.6; // m/s
/* Aimed above the dragon's waist, not at it: the head rears well past the 6 m
   idle height during the attack clip, and a lower look-at cropped it off the
   top of the frame. */
const LOOK_AT_HEIGHT = DRAGON_TARGET_HEIGHT_M * 0.55;

/* Below and to the right of the eye, and pushed forward, so the tracer crosses
   the frame diagonally instead of receding along the exact view axis where it
   would be invisible. */
const MUZZLE_OFFSET = new THREE.Vector3(0.5, -0.42, -0.9);
const MISS_RANGE = 28;

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

/**
 * Round 4, as one scene.
 *
 * Mounted by BOTH the real-AR path (inside the placed anchor) and the
 * camera-overlay path, so it must never assume it sits at the world origin or
 * that the floor is y=0 -- in AR it hangs off a detected plane that can be
 * anywhere. Everything below works from `groundY` and from world-space
 * positions read back out of the graph.
 *
 * Deliberately free of any @react-three/xr import: the camera path runs on
 * browsers with no WebXR at all, and it should not have to load the XR library
 * to draw a dragon. WebXrDragon supplies the XR-specific pieces (the anchor
 * and the tap source) from outside.
 */
export default function DragonScene({
  mode = "camera",
  groundY = 0,
  onSnapshot,
  controlsRef,
  fireRef,
}) {
  const { camera, gl } = useThree();

  const rigRef = useRef(null);
  const boltsRef = useRef(null);
  const boutRef = useRef(null);
  const playerRef = useRef(new THREE.Vector3(0, EYE_HEIGHT, START_DISTANCE));
  const mouthRef = useRef(new THREE.Vector3(0, DRAGON_TARGET_HEIGHT_M * 0.8, 0));
  const pendingRef = useRef([]);
  const snapshotRef = useRef({ hp: -1, lives: -1, phase: "", result: null, playerInside: false });

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const scratchA = useMemo(() => new THREE.Vector3(), []);
  const scratchB = useMemo(() => new THREE.Vector3(), []);
  const playerGround = useMemo(() => new THREE.Vector3(), []);
  const dragonGround = useMemo(() => new THREE.Vector3(), []);

  if (!boutRef.current) boutRef.current = createBout(0);

  /* Development only: hang the live bout off window so the fight can be
     driven and inspected from outside without adding UI for it. Paired with
     ?nocam=1 (see WebcamDragon) this is what makes the bout checkable rather
     than merely watchable -- "the dragon renders" and "the dodge actually
     costs you a life" are different questions, and only the second one is
     worth shipping on. Stripped from production builds by the dead-code
     elimination on NODE_ENV. */
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    window.__dragonBout = boutRef.current;
  }

  /* ---- camera framing, non-AR only -------------------------------- */
  useEffect(() => {
    if (mode !== "camera") return;
    camera.position.set(0, EYE_HEIGHT, START_DISTANCE);
    camera.lookAt(0, LOOK_AT_HEIGHT, 0);
    camera.updateProjectionMatrix();
  }, [camera, mode]);

  /* ---- firing ------------------------------------------------------ */
  const fireAt = useCallback(
    (ndcX, ndcY) => {
      const bout = boutRef.current;
      const rig = rigRef.current;
      const bolts = boltsRef.current;
      if (!bout || !rig || !bolts || boutIsOver(bout)) return;

      /* One clock for the whole bout: the r3f frame clock, stamped onto the
         bout each tick. Mixing in performance.now() here would put the shot
         cooldown on a different time origin than every other deadline in
         lib/dragonBout.js. */
      const now = bout.clockNow ?? 0;
      if (!tryFireLaser(bout, now)) return;

      raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
      const target = rig.hitTarget();
      const hits = target ? raycaster.intersectObject(target, true) : [];

      scratchA.copy(MUZZLE_OFFSET);
      camera.localToWorld(scratchA);

      let hit = false;
      if (hits.length) {
        scratchB.copy(hits[0].point);
        hit = true;
      } else {
        raycaster.ray.at(MISS_RANGE, scratchB);
      }

      bolts.fire(scratchA, scratchB, hit, now);
      if (hit) {
        // Resolved on arrival rather than on the click, so the health bar
        // never drops before the bolt has visibly landed.
        pendingRef.current.push({ at: now + 170, amount: laserDamageFor(bout) });
      }
    },
    [camera, raycaster, scratchA, scratchB],
  );

  useEffect(() => {
    if (fireRef) fireRef.current = fireAt;
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      window.__dragonFire = fireAt;
    }
  }, [fireAt, fireRef]);

  /* In camera mode, aim where you click. In AR there is no cursor, so
     WebXrDragon calls fireRef with the centre of the view instead -- a
     crosshair you point by turning the phone. Same code path either way. */
  useEffect(() => {
    if (mode !== "camera") return undefined;
    const canvas = gl.domElement;
    const onPointerDown = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      fireAt(x, y);
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    return () => canvas.removeEventListener("pointerdown", onPointerDown);
  }, [gl, fireAt, mode]);

  /* ---- keyboard dodging, non-AR only ------------------------------- */
  useEffect(() => {
    if (mode !== "camera" || !controlsRef) return undefined;
    const down = (event) => {
      const k = event.key.toLowerCase();
      if (k === "a" || k === "arrowleft") controlsRef.current.x = -1;
      else if (k === "d" || k === "arrowright") controlsRef.current.x = 1;
      else if (k === "w" || k === "arrowup") controlsRef.current.z = -1;
      else if (k === "s" || k === "arrowdown") controlsRef.current.z = 1;
      else return;
      event.preventDefault();
    };
    const up = (event) => {
      const k = event.key.toLowerCase();
      if (k === "a" || k === "arrowleft" || k === "d" || k === "arrowright") controlsRef.current.x = 0;
      else if (k === "w" || k === "arrowup" || k === "s" || k === "arrowdown") controlsRef.current.z = 0;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [controlsRef, mode]);

  useFrame((state, delta) => {
    const bout = boutRef.current;
    const rig = rigRef.current;
    if (!bout || !rig) return;

    const now = state.clock.elapsedTime * 1000;
    bout.clockNow = now;

    /* ---- move the player ------------------------------------------ */
    if (mode === "camera" && controlsRef?.current) {
      const { x, z } = controlsRef.current;
      if (x || z) {
        // Strafe relative to the dragon, not to the world, so "left" always
        // means "around it" however far you have circled.
        dragonGround.set(0, groundY, 0);
        const rig3 = rig.group();
        if (rig3) rig3.getWorldPosition(dragonGround);
        dragonGround.y = groundY;

        scratchA.set(camera.position.x - dragonGround.x, 0, camera.position.z - dragonGround.z);
        const distance = scratchA.length() || 0.001;
        scratchA.divideScalar(distance);
        /* Tangent, signed so that "right" moves right ON SCREEN. The camera
           looks down its own -Z at the dragon, so its screen-right is world
           +(radial rotated -90 deg); the other sign sends ArrowRight sliding
           left, which is worse than no dodge controls at all. */
        scratchB.set(scratchA.z, 0, -scratchA.x); // tangent

        camera.position.addScaledVector(scratchB, x * MOVE_SPEED * delta);
        camera.position.addScaledVector(scratchA, z * MOVE_SPEED * delta);

        scratchA.set(camera.position.x - dragonGround.x, 0, camera.position.z - dragonGround.z);
        const next = scratchA.length() || 0.001;
        const clamped = THREE.MathUtils.clamp(next, MIN_DISTANCE, MAX_DISTANCE);
        scratchA.multiplyScalar(clamped / next);
        camera.position.set(dragonGround.x + scratchA.x, EYE_HEIGHT + groundY, dragonGround.z + scratchA.z);
        camera.lookAt(dragonGround.x, groundY + LOOK_AT_HEIGHT, dragonGround.z);
      }
    }

    camera.getWorldPosition(playerRef.current);
    playerGround.set(playerRef.current.x, groundY, playerRef.current.z);

    rig.readMouth(mouthRef.current);

    /* ---- resolve landed bolts ------------------------------------- */
    const pending = pendingRef.current;
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      if (now >= pending[i].at) {
        damageDragon(bout, pending[i].amount, now);
        pending.splice(i, 1);
      }
    }

    tickBout(bout, now, {
      mouth: mouthRef.current,
      playerGround,
      groundY,
      playAttack: () => rig.playAttack(),
    });

    /* Am I standing in it right now? Needed by the HUD, because in first
       person the danger zone is centred on your own feet and is therefore the
       hardest thing on screen to notice. */
    if (process.env.NODE_ENV !== "production") {
      bout.debugPlayer = { x: playerGround.x, z: playerGround.z };
      bout.debugControls = controlsRef?.current ? { ...controlsRef.current } : null;
      bout.debugMode = mode;
    }

    bout.playerInside =
      (bout.phase === "telegraph" || bout.phase === "breathe") &&
      isInsideFootprint(bout.footprint, playerGround);

    /* ---- lift only what the HUD actually shows -------------------- */
    const snap = snapshotRef.current;
    if (
      snap.hp !== bout.hp ||
      snap.lives !== bout.lives ||
      snap.phase !== bout.phase ||
      snap.result !== bout.result ||
      snap.playerInside !== bout.playerInside
    ) {
      snap.hp = bout.hp;
      snap.lives = bout.lives;
      snap.phase = bout.phase;
      snap.result = bout.result;
      snap.playerInside = bout.playerInside;
      onSnapshot?.({ ...snap, playerHitFlashUntil: bout.playerHitFlashUntil });
    }
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 8, 4]} intensity={1.25} />

      {/* A faint floor, camera mode only. In real AR the actual floor is
          already there and drawing a second one over it looks wrong. */}
      {mode === "camera" && (
        <gridHelper
          args={[40, 40, "#2a3340", "#141a22"]}
          position={[0, groundY + 0.002, 0]}
        />
      )}

      <Suspense fallback={<LoadingLabel />}>
        <DragonRig ref={rigRef} boutRef={boutRef} playerRef={playerRef} />
      </Suspense>

      <GroundThreat boutRef={boutRef} />
      <FireBreath boutRef={boutRef} mouthRef={mouthRef} />
      <LaserBolts ref={boltsRef} />
    </>
  );
}
