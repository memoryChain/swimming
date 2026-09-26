// 赛中：保留完整原曲，140 BPM，24 小节；延续已确认的赛前伴奏质感。
await samples({ melodic_bed: ['__MELODIC_BED_URL__'] })
setcpm(140 / 4)
// 根音：Am F C G | Am F C G | F G Am G | Dm E Am E | Am F C G | Am F G G。
const roots = "<33 29 36 31 33 29 36 31 29 31 33 31 38 40 33 40 33 29 36 31 33 29 31 31>"
const keys = "<[c4,e4,g4] [a3,c4,e4] [e4,g4,a4] [b3,d4,e4] [c4,e4,g4] [a3,c4,e4] [e4,g4,a4] [b3,d4,e4] [a3,c4,e4] [b3,d4,e4] [c4,e4,g4] [b3,d4,e4] [f3,a3,c4] [gs3,b3,e4] [c4,e4,g4] [gs3,b3,d4] [c4,e4,g4] [a3,c4,e4] [e4,g4,a4] [b3,d4,e4] [c4,e4,g4] [a3,c4,e4] [b3,d4,e4] [b3,d4,e4]>"
stack(
  s("melodic_bed").slow(24).speed(1).hpf(135).hpq(.5).gain(1.05)
    .room(.055).roomsize(1.5).roomlp(5300).orbit(0),
  // 根音、五度与八度组成低音，不另写与主旋律争抢的副歌。
  note("0 ~ 12 7 ~ 0 7 ~").add(note(roots)).s("triangle").fm(.31).fmh(1)
    .fmdecay(.09).fmsustain(.07).lpf(1050).hpf(29).attack(.005)
    .decay(.11).sustain(.2).release(.035).clip(.76)
    .gain("<.39!8 .36!4 .24!3 .32 .42!8>").orbit(1),
  // 比赛保留清晰四拍；原曲第 13–15 小节的收束段同时降低鼓组。
  s("sbd*4").freq(59).penv(16).pdecay(.024).decay(.108).lpf(2300)
    .gain("<.245!8 .22!4 .045!3 .15 .265!8>").orbit(1),
  s("~ white ~ white").hpf(1250).lpf(6000).attack(.001).decay(.047).sustain(0).release(.018)
    .echo(3,.007,.36).gain("<.125!8 .11!4 .018!3 .08 .145!8>").pan(.49).orbit(2),
  note("~ g3 ~ g3").s("triangle").lpf(1200).attack(.001).decay(.04).sustain(0).release(.016)
    .gain("<.12!12 .025!3 .075 .14!8>").orbit(2),
  s("pink*8").hpf(6400).lpf(10300).attack(.001).decay(.024).sustain(0).release(.011)
    .gain(".065 .13 .055 .11 .065 .13 .055 .11").mask("<1!12 0!3 1!9>")
    .pan(".43 .57").orbit(2),
  s("<~ [~ ~ ~ pink ~ ~ ~ pink]>").late(1/16).hpf(7500).lpf(11000)
    .attack(.001).decay(.017).sustain(0).release(.009).gain(.05)
    .mask("<1!12 0!3 1!9>").pan(.61).orbit(2),
  s("<~!16 [~ pink ~ pink]!8>").hpf(6500).lpf(11500)
    .attack(.003).decay(.1).sustain(0).release(.025).gain(.07).pan(.58).orbit(2),
  // 中段稀疏长音，最后八小节加一次弱拍回应，层次随原曲起伏。
  note(keys).struct("<[~ x ~ ~ ~ x ~ ~]!8 [~ ~ ~ x ~ ~ x ~]!4 [x ~ ~ ~ ~ ~ ~ ~]!3 [~ ~ x ~ ~ ~ x ~] [~ x ~ ~ ~ x ~ x]!8>")
    .s("sine").fm(.85).fmh(1).fmdecay(.15).fmsustain(.06)
    .attack(.005).decay(.23).sustain(.03).release(.13).lpf(3200)
    .gain("<.12!8 .14!4 .16!3 .13 .175!8>").pan(.35)
    .room(.12).roomsize(1.8).roomlp(4500).orbit(3),
  note("<~!7 [~ ~ ~ [e3 g3]] ~!7 [~ ~ ~ [b2 e3]] ~!7 [~ ~ ~ [d3 e3]]>")
    .s("sine").fm(.9).fmh(1.4).penv(5).pdecay(.024)
    .attack(.001).decay(.068).sustain(0).release(.03).hpf(140).lpf(2600)
    .gain(.2).pan(.6).room(.07).roomsize(1.5).orbit(4)
).postgain(.62)
