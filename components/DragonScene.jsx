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
/* How far ahead of you the dragon is stood when you tap Place. Far enough that
   a 6 m creature fits in the frame on a phone held at arm's length. */
const PLACE_DISTANCE = 9;
/* How long to wait for the first device-orientation event before concluding
   there will never be one and placing the dragon automatically.
   Without this the scene auto-places on frame 1 -- which beats the first
   orientation event to the punch on every phone, so the dragon is dropped at
   a spot nobody chose and the Place button never appears at all. Events start
   arriving within ~100ms when the sensor is live, so this is generous. */
const TILT_GRACE_MS = 900;

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
  orientationRef,
  placeRef,
  onPlacedChange,
}) {
  const { camera, gl } = useThree();

  const rigRef = useRef(null);
  const boltsRef = useRef(null);
  const boutRef = useRef(null);
  const playerRef = useRef(new THREE.Vector3(0, EYE_HEIGHT, START_DISTANCE));
  const mouthRef = useRef(new THREE.Vector3(0, DRAGON_TARGET_HEIGHT_M * 0.8, 0));
  const pendingRef = useRef([]);
  const snapshotRef = useRef({ hp: -1, lives: -1, phase: "", result: null, playerInside: false });
  const anchorRef = useRef(null);
  /* Where the dragon stands. On a phone this is chosen by tapping Place, and
     from then on the dragon is a fixed point in the room rather than
     something glued to the middle of the lens. With no device orientation
     available (a desktop) there is nothing to anchor against and no way to
     look away from it, so it places itself immediately and the fight starts. */
  const placedRef = useRef(false);
  const graceStartRef = useRef(0);

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

  /* Drop the dragon on the floor in whatever direction you are facing, at a
     fixed distance. Deliberately NOT a hit test: a plain camera feed has no
     depth, so there is no surface to test against -- the floor is assumed to
     be at groundY and the dragon is stood on it ahead of you. The real
     hit-tested version is the WebXR path. */
  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || placedRef.current) return;

    scratchA.set(0, 0, -1).applyQuaternion(camera.quaternion);
    scratchA.y = 0;
    if (scratchA.lengthSq() < 1e-6) scratchA.set(0, 0, -1);
    scratchA.normalize();

    anchor.position.set(
      camera.position.x + scratchA.x * PLACE_DISTANCE,
      groundY,
      camera.position.z + scratchA.z * PLACE_DISTANCE,
    );
    placedRef.current = true;
    onPlacedChange?.(true);
  }, [camera, groundY, onPlacedChange, scratchA]);

  useEffect(() => {
    if (placeRef) placeRef.current = place;
  }, [place, placeRef]);

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

    /* ---- the phone is the camera ---------------------------------- *
       When real device orientation is coming in, it owns where the camera is
       pointed. That is the whole difference between a dragon standing in your
       room and a dragon stuck to your lens: turn away and it should be behind
       you, which cannot happen while a lookAt drags it back to centre. */
    const oriented = mode === "camera" && orientationRef?.current?.active === true;
    if (oriented) camera.quaternion.copy(orientationRef.current.quaternion);

    /* Desktop has no orientation to wait for, so it places itself and plays
       straight away -- same fight, just framed for a mouse. A phone must NOT
       fall through here, so give the sensor a moment to speak up first. */
    if (mode === "camera" && !placedRef.current && !oriented) {
      if (!graceStartRef.current) graceStartRef.current = now;
      if (now - graceStartRef.current > TILT_GRACE_MS) place();
    }

    /* Report state BEFORE the pre-placement bail-out. Writing it after meant
       nothing could observe the scene during placement -- which is exactly
       the window where the placement bug lived. */
    if (process.env.NODE_ENV !== "production") {
      camera.getWorldPosition(playerRef.current);
      bout.debugPlayer = { x: playerRef.current.x, z: playerRef.current.z };
      bout.debugPlaced = placedRef.current;
      bout.debugOriented = oriented;
      bout.debugMode = mode;
      bout.debugControls = controlsRef?.current ? { ...controlsRef.current } : null;
      if (anchorRef.current) {
        anchorRef.current.getWorldPosition(scratchB);
        bout.debugDragon = { x: scratchB.x, y: scratchB.y, z: scratchB.z };
      }
      // Where the camera looks, flattened -- lets a check tell "the dragon
      // moved" apart from "I turned away from it".
      scratchB.set(0, 0, -1).applyQuaternion(camera.quaternion);
      bout.debugFacing = { x: scratchB.x, z: scratchB.z };
    }

    /* Nothing happens until the dragon has somewhere to stand. */
    if (mode === "camera" && !placedRef.current) {
      camera.getWorldPosition(playerRef.current);
      return;
    }

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
        // Only steer the view when the phone is not already doing it.
        if (!oriented) camera.lookAt(dragonGround.x, groundY + LOOK_AT_HEIGHT, dragonGround.z);
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

      <group ref={anchorRef}>
        <Suspense fallback={<LoadingLabel />}>
          <DragonRig ref={rigRef} boutRef={boutRef} playerRef={playerRef} />
        </Suspense>
      </group>

      <GroundThreat boutRef={boutRef} />
      <FireBreath boutRef={boutRef} mouthRef={mouthRef} />
      <LaserBolts ref={boltsRef} />
    </>
  );
}
