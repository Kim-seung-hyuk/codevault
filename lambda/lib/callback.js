// callback.js — Lambda → EC2 완료 콜백 (공유 비밀키 HMAC 서명)
//   헤더 X-CV-Timestamp: 유닉스초,  X-CV-Signature: hex(HMAC-SHA256(CALLBACK_SECRET, ts + "." + body))
//   EC2 는 서명과 5분 시간창을 검사한다 (webapp/app/main.py: lambda_callback).
const crypto = require("crypto");

async function notify(payload) {
  const url = process.env.CALLBACK_URL;
  if (!url) { console.log("CALLBACK_URL 미설정 — 콜백 생략", JSON.stringify(payload)); return null; }
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac("sha256", process.env.CALLBACK_SECRET || "").update(ts + "." + body).digest("hex");
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST", body,
        headers: { "Content-Type": "application/json", "X-CV-Timestamp": ts, "X-CV-Signature": sig },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return res.status;
      lastErr = new Error(`콜백 HTTP ${res.status}`);
      if (res.status < 500) break; // 인증 오류 등은 재시도 무의미
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw lastErr;
}

module.exports = { notify };
