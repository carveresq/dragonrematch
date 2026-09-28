import * as THREE from "three";

/**
 * How tall the dragon stands, in metres. "A nice-size tree" -- tall enough to
 * read as towering over a person in a real room, short enough that you can
 * still see all of it from a normal viewing distance indoors.
 *
 * This is a TARGET, not a scale factor: fitScaleToHeight measures the model
 * and solves for the multiplier. dragon.glb happens to be authored ~1.1 units
 * tall, but nothing here depends on that -- re-export the asset at any scale
 * and the dragon still stands 6 m.
 */
export const DRAGON_TARGET_HEIGHT_M = 6;

/**
 * Measures the dragon's real height, in world units, accounting for skinning.
 *
 * Box3.setFromObject() is NOT good enough here, and the reason is specific to
 * this asset: dragon.glb's bones carry no local TRS at all (verified against
 * the glTF: every node in the base file omits translation/rotation/scale,
 * while dragon_idle.glb and dragon_attack.glb carry a full rest pose on every
 * bone). So the base file's bind pose and its *animated* pose are different
 * shapes, and Box3 -- which only transforms a mesh's static geometry bounds by
 * its world matrix, ignoring bones entirely -- would measure the former while
 * the viewer sees the latter.
 *
 * getVertexPosition() on a SkinnedMesh applies the live bone transforms, so
 * this walks the actual posed vertices. The mesh is 1490 vertices, so a full
 * exact sweep costs nothing and there is no reason to sample a subset.
 *
 * Call this only after the mixer has been advanced at least once and
 * updateMatrixWorld() has run, or the skeleton is still at its (collapsed)
 * identity pose.
 */
export function measurePosedBounds(root) {
  root.updateMatrixWorld(true);

  const box = new THREE.Box3();
  const vertex = new THREE.Vector3();
  let vertices = 0;
  let skinned = 0;

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const position = obj.geometry?.attributes?.position;
    if (!position) return;

    if (obj.isSkinnedMesh && typeof obj.getVertexPosition === "function") {
      skinned += 1;
      for (let i = 0; i < position.count; i += 1) {
        obj.getVertexPosition(i, vertex);
        box.expandByPoint(obj.localToWorld(vertex));
        vertices += 1;
      }
    } else {
      box.expandByObject(obj);
    }
  });

  return { box, vertices, skinned, empty: box.isEmpty() };
}

/**
 * Solves for the scale multiplier that puts the dragon at `targetMetres` tall.
 *
 * Takes the scale currently applied to the wrapper (`currentScale`) so it can
 * be called against an already-scaled scene and still converge -- the measured
 * height comes back in world units, which already include that scale.
 */
export function fitScaleToHeight(root, targetMetres = DRAGON_TARGET_HEIGHT_M, currentScale = 1) {
  const { box, empty, vertices } = measurePosedBounds(root);
  if (empty) return null;

  const size = new THREE.Vector3();
  box.getSize(size);
  if (!(size.y > 0)) return null;

  return {
    scale: (currentScale * targetMetres) / size.y,
    measuredHeight: size.y,
    size,
    box,
    vertices,
  };
}

/* Bone names in THIS rig are Armature-prefixed and resolve correctly -- the
   base, idle and attack GLBs all agree on them (verified across all three
   files). Worth stating explicitly because the Round 1-3 dragon in the
   carveresq-22 repo uses UNPREFIXED bone names and its lookups deliberately
   miss; do not copy that map here. */
const MOUTH_BONES = {
  jawUpper: "Armature_jaw_upper",
  jawLower: "Armature_jaw_lower",
  tongue: "Armature_tongue",
  neck: "Armature_neck3",
  root: "Armature_base",
};

/**
 * Resolves the bones the fire breath is anchored to. Returns whichever it
 * found plus a `missing` list, so a rig change shows up as a loud, named
 * failure instead of fire that silently emits from the world origin.
 */
export function findMouthBones(root) {
  const found = {};
  const byName = new Map();
  root.traverse((obj) => {
    if (obj.name && !byName.has(obj.name)) byName.set(obj.name, obj);
  });

  const missing = [];
  for (const [key, name] of Object.entries(MOUTH_BONES)) {
    const bone = byName.get(name);
    if (bone) found[key] = bone;
    else missing.push(name);
  }
  return { ...found, missing };
}

const _upper = new THREE.Vector3();
const _lower = new THREE.Vector3();
const _neck = new THREE.Vector3();

/**
 * World-space mouth origin and head-forward direction, read fresh from the
 * live skeleton so it tracks the animation frame by frame.
 *
 * `outPosition` lands between the two jaw bones; `outForward` points from the
 * base of the neck out through the mouth. Deriving forward from the rig rather
 * than assuming an axis means it stays correct whatever orientation the model
 * was exported in.
 *
 * Returns false when the bones are missing, so callers can skip rendering fire
 * rather than drawing it somewhere wrong.
 */
export function readMouthFrame(bones, outPosition, outForward) {
  if (!bones?.jawUpper || !bones?.jawLower) return false;

  bones.jawUpper.getWorldPosition(_upper);
  bones.jawLower.getWorldPosition(_lower);
  outPosition.addVectors(_upper, _lower).multiplyScalar(0.5);

  if (bones.neck) {
    bones.neck.getWorldPosition(_neck);
    outForward.subVectors(outPosition, _neck);
    if (outForward.lengthSq() < 1e-8) outForward.set(0, 0, 1);
    else outForward.normalize();
  } else {
    outForward.set(0, 0, 1);
  }
  return true;
}
