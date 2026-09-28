"use client";

import { useImperativeHandle, useMemo, useRef, forwardRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const POOL_SIZE = 14;
const TRAVEL_MS = 170;
const IMPACT_MS = 260;

/* Long, because of where it is fired from. In first person the bolt travels
   almost directly away from the eye, so it is seen end-on and foreshortened to
   nearly nothing -- a short bolt is invisible no matter how bright it is. A
   tracer several metres long still reads as a streak at that angle. */
const BOLT_LENGTH = 2.6;
const BOLT_RADIUS = 0.04;

const HIT_COLOR = new THREE.Color("#8ef6ff");
const MISS_COLOR = new THREE.Color("#6fa8ff");

/**
 * The player's shots.
 *
 * A fixed pool advanced in one useFrame, with every bolt's state in a plain
 * array rather than React state -- fourteen objects moving at 60fps is not
 * something to re-render the scene tree for.
 *
 * Geometry note: the bolt is a cylinder, and CylinderGeometry runs along Y, so
 * it is rotated onto Z once at build time. That lets each bolt be aimed with a
 * single quaternion lookAt down its travel direction instead of a per-frame
 * Euler solve.
 */
const LaserBolts = forwardRef(function LaserBolts(_props, ref) {
  const boltsRef = useRef(null);
  const impactsRef = useRef(null);

  const boltGeometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(BOLT_RADIUS, BOLT_RADIUS * 0.28, BOLT_LENGTH, 8, 1, true);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  const impactGeometry = useMemo(() => new THREE.SphereGeometry(1, 12, 12), []);

  const state = useMemo(
    () =>
      Array.from({ length: POOL_SIZE }, () => ({
        active: false,
        hit: false,
        firedAt: 0,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
      })),
    [],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);

  useImperativeHandle(ref, () => ({
    /** from/to are WORLD space; the meshes live under the scene's own parent. */
    fire(from, to, hit, now) {
      const slot = state.find((s) => !s.active) ?? state[0];
      slot.active = true;
      slot.hit = hit;
      slot.firedAt = now;
      slot.from.copy(from);
      slot.to.copy(to);
    },
  }));

  useFrame((frameState) => {
    const bolts = boltsRef.current;
    const impacts = impactsRef.current;
    if (!bolts || !impacts) return;

    const now = frameState.clock.elapsedTime * 1000;
    const parent = bolts.parent;

    for (let i = 0; i < POOL_SIZE; i += 1) {
      const slot = state[i];

      if (!slot.active) {
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        bolts.setMatrixAt(i, dummy.matrix);
        impacts.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const age = now - slot.firedAt;
      if (age > TRAVEL_MS + IMPACT_MS) {
        slot.active = false;
        continue;
      }

      if (age <= TRAVEL_MS) {
        const t = age / TRAVEL_MS;
        scratch.copy(slot.from).lerp(slot.to, t);
        if (parent) parent.worldToLocal(scratch);
        dummy.position.copy(scratch);
        dummy.lookAt(
          parent ? parent.worldToLocal(scratch.copy(slot.to)) : slot.to,
        );
        dummy.scale.set(1, 1, 1 + (1 - t) * 0.6);
        dummy.updateMatrix();
        bolts.setMatrixAt(i, dummy.matrix);

        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        impacts.setMatrixAt(i, dummy.matrix);
      } else {
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        bolts.setMatrixAt(i, dummy.matrix);

        const t = (age - TRAVEL_MS) / IMPACT_MS;
        scratch.copy(slot.to);
        if (parent) parent.worldToLocal(scratch);
        dummy.position.copy(scratch);
        dummy.quaternion.identity();
        // A miss sparks small; a hit blooms.
        const peak = slot.hit ? 0.34 : 0.12;
        dummy.scale.setScalar(peak * Math.sin(Math.min(1, t) * Math.PI));
        dummy.updateMatrix();
        impacts.setMatrixAt(i, dummy.matrix);
      }
    }

    bolts.instanceMatrix.needsUpdate = true;
    impacts.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={boltsRef} args={[boltGeometry, undefined, POOL_SIZE]} frustumCulled={false}>
        <meshBasicMaterial
          color={HIT_COLOR}
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh ref={impactsRef} args={[impactGeometry, undefined, POOL_SIZE]} frustumCulled={false}>
        <meshBasicMaterial
          color={MISS_COLOR}
          transparent
          opacity={0.8}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
});

export default LaserBolts;
