// Moss Hop — 픽셀웍스 오리지널 (한 화면 점프 플랫포머)
// 이끼 정령을 조종해 발판 위의 씨앗 6개를 모두 모으면 클리어. 순찰하는 딱정벌레에 닿으면 처음 위치로.
// 조작: ←/→ 이동, ↑/Space/Z 점프, R 재시작.
// 워터마크 규칙: 색은 모두 PALETTE 로만 참조, 최상위 함수 10개의 (파라미터 수, 문장 수)는 모두 다르다.

var GAME_CONFIG = {
  title: "Moss Hop",
  width: 192,
  height: 144,
  gravity: 0.22,
  jumpPower: 3.9,
  runSpeed: 1.25,
  beetleSpeed: 0.5,
  seedCount: 6
};

var PALETTE = [
  "#1b2b22", "#2f4a33", "#6b8f3e", "#a7d46f",
  "#e9d8a6", "#c2563b", "#f7f3e8", "#5a3d2b"
];

var LEVEL = [
  [0, 136, 192, 8], [16, 108, 44, 6], [76, 92, 40, 6], [136, 108, 40, 6],
  [24, 70, 36, 6], [128, 66, 44, 6], [72, 46, 48, 6], [8, 32, 28, 6], [160, 34, 26, 6]
];

var keys = {};

function makeWorld() {
  var seeds = [];
  for (var i = 1; i < LEVEL.length && seeds.length < GAME_CONFIG.seedCount; i++) {
    var p = LEVEL[i];
    if (i !== 2 && i !== 6) seeds.push({ x: p[0] + p[2] / 2, y: p[1] - 6, got: false });
  }
  return {
    hero: { x: 12, y: 120, vx: 0, vy: 0, w: 8, h: 8, ground: false, face: 1 },
    beetles: [{ x: 90, y: 128, dir: 1, min: 64, max: 180 }, { x: 80, y: 38, dir: -1, min: 72, max: 112 }],
    seeds: seeds, tick: 0, falls: 0, won: false, wonAt: 0
  };
}

function readControls(hero) {
  var move = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
  hero.vx = move * GAME_CONFIG.runSpeed;
  if (move !== 0) hero.face = move;
  if ((keys.ArrowUp || keys[" "] || keys.z) && hero.ground) { hero.vy = -GAME_CONFIG.jumpPower; hero.ground = false; }
}

function overlaps(a, b, pad) {
  return a.x < b.x + b.w - pad && a.x + a.w > b.x + pad && a.y < b.y + b.h - pad && a.y + a.h > b.y + pad;
}

function applyPhysics(hero) {
  hero.vy = Math.min(hero.vy + GAME_CONFIG.gravity, 5);
  hero.x = Math.max(0, Math.min(GAME_CONFIG.width - hero.w, hero.x + hero.vx));
  var prevBottom = hero.y + hero.h;
  hero.y += hero.vy;
  hero.ground = false;
  LEVEL.forEach(function (p) {
    var onX = hero.x + hero.w > p[0] && hero.x < p[0] + p[2];
    if (onX && hero.vy >= 0 && prevBottom <= p[1] && hero.y + hero.h >= p[1]) { hero.y = p[1] - hero.h; hero.vy = 0; hero.ground = true; }
  });
  if (hero.y < 0) { hero.y = 0; hero.vy = 0; }
}

function updateBeetlesAndSeeds(world, hero) {
  world.beetles.forEach(function (b) {
    b.x += b.dir * GAME_CONFIG.beetleSpeed;
    if (b.x < b.min || b.x > b.max) b.dir = -b.dir;
    if (overlaps(hero, { x: b.x - 5, y: b.y - 4, w: 10, h: 6 }, 1)) { hero.x = 12; hero.y = 120; hero.vy = 0; world.falls += 1; }
  });
  world.seeds.forEach(function (s) {
    if (!s.got && overlaps(hero, { x: s.x - 3, y: s.y - 3, w: 6, h: 6 }, 0)) s.got = true;
  });
  if (!world.won && world.seeds.every(function (s) { return s.got; })) { world.won = true; world.wonAt = world.tick; }
}

