"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { telegraphProgress } from "../lib/dragonBout";

const WARN_COLOR = new THREE.Color("#ff5a2b");
const IMMINENT_COLOR = new THREE.Color("#ffd24a");

/**
 * The strike zone, drawn on the floor.
 *
 * This is the whole reason the bout is winnable without ever firing a shot: it
 * tells you where the breath is about to land while there is still time to
 * step out of it.
 *
 * It reads its shape straight off bout.footprint -- the same ellipse
 * lib/footprint.mjs cut from the breath cone and the same one
 * isInsideFootprint() tests against. There is no separate "display radius" that
 * could drift from the damage, which matters more here than it looks: the real
 * footprint is an ellipse noticeably longer than it is wide, and it is centred
 * BEYOND where the dragon is aiming, because the far edge of a tilted cone
 * gains more ground than the near edge loses. Drawing the honest shape is what
 * makes "step toward the dragon" a genuinely better dodge than "back away",
 * which is the one tactic the fight has to teach.
 */
export default function GroundThreat({ boutRef }) {
  const groupRef = useRef(null);
  const fillRef = useRef(null);
  const ringRef = useRef(null);
  const incomingRef = useRef(null);
  const wallRef = useRef(null);
  const brimRef = useRef(null);

  /* Unit shapes in the XY plane, laid flat and then scaled to (b, a): local X
     becomes cross-range, local Y becomes down-range once rotated onto the
     floor. */
  const ringGeometry = useMemo(() => new THREE.RingGeometry(0.88, 1, 96), []);
  const fillGeometry = useMemo(() => new THREE.CircleGeometry(1, 96), []);

  /* Open-ended unit cylinder, y in 0..1, so scaling by (b, height, a) extrudes
     the SAME ellipse upward -- the wall cannot drift from the floor shape
     because it is the floor shape. */
  const wallGeometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
    g.translate(0, 0.5, 0);
    return g;
  }, []);

  useFrame((state) => {
    const group = groupRef.current;
    const bout = boutRef.current;
    if (!group || !bout) return;

    const now = state.clock.elapsedTime * 1000;
    const telegraphing = bout.phase === "telegraph";
    const breathing = bout.phase === "breathe";

    group.visible = telegraphing || breathing;
    if (!group.visible) return;

    const fp = bout.footprint;

    group.position.set(fp.cx, bout.aim.y + 0.015, fp.cz);
    group.rotation.y = fp.yaw;

    const progress = telegraphing ? telegraphProgress(bout, now) : 1;
    const pulse = 0.55 + 0.45 * Math.sin(now * (0.006 + progress * 0.02));

    for (const ref of [fillRef, ringRef, incomingRef]) {
      if (ref.current) ref.current.scale.set(fp.b, fp.a, 1);
    }

    /* The cylinder is upright, so its x/z take the ellipse axes and its y is
       height -- note the axis order differs from the flat meshes above, which
       are laid down by a -90 degree rotation about X. */
    const height = breathing ? 2.4 : 0.5 + progress * 1.9;
    if (wallRef.current) {
      /* Kept faint. Standing inside the ellipse you look through BOTH faces of
         the cylinder, additively, so an opacity that looks right from outside
         becomes an orange curtain over the whole lower half of the screen from
         within -- and the dragon you are supposed to be watching disappears
         behind it. The wall's job is only to say "there is a boundary here";
         the brim below is what makes it legible. */
      wallRef.current.scale.set(fp.b, height, fp.a);
      wallRef.current.material.opacity = (breathing ? 0.16 : 0.05 + progress * 0.1) * pulse;
      wallRef.current.material.color.copy(progress > 0.75 || breathing ? IMMINENT_COLOR : WARN_COLOR);
    }

    /* A bright rim riding the top of the wall. This is the part you actually
       read from inside: a horizontal line of light at roughly eye level,
       crossing your view while you are looking straight ahead at the dragon,
       telling you exactly where the edge is and which way is out. */
    if (brimRef.current) {
      brimRef.current.scale.set(fp.b, fp.a, 1);
      brimRef.current.position.y = height;
      brimRef.current.material.opacity = breathing ? 0.85 : 0.3 + progress * 0.6;
      brimRef.current.material.color.copy(progress > 0.75 || breathing ? IMMINENT_COLOR : WARN_COLOR);
    }

    if (fillRef.current) {
      fillRef.current.material.opacity = breathing ? 0.34 : 0.1 + progress * 0.22 * pulse;
      fillRef.current.material.color.copy(progress > 0.75 || breathing ? IMMINENT_COLOR : WARN_COLOR);
    }
    if (ringRef.current) {
      ringRef.current.material.opacity = breathing ? 0.9 : 0.45 + progress * 0.5;
      ringRef.current.material.color.copy(progress > 0.75 || breathing ? IMMINENT_COLOR : WARN_COLOR);
    }

    /* A second ring collapsing onto the first is the readable part: a static
       outline says "something is here", a closing one says "and it lands
       now". */
    if (incomingRef.current) {
      const closing = 1 + (1 - progress) * 1.7;
      incomingRef.current.scale.set(fp.b * closing, fp.a * closing, 1);
      incomingRef.current.material.opacity = telegraphing ? 0.5 * (1 - progress) + 0.12 : 0;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh ref={fillRef} geometry={fillGeometry} rotation-x={-Math.PI / 2}>
        <meshBasicMaterial
          color={WARN_COLOR}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={ringRef} geometry={ringGeometry} rotation-x={-Math.PI / 2} position-y={0.004}>
        <meshBasicMaterial
          color={WARN_COLOR}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={wallRef} geometry={wallGeometry}>
        <meshBasicMaterial
          color={WARN_COLOR}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={brimRef} geometry={ringGeometry} rotation-x={-Math.PI / 2}>
        <meshBasicMaterial
          color={WARN_COLOR}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={incomingRef} geometry={ringGeometry} rotation-x={-Math.PI / 2} position-y={0.008}>
        <meshBasicMaterial
          color={IMMINENT_COLOR}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
