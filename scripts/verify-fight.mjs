/**
 * Drives Round 4 in a real browser and asserts the fight actually works.
 *
 * WHY THIS EXISTS
 *
 * Every bug this round was invisible to `next build` and to a screenshot. All
 * three were found by driving the running page and reading the bout back:
 *
 *   - Laser hits landed or silently did nothing depending on frame timing.
 *     three's SkinnedMesh.raycast caches a bounding sphere computed from
 *     whatever pose the skeleton was in the first time anything raycast it,
 *     and this rig has no rest pose until the idle clip binds.
 *   - The dodge did not move you. An object literal passed as <Canvas camera>
 *     is a new identity every render, so r3f kept re-applying it and snapping
 *     the camera back -- exactly one frame of travel, forever.
 *   - The strike-zone ring was invisible in first person, because it is always
 *     centred on your own feet while you are looking at the dragon.
 *
 * None of those throw. The page renders a dragon and looks fine.
 *
 * USAGE
 *   npm run dev                       # in another shell, on :3111
 *   node scripts/verify-fight.mjs
 *
 * Needs playwright-core and a local Chrome; deliberately NOT a dependency of
 * this app, so the production image stays free of a browser-driver it never
 * runs. Install it wherever you are running the check:
 *   npm i --no-save playwright-core
 */

const URL = process.env.DRAGON_URL || "http://localhost:3111/?nocam=1";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error(
    "playwright-core is not installed.\n" +
      "  npm i --no-save playwright-core\n" +
      "It is intentionally not a dependency of this app -- see the header of this file.",
  );
  process.exit(2);
}

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"}  ${label}${detail ? `  -- ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  // swiftshader so this runs the same on a CI box with no GPU.
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function openFight({ tilt = false, viewport = { width: 900, height: 1150 } } = {}) {
  const page = await browser.newPage({ viewport });
  if (tilt) {
    /* Stand in for a phone's motion sensor, and start BEFORE any app code
       runs -- a real sensor is already live at page load and the scene only
       waits ~900ms for it. Pumping from a later evaluate() raced that window
       and made the phone path look like the desktop one. */
    await page.addInitScript(() => {
      window.__alpha = 0;
      const pump = () => {
        const e = new Event("deviceorientation");
        Object.defineProperties(e, {
          alpha: { value: window.__alpha }, beta: { value: 70 },
          gamma: { value: 0 }, absolute: { value: true },
        });
        window.dispatchEvent(e);
        requestAnimationFrame(pump);
      };
      requestAnimationFrame(pump);
    });
  }
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  page.on("pageerror", (e) => { failures += 1; console.log("FAIL  page error  --", e.message); });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__dragonBout && window.__dragonFire, null, { timeout: 30000 });
  await page.evaluate(() => document.querySelector("canvas").scrollIntoView({ block: "center" }));
  return { page, logs };
}

/* Wait for a specific line rather than for a phase. The rig confirms its
   measured height on a fixed FRAME number, and under swiftshader the frame
   rate is low enough that the frame lands after the bout has already started
   -- polling a phase raced it and reported a missing measurement as a failed
   one, which is a worse lie than either. */
async function waitForLog(logs, needle, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const hit = logs.find((l) => l.includes(needle));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

const read = (page) =>
  page.evaluate(() => {
    const b = window.__dragonBout;
    const r = (v) => Math.round(v * 100) / 100;
    return {
      phase: b.phase, hp: b.hp, lives: b.lives, result: b.result,
      inside: !!b.playerInside,
      player: b.debugPlayer ? { x: r(b.debugPlayer.x), z: r(b.debugPlayer.z) } : null,
    };
  });
const waitPhase = (page, p, t = 16000) =>
  page.waitForFunction((ph) => window.__dragonBout.phase === ph, p, { timeout: t, polling: 20 });
const fire = (page, x = 0, y = 0.05) =>
  page.evaluate(([a, b]) => window.__dragonFire(a, b), [x, y]);

/* ================= the winning run ================= */
{
  const { page, logs } = await openFight();

  /* The rig reports what it measured. Assert the numbers, not just that it
     rendered -- a scale solve that silently missed looks identical to one
     that worked, and a bone lookup that matched nothing looks like success. */
  const measured = await waitForLog(logs, "standing height");
  const anchored = logs.find((l) => l.includes("mouth anchored to"));
  const dropped = logs.find((l) => l.includes("[retargetClipByName] dropped"));
  check("mouth bones resolved on the rig", Boolean(anchored), anchored);
  check("no animation tracks were dropped", !dropped, dropped);
  const height = measured && Number(measured.match(/standing height ([\d.]+) m/)?.[1]);
  check("dragon stands ~6 m tall", height > 5.7 && height < 6.3, measured || "no measurement logged");

  await waitPhase(page, "stalk");

  const hp0 = (await read(page)).hp;
  await fire(page);
  await page.waitForTimeout(450);
  const hp1 = (await read(page)).hp;
  check("a laser hit damages the dragon", hp1 < hp0, `hp ${hp0} -> ${hp1}`);

  await page.waitForTimeout(250);
  await fire(page, -0.95, 0.92);
  await page.waitForTimeout(450);
  const hp2 = (await read(page)).hp;
  check("a shot into empty sky does not", hp2 === hp1, `hp ${hp1} -> ${hp2}`);

  await waitPhase(page, "telegraph");
  const atLock = await read(page);
  check("the strike zone lands on the player", atLock.inside === true, JSON.stringify(atLock));

  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(600);
  await page.keyboard.up("ArrowRight");
  const stepped = await read(page);
  /* Movement is delta-timed, so the distance covered in a fixed wall-clock
     window depends on how many frames actually rendered -- under swiftshader
     with the whole suite running that can be half of what a real GPU manages
     (2.8 m idle, 1.3 m loaded). So this asserts that you moved at all and
     that you got clear; the metre count is not the contract, escaping is. */
  check("stepping aside actually moves you", Math.abs(stepped.player.x) > 0.8, JSON.stringify(stepped.player));
  check("stepping aside clears the strike zone", stepped.inside === false);

  const livesBefore = stepped.lives;
  await waitPhase(page, "breathe");
  await page.waitForTimeout(1350);
  const burned = await read(page);
  check("a clean dodge costs no life", burned.lives === livesBefore, JSON.stringify(burned));

  const winded = await waitPhase(page, "winded", 5000).then(() => true).catch(() => false);
  check("a clean dodge opens the punish window", winded);
  if (winded) {
    const w0 = (await read(page)).hp;
    await fire(page);
    await page.waitForTimeout(430);
    const w1 = (await read(page)).hp;
    check("winded hits do more damage", w0 - w1 > 5, `drop ${w0 - w1}, base is 5`);
  }

  const deadline = Date.now() + 80000;
  while (Date.now() < deadline) {
    const s = await read(page);
    if (s.result) break;
    if (s.phase === "telegraph") {
      await page.keyboard.down("ArrowRight");
      await page.waitForTimeout(620);
      await page.keyboard.up("ArrowRight");
      continue;
    }
    await fire(page);
    await page.waitForTimeout(200);
  }
  const won = await read(page);
  check("the dragon can be beaten", won.result === "won", JSON.stringify(won));
  await page.close();
}

/* ================= the losing run =================
   Stand still and take it. Two hits must end the bout -- if the strike zone
   ever stopped resolving, every check above would still pass and the fight
   would simply have no stakes. */
{
  const { page } = await openFight();
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const s = await read(page);
    if (s.result) break;
    await page.waitForTimeout(250);
  }
  const lost = await read(page);
  check("standing still loses the bout in two hits", lost.result === "lost" && lost.lives === 0, JSON.stringify(lost));
  await page.close();
}

