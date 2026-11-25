// outputmark.js — L7 출력 지문: 게임이 그린 "화면"에 협력사 지문을 남기고, 스크린샷(PNG)에서 읽어 낸다.
//
// 삽입(빌드 시): game.js 끝에 렌더링 후처리 코드를 붙인다. 매 프레임 게임이 그린 뒤 canvas 를 8열×4행 칸으로 나누고,
//   "켜진" 칸의 모든 픽셀 red 채널 최하위 비트를 뒤집는다(값 변화 1/255 — 눈에 보이지 않음).
//   비트 k(0~15) = 행 k>>2, 열쌍 (k&3)*2 / +1. 비트 1 → 왼쪽 칸 켬, 비트 0 → 오른쪽 칸 켬 (Manchester: 항상 짝이 반대).
//   실린 값 = 코드워드 XOR 화이트닝(HMAC(secret,"L7")) — 코드에 mark 가 그대로 보이지 않게.
// 검출(유출 시): 스크린샷에서 (X, X^red1) 색 쌍이 모두 많이 나오는 쌍을 찾고, 그 색들의 연결 영역 = 캔버스 위치.
//   캔버스마다 칸별로 "red 홀수" 비율을 재서 왼쪽−오른쪽 차이로 비트를 읽는다. 배율·위치 무관, 한 장에 여러 캔버스 가능.
//   PNG 처럼 무손실일 때만 동작한다 (JPEG·영상 압축은 최하위 비트를 지움 — 한계).
const crypto = require("crypto");
const zlib = require("zlib");

const COLS = 8, ROWS = 4;

function whitenFor(secret) {
  const h = crypto.createHmac("sha256", secret).update("L7").digest();
  return (h[0] << 8) | h[1];
}

/** 빌드에 붙일 후처리 코드 (ES5, 소수·hex 색 없음 → 다른 층과 간섭 없음) */
function shimSource(cw, secret) {
  const seed = (cw ^ whitenFor(secret)) & 0xffff;
  return `
(function () {
  if (typeof window === "undefined" || !window.requestAnimationFrame || !window.document) return;
  var grainSeed = ${seed};
  var nextFrame = window.requestAnimationFrame.bind(window);
  var cache = { w: 0, h: 0, cells: null };
  function grainCells(w, h) {
    if (cache.w === w && cache.h === h) return cache.cells;
    var cells = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var row = Math.min(${ROWS - 1}, Math.floor(y * ${ROWS} / h));
      for (var x = 0; x < w; x++) {
        var col = Math.min(${COLS - 1}, Math.floor(x * ${COLS} / w));
        var bit = (grainSeed >> (row * 4 + (col >> 1))) & 1;
        cells[y * w + x] = (col & 1) === (bit ? 0 : 1) ? 1 : 0;
      }
    }
    cache = { w: w, h: h, cells: cells };
    return cells;
  }
  function applyGrain(canvas) {
    var w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    var ctx = canvas.getContext("2d");
    var img = ctx.getImageData(0, 0, w, h), data = img.data, cells = grainCells(w, h);
    for (var p = 0, i = 0; p < cells.length; p++, i += 4) if (cells[p]) data[i] ^= 1;
    ctx.putImageData(img, 0, 0);
  }
  window.requestAnimationFrame = function (cb) {
    return nextFrame(function (t) {
      cb(t);
      var list = window.document.getElementsByTagName("canvas");
      for (var i = 0; i < list.length; i++) applyGrain(list[i]);
    });
  };
})();
`;
}

// ---------------- PNG ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const isPNG = (buf) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

