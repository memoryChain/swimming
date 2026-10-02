// 从已有划水录音离线制作蝶泳推水声：单次主重音、短水流与细滴尾声。
// 不增加运行时混音器或定时器；原始自由泳录音保持不变。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const input = fs.readFileSync(path.join(root, 'assets/music/sfx/stroke_water_01.wav'));
let format, data;
for (let p = 12; p + 8 <= input.length;) {
    const size = input.readUInt32LE(p + 4), name = input.toString('ascii', p, p + 4);
    if (name === 'fmt ') format = input.subarray(p + 8, p + 8 + size);
    if (name === 'data') data = input.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
}
if (!format || !data || format.readUInt16LE(0) !== 1 || format.readUInt16LE(14) !== 16) {
    throw new Error('源音频必须为 16 位 PCM WAV');
}
const channels = format.readUInt16LE(2), sourceRate = format.readUInt32LE(4);
const samples = new Float64Array(data.length / (2 * channels));
let peak = 0, peakIndex = 0;
for (let i = 0; i < samples.length; i++) {
    for (let c = 0; c < channels; c++) samples[i] += data.readInt16LE((i * channels + c) * 2) / (32768 * channels);
    if (Math.abs(samples[i]) > peak) { peak = Math.abs(samples[i]); peakIndex = i; }
}
const rate = 24000, duration = 0.46, output = new Float64Array(Math.round(rate * duration));
// 主攻击对齐录音的第一簇能量，避免把前导空白变成输入延迟。
let onset = 0;
while (onset < peakIndex && Math.abs(samples[onset]) < peak * 0.06) onset++;
onset = Math.max(0, onset - Math.round(sourceRate * 0.004));
function read(time) {
    const p = Math.max(0, time * sourceRate), i = Math.floor(p), t = p - i;
    return (samples[i] || 0) * (1 - t) + (samples[i + 1] || 0) * t;
}
let low = 0, maximum = 0;
for (let i = 0; i < output.length; i++) {
    const t = i / rate;
    const raw = read(onset / sourceRate + t * 0.9);
    low += (raw - low) * 0.21;
    const attack = Math.min(1, t / 0.005), end = Math.min(1, (duration - t) / 0.065);
    // 低频水团只有一个重心；后段保留原录音碎水声，渐弱而不另加一次撞击。
    const main = (0.68 * raw + 0.55 * low) * Math.exp(-t * 4.5);
    const tail = t > 0.15 ? read(onset / sourceRate + 0.18 + (t - 0.15) * 1.2)
        * 0.22 * Math.min(1, (t - 0.15) / 0.035) * Math.exp(-(t - 0.15) * 7) : 0;
    output[i] = (main + tail) * attack * end;
    maximum = Math.max(maximum, Math.abs(output[i]));
}
if (maximum < 0.001) throw new Error('源录音没有可用水声');
const pcm = Buffer.alloc(output.length * 2);
for (let i = 0; i < output.length; i++) pcm.writeInt16LE(Math.round(output[i] / maximum * 0.86 * 32767), i * 2);
const header = Buffer.alloc(44);
header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
const target = path.join(root, 'assets/music/sfx/butterfly_push.wav');
fs.writeFileSync(target, Buffer.concat([header, pcm]));
if (!fs.existsSync(target + '.meta')) {
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets/music/sfx/stroke_water_01.wav.meta'), 'utf8'));
    meta.uuid = require('node:crypto').randomUUID();
    fs.writeFileSync(target + '.meta', JSON.stringify(meta, null, 2) + '\n');
}
console.log(`蝶泳推水声：${duration} 秒，单声道 ${rate} Hz，${pcm.length + 44} 字节；源音频 ${sourceRate} Hz。`);