/* ================= placement, on a phone =================
   The dragon has to stand somewhere in the room and STAY there when you turn
   away from it. The camera path used to pin it dead-centre with a lookAt
   every frame, which is not a dragon in your room -- it is a dragon stuck to
   your lens, and no screenshot of it looks any different. */
{
  const { page } = await openFight({ tilt: true, viewport: { width: 500, height: 900 } });

  const state = () =>
    page.evaluate(() => {
      const b = window.__dragonBout;
      const r = (v) => Math.round(v * 100) / 100;
      return {
        placed: !!b.debugPlaced, oriented: !!b.debugOriented,
        dragon: b.debugDragon ? { x: r(b.debugDragon.x), z: r(b.debugDragon.z) } : null,
        facing: b.debugFacing ? { x: r(b.debugFacing.x), z: r(b.debugFacing.z) } : null,
        player: b.debugPlayer ? { x: r(b.debugPlayer.x), z: r(b.debugPlayer.z) } : null,
      };
    });

  await page.waitForTimeout(500);
  const before = await state();
  check("device tilt is picked up as the camera", before.oriented === true, JSON.stringify(before));
  check("it waits for you to choose the spot", before.placed === false, JSON.stringify(before));

  await page.getByRole("button", { name: /place the dragon/i }).click();
  await page.waitForTimeout(400);
  const placed = await state();
  check("placing gives it a spot in the room", placed.placed === true, JSON.stringify(placed.dragon));

  const out = Math.hypot(placed.dragon.x - placed.player.x, placed.dragon.z - placed.player.z);
  check("it stands ~9 m from you", out > 7 && out < 11, `${out.toFixed(2)} m`);

  for (const a of [30, 60, 90, 120]) {
    await page.evaluate((v) => { window.__alpha = v; }, a);
    await page.waitForTimeout(140);
  }
  await page.waitForTimeout(400);
  const turned = await state();
  const viewMoved = Math.hypot(turned.facing.x - placed.facing.x, turned.facing.z - placed.facing.z);
  const dragonMoved = Math.hypot(turned.dragon.x - placed.dragon.x, turned.dragon.z - placed.dragon.z);
  check("turning the phone turns the view", viewMoved > 0.3, `facing moved ${viewMoved.toFixed(2)}`);
  check("the dragon holds its spot while you turn", dragonMoved < 0.01, `moved ${dragonMoved.toFixed(4)} m`);

  /* THE ESCAPE. A phone cannot track you walking, so the on-screen pad is the
     only thing that moves you -- and if it does not get you clear of the
     strike zone, the zone is centred on you forever and the dodge is a lie.
     Driven through the real pad button, not the keyboard, because that is the
     only control a phone actually has. */
  await page.waitForFunction(() => window.__dragonBout.phase === "telegraph", null,
    { timeout: 20000, polling: 20 });
  const caught = await page.evaluate(() => !!window.__dragonBout.playerInside);
  check("the strike zone starts on you", caught === true);

  const pad = page.getByRole("button", { name: /step right/i });
  await pad.dispatchEvent("pointerdown");
  await page.waitForTimeout(700);
  await pad.dispatchEvent("pointerup");
  const escaped = await page.evaluate(() => {
    const b = window.__dragonBout;
    const r = (v) => Math.round(v * 100) / 100;
    return { inside: !!b.playerInside, player: { x: r(b.debugPlayer.x), z: r(b.debugPlayer.z) } };
  });
  check("the pad gets you out of the strike zone", escaped.inside === false, JSON.stringify(escaped));

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nAll fight checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
