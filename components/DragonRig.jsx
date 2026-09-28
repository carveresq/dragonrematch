"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { useRetargetedDragon } from "../lib/useRetargetedDragon";
import {
  DRAGON_TARGET_HEIGHT_M,
  fitScaleToHeight,
  findMouthBones,
  measurePosedBounds,
  readMouthFrame,
} from "../lib/dragonScale";

/* The scale solve runs once the idle clip is actually driving the skeleton.
   It cannot run on mount: dragon.glb's bones carry no rest pose of their own
   (every node in the base file omits translation/rotation/scale, while the
   two animation files carry a full pose), so before the mixer has applied a
   frame the skeleton is still collapsed at the origin and any measurement
   taken there describes a shape nobody will ever see. */
const MEASURE_AT_FRAME = 6;
const CONFIRM_AT_FRAME = 40;

const TURN_RATE = 2.4; // radians/sec, how fast it swings to face you
const DEFEAT_FALL_MS = 1600;

const _mouth = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _playerLocal = new THREE.Vector3();
const _worldPos = new THREE.Vector3();

/**
 * The dragon itself: loads it, stands it at a real-world height, turns it to
 * face the player, and owns the single copy of the idle/attack state machine.
 *
 * Both WebXrDragon and WebcamDragon previously carried their own near-identical
 * copy of that clip logic. It lives here now and they mount DragonScene
 * instead.
 *
 * Exposes an imperative handle rather than props-down state because everything
 * it drives is per-frame: the parent reads the mouth position and the dragon's
 * bounds every tick, and pushing that through React state would re-render the
 * scene 60 times a second.
 */
