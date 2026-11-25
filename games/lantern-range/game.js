// Lantern Range — 픽셀웍스 오리지널 (표적 맞추기)
// 밤하늘을 떠다니는 등불을 클릭해 터뜨린다. 파란 등불은 감점, 연속 명중은 콤보 보너스. 제한 시간 40초.
// 워터마크 규칙: 색은 모두 PALETTE 로만 참조, 최상위 함수 11개의 (파라미터 수, 문장 수)는 모두 다르다.

var GAME_CONFIG = {
  title: "Lantern Range",
  width: 200,
  height: 150,
  roundSeconds: 40,
  spawnGap: 34,
  lanternSpeed: 0.55,
  decoyChance: 0.22,
  comboBonus: 5
};

var PALETTE = [
  "#140c1c", "#2a1d3a", "#44355b", "#ffb347",
  "#ff5e5b", "#56c2e6", "#fdf6e3", "#9cdb43"
];

// 등불 비행 경로: [높이 y, 속도 %]. 게임플레이 데이터 = L8 시맨틱 지문이 실리는 곳
var FLIGHTS = [
  [93, 113], [87, 106], [107, 79], [45, 135],
  [83, 91], [73, 89], [92, 123], [35, 79],
  [101, 110], [73, 114], [106, 133], [104, 128],
  [38, 81], [64, 130], [115, 78], [37, 109],
  [112, 127], [66, 119], [115, 114], [32, 129],
  [75, 91], [108, 84], [93, 77], [57, 106],
  [46, 101], [80, 120], [93, 80], [51, 127],
  [81, 140], [65, 87], [85, 140], [65, 123]
];

var pointer = { x: -1, y: -1, clicked: false };

function newRound() {
  return {
    lanterns: [], sparks: [], tick: 0, score: 0, combo: 0,
    left: GAME_CONFIG.roundSeconds * 60, best: 0, done: false, launched: 0
  };
}

function launchLantern(state) {
  var f = FLIGHTS[state.launched++ % FLIGHTS.length], decoy = Math.random() < GAME_CONFIG.decoyChance, fromLeft = Math.random() < 0.5;
  state.lanterns.push({
    x: fromLeft ? -8 : GAME_CONFIG.width + 8,
    y: f[0],
    vx: (fromLeft ? 1 : -1) * GAME_CONFIG.lanternSpeed * f[1] / 100,
    sway: Math.random() * 6.28, decoy: decoy, size: decoy ? 5 : 6 + Math.floor(Math.random() * 3)
  });
}

function driftLanterns(state) {
  state.lanterns.forEach(function (l) {
    l.x += l.vx;
    l.sway += 0.05;
    l.y += Math.sin(l.sway) * 0.3;
  });
  state.lanterns = state.lanterns.filter(function (l) { return l.x > -12 && l.x < GAME_CONFIG.width + 12 && !l.popped; });
  state.sparks.forEach(function (p) { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= 1; });
  state.sparks = state.sparks.filter(function (p) { return p.life > 0; });
}

function burst(state, x, y, colorIndex) {
  for (var i = 0; i < 10; i++) {
    var a = (i / 10) * 6.28;
    state.sparks.push({ x: x, y: y, vx: Math.cos(a) * 1.2, vy: Math.sin(a) * 1.2 - 0.4, life: 22, c: colorIndex });
  }
}

function takeShot(state, px, py, now) {
  var hit = null;
  for (var i = state.lanterns.length - 1; i >= 0; i--) {
    var l = state.lanterns[i];
    if (Math.abs(px - l.x) <= l.size && Math.abs(py - l.y) <= l.size + 2) { hit = l; break; }
  }
  if (!hit) { state.combo = 0; return now; }
  hit.popped = true;
  if (hit.decoy) {
    state.score = Math.max(0, state.score - 20); state.combo = 0; burst(state, hit.x, hit.y, 5);
  } else {
    state.combo += 1; state.score += 10 + (state.combo - 1) * GAME_CONFIG.comboBonus; burst(state, hit.x, hit.y, 3);
  }
  state.best = Math.max(state.best, state.combo);
  return now;
}

