// 영상통화 자동 시험: 실제 인터넷(공개 MQTT 신호 서버, STUN/TURN)으로 두 브라우저를 잇고
// 양쪽에서 상대 영상이 실제로 풀려 나오고(프레임 디코딩) 소리 데이터가 오는지 확인한다.
const {chromium} = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/webcall/';
const CASES = [
  {name: '기본(직접 연결 허용)', q: ''},
  {name: '중계만: openrelay', q: '&relay=1&turn=openrelay'},
  {name: '중계만: freestun', q: '&relay=1&turn=freestun'},
  {name: '중계만: peerjs', q: '&relay=1&turn=peerjs'},
  {name: '중계만: 기본 목록 전체', q: '&relay=1'},
];
async function probe(p) {
  return p.evaluate(async () => {
    if (typeof pc === 'undefined' || !pc) return {ice: 'none'};
    const r = await pc.getStats(); let v = 0, a = 0, path = '-';
    r.forEach(s => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') v = s.framesDecoded || 0;
      if (s.type === 'inbound-rtp' && s.kind === 'audio') a = s.bytesReceived || 0;
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
        const l = r.get(s.localCandidateId), m = r.get(s.remoteCandidateId);
        path = (l && l.candidateType) + '→' + (m && m.candidateType) + (l && l.relayProtocol ? '(' + l.relayProtocol + ')' : '');
      }
    });
    const el = document.querySelector('#remote');
    return {ice: pc.iceConnectionState, frames: v, audio: a, path, playing: !el.paused && el.videoWidth > 0, srv: document.querySelector('#status').textContent.match(/\[(.*)\]/)?.[1]};
  });
}
// 고정 통화방: 태블릿은 /t, 폰은 /p 만 연다
async function runFixed(b) {
  const mk = async () => (await b.newContext({permissions: ['camera', 'microphone']})).newPage();
  const T = await mk(), Ph = await mk(); const t0 = Date.now();
  const root = BASE.replace(/webcall\/$/, '');
  try {
    await T.goto(root + 't/'); await T.waitForURL(/f=1/); await T.click('#go');
    await Ph.goto(root + 'p/'); await Ph.waitForURL(/f=1/); await Ph.click('#go');
    let a, bb;
    for (let i = 0; i < 45; i++) { await T.waitForTimeout(1000); [a, bb] = [await probe(T), await probe(Ph)]; if (a.frames > 15 && bb.frames > 15 && a.playing && bb.playing) break; }
    return {name: '고정 통화방(/t, /p)', ok: a.frames > 15 && bb.frames > 15 && a.audio > 2000 && bb.audio > 2000 && a.playing && bb.playing, sec: Math.round((Date.now() - t0) / 1000), A: a, B: bb, must: true};
  } catch (e) { return {name: '고정 통화방(/t, /p)', ok: false, err: e.message.slice(0, 200), must: true}; }
  finally { await T.context().close(); await Ph.context().close(); }
}
async function run(b, c) {
  const mk = async () => (await b.newContext({permissions: ['camera', 'microphone']})).newPage();
  const A = await mk(), B = await mk();
  const t0 = Date.now();
  try {
    await A.goto(BASE + '?x=1' + c.q); await A.click('#newroom'); await A.waitForURL(/c=/);
    const link = await A.textContent('#link');
    await A.click('#go');
    await B.goto(link); await B.click('#go');
    let a, bb;
    for (let i = 0; i < 45; i++) {
      await A.waitForTimeout(1000);
      [a, bb] = [await probe(A), await probe(B)];
      if (a.frames > 15 && bb.frames > 15 && a.audio > 2000 && bb.audio > 2000 && a.playing && bb.playing) break;
    }
    const ok = a.frames > 15 && bb.frames > 15 && a.audio > 2000 && bb.audio > 2000 && a.playing && bb.playing;
    return {name: c.name, ok, sec: Math.round((Date.now() - t0) / 1000), A: a, B: bb};
  } catch (e) { return {name: c.name, ok: false, err: e.message.slice(0, 200)}; }
  finally { await A.context().close(); await B.context().close(); }
}
(async () => {
  const b = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=document-user-activation-required']});
  const res = [];
  for (const c of CASES) { const r = await run(b, c); if (!c.q) r.must = true; res.push(r); console.log(JSON.stringify(r)); }
  { const r = await runFixed(b); res.push(r); console.log(JSON.stringify(r)); }
  await b.close();
  console.log('\n===== 결과 =====');
  for (const r of res) console.log((r.ok ? '통과' : '실패') + ' | ' + r.name + ' | ' + (r.sec || '-') + '초 | ' + (r.A ? `A ${r.A.ice} ${r.A.path} 영상${r.A.frames} 소리${r.A.audio}B / B ${r.B.ice} ${r.B.path} 영상${r.B.frames} 소리${r.B.audio}B | ${r.A.srv}` : r.err));
  // 꼭 통과해야 하는 것: 직접 연결, 고정 통화방. 중계 서버 항목은 계정 있는 중계 서버를 넣기 전까지 참고용
  if (res.some(r => r.must && !r.ok)) process.exit(1);
})();
