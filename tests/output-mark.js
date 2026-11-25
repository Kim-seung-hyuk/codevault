// output-mark.js — L7 출력 지문 테스트
// 게임을 소프트웨어 canvas(실제 RGBA 프레임버퍼)에서 돌려 화면을 만들고, "스크린샷"을 여러 형태로 꾸며 PNG 로 검출한다.
//   node tests/output-mark.js      종료코드 0 = 필수 항목 통과 (식별해야 할 것은 식별, 오지목 0, 무표식 거부)
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const wm = require("../lambda/lib/watermark");
const om = require("../lambda/lib/outputmark");
const atk = require("./attacks");

const ROOT = path.join(__dirname, "..");
const GAMES = ["comet-shower", "lantern-range", "moss-hop"];
const MARKS = [17, 42, 203];

const { render, blank, pageWith } = require("../tools/screenshot");

function crop(img, fx0, fy0, fx1, fy1) {
  const x0 = Math.round(img.width * fx0), y0 = Math.round(img.height * fy0), w = Math.round(img.width * fx1) - x0, h = Math.round(img.height * fy1) - y0;
  const out = blank(w, h, [0, 0, 0]);
  for (let y = 0; y < h; y++) out.data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return out;
}
function noisy(img, amp) { // 손실 압축 모의: 모든 채널에 ±amp 잡음
  const d = new Uint8Array(img.data);
  let s = 12345;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { s = (s * 1103515245 + 12345) >>> 0; d[i + c] = Math.max(0, Math.min(255, d[i + c] + ((s >>> 16) % (2 * amp + 1)) - amp)); }
  return { ...img, data: d };
}
const toPNG = (img) => om.encodePNG(img.width, img.height, img.data);

(async () => {
  let failures = 0;
  const rows = [];
  const check = (label, rep, expectMarks, required) => {
    const got = rep.marks.slice().sort((a, b) => a - b);
    const want = expectMarks.slice().sort((a, b) => a - b);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    const wrong = got.some((m) => !want.includes(m));
    if (wrong || (required && !ok)) failures++;
    const q = rep.canvases.map((c) => c.quality).join("/");
    rows.push({ label, ok, wrong, required, got, want, q, decision: rep.decision });
    console.log(`${wrong ? "FAIL(오지목)" : ok ? "PASS" : required ? "FAIL" : "참고"} ${label.padEnd(44)} → ${rep.decision} [${got.join(",")}] 기대 [${want.join(",")}] 품질 ${q || "-"}`);
  };

  for (const g of GAMES) {
    const src = fs.readFileSync(path.join(ROOT, "games", g, "game.js"), "utf8");
    const shots = {};
    for (const m of MARKS) shots[m] = render(wm.insert(src, m));
    const B = shots[42];
    console.log(`\n# ${g} (${B.width}x${B.height})`);
    check(`${g} 캔버스 원본 크기 PNG (B)`, om.extractImage(toPNG(B)), [42], true);
    check(`${g} 웹페이지 안 ×3 확대 (B)`, om.extractImage(toPNG(pageWith([B], 3))), [42], true);
    check(`${g} 웹페이지 안 ×2.5 비정수 확대 (B)`, om.extractImage(toPNG(pageWith([B], 2.5))), [42], true);
    check(`${g} 나란히 플레이 화면 A·B·C ×2`, om.extractImage(toPNG(pageWith(MARKS.map((m) => shots[m]), 2))), MARKS, true);
    // 코드 공격을 받은 빌드도 화면에는 지문이 남는가
    for (const [label, fn] of [["terser", atk.terserMangle], ["난독화", async (c) => atk.obfuscate(c)], ["층을 아는 공격자(A5)", async (c) => atk.informedScrub(c)]]) {
      let shot;
      try { shot = render(await fn(wm.insert(src, 42))); } catch (e) { console.log(`참고 ${g} ${label} 빌드 실행 실패: ${e.message}`); continue; }
      check(`${g} ${label} 빌드의 화면 ×2 (B)`, om.extractImage(toPNG(pageWith([shot], 2))), [42], true);
    }
    // 한계 (필수 아님): 자르기, 손실 압축 모의
    check(`${g} 오른쪽 10% 잘린 스크린샷 (한계)`, om.extractImage(toPNG(crop(pageWith([B], 2), 0, 0, 0.9, 1))), [42], false);
    check(`${g} ±2 잡음(손실 압축 모의, 한계)`, om.extractImage(toPNG(noisy(pageWith([B], 2), 2))), [42], false);
    // 무표식은 거부
    check(`${g} 무워터마크 원본 화면`, om.extractImage(toPNG(pageWith([render(src)], 2))), [], true);
  }
  // 자연 이미지 흉내: 부드러운 그라디언트 + 잡음 (red ±1 색 쌍이 많이 생김)
  const grad = blank(640, 480, [0, 0, 0]);
  for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) { const i = (y * 640 + x) * 4; grad.data[i] = (x * 255) / 640; grad.data[i + 1] = (y * 255) / 480; grad.data[i + 2] = 90; }
  check("그라디언트 사진(무관한 이미지)", om.extractImage(toPNG(noisy(grad, 1))), [], true);
  check("무작위 잡음 이미지", om.extractImage(toPNG(noisy(blank(400, 300, [100, 100, 100]), 3))), [], true);

  const req = rows.filter((r) => r.required);
  console.log(`\n요약: 필수 ${req.length}건 중 실패 ${failures}건, 오지목 ${rows.filter((r) => r.wrong).length}건`);
  const md = ["# L7 출력 지문 테스트 결과 (자동 생성: `node tests/output-mark.js`)", "",
    "게임을 소프트웨어 canvas 에서 90프레임 돌린 화면을 스크린샷처럼 꾸며(확대·페이지 합성·코드 공격) PNG 로 검출했다.", "",
    "| 시나리오 | 기대 | 검출 | 비트 대비(품질) | 결과 |", "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.label} | ${r.want.join(",") || "없음"} | ${r.got.join(",") || "없음"} | ${r.q || "-"} | ${r.wrong ? "✗ 오지목" : r.ok ? "✔" : r.required ? "✗" : "한계(실패)"} |`),
    "", "품질 = 16비트 중 가장 약한 비트의 대비(0~1). 0.5 미만이면 지목하지 않는다."];
  fs.writeFileSync(path.join(ROOT, "RESULTS-L7.md"), md.join("\n") + "\n");
  process.exit(failures ? 1 : 0);
})();
