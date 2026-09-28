import * as THREE from "three";

import {
  footprintFromCone,
  isInsideFootprint,
  FIRE_CONE_HALF_ANGLE,
  MAX_FOOTPRINT_R,
} from "./footprint.mjs";

/* Re-exported so callers get the bout and its geometry from one import, while
   the geometry itself stays runnable under plain node. See lib/footprint.mjs
   and scripts/verify-footprint.mjs. */
export { footprintFromCone, isInsideFootprint, FIRE_CONE_HALF_ANGLE, MAX_FOOTPRINT_R };

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
export const TELEGRAPH_MS = 1300;
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
  const t = (now - bout.attackStartedAt) / 1000;
  if (t < FIRE_IGNITE_S || t > FIRE_END_S) return 0;
  const p = (t - FIRE_IGNITE_S) / (FIRE_END_S - FIRE_IGNITE_S);
  return Math.max(0, Math.min(1, Math.min(p / 0.18, (1 - p) / 0.25)));
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
        // Lock on. The aim is where the player is standing RIGHT NOW and does
        // not track afterwards -- committing to a stale position is the whole
        // reason the attack can be dodged at all.
        bout.aim.set(ctx.playerGround.x, ctx.groundY, ctx.playerGround.z);
        footprintFromCone(ctx.mouth, bout.aim, bout.footprint);
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
        bout.phaseUntil = now + ATTACK_CLIP_S * 1000;
        ctx.playAttack?.();
      }
      break;

    case "breathe": {
      const elapsed = (now - bout.attackStartedAt) / 1000;

      if (!bout.resolvedThisAttack && elapsed >= FIRE_PEAK_S) {
        bout.resolvedThisAttack = true;
        const caught = isInsideFootprint(bout.footprint, ctx.playerGround);
        bout.dodgedLastAttack = !caught;

        if (caught) {
          bout.lives -= 1;
          bout.playerHitFlashUntil = now + 450;
          if (bout.lives <= 0) {
            bout.phase = "lost";
            bout.result = "lost";
            bout.phaseUntil = Infinity;
            return bout;
          }
        } else {
          // A clean dodge is itself progress, so the bout stays winnable with
          // no lasers at all -- see the fallback note in DragonScene.
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