function paintBackdrop(ctx) {
  var w = GAME_CONFIG.width, h = GAME_CONFIG.height;
  ctx.fillStyle = PALETTE[0];
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PALETTE[1];
  ctx.fillRect(0, h - 30, w, 30);
  ctx.fillStyle = PALETTE[2];
  for (var x = 0; x < w; x += 16) ctx.fillRect(x, h - 30 - ((x * 7) % 11), 10, 30);
  ctx.fillStyle = PALETTE[6];
  ctx.fillRect(w - 30, 14, 8, 8);
}

function paintLanterns(ctx, lanterns, sparks, t, glow) {
  lanterns.forEach(function (l) {
    var x = Math.floor(l.x), y = Math.floor(l.y), s = l.size;
    if (glow && !l.decoy) { ctx.fillStyle = PALETTE[2]; ctx.fillRect(x - s - 2, y - s - 2, s * 2 + 4, s * 2 + 6); }
    ctx.fillStyle = l.decoy ? PALETTE[5] : (t % 30 < 15 ? PALETTE[3] : PALETTE[4]);
    ctx.fillRect(x - s, y - s, s * 2, s * 2 + 2);
    ctx.fillStyle = PALETTE[6];
    ctx.fillRect(x - 1, y - s - 3, 2, 3);
  });
  sparks.forEach(function (p) { ctx.fillStyle = PALETTE[p.c]; ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1); });
}

function paintCrosshair(ctx, x, y) {
  if (x < 0) return;
  ctx.fillStyle = PALETTE[7];
  ctx.fillRect(x - 5, y, 3, 1);
  ctx.fillRect(x + 3, y, 3, 1);
  ctx.fillRect(x, y - 5, 1, 3);
  ctx.fillRect(x, y + 3, 1, 3);
}

function paintHud(ctx, state) {
  ctx.font = "8px monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = PALETTE[6];
  ctx.fillText("SCORE " + state.score, 4, 4);
  ctx.fillText("TIME " + Math.ceil(state.left / 60), GAME_CONFIG.width - 50, 4);
  if (state.combo > 1) { ctx.fillStyle = PALETTE[7]; ctx.fillText("x" + state.combo + " COMBO", 4, 14); }
  if (state.done) {
    ctx.fillStyle = PALETTE[1];
    ctx.fillRect(30, 50, GAME_CONFIG.width - 60, 48);
    ctx.fillStyle = PALETTE[3];
    ctx.textAlign = "center";
    ctx.fillText("TIME UP  " + state.score + " pts", GAME_CONFIG.width / 2, 58);
    ctx.fillStyle = PALETTE[6];
    ctx.fillText("best combo " + state.best, GAME_CONFIG.width / 2, 72);
    ctx.fillText("click to play again", GAME_CONFIG.width / 2, 84);
    ctx.textAlign = "left";
  }
}

function loop(ctx, holder) {
  var s = holder.state;
  if (s.done) {
    if (pointer.clicked) holder.state = newRound();
  } else {
    s.tick += 1;
    s.left -= 1;
    if (s.tick % GAME_CONFIG.spawnGap === 1) launchLantern(s);
    if (pointer.clicked) takeShot(s, pointer.x, pointer.y, s.tick);
    driftLanterns(s);
    if (s.left <= 0) s.done = true;
  }
  pointer.clicked = false;
  paintBackdrop(ctx);
  paintLanterns(ctx, holder.state.lanterns, holder.state.sparks, holder.state.tick, holder.state.combo > 2);
  paintCrosshair(ctx, pointer.x, pointer.y);
  paintHud(ctx, holder.state);
  requestAnimationFrame(function () { loop(ctx, holder); });
}

function start(canvasId) {
  var canvas = document.getElementById(canvasId);
  canvas.width = GAME_CONFIG.width;
  canvas.height = GAME_CONFIG.height;
  canvas.style.cursor = "none";
  var ctx = canvas.getContext("2d");
  var toGame = function (e) {
    var r = canvas.getBoundingClientRect();
    pointer.x = Math.floor((e.clientX - r.left) * GAME_CONFIG.width / r.width);
    pointer.y = Math.floor((e.clientY - r.top) * GAME_CONFIG.height / r.height);
  };
  canvas.addEventListener("pointermove", toGame);
  canvas.addEventListener("pointerdown", function (e) { toGame(e); pointer.clicked = true; });
  canvas.addEventListener("pointerleave", function () { pointer.x = -1; });
  document.title = GAME_CONFIG.title;
  loop(ctx, { state: newRound() });
}

if (typeof window !== "undefined") {
  window.addEventListener("load", function () { start("game"); });
}
