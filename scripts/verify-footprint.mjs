/**
 * Checks footprintFromCone() against an INDEPENDENT construction of the same
 * geometry: rather than reusing the closed form, sample rays along the actual
 * cone surface, intersect each with the floor plane, and measure the resulting
 * point cloud.
 *
 * The two derivations share no code, which is the point -- a test fed the
 * function's own output could only ever prove it is self-consistent. This one
 * has already earned its keep: it caught the first implementation
 * under-reporting the footprint by 5-10%, i.e. drawing a ring smaller than the
 * area that actually damages the player.
 *
 * Run: node scripts/verify-footprint.mjs
 */
import {
  footprintFromCone,
  isInsideFootprint,
  safePointsAround,
  footprintRadius,
  FIRE_CONE_HALF_ANGLE,
  MAX_FOOTPRINT_R,
} from "../lib/footprint.mjs";

const THETA = FIRE_CONE_HALF_ANGLE;

/** Numerically cut the cone with the plane y = groundY and measure the slice. */
function sampleFootprint(mouth, target, groundY, samples = 200000) {
  const ax = target.x - mouth.x, ay = target.y - mouth.y, az = target.z - mouth.z;
  const aLen = Math.hypot(ax, ay, az);
  const axis = [ax / aLen, ay / aLen, az / aLen];

  // Orthonormal basis around the axis.
  const seed = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (p, q) => [p[1]*q[2]-p[2]*q[1], p[2]*q[0]-p[0]*q[2], p[0]*q[1]-p[1]*q[0]];
  const norm = (p) => { const l = Math.hypot(...p); return [p[0]/l, p[1]/l, p[2]/l]; };
  const e1 = norm(cross(axis, seed));
  const e2 = norm(cross(axis, e1));

  const hLen = Math.hypot(axis[0], axis[2]) || 1e-9;
  const down = [axis[0] / hLen, 0, axis[2] / hLen];
  const side = [-down[2], 0, down[0]];

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, missed = 0;

  for (let i = 0; i < samples; i += 1) {
    const psi = (i / samples) * Math.PI * 2;
    const c = Math.cos(THETA), s = Math.sin(THETA);
    const cp = Math.cos(psi), sp = Math.sin(psi);
    const dir = [
      c * axis[0] + s * (cp * e1[0] + sp * e2[0]),
      c * axis[1] + s * (cp * e1[1] + sp * e2[1]),
      c * axis[2] + s * (cp * e1[2] + sp * e2[2]),
    ];
    if (Math.abs(dir[1]) < 1e-12) { missed += 1; continue; }
    const t = (groundY - mouth.y) / dir[1];
    if (t <= 0) { missed += 1; continue; }

    const px = mouth.x + dir[0] * t;
    const pz = mouth.z + dir[2] * t;
    const rx = px - mouth.x, rz = pz - mouth.z;
    const v = rx * down[0] + rz * down[2];
    const u = rx * side[0] + rz * side[2];
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }

  return {
    a: (maxV - minV) / 2,
    b: (maxU - minU) / 2,
    // Centre expressed as distance from the mouth along the ground heading.
    centreRange: (maxV + minV) / 2,
    missed,
  };
}

const CASES = [
  { name: "close, steep", mouth: { x: 0, y: 4.2, z: 0 },  target: { x: 0, y: 0, z: 3 } },
  { name: "mid range",    mouth: { x: 0, y: 4.2, z: 0 },  target: { x: 0, y: 0, z: 8 } },
  { name: "off-axis",     mouth: { x: 0, y: 4.2, z: 0 },  target: { x: 6, y: 0, z: 6 } },
  { name: "raised floor", mouth: { x: 1, y: 6.5, z: -2 }, target: { x: 4, y: 2.1, z: 5 } },
  { name: "tall dragon",  mouth: { x: 0, y: 5.6, z: 0 },  target: { x: -3, y: 0, z: 4 } },
  { name: "far, flat",    mouth: { x: 0, y: 4.2, z: 0 },  target: { x: 0, y: 0, z: 16 } },
];

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"}  ${label}${detail ? `  -- ${detail}` : ""}`);
};
const TOL = 0.005; // 0.5% -- the solve is exact, so this is discretisation only
console.log(`cone half-angle = ${(THETA * 180 / Math.PI).toFixed(2)} deg`);
console.log(`${"case".padEnd(14)} ${"closed a".padEnd(10)}${"sampled a".padEnd(11)}${"closed b".padEnd(10)}${"sampled b".padEnd(11)}${"err a".padEnd(9)}${"err b".padEnd(9)}`);

