// 导出已采用的三首 Strudel 编曲；所有输出放入指定目录，不自动替换游戏资源。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const [bundle, browserPath, ffmpeg, output] = process.argv.slice(2);
const scoreOption = process.argv.find(arg => arg.startsWith('--score='))?.slice(8);
if (scoreOption && (path.basename(scoreOption) !== scoreOption || !scoreOption.endsWith('.strudel.js'))) {
  throw Error('--score 仅接受 scripts/music 下的 .strudel.js 文件名');
}
const reuseRaw = process.argv.includes('--reuse-raw');
const trackKey = process.argv.find(arg => arg.startsWith('--track='))?.slice(8) || 'login';
const tracks = {
  login: { score: 'login-arrangement-v4.strudel.js', asset: 'login_ripples', bars: 8, bpm: 126, frames: 665385, bitrate: '112k', byteLimit: 216400 },
  race: { score: 'race-arrangement-v1.strudel.js', asset: 'race_current', bars: 24, bpm: 140, frames: 1814400, bitrate: '96k', byteLimit: 496000, edgeFadeSeconds: .003 },
  result: { score: 'result-arrangement-v1.strudel.js', asset: 'result_sunlit_podium', bars: 4, bpm: 120, frames: 355968, bitrate: '80k', byteLimit: 82000 },
};
const track = tracks[trackKey];
if (!track) throw Error('--track 仅支持 login、race、result');
if (!output) throw Error('用法：node render-preserve-melody.cjs Strudel模块 Chrome FFmpeg 输出目录');
const sourceOption = process.argv.find(arg => arg.startsWith('--source='))?.slice(9);
const input = sourceOption ? path.resolve(sourceOption) : path.resolve(__dirname, '../../assets/music', track.asset + '.mp3');
// 接入后 assets/music 已经是成品，不能再次当作原素材叠加伴奏。
const originalHashes = {
  login: '560a2f3990974f11d2ecda07278eda4f4a95fda067f7c601548ff0dc83e717ad',
  race: 'b69dc7465fe3fcb88fc85ad14533787b23814e9f8fcaed3f56b40e115cfec3a4',
  result: '932baf28286577672ab098c7f935feb2f46b7fe511303747437bfdf1e8ff143b',
};
const sourceHash = createHash('sha256').update(fs.readFileSync(input)).digest('hex');
if (sourceHash !== originalHashes[trackKey]) {
  throw Error('输入不是修改前的原版，请用 --source=/path/to/original.mp3 指定原始备份，避免重复加工成品');
}
const duration = track.bars * 240 / track.bpm;
const stem = path.join(output, 'original-melodic-bed.wav');
const scoreFile = scoreOption || track.score;
const resultName = scoreFile.replace(/\.strudel\.js$/, '');
fs.mkdirSync(output, { recursive: true });
function run(args) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(r.stderr);
  return r.stderr;
}
function measure(file) {
  const log = run(['-i', file, '-af', 'loudnorm=I=-16:TP=-1:LRA=9:print_format=json', '-f', 'null', '-']);
  return JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
}
(async () => {
  const server = http.createServer((req, res) => {
    const file = req.url === '/strudel.mjs' ? bundle : req.url === '/original.mp3' ? input : req.url === '/bed.wav' ? stem : null;
    res.setHeader('Content-Type', req.url === '/strudel.mjs' ? 'text/javascript' : req.url === '/original.mp3' ? 'audio/mpeg' : req.url === '/bed.wav' ? 'audio/wav' : 'text/html');
    res.end(file ? fs.readFileSync(file) : '<!doctype html><script type="module">import * as S from "/strudel.mjs"; window.S=S;window.ready=S.initStrudel();</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true,
      args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ acceptDownloads: true });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.error(m.text()); } });
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => window.ready);
    const code = fs.readFileSync(path.join(__dirname, scoreFile), 'utf8')
      .replace('__MELODIC_BED_URL__', base + '/bed.wav');
    const originalFrames = await page.evaluate(async ({ base, code, bars }) => {
      const context = new AudioContext({ sampleRate: 44100 });
      const decoded = await context.decodeAudioData(await (await fetch(base + '/original.mp3')).arrayBuffer());
      const frames = decoded.length;
      await context.close();
      window.pattern = await window.S.evaluate(code, false);
      const events = window.pattern?.queryArc?.(0, bars).filter(h => h.hasOnset());
      const sourceEvents = events?.filter(h => h.value.s === 'melodic_bed');
      if (sourceEvents?.length !== 1) {
        throw Error('原录音必须恰好触发一次：' + JSON.stringify(window.pattern?.queryArc?.(0, bars)));
      }
      for (const event of events) {
        const pitch = event.value.note;
        if (typeof pitch === 'number' && (!Number.isFinite(pitch) || pitch < 16 || pitch > 112)) {
          throw Error('合成音高异常：' + JSON.stringify(event.value));
        }
      }
      const normalized = start => window.pattern.queryArc(start, start + bars).filter(h => h.hasOnset())
        .map(h => ({ time: +(h.whole.begin.valueOf() - start).toFixed(8), value: h.value }));
      if (JSON.stringify(normalized(0)) !== JSON.stringify(normalized(bars))) throw Error('乐谱周期与导出小节数不一致');
      console.log('编曲事件数：' + events.length);
      return frames;
    }, { base, code, bars: track.bars });
    if (originalFrames !== track.frames) throw Error('浏览器解码长度发生变化：' + originalFrames);
    const raw = path.join(output, 'strudel-render.wav');
    // --reuse-raw 仅用于原始音频、旋律素材和乐谱均未变化的母带调整。
    if (!reuseRaw || !fs.existsSync(raw)) {
      const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
      await page.evaluate(async ({ duration, bars }) => {
        // 离线预调度时语音尚未自然释放，限额必须覆盖所有事件，
        // 否则实时播放用的低限额会在导出前抢占并截短长采样。
        const voices = window.pattern.queryArc(0, bars * 2).filter(h => h.hasOnset()).length + 32;
        await window.S.renderPatternAudio(window.pattern, bars / duration, 0, bars * 2, 44100, voices, false, 'preserve-melody');
      }, { duration, bars: track.bars });
      await (await downloadPromise).saveAs(raw);
    }
    if (errors.length) throw Error(errors.join('\n'));
    const master = path.join(output, resultName + '.wav');
    // 保留第二遍，避开滤波器启动阶段；伴奏由 Strudel 完成，这里仅处理母带动态。
    const masterFilter = 'highpass=f=30,lowpass=f=14000,acompressor=threshold=0.14:ratio=2:attack=8:release=90';
    // 几毫秒防咔哒处理不缩短乐句；不能改成长淡入淡出。
    const edge = track.edgeFadeSeconds || 0;
    const edgeFilter = edge ? `,afade=t=in:st=0:d=${edge}:curve=qsin,afade=t=out:st=${duration - edge}:d=${edge}:curve=qsin` : '';
    run(['-y', '-i', raw, '-af', `${masterFilter},atrim=start=${duration}:duration=${duration},asetpts=PTS-STARTPTS${edgeFilter}`, '-c:a', 'pcm_s24le', master]);
    const before = measure(input), processed = measure(master);
    const dest = path.join(output, resultName + '.mp3');
    let gain = Number(before.input_i) - Number(processed.input_i);
    let final;
    for (let i = 0; i < 6; i++) {
      run(['-y', '-i', master, '-af', `volume=${gain}dB,alimiter=limit=0.84:level=false:latency=true`, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame',
        '-b:a', track.bitrate, '-joint_stereo', '1', '-write_xing', '1', '-map_metadata', '-1', dest]);
      final = measure(dest);
      const correction = Number(before.input_i) - Number(final.input_i);
      if (Math.abs(correction) <= .15) break;
      gain += correction;
    }
    if (Number(final.input_tp) > -.8) throw Error('压缩后峰值余量不足');
    if (Math.abs(Number(before.input_i) - Number(final.input_i)) > .2) throw Error('试听响度未对齐');
    const report = { source: 'assets/music/' + track.asset + '.mp3', score: scoreFile, strudel: '1.3.0', sourceFrames: originalFrames, arrangement: true,
      sourceSha256: sourceHash,
      bpm: track.bpm, bars: track.bars, bitrate: track.bitrate,
      edgeFadeSeconds: edge,
      duration, originalBytes: fs.statSync(input).size, previewBytes: fs.statSync(dest).size, before, final };
    if (report.previewBytes > track.byteLimit) throw Error('试听文件超出体积预算');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    fs.copyFileSync(input, path.join(output, trackKey + '-original.mp3'));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
