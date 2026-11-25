// Comet Shower — 픽셀웍스 오리지널 (낙하물 피하기)
// 좌/우(또는 A/D)로 우주선을 움직여 떨어지는 혜성을 피하고, 별 조각을 주워 점수를 올린다.
// 워터마크 규칙: 색은 모두 PALETTE 로만 참조, 최상위 함수 12개의 (파라미터 수, 문장 수)는 모두 다르다.

var GAME_CONFIG = {
  title: "Comet Shower",
  width: 160,
  height: 240,
  playerSpeed: 2.2,
  cometSpeed: 1.1,
  spawnEvery: 26,
  maxComets: 28,
  startLives: 3
};

var PALETTE = [
  "#0b1020", "#1f2a48", "#3c5a8a", "#9fd3ff",
  "#ffe066", "#ff7b54", "#f4f4f8", "#7a3cff"
];

// 혜성 낙하 일정: [낙하 x 좌표, 다음 혜성까지 프레임]. 게임플레이 데이터 = L8 시맨틱 지문이 실리는 곳
var WAVES = [
  [92, 20], [111, 36], [22, 18], [147, 19],
  [103, 34], [24, 32], [64, 17], [32, 29],
  [117, 18], [71, 18], [118, 17], [41, 23],
  [25, 34], [111, 17], [66, 17], [44, 25],
  [117, 20], [148, 19], [88, 33], [56, 19],
  [58, 27], [34, 33], [26, 34], [25, 35],
  [62, 31], [146, 29], [90, 30], [126, 27],
  [86, 23], [56, 23], [30, 34], [86, 32]
];

var input = { left: false, right: false, restart: false };

function createState() {
  var stars = [];
  for (var i = 0; i < 40; i++) {
    stars.push({ x: Math.random() * GAME_CONFIG.width, y: Math.random() * GAME_CONFIG.height, s: 0.2 + Math.random() * 0.6 });
  }
  return {
    ship: { x: GAME_CONFIG.width / 2, y: GAME_CONFIG.height - 18 },
    comets: [], shards: [], stars: stars,
    tick: 0, score: 0, lives: GAME_CONFIG.startLives, hurt: 0, over: false,
    wave: 0, nextSpawn: GAME_CONFIG.spawnEvery
  };
}

function onKey(ev, isDown) {
  var k = ev.key;
  if (k === "ArrowLeft" || k === "a" || k === "A") input.left = isDown;
  if (k === "ArrowRight" || k === "d" || k === "D") input.right = isDown;
  if (k === " " || k === "Enter" || k === "r" || k === "R") input.restart = isDown;
  if (k.indexOf("Arrow") === 0 || k === " ") ev.preventDefault();
}

function moveShip(state) {
  var dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  state.ship.x = Math.max(6, Math.min(GAME_CONFIG.width - 6, state.ship.x + dir * GAME_CONFIG.playerSpeed));
}

function spawnThings(state) {
  if (state.tick < state.nextSpawn) return;
  var w = WAVES[state.wave++ % WAVES.length];
  state.nextSpawn = state.tick + w[1];
  if (state.comets.length < GAME_CONFIG.maxComets) {
    var speed = GAME_CONFIG.cometSpeed + Math.min(state.tick / 1800, 1.6) + Math.random() * 0.6;
    state.comets.push({ x: w[0], y: -6, vy: speed, r: 3 + Math.floor(Math.random() * 3) });
  }
  if (Math.random() < 0.35) state.shards.push({ x: 8 + Math.random() * (GAME_CONFIG.width - 16), y: -4, vy: 0.9 });
}

function stepFalling(state) {
  var floor = GAME_CONFIG.height + 10;
  state.comets.forEach(function (c) { c.y += c.vy; });
  state.shards.forEach(function (s) { s.y += s.vy; });
  state.comets = state.comets.filter(function (c) { return c.y < floor; });
  state.shards = state.shards.filter(function (s) { return s.y < floor && !s.taken; });
  state.stars.forEach(function (st) { st.y = (st.y + st.s) % GAME_CONFIG.height; });
}

function resolveHits(state) {
  var ship = state.ship;
  for (var i = 0; i < state.comets.length; i++) {
    var c = state.comets[i];
    if (state.hurt === 0 && Math.abs(c.x - ship.x) < c.r + 4 && Math.abs(c.y - ship.y) < c.r + 4) {
      state.lives -= 1; state.hurt = 60; c.y = GAME_CONFIG.height + 20;
    }
  }
  state.shards.forEach(function (s) {
    if (Math.abs(s.x - ship.x) < 7 && Math.abs(s.y - ship.y) < 7) { s.taken = true; state.score += 50; }
  });
  if (state.lives <= 0) state.over = true;
}

