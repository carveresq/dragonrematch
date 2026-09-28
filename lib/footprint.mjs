/**
 * Where the dragon's breath meets the floor.
 *
 * Split out of lib/dragonBout.js, and deliberately free of any import -- not
 * even three. Two reasons: this is the only geometry the renderer and the
 * damage test BOTH depend on, so it is worth being able to check directly
 * (scripts/verify-footprint.mjs runs it under plain node against an
 * independent numerical cut of the same cone), and .mjs is what lets node
 * load it without the package becoming type: module and breaking Next's
 * CommonJS config files.
 */

/* Half-angle of the breath cone. Everything about the threat footprint is
   derived from this one number -- change it and the ground ring, the fire
   visual and the hit test all move together. */
export const FIRE_CONE_HALF_ANGLE = 0.155; // radians, ~8.9 degrees

export const MAX_FOOTPRINT_R = 3.2;

/* Playability floor on the aim's elevation above the cone half-angle.
   As phi approaches theta the cone's upper edge runs parallel to the floor and
   the ellipse's far end escapes to infinity -- a real property of the geometry,
   but an unplayable one. Below this the aim is treated as if it were steeper.
   This is a game-design decision, not a geometric claim, and the verifier
   knows to skip the cases where it bites. */
export const MIN_ELEVATION_MARGIN = 0.09; // radians above FIRE_CONE_HALF_ANGLE

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Cuts the breath cone with the floor plane and returns the ellipse.
 *
 * A tilted cone cuts an ELLIPSE, and both of its axes are bigger than the naive
 * "circle of radius d*tan(theta) centred on the target" -- by 5% cross-range
 * and 10% down-range at typical fight distances, and much more as the aim
 * flattens. Since this ellipse is simultaneously what gets drawn on the floor
 * and what decides whether the player takes a hit, an approximation here is a
 * ring that lies about its own hitbox. So it is solved exactly.
 *
 * Down-range: the cone's two edges sit at (phi - theta) and (phi + theta) below
 * the horizon, so they reach the floor at horizontal ranges h/tan(phi -+ theta).
 * Those two points are the major axis; a and the centre follow directly.
 *
 * Cross-range: at the ellipse centre, offset perpendicular to the vertical
 * plane of the aim. That offset direction is orthogonal to both the cone axis
 * and the centre vector w, so the cone condition collapses to
 *
 *     b^2 = (w . axis)^2 / cos^2(theta) - |w|^2
 *
 * which is exact, with no small-angle step anywhere.
 *
 * IMPORTANT: the ellipse centre is NOT the target. The far edge gains more
 * ground than the near edge loses, so the footprint sits beyond where the
 * dragon is actually aiming. That is real, and it is good: stepping toward the
 * dragon is genuinely safer than backing away, which is a dynamic worth
 * keeping rather than a discrepancy worth hiding. Callers must use
 * `out.cx`/`out.cz`, not the target, as the centre.
 *
 * Writes into `out` and returns it.
 */
export function footprintFromCone(mouth, target, out = {}) {
  const dx = target.x - mouth.x;
  const dz = target.z - mouth.z;

  const h = mouth.y - target.y; // mouth height above the floor
  const D = Math.hypot(dx, dz) || 0.001;
  const yaw = Math.atan2(dx, dz);

  const theta = FIRE_CONE_HALF_ANGLE;
  const minPhi = theta + MIN_ELEVATION_MARGIN;

  let phi = Math.atan2(Math.max(h, 0.001), D);
  const clamped = phi < minPhi;
  if (clamped) phi = minPhi;

  const height = Math.max(h, 0.001);
  const rNear = height / Math.tan(phi + theta);
  const rFar = height / Math.tan(phi - theta);

  const a = clamp((rFar - rNear) / 2, 0.2, MAX_FOOTPRINT_R * 2.2);
  const rCentre = (rNear + rFar) / 2;

  // Centre of the ellipse, on the floor, along the aim heading.
  const cx = mouth.x + Math.sin(yaw) * rCentre;
  const cz = mouth.z + Math.cos(yaw) * rCentre;

  // w: mouth -> ellipse centre. Cross-range is perpendicular to both w and the
  // cone axis, so |w| and w.axis are all the cross-section needs.
  const wx = cx - mouth.x;
  const wy = -height;
  const wz = cz - mouth.z;
  const wLen = Math.hypot(wx, wy, wz) || 0.001;

  const axisLen = Math.hypot(dx, -height, dz) || 0.001;
  const wDotAxis = (wx * dx + wy * -height + wz * dz) / axisLen;

  const cosTheta = Math.cos(theta);
  const bSq = (wDotAxis * wDotAxis) / (cosTheta * cosTheta) - wLen * wLen;
  const b = clamp(Math.sqrt(Math.max(bSq, 0.0001)), 0.2, MAX_FOOTPRINT_R);

  out.a = a;
  out.b = b;
  out.yaw = yaw;
  out.cx = cx;
  out.cz = cz;
  out.distance = Math.hypot(dx, h, dz);
  out.clamped = clamped;
  return out;
}

/**
 * Is the player standing in it?
 *
 * Rotates the player's offset from the ellipse CENTRE into the ellipse's own
 * frame (+v down-range along `a`, +u cross-range along `b`) and applies the
 * standard ellipse test. What gets drawn and what gets tested come from the
 * same numbers, so the ring on the floor cannot lie about where the damage is.
 */
export function isInsideFootprint(footprint, point) {
  const dx = point.x - footprint.cx;
  const dz = point.z - footprint.cz;

  /* yaw is a heading in three.js convention: yaw = 0 points down +Z, and the
     aim direction is (sin yaw, cos yaw). So down-range is the projection onto
     that, and cross-range the projection onto (cos yaw, -sin yaw). Rotating by
     -yaw here instead of +yaw mirrors the ellipse about the line of fire --
     which looks perfectly fine on a near-symmetric shape and is why the first
     version of scripts/verify-footprint.mjs missed it: that check re-derived
     the boundary with the same rotation, so it only ever proved the formula
     agreed with a copy of itself. It now tests orientation against the
     sampled cone instead. */
  const sin = Math.sin(footprint.yaw);
  const cos = Math.cos(footprint.yaw);

  const u = dx * cos - dz * sin; // cross-range, scaled by b
  const v = dx * sin + dz * cos; // down-range, scaled by a

  const nu = u / footprint.b;
  const nv = v / footprint.a;
  return nu * nu + nv * nv <= 1;
}