for (const c of CASES) {
  const closed = footprintFromCone(c.mouth, c.target, {});
  const sampled = sampleFootprint(c.mouth, c.target, c.target.y);

  // Centre, independently: distance from mouth to the closed form's centre.
  const closedCentreRange = Math.hypot(closed.cx - c.mouth.x, closed.cz - c.mouth.z);

  const errA = Math.abs(closed.a - sampled.a) / sampled.a;
  const errB = Math.abs(closed.b - sampled.b) / sampled.b;
  const errC = Math.abs(closedCentreRange - sampled.centreRange) / sampled.centreRange;

  const atCap = closed.a >= MAX_FOOTPRINT_R * 2.2 - 1e-6 || closed.b >= MAX_FOOTPRINT_R - 1e-6;
  const skip = closed.clamped || atCap;
  const ok = skip || (errA < TOL && errB < TOL && errC < TOL);
  if (!ok) failures += 1;

  console.log(
    `${c.name.padEnd(14)} ${closed.a.toFixed(3).padEnd(10)}${sampled.a.toFixed(3).padEnd(11)}` +
    `${closed.b.toFixed(3).padEnd(10)}${sampled.b.toFixed(3).padEnd(11)}` +
    `${(errA * 100).toFixed(2).padStart(6)}%  ${(errB * 100).toFixed(2).padStart(6)}%  ` +
    `centre ${(errC * 100).toFixed(2)}%  ${skip ? "[clamped, skipped]" : ok ? "OK" : "FAIL"}`,
  );
}

/* ------------------------------------------------------------------ *
   Orientation.

   The magnitudes above are checked against the sampled cone, but a mirrored
   or transposed ellipse has identical a and b -- so orientation needs its own
   check, and it must not be made against a re-derivation of the same rotation.
   (The first version of this file did exactly that and missed a real sign
   error in isInsideFootprint.)

   So: take the extreme points the SAMPLER found on the real cone-floor curve,
   and ask the hit test where they are. They must sit on the boundary --
   just inside at 0.999x out from the centre, just outside at 1.001x.
   ------------------------------------------------------------------ */
function extremePoints(mouth, target, groundY, samples = 200000) {
  const ax = target.x - mouth.x, ay = target.y - mouth.y, az = target.z - mouth.z;
  const aLen = Math.hypot(ax, ay, az);
  const axis = [ax / aLen, ay / aLen, az / aLen];
  const seed = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (p, q) => [p[1]*q[2]-p[2]*q[1], p[2]*q[0]-p[0]*q[2], p[0]*q[1]-p[1]*q[0]];
  const norm = (p) => { const l = Math.hypot(...p); return [p[0]/l, p[1]/l, p[2]/l]; };
  const e1 = norm(cross(axis, seed));
  const e2 = norm(cross(axis, e1));

  const pts = [];
  for (let i = 0; i < samples; i += 1) {
    const psi = (i / samples) * Math.PI * 2;
    const c = Math.cos(THETA), s2 = Math.sin(THETA);
    const cp = Math.cos(psi), sp = Math.sin(psi);
    const dir = [
      c * axis[0] + s2 * (cp * e1[0] + sp * e2[0]),
      c * axis[1] + s2 * (cp * e1[1] + sp * e2[1]),
      c * axis[2] + s2 * (cp * e1[2] + sp * e2[2]),
    ];
    if (Math.abs(dir[1]) < 1e-12) continue;
    const t = (groundY - mouth.y) / dir[1];
    if (t <= 0) continue;
    pts.push({ x: mouth.x + dir[0] * t, z: mouth.z + dir[2] * t });
  }
  return pts;
}

