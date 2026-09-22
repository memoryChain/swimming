"""原创短气球爆开音：确定性噪声瞬态与短下滑音，离线合成，无外部采样。"""
from pathlib import Path
import math,random,wave,struct,json,shutil
SOURCE=Path(__file__).resolve().parent;ROOT=SOURCE.parents[1]
RATE=22050;DURATION=.18
random_source=random.Random(20260922);samples=[];last=0;low=0;phase=0
for i in range(round(RATE*DURATION)):
    t=i/RATE;noise=random_source.uniform(-1,1);high=noise-last;last=noise
    low=low*.78+noise*.22
    attack=min(1,t/.0007);release=min(1,(DURATION-t)/.02)
    phase+=math.tau*(950*math.exp(-t*32)+120)/RATE
    signal=(high*.28*math.exp(-t*150)+math.sin(phase)*.24*math.exp(-t*65)+low*.20*math.exp(-t*26))*attack*release
    samples.append(signal)
peak=max(abs(v) for v in samples);gain=.72/peak
data=b''.join(struct.pack('<h',round(v*gain*32767)) for v in samples)
output=SOURCE/'buoy_balloon_pop.wav'
with wave.open(str(output),'wb') as f:
    f.setnchannels(1);f.setsampwidth(2);f.setframerate(RATE);f.writeframes(data)
shutil.copy2(output,ROOT/'assets/music/sfx/buoy_balloon_pop.wav')
(SOURCE/'sound-audit.json').write_text(json.dumps(dict(source='本项目确定性原创合成，无外部录音',recipe='build_pop_sound.py',sampleRate=RATE,channels=1,bits=16,duration=DURATION,bytes=output.stat().st_size,peak=.72,rms=math.sqrt(sum((s*gain)**2 for s in samples)/len(samples))),ensure_ascii=False,indent=2),encoding='utf-8')
print(str(output),output.stat().st_size)