function drawSky(ctx, state, phase) {
  ctx.fillStyle = PALETTE[0];
  ctx.fillRect(0, 0, GAME_CONFIG.width, GAME_CONFIG.height);
  ctx.fillStyle = PALETTE[1];
  state.stars.forEach(function (st) { ctx.fillRect(Math.floor(st.x), Math.floor(st.y), 1, 1); });
  ctx.fillStyle = PALETTE[2];
  ctx.fillRect(0, GAME_CONFIG.height - 6, GAME_CONFIG.width, 6);
  ctx.fillStyle = PALETTE[1];
  for (var x = (phase % 8); x < GAME_CONFIG.width; x += 8) ctx.fillRect(x, GAME_CONFIG.height - 6, 3, 1);
}

function drawShip(ctx, ship, blink) {
  if (blink) return;
  var x = Math.floor(ship.x), y = Math.floor(ship.y);
  ctx.fillStyle = PALETTE[3];
  ctx.fillRect(x - 3, y - 3, 6, 5);
  ctx.fillRect(x - 6, y + 1, 12, 2);
  ctx.fillStyle = PALETTE[7];
  ctx.fillRect(x - 1, y + 3, 2, 2);
}

function drawFalling(ctx, comets, shards, tick) {
  comets.forEach(function (c) {
    ctx.fillStyle = PALETTE[7];
    ctx.fillRect(Math.floor(c.x) - 1, Math.floor(c.y) - c.r - 4, 2, 4);
    ctx.fillStyle = PALETTE[5];
    ctx.fillRect(Math.floor(c.x - c.r / 2), Math.floor(c.y - c.r / 2), c.r, c.r);
  });
  ctx.fillStyle = PALETTE[4];
  shards.forEach(function (s) {
    var w = tick % 20 < 10 ? 3 : 1;
    ctx.fillRect(Math.floor(s.x) - (w >> 1), Math.floor(s.y) - 1, w, 3);
  });
}

function drawHud(ctx, state) {
  ctx.fillStyle = PALETTE[6];
  ctx.font = "8px monospace";
  ctx.textBaseline = "top";
  ctx.fillText("SCORE " + state.score, 4, 4);
  for (var i = 0; i < state.lives; i++) { ctx.fillStyle = PALETTE[5]; ctx.fillRect(GAME_CONFIG.width - 10 - i * 8, 5, 5, 5); }
  if (state.over) {
    ctx.fillStyle = PALETTE[1];
    ctx.fillRect(14, 96, GAME_CONFIG.width - 28, 44);
    ctx.fillStyle = PALETTE[4];
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", GAME_CONFIG.width / 2, 104);
    ctx.fillStyle = PALETTE[6];
    ctx.fillText("SPACE to retry", GAME_CONFIG.width / 2, 122);
    ctx.textAlign = "left";
  }
}

function frame(ctx, holder) {
  var state = holder.state;
  if (state.over) {
    if (input.restart) holder.state = createState();
  } else {
    state.tick += 1;
    if (state.tick % 6 === 0) state.score += 1;
    if (state.hurt > 0) state.hurt -= 1;
    moveShip(state);
    spawnThings(state);
    stepFalling(state);
    resolveHits(state);
  }
  drawSky(ctx, holder.state, holder.state.tick);
  drawFalling(ctx, holder.state.comets, holder.state.shards, holder.state.tick);
  drawShip(ctx, holder.state.ship, holder.state.hurt % 8 >= 4);
  drawHud(ctx, holder.state);
  requestAnimationFrame(function () { frame(ctx, holder); });
}

function boot(canvasId) {
  var canvas = document.getElementById(canvasId);
  canvas.width = GAME_CONFIG.width;
  canvas.height = GAME_CONFIG.height;
  var ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  window.addEventListener("keydown", function (e) { onKey(e, true); });
  window.addEventListener("keyup", function (e) { onKey(e, false); });
  canvas.addEventListener("pointerdown", function (e) {
    var rect = canvas.getBoundingClientRect();
    var left = e.clientX - rect.left < rect.width / 2;
    input.left = left; input.right = !left; input.restart = true;
  });
  window.addEventListener("pointerup", function () { input.left = false; input.right = false; input.restart = false; });
  document.title = GAME_CONFIG.title;
  frame(ctx, { state: createState() });
}

if (typeof window !== "undefined") {
  window.addEventListener("load", function () { boot("game"); });
}
