"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { fireEnvelope, FIRE_CONE_HALF_ANGLE } from "../lib/dragonBout";

/* Hot-orange rather than the pink/neon-blue rotation the Round 1-3 dragon
   cycles through. That palette belongs to an arcade scene on a dark page; this
   fire is composited over a live camera feed of a real room, where anything
   but firelight colour reads as a decal stuck on the lens. */
const CORE_COLOR = new THREE.Color("#fff4d6");
const PLUME_COLOR = new THREE.Color("#ff8a2b");
const OUTER_COLOR = new THREE.Color("#ff3d17");
const LIGHT_COLOR = new THREE.Color("#ff7a26");

const EMBER_COUNT = 90;

/**
 * Builds a cone of unit length whose APEX sits at the origin pointing down +Z.
 *
 * +Z because Object3D.lookAt() aims a regular object's +Z axis at its target
 * (unlike a camera or a light, which it aims down -Z) -- so once the group is
 * pointed at the strike point, the cone already runs along the line of fire.
 *
 * Unit length matters: a cone of height 1 and base radius tan(theta) stays a
 * correct cone of half-angle theta under any UNIFORM scale, so the plume can be
 * grown and shrunk with a single scalar without ever widening away from the
 * angle the hitbox was computed from.
 */
function coneAlongZ(halfAngle, radialSegments) {
  const geometry = new THREE.ConeGeometry(Math.tan(halfAngle), 1, radialSegments, 6, true);
  geometry.translate(0, -0.5, 0);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * The dragon's breath, drawn in WebGL and anchored in world space -- not as a
 * screen overlay. The Round 1-3 dragon gets away with a fixed DOM/CSS plume
 * because its camera never moves; here the viewer physically walks around the
 * room, so the fire has to exist in the scene or it slides off the mouth.
 *
 * Geometry is shared with the damage model on purpose: the cone is drawn at
 * FIRE_CONE_HALF_ANGLE, the same constant lib/footprint.mjs cuts against the
 * floor to decide what the ring covers and what actually burns the player.
 * There is no second, decorative angle that could drift away from the real one.
 */
export default function FireBreath({ boutRef, mouthRef }) {
  const groupRef = useRef(null);
  const coreRef = useRef(null);
  const plumeRef = useRef(null);
  const outerRef = useRef(null);
  const lightRef = useRef(null);
  const embersRef = useRef(null);

  const coreGeometry = useMemo(() => coneAlongZ(FIRE_CONE_HALF_ANGLE * 0.42, 16), []);
  const plumeGeometry = useMemo(() => coneAlongZ(FIRE_CONE_HALF_ANGLE * 0.78, 24), []);
  const outerGeometry = useMemo(() => coneAlongZ(FIRE_CONE_HALF_ANGLE, 28), []);

  /* Embers live in the cone's own frame: z is progress along the jet, so a
     particle only needs its offset re-randomised when it runs off the end. */
  const embers = useMemo(() => {
    const positions = new Float32Array(EMBER_COUNT * 3);
    const seeds = new Float32Array(EMBER_COUNT * 3); // spread, angle, speed
    // Progress along the jet, 0..1, kept separate from `positions` so the
    // integration never has to divide the rendered offset back out by the
    // plume length -- which is zero on the first and last frame of a breath.
    const progress = new Float32Array(EMBER_COUNT);
    for (let i = 0; i < EMBER_COUNT; i += 1) {
      seeds[i * 3] = 0.25 + Math.random() * 0.75;
      seeds[i * 3 + 1] = Math.random() * Math.PI * 2;
      seeds[i * 3 + 2] = 0.55 + Math.random() * 0.9;
      progress[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return { geometry, positions, seeds, progress };
  }, []);

  const localMouth = useMemo(() => new THREE.Vector3(), []);
  const localAim = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    const bout = boutRef.current;
    if (!group || !bout) return;

    const now = state.clock.elapsedTime * 1000;
    const envelope = fireEnvelope(bout, now);

    group.visible = envelope > 0.001;
    if (!group.visible) {
      if (lightRef.current) lightRef.current.intensity = 0;
      return;
    }

    /* The mouth and the strike point arrive in world space; the group lives
       under whatever parent the scene mounted (in real AR that is the placed
       anchor, which can sit anywhere and at any rotation), so both have to be
       brought into the parent's frame rather than assumed to be world. */
    localMouth.copy(mouthRef.current);
    localAim.set(bout.footprint.cx, bout.aim.y, bout.footprint.cz);
    if (group.parent) {
      group.parent.worldToLocal(localMouth);
      group.parent.worldToLocal(localAim);
    }

    group.position.copy(localMouth);
    group.lookAt(localAim.x, localAim.y, localAim.z);

    const reach = localMouth.distanceTo(localAim);
    const flicker = 0.9 + Math.sin(now * 0.037) * 0.06 + Math.sin(now * 0.091) * 0.04;
    const length = reach * envelope * flicker;

    // Uniform scale keeps the drawn half-angle equal to the hitbox's.
    if (coreRef.current) {
      coreRef.current.scale.setScalar(length * 1.02);
      coreRef.current.material.opacity = 0.95 * envelope;
    }
    if (plumeRef.current) {
      plumeRef.current.scale.setScalar(length * 0.97);
      plumeRef.current.material.opacity = 0.6 * envelope;
    }
    if (outerRef.current) {
      outerRef.current.scale.setScalar(length);
      outerRef.current.material.opacity = 0.34 * envelope;
    }

    /* The mouth light is the cue that sells this as fire rather than a glowing
       cone: it throws real light back onto the dragon's own neck and chest, and
       onto anything else in the scene. */
    if (lightRef.current) {
      /* Modest on purpose. three r155+ defaults to physical light units, so
         intensity scales very differently than it used to -- an earlier
         version multiplied by the plume's reach and landed near 90, which
         parked a floodlight inside the dragon's own head and rendered the
         whole model as a flat white silhouette. It looked like a shader bug.
         Enough to light the neck and chest, not enough to clip them. */
      lightRef.current.intensity = 5.5 * envelope * flicker * THREE.MathUtils.clamp(reach * 0.18, 1, 2.2);
      lightRef.current.distance = Math.max(5, reach);
    }

    const { positions, seeds, progress } = embers;
    for (let i = 0; i < EMBER_COUNT; i += 1) {
      let z = progress[i] + delta * seeds[i * 3 + 2] * 1.5;
      if (z > 1) z -= 1;
      progress[i] = z;

      // Embers ride just inside the cone wall, so they widen as the jet does.
      const radius = Math.tan(FIRE_CONE_HALF_ANGLE) * z * seeds[i * 3] * length;
      const angle = seeds[i * 3 + 1] + now * 0.0012 * seeds[i * 3 + 2];
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius;
      positions[i * 3 + 2] = z * length;
    }
    if (embersRef.current) {
      embersRef.current.geometry.attributes.position.needsUpdate = true;
      embersRef.current.material.opacity = 0.85 * envelope;
      embersRef.current.material.size = Math.max(0.04, length * 0.02);
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh ref={outerRef} geometry={outerGeometry}>
        <meshBasicMaterial
          color={OUTER_COLOR}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={plumeRef} geometry={plumeGeometry}>
        <meshBasicMaterial
          color={PLUME_COLOR}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={coreRef} geometry={coreGeometry}>
        <meshBasicMaterial
          color={CORE_COLOR}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <points ref={embersRef} geometry={embers.geometry}>
        <pointsMaterial
          color={PLUME_COLOR}
          transparent
          opacity={0}
          size={0.06}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
      <pointLight ref={lightRef} color={LIGHT_COLOR} intensity={0} distance={12} decay={2} />
    </group>
  );
}