console.log("");
let orientationFailures = 0;
for (const c of CASES) {
  const fp = footprintFromCone(c.mouth, c.target, {});
  // Skip the same cases the magnitude pass skips: once a or b is pinned to a
  // playability cap, the drawn ellipse is deliberately not the true cone
  // section any more, so asking it to match one is meaningless.
  const capped = fp.a >= MAX_FOOTPRINT_R * 2.2 - 1e-6 || fp.b >= MAX_FOOTPRINT_R - 1e-6;
  if (fp.clamped || capped) {
    console.log(`orientation ${c.name.padEnd(14)} [clamped, skipped]`);
    continue;
  }
  const pts = extremePoints(c.mouth, c.target, c.target.y);

  // Every point on the real curve must land on the hit test's boundary.
  let maxRatio = 0, minRatio = Infinity;
  for (const p of pts) {
    const dx = p.x - fp.cx, dz = p.z - fp.cz;
    // Scale the offset until the hit test flips, then compare to 1.
    let lo = 0.0001, hi = 4;
    for (let k = 0; k < 70; k += 1) {
      const mid = (lo + hi) / 2;
      if (isInsideFootprint(fp, { x: fp.cx + dx / mid, z: fp.cz + dz / mid })) hi = mid;
      else lo = mid;
    }
    maxRatio = Math.max(maxRatio, lo);
    minRatio = Math.min(minRatio, lo);
  }
  const ok = Math.abs(maxRatio - 1) < 0.002 && Math.abs(minRatio - 1) < 0.002;
  if (!ok) { orientationFailures += 1; failures += 1; }
  console.log(`orientation ${c.name.padEnd(14)} sampled curve sits at ` +
    `${minRatio.toFixed(4)}..${maxRatio.toFixed(4)} of the hit-test boundary  ${ok ? "OK" : "FAIL"}`);
}

/* A deliberately mirrored footprint must be REJECTED, or the check above is
   not actually sensitive to the sign error it exists to catch. */
{
  const fp = footprintFromCone({ x: 0, y: 4.2, z: 0 }, { x: 5, y: 0, z: 7 }, {});
  const mirrored = { ...fp, yaw: -fp.yaw };
  const pts = extremePoints({ x: 0, y: 4.2, z: 0 }, { x: 5, y: 0, z: 7 }, 0);
  let worstMirror = 0;
  for (const p of pts) {
    const dx = p.x - mirrored.cx, dz = p.z - mirrored.cz;
    let lo = 0.0001, hi = 4;
    for (let k = 0; k < 70; k += 1) {
      const mid = (lo + hi) / 2;
      if (isInsideFootprint(mirrored, { x: mirrored.cx + dx / mid, z: mirrored.cz + dz / mid })) hi = mid;
      else lo = mid;
    }
    worstMirror = Math.max(worstMirror, Math.abs(lo - 1));
  }
  const sensitive = worstMirror > 0.05;
  if (!sensitive) failures += 1;
  console.log(`\nmirrored footprint is rejected by ${(worstMirror * 100).toFixed(0)}%  ` +
    `${sensitive ? "OK (the check can see a sign error)" : "FAIL (check is blind)"}`);
}

/* A circle centred on the target -- the naive version -- should be visibly
   WRONG, or the exact solve above is pointless complexity. Report the gap. */
