"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { telegraphProgress } from "../lib/dragonBout";

const SAFE_COLOR = new THREE.Color("#7cfc9a");
const MAX_ZONES = 8;   // a sweep is 8 aim samples
const MAX_MARKERS = 3;

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
  const zonesRef = useRef([]);
  const markersRef = useRef([]);

  const ringGeometry = useMemo(() => new THREE.RingGeometry(0.88, 1, 96), []);
  const fillGeometry = useMemo(() => new THREE.CircleGeometry(1, 96), []);
  /* Open-ended unit cylinder, y in 0..1, so scaling by (b, height, a) extrudes
     the SAME ellipse upward -- the wall cannot drift from the floor shape
     because it is the floor shape. */
  const wallGeometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  const markerRing = useMemo(() => new THREE.RingGeometry(0.62, 0.8, 40), []);
  const markerPost = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.06, 0.06, 1, 10, 1, true);
    g.translate(0, 0.5, 0);
    return g;
  }, []);

  useFrame((state) => {
    const bout = boutRef.current;
    if (!bout) return;

    const now = state.clock.elapsedTime * 1000;
    const telegraphing = bout.phase === "telegraph";
    const breathing = bout.phase === "breathe";
    const live = telegraphing || breathing;

    const footprints = bout.footprints || [];
    const progress = telegraphing ? telegraphProgress(bout, now) : 1;
    const pulse = 0.55 + 0.45 * Math.sin(now * (0.006 + progress * 0.02));
    const imminent = progress > 0.75 || breathing;
    const height = breathing ? 2.4 : 0.5 + progress * 1.9;

    /* Eight overlapping sweep zones add up, and additively: at full per-zone
       opacity the brims weave into a solid curtain across eye level and the
       dragon disappears behind its own telegraph. Divide the vertical cues by
       the zone count so a sweep reads as one band of roughly the brightness a
       single zone would have. The FLOOR marks are left alone -- overlap there
       is informative, it shows where the arc is densest. */
    const stack = Math.max(1, footprints.length);
    const vertical = 1 / Math.sqrt(stack);

    for (let i = 0; i < MAX_ZONES; i += 1) {
      const zone = zonesRef.current[i];
      if (!zone?.group) continue;
      const fp = live ? footprints[i] : null;
      zone.group.visible = Boolean(fp);
      if (!fp) continue;

      zone.group.position.set(fp.cx, bout.aim.y + 0.015, fp.cz);
      zone.group.rotation.y = fp.yaw;

      zone.fill.scale.set(fp.b, fp.a, 1);
      zone.ring.scale.set(fp.b, fp.a, 1);
      zone.brim.scale.set(fp.b, fp.a, 1);
      zone.brim.position.y = height;
      zone.wall.scale.set(fp.b, height, fp.a);

      const color = imminent ? IMMINENT_COLOR : WARN_COLOR;
      zone.fill.material.color.copy(color);
      zone.ring.material.color.copy(color);
      zone.brim.material.color.copy(color);
      zone.wall.material.color.copy(color);

      zone.fill.material.opacity = (breathing ? 0.3 : 0.09 + progress * 0.2 * pulse) * (stack > 3 ? 0.6 : 1);
      zone.ring.material.opacity = breathing ? 0.85 : 0.42 + progress * 0.48;
      zone.brim.material.opacity = (breathing ? 0.8 : 0.28 + progress * 0.55) * vertical;
      zone.wall.material.opacity = (breathing ? 0.14 : 0.045 + progress * 0.09) * pulse * vertical;

      /* A second ring collapsing onto the first is the readable part: a static
         outline says "something is here", a closing one says "and it lands
         now". Only on the first zone -- eight of them closing at once is
         noise, not information. */
      if (zone.incoming) {
        const show = telegraphing && i === 0;
        zone.incoming.visible = show;
        if (show) {
          const closing = 1 + (1 - progress) * 1.7;
          zone.incoming.scale.set(fp.b * closing, fp.a * closing, 1);
          zone.incoming.material.opacity = 0.45 * (1 - progress) + 0.12;
        }
      }
    }

    /* Escape markers. Only during the wind-up -- once the fire is out they are
       telling you about a decision you have already made. Each carries a post
       for the same reason the danger zones do: a flat decal on the floor is
       invisible when you are looking ahead at the dragon. */
    const points = telegraphing ? bout.safePoints || [] : [];
    for (let i = 0; i < MAX_MARKERS; i += 1) {
      const marker = markersRef.current[i];
      if (!marker?.group) continue;
      const sp = points[i];
      marker.group.visible = Boolean(sp);
      if (!sp) continue;
      marker.group.position.set(sp.x, bout.aim.y + 0.02, sp.z);
      const bob = 0.85 + 0.15 * Math.sin(now * 0.005 + i);
      marker.ring.scale.setScalar(bob);
      marker.ring.material.opacity = 0.5 + 0.4 * progress;
      marker.post.scale.set(1, 1.5 + progress * 0.6, 1);
      marker.post.material.opacity = 0.3 + 0.35 * progress;
    }
  });

  const zoneLayer = (i) => (
    <group key={`zone-${i}`} ref={(g) => { zonesRef.current[i] = { ...(zonesRef.current[i] || {}), group: g }; }} visible={false}>
      <mesh ref={(m) => { if (zonesRef.current[i]) zonesRef.current[i].fill = m; }} geometry={fillGeometry} rotation-x={-Math.PI / 2}>
        <meshBasicMaterial color={WARN_COLOR} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={(m) => { if (zonesRef.current[i]) zonesRef.current[i].ring = m; }} geometry={ringGeometry} rotation-x={-Math.PI / 2} position-y={0.004}>
        <meshBasicMaterial color={WARN_COLOR} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={(m) => { if (zonesRef.current[i]) zonesRef.current[i].wall = m; }} geometry={wallGeometry}>
        <meshBasicMaterial color={WARN_COLOR} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={(m) => { if (zonesRef.current[i]) zonesRef.current[i].brim = m; }} geometry={ringGeometry} rotation-x={-Math.PI / 2}>
        <meshBasicMaterial color={WARN_COLOR} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      {i === 0 && (
        <mesh ref={(m) => { if (zonesRef.current[i]) zonesRef.current[i].incoming = m; }} geometry={ringGeometry} rotation-x={-Math.PI / 2} position-y={0.008}>
          <meshBasicMaterial color={IMMINENT_COLOR} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );

  const markerLayer = (i) => (
    <group key={`safe-${i}`} ref={(g) => { markersRef.current[i] = { ...(markersRef.current[i] || {}), group: g }; }} visible={false}>
      <mesh ref={(m) => { if (markersRef.current[i]) markersRef.current[i].ring = m; }} geometry={markerRing} rotation-x={-Math.PI / 2}>
        <meshBasicMaterial color={SAFE_COLOR} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={(m) => { if (markersRef.current[i]) markersRef.current[i].post = m; }} geometry={markerPost}>
        <meshBasicMaterial color={SAFE_COLOR} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );

  return (
    <group>
      {Array.from({ length: MAX_ZONES }, (_, i) => zoneLayer(i))}
      {Array.from({ length: MAX_MARKERS }, (_, i) => markerLayer(i))}
    </group>
  );
}