const DragonRig = forwardRef(function DragonRig(
  { boutRef, playerRef, onMeasured, targetHeight = DRAGON_TARGET_HEIGHT_M },
  ref,
) {
  const { scene, actions } = useRetargetedDragon();

  const wrapperRef = useRef(null); // carries the fitted scale + facing yaw
  const offsetRef = useRef(null); // drops the feet onto the floor
  const attackingRef = useRef(false);
  const framesRef = useRef(0);
  const scaleRef = useRef(1);
  const modelHeadingRef = useRef(0);
  const measuredRef = useRef(false);
  const defeatStartRef = useRef(0);

  const bones = useMemo(() => findMouthBones(scene), [scene]);

  const skinnedMeshes = useMemo(() => {
    const list = [];
    scene.traverse((obj) => { if (obj.isSkinnedMesh) list.push(obj); });
    return list;
  }, [scene]);

  /* Materials are cloned so the hit flash can drive emissive without the
     change leaking into any other mount of this cached GLTF scene. */
  const materials = useMemo(() => {
    const list = [];
    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const cloned = Array.isArray(obj.material)
        ? obj.material.map((m) => m.clone())
        : obj.material.clone();
      obj.material = cloned;
      for (const m of Array.isArray(cloned) ? cloned : [cloned]) {
        m.transparent = true;
        list.push({ material: m, baseEmissive: m.emissive?.clone() ?? new THREE.Color(0, 0, 0) });
      }
    });
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      window.__dragonMats = () =>
        list.map(({ material: m, baseEmissive }) => ({
          type: m.type,
          color: m.color?.getHexString(),
          emissive: m.emissive?.getHexString(),
          baseEmissive: baseEmissive.getHexString(),
          emissiveIntensity: m.emissiveIntensity,
          hasMap: !!m.map,
          opacity: m.opacity,
        }));
    }
    return list;
  }, [scene]);

  useEffect(() => {
    if (bones.missing.length) {
      console.warn(
        "[DragonRig] mouth bones missing from the rig, fire will fall back to the body centre:",
        bones.missing.join(", "),
      );
    } else {
      console.info("[DragonRig] mouth anchored to", Object.entries(bones)
        .filter(([k]) => k !== "missing")
        .map(([k, b]) => `${k}=${b.name}`)
        .join(", "));
    }
  }, [bones]);

  useEffect(() => {
    const idle = actions.idle;
    if (!idle) {
      console.warn("[DragonRig] no idle action - the skeleton will stay in its collapsed bind pose");
      return undefined;
    }
    idle.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play();
    return () => { idle.fadeOut(0.2); };
  }, [actions]);

  const playAttack = () => {
    const attack = actions.attack;
    const idle = actions.idle;
    if (!attack || attackingRef.current) return;
    attackingRef.current = true;

    attack.reset();
    attack.setLoop(THREE.LoopOnce, 1);
    attack.clampWhenFinished = true;
    if (idle) attack.crossFadeFrom(idle, 0.15, false);
    attack.play();

    const mixer = attack.getMixer();
    const onFinished = (event) => {
      if (event.action !== attack) return;
      mixer.removeEventListener("finished", onFinished);
      attackingRef.current = false;
      if (idle) {
        idle.reset().play();
        attack.crossFadeTo(idle, 0.3, false);
      }
    };
    mixer.addEventListener("finished", onFinished);
  };

  useImperativeHandle(ref, () => ({
    group: () => wrapperRef.current,
    hitTarget: () => scene,
    playAttack,
    /** World-space mouth position, read fresh from the live skeleton. */
    readMouth(out) {
      if (readMouthFrame(bones, _mouth, _forward)) {
        out.copy(_mouth);
        return true;
      }
      if (wrapperRef.current) {
        wrapperRef.current.getWorldPosition(out);
        out.y += targetHeight * 0.75;
        return true;
      }
      return false;
    },
    scale: () => scaleRef.current,
  }));

  useFrame((state, delta) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    framesRef.current += 1;
    const frame = framesRef.current;
    const bout = boutRef?.current;
    const now = state.clock.elapsedTime * 1000;

    /* ---- stand it at a real-world height ---------------------------- */
    if (!measuredRef.current && frame >= MEASURE_AT_FRAME) {
      const fit = fitScaleToHeight(scene, targetHeight, scaleRef.current);
      if (fit) {
        measuredRef.current = true;
        scaleRef.current = fit.scale;
        wrapper.scale.setScalar(fit.scale);
        wrapper.updateMatrixWorld(true);

        // Drop the feet onto the floor: re-measure at the new scale and shift
        // the inner group up by however far the lowest vertex sits below it.
        const posed = measurePosedBounds(scene);
        if (!posed.empty && offsetRef.current) {
          wrapper.getWorldPosition(_worldPos);
          offsetRef.current.position.y -= (posed.box.min.y - _worldPos.y) / fit.scale;
        }

        // Which way does the model face? Solved once, from the rig itself,
        // rather than assuming an export axis convention: take the neck ->
        // mouth direction and express it in the wrapper's own frame.
        if (readMouthFrame(bones, _mouth, _forward)) {
          wrapper.getWorldQuaternion(_quat).invert();
          _forward.applyQuaternion(_quat);
          modelHeadingRef.current = Math.atan2(_forward.x, _forward.z);
        }

        console.info(
          `[DragonRig] measured ${fit.measuredHeight.toFixed(3)} units over ${fit.vertices} posed vertices ` +
          `-> scale ${fit.scale.toFixed(3)} for a ${targetHeight} m dragon ` +
          `(model heading ${(modelHeadingRef.current * 180 / Math.PI).toFixed(1)} deg)`,
        );
        onMeasured?.({ scale: fit.scale, measuredHeight: fit.measuredHeight, vertices: fit.vertices });
      }
    }

    /* Confirm, out loud, that the dragon really is the height we asked for.
       A scale solve that silently missed looks exactly like one that worked. */
    if (measuredRef.current && frame === CONFIRM_AT_FRAME) {
      const posed = measurePosedBounds(scene);
      if (!posed.empty) {
        const size = new THREE.Vector3();
        posed.box.getSize(size);
        console.info(
          `[DragonRig] standing height ${size.y.toFixed(2)} m (target ${targetHeight} m), ` +
          `wingspan ${size.x.toFixed(2)} m, feet at y=${posed.box.min.y.toFixed(3)}`,
        );
      }
    }

    /* ---- face the player -------------------------------------------- */
    if (bout && playerRef?.current && wrapper.parent &&
        (bout.phase === "stalk" || bout.phase === "intro" || bout.phase === "winded")) {
      _playerLocal.copy(playerRef.current);
      wrapper.parent.worldToLocal(_playerLocal);
      const desired = Math.atan2(
        _playerLocal.x - wrapper.position.x,
        _playerLocal.z - wrapper.position.z,
      ) - modelHeadingRef.current;

      let diff = desired - wrapper.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      wrapper.rotation.y += THREE.MathUtils.clamp(diff, -TURN_RATE * delta, TURN_RATE * delta);
    }

    /* ---- keep the hit volume honest --------------------------------- *

       three's SkinnedMesh.raycast early-outs against a bounding sphere it
       computes ONCE and then caches on the mesh. The triangle test that
       follows is skin-aware, but that cached sphere is not: it describes
       whatever pose the skeleton happened to be in the first time anything
       raycast the dragon.

       On this rig that is actively wrong. dragon.glb's bones carry no rest
       pose, so before the idle clip binds the skeleton is collapsed at the
       origin -- and a sphere cached from that pose rejects almost every ray
       that should have hit. The symptom is the nastiest kind: shooting the
       dragon works or silently does nothing depending on how the first few
       frames happened to be timed, with no error anywhere. It was caught by
       firing at a fixed screen position and watching the health bar not move.

       Dropping the cache each frame is O(1); the recompute only happens on
       the frames something actually raycasts, and this mesh is 1490 vertices.
       ------------------------------------------------------------------- */
    for (const mesh of skinnedMeshes) {
      mesh.boundingSphere = null;
      mesh.boundingBox = null;
    }

    /* ---- hit flash and defeat --------------------------------------- */
    const flashing = bout ? now < bout.hitFlashUntil : false;
    const winded = bout?.phase === "winded";

    let fallT = 0;
    if (bout?.phase === "won") {
      if (!defeatStartRef.current) defeatStartRef.current = now;
      fallT = THREE.MathUtils.clamp((now - defeatStartRef.current) / DEFEAT_FALL_MS, 0, 1);
      const ease = 1 - (1 - fallT) * (1 - fallT);
      wrapper.rotation.z = ease * 1.15;
      wrapper.position.y = -ease * targetHeight * 0.22;
    }

    for (const entry of materials) {
      const m = entry.material;
      if (!m.emissive) continue;
      /* Restrained on purpose. A full-strength emissive flash is added on top
         of an already-lit textured surface, so (1, 0.55, 0.3) at 1.4 intensity
         saturated every channel and turned the dragon into a flat cream
         silhouette with no form at all -- it read as a rendering fault rather
         than as a hit. This is bright enough to see land and dim enough to
         keep the model. */
      if (flashing) m.emissive.setRGB(0.5, 0.17, 0.05);
      else if (winded) m.emissive.copy(entry.baseEmissive).lerp(new THREE.Color(0.32, 0.08, 0.015), 0.5);
      else m.emissive.copy(entry.baseEmissive);
      m.emissiveIntensity = flashing ? 1 : winded ? 0.5 : 1;
      m.opacity = 1 - fallT * 0.72;
    }
  });

  return (
    <group ref={wrapperRef}>
      <group ref={offsetRef}>
        <primitive object={scene} />
      </group>
    </group>
  );
});

export default DragonRig;
