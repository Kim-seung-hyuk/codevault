// FallingDodge - original build (no watermark)
// A tiny canvas game: move left/right to dodge falling blocks.

var GAME_CONFIG = {
  title: "FallingDodge",
  width: 160,
  height: 240,
  gravity: 2,
  spawnRate: 45,
  playerSpeed: 4,
  maxBlocks: 24,
  startLives: 3
};

var PALETTE = [
  "#101828", "#1d2b4a", "#2e4a6e", "#3a5f7d",
  "#4f8fb0", "#7ec8e3", "#f2c14e", "#e06c3a"
];

function handleInput(ev, state) {
  if (ev === "left") movePlayer(state, -1); else if (ev === "right") movePlayer(state, 1);
}

function initState(width, height) {
  var state = { player: { x: width / 2, y: height - 16 }, blocks: [], tick: 0, score: 0, lives: GAME_CONFIG.startLives, over: false };
  return state;
}

function movePlayer(state, dir) {
  var nx = state.player.x + dir * GAME_CONFIG.playerSpeed;
  nx = clamp(nx, 4, GAME_CONFIG.width - 4);
  state.player.x = nx;
}

function drawBlock(ctx, b) {
  var size = 8;
  ctx.fillStyle = PALETTE[7];
  ctx.fillRect(b.x - 4, b.y - 4, size, size);
  ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
}

function drawPlayer(ctx, state) {
  var px = state.player.x;
  var py = state.player.y;
  ctx.fillStyle = PALETTE[6];
  ctx.fillRect(px - 4, py - 4, 8, 8);
  ctx.fillRect(px - 2, py - 6, 4, 2);
}

function drawFrame(ctx, state) {
  ctx.fillStyle = PALETTE[0];
  ctx.fillRect(0, 0, GAME_CONFIG.width, GAME_CONFIG.height);
  ctx.fillStyle = PALETTE[2];
  ctx.fillRect(0, GAME_CONFIG.height - 2, GAME_CONFIG.width, 2);
  for (var i = 0; i < state.blocks.length; i++) drawBlock(ctx, state.blocks[i]);
  drawPlayer(ctx, state);
}

function gameLoop(ctx, state) {
  if (state.over) return state.score;
  scoreTick(state);
  updateBlocks(state);
  checkCollision(state);
  drawFrame(ctx, state);
  state.fps = 60;
  return state.score;
}

function checkCollision(state) {
  var hitSize = 8;
  for (var i = 0; i < state.blocks.length; i++) {
    var b = state.blocks[i];
    var dx = Math.abs(b.x - state.player.x);
    var dy = Math.abs(b.y - state.player.y);
    if (dx < hitSize && dy < hitSize) { state.lives -= 1; b.y = GAME_CONFIG.height + 99; if (state.lives <= 0) state.over = true; }
  }
}

function scoreTick(state) {
  state.tick += 1;
  state.score += 1;
  if (state.tick % GAME_CONFIG.spawnRate === 0) spawnBlock(state);
}

function updateBlocks(state) {
  var g = GAME_CONFIG.gravity;
  for (var i = 0; i < state.blocks.length; i++) { state.blocks[i].y += state.blocks[i].vy * g / GAME_CONFIG.gravity; }
  var h = GAME_CONFIG.height + 8;
  state.blocks = state.blocks.filter(function (b) { return b.y < h; });
}

function spawnBlock(state) {
  var x = Math.floor(Math.random() * GAME_CONFIG.width);
  var y = -8;
  var block = { x: x, y: y, vy: GAME_CONFIG.gravity };
  if (state.blocks.length >= GAME_CONFIG.maxBlocks) return;
  state.blocks.push(block);
}

function clamp(value, low, high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

if (typeof module !== "undefined") {
  module.exports = { initState: initState, gameLoop: gameLoop, handleInput: handleInput, GAME_CONFIG: GAME_CONFIG, PALETTE: PALETTE };
}
