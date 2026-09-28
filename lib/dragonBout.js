import * as THREE from "three";

import {
  footprintFromCone,
  isInsideFootprint,
  safePointsAround,
  FIRE_CONE_HALF_ANGLE,
  MAX_FOOTPRINT_R,
} from "./footprint.mjs";

/* Re-exported so callers get the bout and its geometry from one import, while
   the geometry itself stays runnable under plain node. See lib/footprint.mjs
   and scripts/verify-footprint.mjs. */
export { footprintFromCone, isInsideFootprint, safePointsAround, FIRE_CONE_HALF_ANGLE, MAX_FOOTPRINT_R };

/* ------------------------------------------------------------------ *
   Timing

   MEASURED off dragon_attack.glb, not chosen by eye. The clip runs 1.708s and
   the jaw bones hit their widest opening at t=1.292s -- Armature_jaw_lower is
   41.6 degrees off its frame-0 rotation there and Armature_jaw_upper 47.0,
   both peaking on the same key. That is the frame the dragon is actually
   roaring on, so that is where the fire has to land.

   Do not port the numbers from the Round 1-3 dragon in carveresq-22: its
   dragonTimingFor() uses a 4600ms attack with impact at 2860ms, which belongs
   to a different clip and is wrong here by nearly 3x.
   ------------------------------------------------------------------ */

export const ATTACK_CLIP_S = 1.708;
export const FIRE_IGNITE_S = 1.0;
export const FIRE_PEAK_S = 1.292;
export const FIRE_END_S = 1.66;

export const INTRO_MS = 1200;
export const STALK_MS = 1500;
/* 2.2s, up from 1.3s. The attacks below deliberately demand real ground, and
   on the camera path the player's only movement is the pad at MOVE_SPEED --
   so the wind-up has to be long enough to actually cross that ground. Time
   was chosen over raising the speed: a person in a room does not sprint at
   7 m/s, and a longer tell is easier to read on a phone. */
export const TELEGRAPH_MS = 2200;
export const WINDED_MS = 1700;

/* ------------------------------------------------------------------ *
   Stakes
   ------------------------------------------------------------------ */

export const DRAGON_MAX_HP = 100;
export const PLAYER_LIVES = 2; // caught twice and the bout is lost
export const LASER_DAMAGE = 5;
export const LASER_DAMAGE_WINDED = 13; // punish window opened by a clean dodge
export const DODGE_REWARD = 6;
export const LASER_COOLDOWN_MS = 190;

/* ================================================================== *
   ATTACKS

   One shape covers all of them: an attack is a timed sequence of aim
   samples, each of which becomes a footprint through the same
   footprintFromCone() that decides damage. Sweeps are many samples along an
   arc; a burst volley is a few separated ones; the old behaviour is a single
   sample. Nothing here invents a second notion of "where the fire goes".
   ================================================================== */

export const PLAYER_SPEED = 4.6; // must match MOVE_SPEED in DragonScene

/* Deterministic rather than random: the browser checks drive one attack of
   each kind, and a random sequence would make that flaky. Opens easy and
   escalates. */
export const ATTACK_SEQUENCE = ["spot", "lead", "wide", "multi", "sweep", "lead", "sweep", "multi"];

export const WIDE_CONE_HALF_ANGLE = FIRE_CONE_HALF_ANGLE * 2.1;

/** Clamp a lead so the dragon can never aim somewhere you could not have got to. */
function clampLead(from, to, maxDistance) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDistance || d < 1e-6) return { x: to.x, z: to.z };
  const k = maxDistance / d;
  return { x: from.x + dx * k, z: from.z + dz * k };
}

/**
 * Build the attack. `ctx` needs mouth, playerGround, playerVelocity, groundY.
 *
 * Each sample carries its own cone angle and its own firing time, relative to
 * the start of the breath. `continuous` says whether the fire streams between
 * samples (a sweep) or comes in discrete bursts (a volley) -- the same field
 * drives both the visual and the damage windows, so they cannot disagree.
 */
