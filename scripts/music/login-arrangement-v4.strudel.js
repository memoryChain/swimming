// 第四轮：原旋律保持中心位置，重写低音律动，让和声更简洁。
// 完整八小节，126 BPM。所有新增伴奏均由 Strudel 合成。
await samples({ melodic_bed: ['__MELODIC_BED_URL__'] })
setcpm(126 / 4)
const keys = "<[e4,g4,a4] [d4,g4,a4] [c4,e4,g4] [a3,c4,e4]>"
const bass = "<[c2 ~ ~ g2 c3 ~ e2 g2] [g1 ~ ~ d2 g2 ~ d2 gs1] [a1 ~ ~ e2 a2 ~ c2 e2] [f1 ~ ~ c2 f2 ~ g1 b1] [c2 ~ g2 ~ c3 ~ e2 g2] [g1 ~ d2 ~ g2 ~ d2 gs1] [a1 ~ ~ e2 a2 ~ ~ e2] [f1 ~ ~ c2 f2 ~ g1 b1]>"
stack(
  // 原低音适度让位，避免旧低音与新的贝斯叠在一起。
  // 不变调、不拉伸、不切碎原旋律采样。
  s("melodic_bed").slow(8).speed(1).gain(.93).hpf(115).hpq(.5)
    .room(.085).roomsize(1.7).roomlp(6000).orbit(0),
  // 短而有弹性的低音，与底鼓错开落点；第七小节留出呼吸。
  note(bass).s("triangle").fm(.28).fmh(1).fmdecay(.1).fmsustain(.08)
    .lpf(950).lpq(.45).hpf(30).attack(.006).decay(.12).sustain(.2).release(.045)
    .clip(.76).gain(".42 .34 .34 .39 .39 .33 .34 .32").orbit(1),
  s("<[sbd ~ ~ sbd ~ sbd ~ ~] [sbd ~ ~ ~ sbd ~ ~ sbd] [sbd ~ ~ sbd ~ sbd ~ ~] [sbd ~ ~ ~ sbd ~ sbd ~] [sbd ~ ~ sbd ~ sbd ~ ~] [sbd ~ ~ ~ sbd ~ ~ sbd] [sbd ~ ~ ~ ~ ~ sbd ~] [sbd ~ ~ sbd ~ ~ ~ ~]>")
    .freq(58).decay(.105).penv(16).pdecay(.025).lpf(2100).gain(.25).orbit(1),
  // 较柔和的短拍手替代高音边鼓；层叠间隔约 12 毫秒。
  s("~ white ~ white").hpf(1100).lpf(5900).attack(.001).decay(.04).sustain(0).release(.018)
    .gain("<.105 .105 .12 .12 .15 .15 .09 .12>").echo(3, .0063, .38).pan(.49).orbit(2),
  note("~ g3 ~ g3").s("triangle").lpf(1200).attack(.001).decay(.035).sustain(0).release(.017)
    .gain("<.1 .1 .12 .12 .14 .14 .08 .1>").orbit(2),
  // 镲片有重轻拍；十六分弱音只在偶数小节出现。
  s("pink*8").hpf(6200).lpf(10000).attack(.002).decay(.023).sustain(0).release(.01)
    .gain(".062 .105 .045 .087 .062 .105 .045 .08").swingBy(.055,4).pan(".43 .57").orbit(2),
  s("<~ [~ ~ ~ pink ~ ~ ~ pink] ~ [~ ~ ~ pink ~ ~ pink ~]>").late(1/16)
    .hpf(7400).lpf(10500).attack(.001).decay(.018).sustain(0).release(.008).gain(.042).pan(.6).orbit(2),
  s("<~ ~ ~ ~ [~ pink ~ pink] ~ ~ ~>").hpf(6500).lpf(11000)
    .attack(.003).decay(.105).sustain(0).release(.04).gain(.067).pan(.58).orbit(2),
  // 三音和弦减少与主旋律的摩擦；后四小节再加入第二个回应落点。
  note(keys).struct("<[~ ~ ~ x ~ ~ ~ ~]!4 [~ ~ ~ x ~ ~ x ~]!2 [~ ~ ~ x ~ ~ ~ ~] [~ ~ ~ x ~ ~ x ~]>")
    .s("sine").fm(.85).fmh(1).fmdecay(.16).fmsustain(.06)
    .attack(.006).decay(.32).sustain(.025).release(.16).lpf(3100)
    .gain("<.16 .16 .17 .17 .21 .21 .14 .17>").pan(.34)
    .room(.16).roomsize(2).roomlp(4600).orbit(3),
  // 过门缩短成两次打击，不用连续四音把结尾塞满。
  note("<~ ~ ~ [~ ~ ~ g3] ~ [~ ~ ~ d4] ~ [~ ~ ~ [f3 g3]]>")
    .s("sine").fm(.85).fmh(1.4).penv(5).pdecay(.024)
    .attack(.001).decay(.075).sustain(0).release(.035).hpf(140).lpf(2600)
    .gain(.19).pan(.62).room(.09).roomsize(1.6).orbit(4)
).postgain(.65)
