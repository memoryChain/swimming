// 真实输入分类器和运动模型回放；体力固定为满值，不包含镜头、跳水和碰撞。
// 用内部游速评价推进，避免翻滚损速混入直线推进曲线的比较。
function replayStrokeFeel(h, { period = 0.4, hold = 0.38, fps = 120, seconds = 30 } = {}) {
    const { SwimmerMotor } = h.loadModule('swimmer/SwimmerMotor');
    const { InputRouter } = h.loadModule('core/InputRouter');
    const { StrokeType } = h.loadModule('core/GameConstants');
    h.loadModule('core/GameBalance').setRaceDifficulty('beginner');
    const motor = new SwimmerMotor();
    motor.startRace(0, 0.8);
    motor.setSteeringEnabled(true);
    let now = 1000, accepted = 0, rejected = 0, perfect = 0, good = 0, bad = 0;
    let sum = 0, min = Infinity, max = 0, count = 0;
    const originalNow = Date.now;
    Date.now = () => now;
    const judge = result => {
        if (!result) return;
        if (result.strokeQuality === 1) perfect++;
        else if (result.strokeQuality > 0) good++;
        else bad++;
    };
    const router = new InputRouter(new h.cc.Node(), {
        onStrokeHeld: (side, held, preHeld) => { judge(motor.setStrokeHeld(side, held, preHeld)); return true; },
        onStroke: side => { if (motor.recordStroke(side)) accepted++; else rejected++; },
        onKickStroke: side => motor.recordKickTap(side),
    });
    const events = [];
    for (let index = 0; index * period < seconds; index++) {
        const side = index % 2 ? StrokeType.RIGHT : StrokeType.LEFT;
        events.push({ time: index * period, down: true, side },
            { time: index * period + hold, down: false, side });
    }
    events.sort((a, b) => a.time - b.time || Number(a.down) - Number(b.down));
    let cursor = 0;
    try {
        for (let frame = 0; frame < seconds * fps; frame++) {
            const time = frame / fps;
            now = 1000 + time * 1000;
            while (cursor < events.length && events[cursor].time <= time + 1e-8) {
                const event = events[cursor++];
                if (event.down) router.handleScreenStroke(event.side);
                else router.handleScreenStrokeEnd(event.side);
            }
            router.tick();
            motor.update(1 / fps, { isAI: false });
            for (const result of motor.consumeStrokeQualityResults()) judge(result);
            if (time > seconds - 5) {
                sum += motor.currentSpeed;
                min = Math.min(min, motor.currentSpeed);
                max = Math.max(max, motor.currentSpeed);
                count++;
            }
        }
    } finally {
        Date.now = originalNow;
    }
    const mean = sum / count;
    return { mean, min, max, ripple: (max - min) / mean, accepted, rejected, perfect, good, bad };
}

module.exports = { replayStrokeFeel };