export function planAttack(kind, ctx) {
  const { mouth, playerGround, playerVelocity, groundY } = ctx;
  const y = groundY;
  const at = (x, z) => ({ x, y, z });

  const reach = PLAYER_SPEED * (TELEGRAPH_MS / 1000);
  let samples = [];
  let continuous = false;

  switch (kind) {
    case "lead": {
      /* Aim where you are GOING. Repeating one sidestep walks you into it --
         which is the entire point, since a single memorised dodge beat every
         attack before this. Clamped so it can only ever pick a spot you could
         actually have reached. */
      const t = (TELEGRAPH_MS + 900) / 1000;
      const predicted = clampLead(
        playerGround,
        { x: playerGround.x + (playerVelocity?.x || 0) * t, z: playerGround.z + (playerVelocity?.z || 0) * t },
        reach * 0.8,
      );
      samples = [{ atMs: 0, target: at(predicted.x, predicted.z), halfAngle: FIRE_CONE_HALF_ANGLE }];
      break;
    }

    case "wide":
      samples = [{ atMs: 0, target: at(playerGround.x, playerGround.z), halfAngle: WIDE_CONE_HALF_ANGLE }];
      break;

    case "multi": {
      /* Three separated bursts with gaps between them: you have to pick a
         pocket and commit, rather than stepping anywhere sideways. */
      const spread = 3.4;
      const side = playerVelocity && playerVelocity.x < 0 ? -1 : 1;
      samples = [-1, 0, 1].map((i, n) => ({
        atMs: n * 260,
        target: at(playerGround.x + i * spread * side, playerGround.z + (i === 0 ? 0 : spread * 0.5)),
        halfAngle: FIRE_CONE_HALF_ANGLE,
      }));
      break;
    }

    case "sweep": {
      /* An arc centred on the dragon, passing through where you stand, so
         standing anywhere along it is death and you have to outrun it. */
      continuous = true;
      const dx = playerGround.x - mouth.x;
      const dz = playerGround.z - mouth.z;
      const radius = Math.hypot(dx, dz) || 1;
      const centreAngle = Math.atan2(dx, dz);
      const arc = 0.85; // radians, total
      const steps = 8;
      samples = Array.from({ length: steps }, (_, i) => {
        const f = i / (steps - 1);
        const a = centreAngle - arc / 2 + arc * f;
        return {
          atMs: f * 900,
          target: at(mouth.x + Math.sin(a) * radius, mouth.z + Math.cos(a) * radius),
          halfAngle: FIRE_CONE_HALF_ANGLE,
        };
      });
      break;
    }

    case "spot":
    default:
      samples = [{ atMs: 0, target: at(playerGround.x, playerGround.z), halfAngle: FIRE_CONE_HALF_ANGLE }];
      break;
  }

  for (const sample of samples) {
    sample.footprint = footprintFromCone(mouth, sample.target, {}, sample.halfAngle);
    sample.resolved = false;
  }

  const last = samples[samples.length - 1];
  return {
    kind,
    continuous,
    samples,
    footprints: samples.map((s) => s.footprint),
    burnStartMs: -BURST_LEAD_MS,
    burnEndMs: last.atMs + BURST_TAIL_MS,
  };
}

/* How long the fire is alive around each aim sample. */
export const BURST_LEAD_MS = 150;
export const BURST_TAIL_MS = 420;

/** Where the fire is pointed right now, or null when it is not burning. */
export function currentAim(bout, now) {
  const attack = bout.attack;
  if (!attack || bout.phase !== "breathe") return null;
  const t = now - bout.attackStartedAt - FIRE_PEAK_S * 1000;
  const { samples } = attack;

  if (attack.continuous) {
    if (t < samples[0].atMs - BURST_LEAD_MS || t > samples[samples.length - 1].atMs + BURST_TAIL_MS) return null;
    const clamped = Math.max(samples[0].atMs, Math.min(t, samples[samples.length - 1].atMs));
    for (let i = 0; i < samples.length - 1; i += 1) {
      const a = samples[i], b = samples[i + 1];
      if (clamped >= a.atMs && clamped <= b.atMs) {
        const f = (clamped - a.atMs) / Math.max(1, b.atMs - a.atMs);
        return {
          x: a.target.x + (b.target.x - a.target.x) * f,
          y: a.target.y,
          z: a.target.z + (b.target.z - a.target.z) * f,
        };
      }
    }
    return samples[samples.length - 1].target;
  }

  let best = null, bestGap = Infinity;
  for (const s of samples) {
    const gap = Math.abs(t - s.atMs);
    if (gap < bestGap && t >= s.atMs - BURST_LEAD_MS && t <= s.atMs + BURST_TAIL_MS) {
      best = s; bestGap = gap;
    }
  }
  return best ? best.target : null;
}

