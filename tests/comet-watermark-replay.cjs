const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");

const args = process.argv.slice(2);
const root = path.resolve(args.find((arg) => arg !== "--json") || path.join(__dirname, ".."));
const requireFromGame = createRequire(path.join(root, "lambda", "package.json"));
const { zipSync } = requireFromGame("fflate");
const wm = requireFromGame("./lib/watermark");
const { inspectPackage, buildFor, readPackage } = requireFromGame("./lib/pkg");

const gameDir = path.join(root, "games", "comet-shower");
const files = Object.fromEntries(["manifest.json", "index.html", "game.js"].map(
  (name) => [name, fs.readFileSync(path.join(gameDir, name))]
));
const source = files["game.js"].toString("utf8");
const pkg = inspectPackage(zipSync(files));
const reference = pkg.references["game.js"];
const options = { secret: "comet-watermark-replay-fixture-v1" };
const frames = 800;
const seeds = [2026, 2027, 2028];
const marks = [17, 42, 203];

function replaceTable(code, name, rows) {
  for (const node of wm.parse(code).body) {
    if (node.type !== "VariableDeclaration") continue;
    for (const decl of node.declarations) {
      if (decl.id.type !== "Identifier" || decl.id.name !== name) continue;
      const { start, end } = decl.init;
      return code.slice(0, start) + JSON.stringify(rows) + code.slice(end);
    }
  }
  throw new Error(`Table not found: ${name}`);
}

function replay(code, seed) {
  let randomState = seed;
  const math = Object.create(Math);
  math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 2 ** 32;
  };
  const game = vm.createContext({ Math: math, requestAnimationFrame() {} });
  vm.runInContext(code, game, { timeout: 1000 });
  const holder = { state: game.createState() };
  const canvas = { fillRect() {}, fillText() {} };
  const spawns = [];
  const states = [];
  const spawn = game.spawnThings;
  game.spawnThings = function (state) {
    const previous = state.comets.length;
    spawn(state);
    if (state.comets.length > previous) spawns.push([state.tick, state.comets.at(-1).x]);
  };
  let error = null;
  for (let frame = 0; frame < frames; frame++) {
    const direction = Math.floor(frame / 73) % 4;
    game.onKey({ key: "ArrowLeft", preventDefault() {} }, direction === 1);
    game.onKey({ key: "ArrowRight", preventDefault() {} }, direction === 3);
    try {
      game.frame(canvas, holder);
    } catch (err) {
      error = { frame: frame + 1, tick: holder.state.tick, type: err.name };
      break;
    }
    const state = holder.state;
    states.push([state.score, state.lives, state.over]);
  }
  return { error, spawns, states };
}

const cleanReplay = replay(source, seeds[0]);
assert.equal(cleanReplay.error, null);
const candidates = reference.tables.map(({ name }) => {
  const result = replay(replaceTable(source, name, []), seeds[0]);
  return {
    name,
    error: result.error,
    changesSpawnSchedule: JSON.stringify(result.spawns) !== JSON.stringify(cleanReplay.spawns)
  };
});
const required = candidates.filter((item) => item.error && item.changesSpawnSchedule);
assert.equal(required.length, 1, "Expected one required table in the Comet Shower fixture");
const tableName = required[0].name;

function compare(result, baseline) {
  let matches = 0;
  let firstSpawnMismatch = null;
  for (let index = 0; index < Math.max(result.spawns.length, baseline.spawns.length); index++) {
    const actual = result.spawns[index] || null;
    const expected = baseline.spawns[index] || null;
    if (JSON.stringify(actual) === JSON.stringify(expected)) matches++;
    else if (!firstSpawnMismatch) firstSpawnMismatch = { event: index + 1, expected, actual };
  }
  const firstStateMismatch = baseline.states.findIndex(
    (state, index) => JSON.stringify(state) !== JSON.stringify(result.states[index])
  );
  const [score, lives, gameOver] = result.states.at(-1);
  return {
    error: result.error,
    completedFrames: result.states.length,
    spawns: result.spawns.length,
    expectedSpawns: baseline.spawns.length,
    matchingSpawns: matches,
    firstSpawnMismatch,
    firstScoreLifeOrGameOverMismatch: firstStateMismatch < 0 ? null : firstStateMismatch + 1,
    score,
    lives,
    gameOver,
    spawnTrace: result.spawns
  };
}

