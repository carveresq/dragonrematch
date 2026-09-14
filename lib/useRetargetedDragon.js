"use client";

import { useEffect, useMemo } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { retargetClipByName } from "./retargetClip";

export const DRAGON_IDLE_URL = "/models/dragon_idle.glb";
export const DRAGON_ATTACK_URL = "/models/dragon_attack.glb";
export const DRAGON_BASE_URL = "/models/dragon.glb";

useGLTF.preload(DRAGON_BASE_URL);
useGLTF.preload(DRAGON_IDLE_URL);
useGLTF.preload(DRAGON_ATTACK_URL);

/**
 * Loads the base dragon mesh+skeleton and retargets the idle/attack clips
 * (baked against their own standalone armatures in separate GLBs) onto it by
 * bone name. See lib/retargetClip.js for why this is safe here: verified
 * offline that bone names and rest-pose rotations already match within
 * floating-point noise across all three files, so this is a defensive
 * name-matching pass rather than a coordinate-system fix.
 *
 * Deliberately kept free of any @react-three/xr import -- both the WebXR
 * path (components/WebXrDragon.jsx) and the plain-webcam path
 * (components/WebcamDragon.jsx) need this loader, but the webcam path runs
 * on browsers that don't support WebXR at all, so it shouldn't have to pull
 * in the XR library just to reuse the animation-retargeting logic.
 */
export function useRetargetedDragon() {
  const base = useGLTF(DRAGON_BASE_URL);
  const idleGltf = useGLTF(DRAGON_IDLE_URL);
  const attackGltf = useGLTF(DRAGON_ATTACK_URL);

  const scene = useMemo(() => base.scene, [base.scene]);

  const clips = useMemo(() => {
    const idle = idleGltf.animations[0]
      ? retargetClipByName(idleGltf.animations[0], scene, { clipName: "idle" })
      : null;
    const attack = attackGltf.animations[0]
      ? retargetClipByName(attackGltf.animations[0], scene, {
          clipName: "attack",
        })
      : null;
    return [idle, attack].filter(Boolean);
  }, [idleGltf.animations, attackGltf.animations, scene]);

  useEffect(() => {
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.material?.map) {
        obj.material.map.colorSpace = THREE.SRGBColorSpace;
        obj.material.map.needsUpdate = true;
      }
    });
  }, [scene]);

  const { actions } = useAnimations(clips, scene);
  return { scene, actions };
}