export function createBout(now) {
  return {
    phase: "intro", // intro | stalk | telegraph | breathe | winded | won | lost
    phaseUntil: now + INTRO_MS,
    hp: DRAGON_MAX_HP,
    lives: PLAYER_LIVES,
    result: null,

    attackStartedAt: 0,
    resolvedThisAttack: false,
    dodgedLastAttack: false,
    attacks: 0,

    aim: new THREE.Vector3(),
    footprint: { a: 1, b: 1, yaw: 0, cx: 0, cz: 0, distance: 1, clamped: false },

    lastShotAt: -Infinity,
    hitFlashUntil: 0,
    playerHitFlashUntil: 0,
  };
}

export function boutIsOver(bout) {
  return bout.phase === "won" || bout.phase === "lost";
}

/** 0..1 while the ground ring is charging. */
export function telegraphProgress(bout, now) {
  if (bout.phase !== "telegraph") return 0;
  return THREE.MathUtils.clamp(1 - (bout.phaseUntil - now) / TELEGRAPH_MS, 0, 1);
}

/**
 * How much breath is live this frame, 0 when not breathing.
 * Fast ignite, held burn, quick cut -- shaped so the peak lands on the roar
 * frame rather than ramping through it.
 */
export function fireEnvelope(bout, now) {
  if (bout.phase !== "breathe") return 0;
  const attack = bout.attack;
  const t = now - bout.attackStartedAt - FIRE_PEAK_S * 1000;

  if (!attack) {
    const s = (now - bout.attackStartedAt) / 1000;
    if (s < FIRE_IGNITE_S || s > FIRE_END_S) return 0;
    const p = (s - FIRE_IGNITE_S) / (FIRE_END_S - FIRE_IGNITE_S);
    return Math.max(0, Math.min(1, Math.min(p / 0.18, (1 - p) / 0.25)));
  }

  const first = attack.samples[0].atMs;
  const last = attack.samples[attack.samples.length - 1].atMs;

  /* A sweep streams continuously between its samples; a volley burns only
     around each one. Same field drives the visual and the damage windows, so
     the fire can never be showing where nothing is resolving. */
  if (attack.continuous) {
    const start = first - BURST_LEAD_MS;
    const end = last + BURST_TAIL_MS;
    if (t < start || t > end) return 0;
    const p = (t - start) / Math.max(1, end - start);
    return Math.max(0, Math.min(1, Math.min(p / 0.1, (1 - p) / 0.18)));
  }

  let best = 0;
  for (const s of attack.samples) {
    const start = s.atMs - BURST_LEAD_MS;
    const end = s.atMs + BURST_TAIL_MS;
    if (t < start || t > end) continue;
    const p = (t - start) / Math.max(1, end - start);
    best = Math.max(best, Math.min(1, Math.min(p / 0.2, (1 - p) / 0.3)));
  }
  return Math.max(0, best);
}

export function damageDragon(bout, amount, now) {
  if (boutIsOver(bout)) return false;
  bout.hp = Math.max(0, bout.hp - amount);
  bout.hitFlashUntil = now + 140;
  if (bout.hp <= 0) {
    bout.phase = "won";
    bout.result = "won";
    bout.phaseUntil = Infinity;
  }
  return true;
}

/**
 * One step of the bout.
 *
 * `ctx` supplies the live world state the machine cannot know on its own:
 *   mouth        Vector3  world-space mouth position this frame
 *   playerGround Vector3  the player, projected onto the floor
 *   groundY      number   floor height in WORLD space -- not assumed to be 0,
 *                         because in real AR the dragon is placed on a
 *                         detected plane that can sit anywhere
 *   playAttack() function fires the attack clip
 */
