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
export function footprintFromCone(mouth, target, out = {}, halfAngle = FIRE_CONE_HALF_ANGLE) {
  const dx = target.x - mouth.x;
  const dz = target.z - mouth.z;

  const h = mouth.y - target.y; // mouth height above the floor
  const D = Math.hypot(dx, dz) || 0.001;
  const yaw = Math.atan2(dx, dz);

  /* Per-attack, not fixed: a "wide" attack is a genuinely wider cone, so the
     drawn zone and the damage zone both grow from the same number. The default
     keeps every existing caller and every existing check unchanged. */
  const theta = halfAngle;
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

/**
 * Normalised ellipse radius of a point: <1 inside, 1 on the edge, >1 outside.
 * Exposed because both the clearance estimate and the tests want the raw
 * number rather than the boolean.
 */
export function footprintRadius(footprint, point) {
  const dx = point.x - footprint.cx;
  const dz = point.z - footprint.cz;
  const sin = Math.sin(footprint.yaw);
  const cos = Math.cos(footprint.yaw);
  const u = (dx * cos - dz * sin) / footprint.b;
  const v = (dx * sin + dz * cos) / footprint.a;
  return Math.hypot(u, v);
}

/**
 * Roughly how many metres clear of a footprint a point is. Negative inside.
 *
 * Scaling the normalised overshoot by the SMALLER semi-axis deliberately
 * under-estimates clearance in the long direction rather than over-estimating
 * it. A safety margin that flatters itself is worse than none.
 */
export function clearanceFrom(footprint, point) {
  const r = footprintRadius(footprint, point);
  return (r - 1) * Math.min(footprint.a, footprint.b);
}

/**
 * Where can the player actually stand, and actually get to, before this lands?
 *
 * Returns up to `count` points, each `{ x, z, distance, clearance }`, sorted
 * best first. Empty when there is nowhere both safe and reachable -- which is a
 * real answer and must not be papered over with a "best effort" point that is
 * secretly inside the fire.
 *
 * Two filters, and the second one is the whole reason this exists:
 *
 *   1. SAFE  -- outside every footprint by at least `margin` metres. Derived
 *      from the same ellipses that decide damage, so a marker cannot point at
 *      a spot that will burn.
 *   2. REACHABLE -- no farther than `speed * timeLeft`. The camera path has no
 *      positional tracking, so the player's only movement is the on-screen pad
 *      at a known speed; an escape longer than that is not a hard dodge, it is
 *      an impossible one. Enforcing it here is what keeps the fight winnable by
 *      construction instead of by tuning.
 *
 * Candidates are sampled on rings rather than a grid so that distance -- the
 * thing being scored -- is exact per ring instead of an artefact of cell size.
 */
export function safePointsAround(footprints, from, opts = {}) {
  const {
    speed = 4.6,
    timeLeft = 2.2,
    count = 3,
    margin = 0.7,
    minSeparation = 2.2,
    angleSteps = 48,
    ringFractions = [0.9, 0.72, 0.55, 0.4, 0.28],
  } = opts;

  const reach = Math.max(0, speed * timeLeft);
  if (reach <= 0) return [];

  const zones = (footprints || []).filter(Boolean);
  const candidates = [];

  for (const frac of ringFractions) {
    const radius = reach * frac;
    if (radius < 0.35) continue;
    for (let i = 0; i < angleSteps; i += 1) {
      const angle = (i / angleSteps) * Math.PI * 2;
      const x = from.x + Math.cos(angle) * radius;
      const z = from.z + Math.sin(angle) * radius;

      let clearance = Infinity;
      for (const zone of zones) {
        const c = clearanceFrom(zone, { x, z });
        if (c < clearance) clearance = c;
      }
      if (zones.length === 0) clearance = Infinity;
      if (clearance < margin) continue;

      candidates.push({
        x, z,
        ring: frac,
        distance: radius,
        clearance: clearance === Infinity ? 99 : clearance,
        // Favour clearance; distance is handled by picking across rings below,
        // not by weighting it here -- weighting it just pins every marker to
        // the outermost ring.
        score: Math.min(clearance, 4),
      });
    }
  }

  candidates.sort((p, q) => q.score - p.score);

  const chosen = [];
  const farEnoughApart = (c) =>
    chosen.every((p) => Math.hypot(c.x - p.x, c.z - p.z) >= minSeparation);

  /* Pick at most one per ring, outermost first.
     Two failure modes this avoids, both of which defeat the point of showing
     markers at all: scoring by distance pins every marker to the outer ring,
     and scoring by clearance alone clusters them on whichever side is emptiest.
     Walking the rings gives a near / middle / far choice -- an actual decision
     about how much ground to cover, which is what was asked for. */
  for (const frac of ringFractions) {
    if (chosen.length >= count) break;
    const best = candidates.find((c) => c.ring === frac && farEnoughApart(c));
    if (best) chosen.push(best);
  }

  // Backfill if some rings were entirely unsafe or unreachable.
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (!chosen.includes(c) && farEnoughApart(c)) chosen.push(c);
  }

  return chosen.sort((p, q) => q.distance - p.distance);
}