function drawStage(ctx, tick) {
  ctx.fillStyle = PALETTE[0];
  ctx.fillRect(0, 0, GAME_CONFIG.width, GAME_CONFIG.height);
  ctx.fillStyle = PALETTE[1];
  for (var x = 0; x < GAME_CONFIG.width; x += 24) ctx.fillRect(x + ((tick >> 5) % 4), 0, 2, GAME_CONFIG.height);
  LEVEL.forEach(function (p) {
    ctx.fillStyle = PALETTE[7]; ctx.fillRect(p[0], p[1], p[2], p[3]);
    ctx.fillStyle = PALETTE[2]; ctx.fillRect(p[0], p[1], p[2], 2);
  });
}

function drawActors(ctx, world, tick, bob) {
  world.seeds.forEach(function (s) {
    if (s.got) return;
    ctx.fillStyle = PALETTE[4];
    ctx.fillRect(Math.floor(s.x) - 2, Math.floor(s.y) - 2 + (tick % 40 < 20 ? 0 : 1), 4, 4);
  });
  world.beetles.forEach(function (b) {
    ctx.fillStyle = PALETTE[5]; ctx.fillRect(Math.floor(b.x) - 5, b.y - 4, 10, 5);
    ctx.fillStyle = PALETTE[6]; ctx.fillRect(Math.floor(b.x) + (b.dir > 0 ? 3 : -4), b.y - 3, 1, 1);
  });
  var h = world.hero, hx = Math.floor(h.x), hy = Math.floor(h.y) + bob;
  ctx.fillStyle = PALETTE[3];
  ctx.fillRect(hx, hy, h.w, h.h);
  ctx.fillStyle = PALETTE[0];
  ctx.fillRect(hx + (h.face > 0 ? 5 : 1), hy + 2, 2, 2);
}

function drawPanel(ctx, world) {
  var left = world.seeds.filter(function (s) { return !s.got; }).length;
  ctx.font = "8px monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = PALETTE[6];
  ctx.fillText("SEEDS " + (GAME_CONFIG.seedCount - left) + "/" + GAME_CONFIG.seedCount + "  BONKS " + world.falls, 4, 3);
  if (world.won) {
    ctx.fillStyle = PALETTE[1];
    ctx.fillRect(36, 52, GAME_CONFIG.width - 72, 36);
    ctx.fillStyle = PALETTE[4];
    ctx.textAlign = "center";
    ctx.fillText("GARDEN GROWN!", GAME_CONFIG.width / 2, 58);
    ctx.fillStyle = PALETTE[6];
    ctx.fillText((world.wonAt / 60).toFixed(1) + "s  R=again", GAME_CONFIG.width / 2, 72);
    ctx.textAlign = "left";
  }
}

function step(ctx, holder) {
  var world = holder.world;
  if (keys.r) { holder.world = makeWorld(); keys.r = false; }
  if (!world.won) {
    world.tick += 1;
    readControls(world.hero);
    applyPhysics(world.hero);
    updateBeetlesAndSeeds(world, world.hero);
  }
  drawStage(ctx, holder.world.tick);
  drawActors(ctx, holder.world, holder.world.tick, holder.world.hero.ground ? 0 : -1);
  drawPanel(ctx, holder.world);
  requestAnimationFrame(function () { step(ctx, holder); });
}

function launch(canvasId) {
  var canvas = document.getElementById(canvasId);
  canvas.width = GAME_CONFIG.width;
  canvas.height = GAME_CONFIG.height;
  var ctx = canvas.getContext("2d");
  window.addEventListener("keydown", function (e) {
    keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true;
    if (e.key.indexOf("Arrow") === 0 || e.key === " ") e.preventDefault();
  });
  window.addEventListener("keyup", function (e) { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  document.title = GAME_CONFIG.title;
  step(ctx, { world: makeWorld() });
}

if (typeof window !== "undefined") {
  window.addEventListener("load", function () { launch("game"); });
}