export function tickBout(bout, now, ctx) {
  if (boutIsOver(bout)) return bout;

  switch (bout.phase) {
    case "intro":
      if (now >= bout.phaseUntil) {
        bout.phase = "stalk";
        bout.phaseUntil = now + STALK_MS;
      }
      break;

    case "stalk":
      if (now >= bout.phaseUntil) {
        /* Lock on. The plan is committed HERE and does not track you
           afterwards -- that is the whole reason an attack can be dodged.
           What it commits to now varies by kind: your feet, where you are
           heading, a wide sweep of ground, a volley, or an arc. */
        const kind = bout.forceKind || ATTACK_SEQUENCE[bout.attacks % ATTACK_SEQUENCE.length];
        bout.aim.set(ctx.playerGround.x, ctx.groundY, ctx.playerGround.z);
        bout.lockPosition = { x: ctx.playerGround.x, z: ctx.playerGround.z };
        bout.attack = planAttack(kind, {
          mouth: ctx.mouth,
          playerGround: ctx.playerGround,
          playerVelocity: ctx.playerVelocity,
          groundY: ctx.groundY,
        });
        bout.footprints = bout.attack.footprints;

        /* Where can you actually go? Computed once, from the same ellipses
           that will burn you and from how far you can genuinely run in the
           wind-up. If this comes back empty the attack is unsurvivable, which
           is a bug in the attack, not a hard moment -- so widen the search
           rather than show the player nothing. */
        bout.safePoints = safePointsAround(bout.footprints, ctx.playerGround, {
          speed: PLAYER_SPEED,
          timeLeft: TELEGRAPH_MS / 1000,
          count: 3,
        });
        if (bout.safePoints.length === 0) {
          bout.safePoints = safePointsAround(bout.footprints, ctx.playerGround, {
            speed: PLAYER_SPEED,
            timeLeft: TELEGRAPH_MS / 1000,
            count: 3,
            margin: 0.25,
          });
        }

        bout.phase = "telegraph";
        bout.phaseUntil = now + TELEGRAPH_MS;
      }
      break;

    case "telegraph":
      if (now >= bout.phaseUntil) {
        bout.phase = "breathe";
        bout.attackStartedAt = now;
        bout.resolvedThisAttack = false;
        bout.attacks += 1;
        /* Long enough for the last aim sample to land plus its tail -- a
           sweep outlives the 1.708s animation clip, and the fire is drawn
           independently of the clip so that is fine. */
        const tail = (bout.attack?.burnEndMs ?? 0) + 260;
        bout.phaseUntil = now + Math.max(ATTACK_CLIP_S * 1000, FIRE_PEAK_S * 1000 + tail);
        ctx.playAttack?.();
      }
      break;

    case "breathe": {
      const attack = bout.attack;
      const sinceImpact = now - bout.attackStartedAt - FIRE_PEAK_S * 1000;

      /* Each aim sample resolves as the fire reaches it, so a sweep catches
         you when the arc arrives and a volley catches you on whichever burst
         you are standing under. At most one life per attack, however many
         samples land on you. */
      if (attack) {
        for (const sample of attack.samples) {
          if (sample.resolved || sinceImpact < sample.atMs) continue;
          sample.resolved = true;
          if (bout.resolvedThisAttack) continue;
          if (!isInsideFootprint(sample.footprint, ctx.playerGround)) continue;

          bout.resolvedThisAttack = true;
          bout.dodgedLastAttack = false;
          bout.lives -= 1;
          bout.playerHitFlashUntil = now + 450;
          if (bout.lives <= 0) {
            bout.phase = "lost";
            bout.result = "lost";
            bout.phaseUntil = Infinity;
            return bout;
          }
        }

        const allResolved = attack.samples.every((s) => s.resolved);
        if (allResolved && !bout.resolvedThisAttack) {
          bout.resolvedThisAttack = true;
          bout.dodgedLastAttack = true;

          /* Score the escape by ground actually covered, so outrunning a sweep
             to the far marker beats a minimum sidestep. */
          const moved = Math.hypot(
            ctx.playerGround.x - bout.lockPosition.x,
            ctx.playerGround.z - bout.lockPosition.z,
          );
          bout.lastEscape = moved;
          bout.score += Math.round(moved * 10);

          damageDragon(bout, DODGE_REWARD, now);
          if (boutIsOver(bout)) return bout;
        }
      }

      if (now >= bout.phaseUntil) {
        bout.phase = bout.dodgedLastAttack ? "winded" : "stalk";
        bout.phaseUntil = now + (bout.dodgedLastAttack ? WINDED_MS : STALK_MS);
      }
      break;
    }

    case "winded":
      if (now >= bout.phaseUntil) {
        bout.phase = "stalk";
        bout.phaseUntil = now + STALK_MS;
      }
      break;

    default:
      break;
  }

  return bout;
}

export function tryFireLaser(bout, now) {
  if (boutIsOver(bout)) return false;
  if (now - bout.lastShotAt < LASER_COOLDOWN_MS) return false;
  bout.lastShotAt = now;
  return true;
}

export function laserDamageFor(bout) {
  return bout.phase === "winded" ? LASER_DAMAGE_WINDED : LASER_DAMAGE;
}
