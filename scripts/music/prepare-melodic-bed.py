"""保守分离持续音与瞬态；依赖 numpy 与外部 FFmpeg，仅生成离线制作素材。"""
import subprocess
import sys
import wave
from pathlib import Path
import numpy as np

ffmpeg, source, output = sys.argv[1:4]
options = dict(arg[2:].split('=', 1) for arg in sys.argv[4:] if arg.startswith('--') and '=' in arg)
raw = subprocess.check_output([ffmpeg, '-v', 'error', '-i', source, '-ac', '2',
                               '-ar', '44100', '-f', 'f32le', '-'])
x = np.frombuffer(raw, '<f4').reshape(-1, 2)
trim_start = int(options.get('trim-start-samples', '0'))
frame_limit = int(options.get('frames', str(len(x) - trim_start)))
if trim_start < 0 or frame_limit <= 0 or trim_start + frame_limit > len(x):
    raise ValueError('裁切范围超出原始音频')
x = x[trim_start:trim_start + frame_limit]
size, hop = 4096, 512
window = np.hanning(size)
padded = np.pad(x, ((size // 2, size // 2 + size), (0, 0)))
frames = np.lib.stride_tricks.sliding_window_view(padded, size, axis=0)[::hop]
spectra = np.fft.rfft(frames * window, axis=-1)
mag = np.mean(abs(spectra), axis=1).astype('float32')
# 分块计算中值，避免较长赛中曲的中间数组占用数 GB 内存。
harmonic = np.empty_like(mag)
percussive = np.empty_like(mag)
time_padded = np.pad(mag, ((15, 15), (0, 0)), mode='edge')
for begin in range(0, len(mag), 256):
    end = min(begin + 256, len(mag))
    harmonic[begin:end] = np.median(np.lib.stride_tricks.sliding_window_view(
        time_padded[begin:end + 30], 31, axis=0), axis=-1)
    percussive[begin:end] = np.median(np.lib.stride_tricks.sliding_window_view(
        np.pad(mag[begin:end], ((0, 0), (15, 15)), mode='edge'), 31, axis=1), axis=-1)
# 最低保留 35% 原音，避免连旋律拨弦的起音也完全去掉。
mask = .35 + .65 * harmonic ** 2 / (harmonic ** 2 + percussive ** 2 + 1e-12)
reconstructed = np.fft.irfft(spectra * mask[:, None, :], size, axis=-1) * window
result = np.zeros_like(padded, dtype='float64')
norm = np.zeros(len(padded))
for index, frame in enumerate(reconstructed):
    start = index * hop
    result[start:start + size] += frame.T
    norm[start:start + size] += window * window
result /= np.maximum(norm[:, None], 1e-8)
result = result[size // 2:size // 2 + len(x)]
Path(output).parent.mkdir(parents=True, exist_ok=True)
with wave.open(output, 'wb') as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(44100)
    wav.writeframes((np.clip(result, -1, 1) * 32767).astype('<i2').tobytes())
print(f'制作素材已生成：{len(result)} 帧；这是保守频谱分离，不是原始分轨。')