const runs = marks.map((mark) => {
  const artifact = buildFor(pkg, mark, options);
  const issued = Buffer.from(readPackage(artifact.zip)["game.js"]).toString("utf8");
  const { rows } = wm.semanticReference(issued).tables.find(({ name }) => name === tableName);
  const rounded = rows.map((row) => row.map((value) => Math.round(value / 8) * 8));
  // Use the clean game as a controlled reconstruction of the logic. Only the table varies.
  const variants = [
    ["issued", issued],
    ["retained", replaceTable(source, tableName, rows)],
    ["omitted", replaceTable(source, tableName, [])],
    ["rounded", replaceTable(source, tableName, rounded)],
    ["unmarked-source", source]
  ];
  const baselines = seeds.map((seed) => {
    const result = replay(issued, seed);
    assert.equal(result.error, null);
    assert.equal(result.states.length, frames);
    assert.ok(result.spawns.length > 0);
    return result;
  });
  const cases = variants.map(([variant, code]) => {
    const fingerprint = wm.extract(code, { ...options, reference });
    return {
      variant,
      markId: fingerprint.markId,
      decision: fingerprint.decision,
      layers: fingerprint.agreeingLayers,
      z: fingerprint.layers.L8.z ?? null,
      replays: seeds.map((seed, index) => ({ seed, ...compare(replay(code, seed), baselines[index]) }))
    };
  });
  for (const trial of cases) {
    const expectedMark = ["issued", "retained"].includes(trial.variant) ? mark : null;
    assert.equal(trial.markId, expectedMark, trial.variant);
    if (trial.variant === "retained") assert.deepEqual(trial.layers, ["L8"]);
    for (const run of trial.replays) {
      assert.equal(run.error?.tick ?? null, trial.variant === "omitted" ? 26 : null);
      assert.equal(
        run.firstSpawnMismatch === null,
        ["issued", "retained"].includes(trial.variant),
        trial.variant
      );
      if (trial.variant === "retained") assert.equal(run.firstScoreLifeOrGameOverMismatch, null);
      if (trial.variant === "rounded" || trial.variant === "unmarked-source") {
        assert.notEqual(run.firstScoreLifeOrGameOverMismatch, null, trial.variant);
      }
    }
  }
  return { mark, zipSha256: artifact.sha256, cases };
});

const report = {
  game: pkg.manifest.name,
  node: process.version,
  sourceSha256: crypto.createHash("sha256").update(source, "utf8").digest("hex"),
  frames,
  candidateProbeSeed: seeds[0],
  seeds,
  candidates,
  selectedTable: tableName,
  carriers: reference.carriers,
  runs
};

if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`${report.game} | ${tableName} | ${reference.carriers} values | ${frames} frames per replay`);
  console.table(runs.flatMap(({ mark, cases }) => cases.map((trial) => ({
    mark,
    variant: trial.variant,
    detected: trial.markId ?? "-",
    layers: trial.layers.join(","),
    z: trial.z ?? "-",
    exactSpawns: `${trial.replays.reduce((n, run) => n + run.matchingSpawns, 0)}/${trial.replays.reduce((n, run) => n + run.expectedSpawns, 0)}`,
    runtimeError: `${trial.replays.filter((run) => run.error).length}/${seeds.length}`,
    changedOutcome: `${trial.replays.filter((run) => !run.error && run.firstScoreLifeOrGameOverMismatch !== null).length}/${seeds.length}`
  }))));
}
