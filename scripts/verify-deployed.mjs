/**
 * Confirms which commit is actually SERVING, from outside, with no credentials.
 *
 * WHY: this app has no CI and no version endpoint, and it has already sat a
 * commit behind HEAD while every page returned 200. "The site is up" is not
 * evidence that your change shipped.
 *
 * Server-rendered copy is the cheap stamp -- one curl -- but it only works for
 * commits that change visible text. Anything behaviour-only lives in the
 * Three.js scene, which is a dynamic import, so its code sits in a lazy chunk
 * the HTML never names. The webpack runtime manifest does name every chunk the
 * app can load, not as paths (a plain grep of it finds nothing) but as an
 * id -> contenthash map. Rebuild the filenames from that and the lazy chunks
 * are fetchable.
 *
 * THE CONTROL IS NOT OPTIONAL. A chunk search that finds nothing is only
 * evidence if the same search finds something you know is there. Without that
 * gate a missing string reads as "not deployed" when the truth may be "this
 * search never looked at the right files" -- a real failure mode: run against
 * a sibling app this same technique resolved 22 chunks and found zero hits for
 * three strings that were definitely in the build, because those chunks are
 * only registered after login. Credit to carver-sim-game-interface for
 * catching that by running a control before trusting a no-hit.
 *
 * Usage:
 *   node scripts/verify-deployed.mjs \
 *     --control "Place the dragon" \
 *     --expect  "Step right"
 *
 * Exit 0 = every --expect found. Exit 1 = something is genuinely missing.
 * Exit 2 = the method itself failed its control; the result means nothing.
 */

const args = process.argv.slice(2);
const takeAll = (flag) =>
  args.reduce((acc, a, i) => (a === flag && args[i + 1] ? [...acc, args[i + 1]] : acc), []);
const takeOne = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = takeOne("--url", "https://dragonrematch.carveresq.com").replace(/\/$/, "");
const controls = takeAll("--control");
const expects = takeAll("--expect");

if (!controls.length || !expects.length) {
  console.error("need at least one --control and one --expect (see header)");
  process.exit(2);
}

const get = async (url) => {
  const res = await fetch(url, { headers: { "accept-encoding": "gzip" } });
  if (!res.ok) return null;
  return res.text();
};

const html = await get(`${BASE}/`);
if (!html) { console.error(`could not fetch ${BASE}/`); process.exit(2); }

const wp = html.match(/\/_next\/static\/chunks\/webpack-[a-z0-9]+\.js/)?.[0];
if (!wp) { console.error("no webpack runtime manifest in the served HTML"); process.exit(2); }

const manifest = await get(`${BASE}${wp}`);
if (!manifest) { console.error(`could not fetch ${wp}`); process.exit(2); }

/* Hashes in the manifest map are shorter than the ones spelled out in the
   HTML, hence the loose lower bound. */
const chunks = new Set();
for (const m of manifest.matchAll(/([0-9]+):"([a-f0-9]{8,})"/g)) chunks.add(`${m[1]}.${m[2]}`);
for (const m of html.matchAll(/\/_next\/static\/chunks\/([A-Za-z0-9._/-]+)\.js/g)) chunks.add(m[1]);

console.log(`${BASE}`);
console.log(`manifest ${wp.split("/").pop()}  ->  ${chunks.size} chunks\n`);

const bodies = [["served HTML", html]];
await Promise.all(
  [...chunks].map(async (c) => {
    const body = await get(`${BASE}/_next/static/chunks/${c}.js`);
    if (body) bodies.push([`${c}.js`, body]);
  }),
);
console.log(`fetched ${bodies.length} documents (HTML + chunks)\n`);

const findIn = (needle) => bodies.filter(([, b]) => b.includes(needle)).map(([n]) => n);

let controlOk = true;
for (const c of controls) {
  const where = findIn(c);
  console.log(`control  ${JSON.stringify(c)}  -> ${where.length ? where.join(", ") : "NOT FOUND"}`);
  if (!where.length) controlOk = false;
}

if (!controlOk) {
  console.log(
    "\nCONTROL FAILED. A string known to be in the running build was not found, " +
    "so this search is not looking at the right files and a miss below would " +
    "mean nothing. Reporting no result rather than a wrong one.",
  );
  process.exit(2);
}

console.log("");
let missing = 0;
for (const e of expects) {
  const where = findIn(e);
  if (!where.length) missing += 1;
  console.log(`expect   ${JSON.stringify(e)}  -> ${where.length ? where.join(", ") : "NOT FOUND"}`);
}

console.log(
  missing === 0
    ? "\nAll expected strings are being served."
    : `\n${missing} expected string(s) NOT served -- that commit is not live.`,
);
process.exit(missing === 0 ? 0 : 1);
