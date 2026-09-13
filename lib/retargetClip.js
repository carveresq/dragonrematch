// Retargets an AnimationClip authored against one skeleton (e.g. dragon_idle.glb's
// own armature) onto a different-but-topologically-equivalent scene (dragon.glb's
// skeleton), matching purely by bone/node NAME rather than by object identity or
// track index.
//
// Why this is needed: dragon.glb (base mesh + skeleton, no animation) and
// dragon_idle.glb / dragon_attack.glb (animation-only, no mesh) were exported as
// separate GLBs from separate DAE sources. Their scene graphs are different THREE
// objects, so a clip's tracks -- which THREE.PropertyBinding resolves by walking a
// target root looking for a matching name/uuid -- won't bind to anything in
// dragon.glb's scene unless we rebuild the clip's tracks against names that exist
// in that scene's skeleton.
//
// In production here, bone names are already consistent across all three GLBs
// (verified: "Armature_base", "Armature_neck1", ... appear identically in all
// three, and the rest-pose local rotations differ by <0.05 degrees across files --
// i.e. no coordinate-system or bind-pose mismatch). So this function is mostly a
// defensive passthrough: it drops any track that can't be resolved by name on the
// destination scene (rather than letting AnimationMixer silently no-op or throw),
// and logs a warning if that happens so a real conversion regression is loud
// instead of silently producing a T-posed dragon.
export function retargetClipByName(clip, destinationScene, { clipName } = {}) {
  if (!clip) return null;

  const destNames = new Set();
  destinationScene.traverse((obj) => {
    if (obj.name) destNames.add(obj.name);
  });

  const tracks = [];
  const dropped = [];

  for (const track of clip.tracks) {
    // Track names are PropertyBinding path strings, e.g. "Armature_base.quaternion"
    // or (for uuid-keyed sources like ColladaLoader output) "<uuid>.quaternion".
    const dot = track.name.lastIndexOf(".");
    if (dot < 0) {
      tracks.push(track);
      continue;
    }
    const targetKey = track.name.slice(0, dot);
    const property = track.name.slice(dot);

    if (destNames.has(targetKey)) {
      // Name already resolves directly on the destination scene -- no rewrite
      // needed, just reuse the track as-is (still clone so the two clips never
      // share mutable typed arrays).
      const cloned = track.clone();
      tracks.push(cloned);
      continue;
    }

    dropped.push(targetKey + property);
  }

  if (dropped.length && typeof console !== "undefined") {
    console.warn(
      `[retargetClipByName] dropped ${dropped.length} track(s) that didn't resolve by name on the destination scene:`,
      dropped.slice(0, 10),
    );
  }

  if (!tracks.length) return null;

  // clip.constructor is THREE.AnimationClip -- reuse it rather than importing
  // three directly here, so this module has zero dependencies of its own.
  return new clip.constructor(clipName || clip.name, clip.duration, tracks);
}
