// 데모 4장면: 받은 빌드로 "유출본"을 만든다.
//   node tools/make-leak.js <빌드.zip | game.js> <attack> [-o 출력파일]
//   attack: none | strip | terser | edit | obfuscate
// zip 을 넣으면 manifest 의 워터마크 대상 JS 를 꺼내 공격을 적용하고 JS 파일 하나로 저장한다.
const fs = require("fs");
const path = require("path");
const atk = require("../tests/attacks");
const { readPackage, readManifest } = require("../lambda/lib/pkg");

const ATTACKS = {
  none: async (c) => c,
  strip: atk.stripComments,
  terser: atk.terserMangle,
  edit: async (c) => atk.beautifyAndEdit(c),
  obfuscate: async (c) => atk.obfuscate(c),
};

(async () => {
  const args = process.argv.slice(2);
  const oIdx = args.indexOf("-o");
  const out = oIdx >= 0 ? args.splice(oIdx, 2)[1] : null;
  const [input, attack = "terser"] = args;
  if (!input || !ATTACKS[attack]) {
    console.error("usage: node tools/make-leak.js <build.zip|game.js> <none|strip|terser|edit|obfuscate> [-o out.js]");
    process.exit(2);
  }
  let code;
  const buf = fs.readFileSync(input);
  if (input.toLowerCase().endsWith(".zip")) {
    const files = readPackage(buf);
    const t = readManifest(files).watermark.targets[0];
    code = Buffer.from(files[t]).toString("utf8");
  } else code = buf.toString("utf8");
  const leaked = await ATTACKS[attack](code);
  const dest = out || path.join(path.dirname(input), `leaked-${attack}-${path.basename(input).replace(/\.zip$/i, "")}.js`.replace(/\.js\.js$/, ".js"));
  fs.writeFileSync(dest, leaked);
  console.log(`${attack}: ${code.length}B → ${leaked.length}B  저장: ${dest}`);
})();
