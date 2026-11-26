// screenshot.js — 빌드(zip 또는 game.js)를 소프트웨어 canvas 에서 실행해 "게임 화면 스크린샷" PNG 를 만든다.
// 데모 4장면 대안(스트리머 C 의 방송 스크린샷) + L7 테스트용. 실제 브라우저 스크린샷(PNG)도 같은 방식으로 검출된다.
//   node tools/screenshot.js <빌드.zip|game.js> [-o shot.png] [--scale 3] [--frames 120]
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---------- 소프트웨어 canvas ----------
function makeCanvas() {
  const cv = { width: 0, height: 0, style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) };
  let buf = null;
  const ensure = () => { if (!buf || buf.length !== cv.width * cv.height * 4) buf = new Uint8ClampedArray(cv.width * cv.height * 4); };
  const rgb = (s) => (/^#[0-9a-f]{6}$/i.test(s) ? [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)] : [128, 128, 128]);
  const ctx = {
    fillStyle: "#000000", font: "", textAlign: "left", textBaseline: "top", imageSmoothingEnabled: true,
    fillRect(x, y, w, h) {
      ensure();
      const [r, g, b] = rgb(ctx.fillStyle);
      const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
      const x1 = Math.min(cv.width, Math.round(x + w)), y1 = Math.min(cv.height, Math.round(y + h));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * cv.width + xx) * 4; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; }
    },
    fillText(t, x, y) { // 글자 대신 작은 블록 (안티에일리어싱 흉내로 중간색 한 줄 추가)
      const save = ctx.fillStyle;
      const sx = ctx.textAlign === "center" ? x - String(t).length * 2.5 : x;
      for (let i = 0; i < String(t).length; i++) if (String(t)[i] !== " ") ctx.fillRect(sx + i * 5, y + 1, 4, 5);
      ctx.fillStyle = "#7f7f7f"; ctx.fillRect(sx, y + 6, String(t).length * 5, 1); ctx.fillStyle = save;
    },
    getImageData() { ensure(); return { data: new Uint8ClampedArray(buf) }; },
    putImageData(img) { buf.set(img.data); },
  };
  cv.getContext = () => ctx;
  cv.pixels = () => { ensure(); return { width: cv.width, height: cv.height, data: new Uint8Array(buf) }; };
  return cv;
}

function render(code, frames = 90) {
  const canvas = makeCanvas();
  const listeners = {};
  let raf = null;
  const sb = { Math, console, Uint8Array, Uint8ClampedArray };
  sb.window = sb;
  sb.addEventListener = (n, f) => (listeners[n] = f);
  sb.document = { getElementById: () => canvas, getElementsByTagName: () => [canvas], title: "" };
  sb.requestAnimationFrame = (f) => { raf = f; return 1; };
  vm.createContext(sb);
  vm.runInContext(code, sb);
  listeners.load();
  for (let f = 0; f < frames; f++) { const cb = raf; raf = null; cb(f * 16); }
  return canvas.pixels();
}

// ---------- "스크린샷" 꾸미기 ----------
function blank(w, h, rgb) { const d = new Uint8Array(w * h * 4); for (let i = 0; i < d.length; i += 4) { d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255; } return { width: w, height: h, data: d }; }
function blitScaled(dst, src, ox, oy, scale) { // 최근접 확대 (CSS image-rendering: pixelated 와 같음)
  const tw = Math.round(src.width * scale), th = Math.round(src.height * scale);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const sx = Math.min(src.width - 1, Math.floor(x / scale)), sy = Math.min(src.height - 1, Math.floor(y / scale));
    const si = (sy * src.width + sx) * 4, di = ((oy + y) * dst.width + ox + x) * 4;
    dst.data[di] = src.data[si]; dst.data[di + 1] = src.data[si + 1]; dst.data[di + 2] = src.data[si + 2]; dst.data[di + 3] = 255;
  }
  return { tw, th };
}
function pageWith(imgs, scale) { // 어두운 웹페이지 + 글자 잡음 + 캔버스들
  const pad = 24, cw = Math.round(imgs[0].width * scale), ch = Math.round(imgs[0].height * scale);
  const page = blank(pad + imgs.length * (cw + pad), ch + pad * 2 + 30, [17, 20, 27]);
  for (let i = 0; i < 4000; i++) { // 페이지 UI 글자 안티에일리어싱 흉내
    const x = (i * 37) % page.width, y = 4 + ((i * 7) % 20), o = (y * page.width + x) * 4, v = 60 + ((i * 13) % 150);
    page.data[o] = v; page.data[o + 1] = v; page.data[o + 2] = v + 10;
  }
  imgs.forEach((im, i) => blitScaled(page, im, pad + i * (cw + pad), pad + 30, scale));
  return page;
}

module.exports = { makeCanvas, render, blank, blitScaled, pageWith };

if (require.main === module) {
  const om = require("../lambda/lib/outputmark");
  const { readPackage, mainScript } = require("../lambda/lib/pkg");
  const args = process.argv.slice(2);
  const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
  const out = opt("-o", null), scale = parseFloat(opt("--scale", "3")), frames = parseInt(opt("--frames", "120"), 10);
  const input = args[0];
  if (!input) { console.error("usage: node tools/screenshot.js <build.zip|game.js> [-o shot.png] [--scale 3] [--frames 120]"); process.exit(2); }
  let code;
  if (input.toLowerCase().endsWith(".zip")) {
    const files = readPackage(fs.readFileSync(input));
    code = Buffer.from(files[mainScript(files)]).toString("utf8");
  } else code = fs.readFileSync(input, "utf8");
  const shot = pageWith([render(code, frames)], scale);
  const dest = out || path.join(path.dirname(input), "screenshot-" + path.basename(input).replace(/\.(zip|js)$/i, "") + ".png");
  fs.writeFileSync(dest, om.encodePNG(shot.width, shot.height, shot.data));
  console.log(`스크린샷 ${shot.width}x${shot.height} 저장: ${dest}`);
}
