// 结算：保留原主题，120 BPM，四小节。D–G–Bm–A，柔和明亮的小收尾。
// 制作素材先去除原 MP3 约 50 毫秒编码起始延迟，再截取完整八秒。
await samples({ melodic_bed: ['__MELODIC_BED_URL__'] })
setcpm(120 / 4)
const keys = "<[fs4,a4,b4] [b3,d4,fs4] [d4,fs4,a4] [cs4,e4,b4]>"
stack(
  s("melodic_bed").slow(4).speed(1).hpf(115).hpq(.5).gain(.96)
    .room(.095).roomsize(1.9).roomlp(5200).orbit(0),
  // 简短低音回应，让结算的律动比比赛放松。
  note("<[d2 ~ a2 ~ b2 ~ a2 ~] [g1 ~ d2 ~ g2 ~ d2 ~] [b1 ~ fs2 ~ a2 ~ fs2 ~] [a1 ~ e2 ~ g2 ~ cs3 ~]>")
    .s("triangle").fm(.23).fmh(1).fmdecay(.1).fmsustain(.06)
    .attack(.006).decay(.15).sustain(.18).release(.05).clip(.78).lpf(850).hpf(29)
    .gain(.35).orbit(1),
  s("<[sbd ~ sbd ~] sbd [sbd ~ sbd ~] [sbd ~ ~ ~]>")
    .freq(62).penv(14).pdecay(.026).decay(.095).lpf(2100).gain(.21).orbit(1),
  s("~ ~ white ~").hpf(1500).lpf(5500).attack(.002).decay(.039).sustain(0).release(.018)
    .echo(3,.006,.34).gain(.1).orbit(2),
  note("~ ~ g3 ~").s("triangle").lpf(1000).attack(.001).decay(.032).sustain(0).release(.018)
    .gain(.085).orbit(2),
  s("pink*8").hpf(6500).lpf(9800).attack(.002).decay(.022).sustain(0).release(.01)
    .gain(".042 .072 .035 .064 .042 .072 .035 .056").swingBy(.05,4).pan(".43 .57").orbit(2),
  // 电钢琴提供三音和声；只在原旋律之间作短回应。
  note(keys).struct("~ ~ ~ x ~ ~ x ~").s("sine").fm(.7).fmh(1)
    .fmdecay(.18).fmsustain(.055).attack(.007).decay(.34).sustain(.035).release(.19)
    .lpf(3200).gain(.175).pan(.34).room(.19).roomsize(2).roomlp(4700).orbit(3),
  // 极轻的长音扩大空间，中央仍是原单声道主题。
  note(keys).s("triangle").attack(.11).decay(.5).sustain(.13).release(.24).clip(.78)
    .hpf(330).lpf(1700).gain(.055).pan(.65).room(.2).roomsize(2.2).orbit(4),
  note("<~ ~ ~ [~ ~ ~ [e4 a3]]>").s("sine").fm(.8).fmh(1.4)
    .attack(.002).decay(.06).sustain(0).release(.03).hpf(160).lpf(2500)
    .gain(.125).pan(.59).room(.08).orbit(5)
).postgain(.62)