const naive = (() => {
  const m = { x: 0, y: 4.2, z: 0 }, t = { x: 0, y: 0, z: 8 };
  const d = Math.hypot(t.x - m.x, t.y - m.y, t.z - m.z);
  return d * Math.tan(THETA);
})();
const exact = footprintFromCone({ x: 0, y: 4.2, z: 0 }, { x: 0, y: 0, z: 8 }, {});
console.log(`naive circle r=${naive.toFixed(3)} vs exact a=${exact.a.toFixed(3)} b=${exact.b.toFixed(3)}` +
  `  -- naive under-reports down-range by ${(((exact.a - naive) / exact.a) * 100).toFixed(0)}%`);

/* ------------------------------------------------------------------ *
   Safe points.

   These are what the player is told to run to, so "is it actually safe" is
   checked against the SAMPLED cone curve rather than by asking the same
   ellipse maths that produced the marker. And "is it actually reachable"
   matters just as much: the camera path has no positional tracking, so an
   escape longer than speed * time is not a hard dodge, it is an impossible
   one -- the defect that shipped in v4.
   ------------------------------------------------------------------ */
console.log("");
{
  const SPEED = 4.6, TIME = 2.2, MARGIN = 0.7;
  const reach = SPEED * TIME;

  const mouth = { x: 0, y: 4.2, z: 0 };
  const aim = { x: 0, y: 0, z: 8 };
  const fp = footprintFromCone(mouth, aim, {});
  const curve = extremePoints(mouth, aim, 0, 40000);

  const pts = safePointsAround([fp], { x: aim.x, z: aim.z }, { speed: SPEED, timeLeft: TIME, margin: MARGIN });
  check("safe points are offered at all", pts.length > 0, `${pts.length} points`);

  // Independent: nearest approach to the real cone-floor curve.
  let worstGap = Infinity;
  for (const p of pts) {
    let nearest = Infinity;
    for (const c of curve) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < nearest) nearest = d;
    }
    if (footprintRadius(fp, p) <= 1) nearest = -nearest; // inside counts as negative
    worstGap = Math.min(worstGap, nearest);
  }
  check("every safe point clears the real burn curve by the margin",
    worstGap >= MARGIN, `closest approach ${worstGap.toFixed(2)} m, margin ${MARGIN}`);

  const farthest = Math.max(...pts.map((p) => p.distance));
  check("no safe point is farther than the player can run",
    farthest <= reach + 1e-6, `farthest ${farthest.toFixed(2)} m, reach ${reach.toFixed(2)} m`);

  const spread = new Set(pts.map((p) => p.distance.toFixed(1))).size;
  check("safe points sit at different distances", spread === pts.length,
    pts.map((p) => `${p.distance.toFixed(1)}m`).join(", "));

  /* NEGATIVE CONTROL. With everything in range covered, the honest answer is
     "nowhere" -- and it must not be a best-effort point that is secretly on
     fire. Without this, "all returned points are safe" passes trivially on an
     empty list, which is the vacuous check in yet another costume. */
  const smother = { a: 50, b: 50, yaw: 0, cx: 0, cz: 8 };
  const none = safePointsAround([smother], { x: 0, z: 8 }, { speed: SPEED, timeLeft: TIME, margin: MARGIN });
  check("returns nothing when nowhere is safe", none.length === 0, `${none.length} points`);

  const noTime = safePointsAround([fp], { x: 0, z: 8 }, { speed: SPEED, timeLeft: 0, margin: MARGIN });
  check("returns nothing when there is no time", noTime.length === 0, `${noTime.length} points`);

  /* And the control on the control: the smother test above only proves
     anything if the same call DOES return points once the cover is lifted. */
  const lifted = safePointsAround([{ a: 6, b: 6, yaw: 0, cx: 0, cz: 8 }], { x: 0, z: 8 },
    { speed: SPEED, timeLeft: TIME, margin: MARGIN });
  check("and finds them again when the cover is lifted", lifted.length > 0, `${lifted.length} points`);
}

console.log(failures === 0 ? "\nAll footprint checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
