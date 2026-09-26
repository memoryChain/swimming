"""生成短促塑料弹撞音；离线确定性输出，复用比赛音效输出与设置音量。"""
import math
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'assets/music/sfx/shark_toy_bump.wav'
RATE = 22050
DURATION = .28


def sample(t):
    # 软壳碰撞的低音，加一小段遥控玩具似的上扬吱声；没有尖叫或爆炸音。
    thump = math.sin(2 * math.pi * (165 * t - 120 * t * t)) * math.exp(-24 * t)
    squeak = math.sin(2 * math.pi * (340 * t + 240 * t * t)) * math.exp(-13 * max(0, t - .035))
    click = math.sin(2 * math.pi * 880 * t) * math.exp(-95 * t)
    attack = min(1, t / .007)
    release = min(1, (DURATION - t) / .04)
    return max(-1, min(1, attack * release * (.55 * thump + .23 * squeak + .12 * click)))


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    data = bytearray()
    for i in range(round(RATE * DURATION)):
        data.extend(struct.pack('<h', round(sample(i / RATE) * 24000)))
    with wave.open(str(OUTPUT), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(data)
    print(f'{OUTPUT}: {len(data)} PCM 字节，{DURATION:.2f} 秒')


if __name__ == '__main__':
    main()