/** PNG → { width, height, data: RGBA Uint8Array }  (8비트, 비인터레이스, 색형식 0/2/3/4/6) */
function decodePNG(buf) {
  if (!isPNG(buf)) throw new Error("PNG 아님");
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (depth !== 8 || interlace) throw new Error(`지원하지 않는 PNG (bit depth ${depth}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error("지원하지 않는 PNG 색 형식 " + ctype);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++], line = new Uint8Array(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      if (ctype === 2 || ctype === 6) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = ctype === 6 ? line[s + 3] : 255; }
      else if (ctype === 0 || ctype === 4) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = ctype === 4 ? line[s + 1] : 255; }
      else { const k = line[s] * 3; out[o] = plte[k]; out[o + 1] = plte[k + 1]; out[o + 2] = plte[k + 2]; out[o + 3] = trns && line[s] < trns.length ? trns[line[s]] : 255; }
    }
    prev = line;
  }
  return { width: w, height: h, data: out };
}

/** RGBA → PNG (테스트·데모용) */
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------- 검출 ----------------
/**
 * 이미지(RGBA) 에서 L7 지문 찾기.
 * 반환: { canvases: [{ bbox, markId, tagOk, cw, quality, pairs }], ... }
 *   quality = 16비트 중 가장 약한 비트의 대비(0~1). 진짜 지문은 1 에 가깝고, 사진의 자연 잡음은 0 근처.
 */
function detect(img, opts) {
  const secret = (opts && opts.secret) || process.env.WM_SECRET || "codevault-demo-secret-v1";
  const tagFor = (id) => crypto.createHmac("sha256", secret).update(String(id & 0xff)).digest()[0];
  const { width: W, height: H, data } = img;
  const N = W * H;
  const keys = new Int32Array(N);
  const counts = new Map();
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    keys[p] = k;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  // 1) 색 쌍 (red 최하위 비트만 다른 두 색이 둘 다 충분히 많음)
  const minCount = Math.max(20, Math.floor(N * 0.0003));
  const pairOf = new Map(); let nPairs = 0;
  for (const [k, c] of counts) {
    if ((k >> 16) & 1) continue;
    const k2 = k ^ 0x10000, c2 = counts.get(k2) || 0;
    if (c >= minCount && c2 >= minCount) { pairOf.set(k, nPairs); pairOf.set(k2, nPairs); nPairs++; }
  }
  if (!nPairs) return { canvases: [], pairs: 0 };
  // 2) 쌍 색 픽셀의 연결 영역 = 캔버스 후보
  const label = new Int32Array(N).fill(-1);
  const comps = [];
  const stack = new Int32Array(N);
  for (let p = 0; p < N; p++) {
    if (label[p] !== -1 || !pairOf.has(keys[p])) continue;
    const id = comps.length; let sp = 0, size = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack[sp++] = p; label[p] = id;
    while (sp) {
      const q = stack[--sp], x = q % W, y = (q / W) | 0;
      size++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && label[q - 1] === -1 && pairOf.has(keys[q - 1])) { label[q - 1] = id; stack[sp++] = q - 1; }
      if (x < W - 1 && label[q + 1] === -1 && pairOf.has(keys[q + 1])) { label[q + 1] = id; stack[sp++] = q + 1; }
      if (y > 0 && label[q - W] === -1 && pairOf.has(keys[q - W])) { label[q - W] = id; stack[sp++] = q - W; }
      if (y < H - 1 && label[q + W] === -1 && pairOf.has(keys[q + W])) { label[q + W] = id; stack[sp++] = q + W; }
    }
    comps.push({ id, size, x0, y0, x1, y1 });
  }
  const minArea = Math.max(64 * 48, N * 0.005);
  const canvases = [];
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    if (c.size < minArea || bw < 32 || bh < 16) continue;
    // 3) 칸별·쌍별 "red 홀수" 비율 (칸 가장자리 15% 는 버림)
    const stats = new Map(); // pair -> Float64Array(COLS*ROWS*2) [odd, tot]
    for (let y = c.y0; y <= c.y1; y++) {
      const fy = ((y - c.y0 + 0.5) * ROWS) / bh, row = Math.min(ROWS - 1, fy | 0), ry = fy - row;
      if (ry < 0.15 || ry > 0.85) continue;
      for (let x = c.x0; x <= c.x1; x++) {
        const p = y * W + x;
        if (label[p] !== c.id) continue;
        const fx = ((x - c.x0 + 0.5) * COLS) / bw, col = Math.min(COLS - 1, fx | 0), rx = fx - col;
        if (rx < 0.15 || rx > 0.85) continue;
        const pi = pairOf.get(keys[p]);
        let s = stats.get(pi); if (!s) { s = new Float64Array(COLS * ROWS * 2); stats.set(pi, s); }
        const cell = row * COLS + col;
        s[cell * 2] += (keys[p] >> 16) & 1; s[cell * 2 + 1] += 1;
      }
    }
    // 4) 쌍마다 비트 대비 벡터 d[k] = 홀수비율(왼칸) − 홀수비율(오른칸), 극성은 가장 큰 쌍에 맞춰 합산
    const vecs = [];
    for (const [pi, s] of stats) {
      const d = new Float64Array(16); let tot = 0;
      for (let k = 0; k < 16; k++) {
        const row = k >> 2, cl = (k & 3) * 2, L = (row * COLS + cl) * 2, R = (row * COLS + cl + 1) * 2;
        if (s[L + 1] >= 4 && s[R + 1] >= 4) d[k] = s[L] / s[L + 1] - s[R] / s[R + 1];
        tot += s[L + 1] + s[R + 1];
      }
      vecs.push({ pi, d, tot });
    }
    if (!vecs.length) continue;
    vecs.sort((a, b) => b.tot - a.tot);
    const D = new Float64Array(16), Wsum = new Float64Array(16);
    for (const v of vecs) {
      let dot = 0; for (let k = 0; k < 16; k++) dot += v.d[k] * vecs[0].d[k];
      const sgn = v === vecs[0] || dot >= 0 ? 1 : -1;
      for (let k = 0; k < 16; k++) if (v.d[k] !== 0) { D[k] += sgn * v.d[k] * v.tot; Wsum[k] += v.tot; }
    }
    let bits = 0, quality = 1;
    for (let k = 0; k < 16; k++) {
      const val = Wsum[k] ? D[k] / Wsum[k] : 0;
      if (val > 0) bits |= 1 << k;
      quality = Math.min(quality, Math.abs(val));
    }
    // 5) 극성 두 가지를 모두 시도 → 화이트닝 해제 → 태그 검증
    const wh = whitenFor(secret);
    let found = null;
    for (const v of [bits, (~bits) & 0xffff]) {
      const cw = v ^ wh, id = (cw >> 8) & 0xff;
      if (id >= 1 && (cw & 0xff) === tagFor(id)) { found = { cw, markId: id }; break; }
    }
    canvases.push({
      bbox: { x: c.x0, y: c.y0, w: bw, h: bh },
      markId: found && quality >= 0.5 ? found.markId : null,
      tagOk: !!found, quality: Math.round(quality * 1000) / 1000, pairs: vecs.length,
    });
  }
  return { canvases, pairs: nPairs };
}

/** PNG 버퍼 → 추출 리포트 (extract-cli 와 같은 모양) */
function extractImage(buf, opts) {
  const img = decodePNG(buf);
  const r = detect(img, opts);
  const hits = r.canvases.filter((c) => c.markId != null);
  const marks = [...new Set(hits.map((c) => c.markId))];
  const decision = marks.length === 1 ? "IDENTIFIED" : marks.length > 1 ? "MULTIPLE" : "NO_RELIABLE_MARK";
  return {
    kind: "image", decision, markId: marks.length === 1 ? marks[0] : null, marks,
    confidence: hits.length ? "MEDIUM" : "NONE", chanceMatch: hits.length ? 1 / 256 : null,
    image: { width: img.width, height: img.height }, canvases: r.canvases, colorPairs: r.pairs,
  };
}

module.exports = { shimSource, whitenFor, decodePNG, encodePNG, detect, extractImage, isPNG, COLS, ROWS };
