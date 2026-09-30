const fs = require('node:fs');
const path = require('node:path');
const { replayBreathingInput } = require('../tests/helpers/freestyle-breathing-replay.cjs');
const { load, root } = require('../tests/helpers/character-contact-harness.cjs');
const current = load(path.join(root, 'assets/scripts/character/FreestyleBreathingMotion.ts'));
const oldFile = path.join(root, '.cache/freestyle-breathing-timing-before/FreestyleBreathingMotion.ts');
const previous = fs.existsSync(oldFile) ? load(oldFile) : null;
const out = path.join(root, '.cache/freestyle-breathing-timing'); fs.mkdirSync(out, {recursive:true});
function summarize(module, frames, stride) {
    const motion = new module.FreestyleBreathingMotion();
    let elapsed = 0, starts = 0, inBreath = false, visible = 0, maxVisible = 0, total = 0, maxTotal = 0;
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i]; elapsed += f.dt; if (i % stride) continue;
        const projection = Math.cos(f.roll) * Math.cos(f.pitch);
        const eligible = f.surface && f.speed > .35 && module.permitsFreestyleBreathing(projection, f.pitch, f.rollSpeed, f.pitchSpeed);
        const weight = motion.update(elapsed, f.right, f.right, eligible,
            !f.surface || projection < .35 || Math.cos(f.pitch) < .65 || Math.abs(f.rollSpeed) > 3 || Math.abs(f.pitchSpeed) > 3);
        if (weight > 0) { if (!inBreath) starts++; total += elapsed; } else { maxTotal = Math.max(maxTotal,total); total = 0; }
        if (motion.headWeight > .8) visible += elapsed;
        else { maxVisible = Math.max(maxVisible,visible); visible = 0; }
        inBreath = weight > 0; elapsed = 0;
    }
    return { starts, longestBodySeconds:Math.max(maxTotal,total), longestHeadAbove80Seconds:Math.max(maxVisible,visible) };
}
const report=[];
for (const mode of ['player','ai']) for (const fps of [30,60]) {
    const frames = replayBreathingInput({mode,fps,seconds:8});
    fs.writeFileSync(path.join(out, `${mode}-${fps}.json`), JSON.stringify(frames));
    for (const stride of mode === 'ai' ? [1,2,3] : [1]) report.push({mode,fps,stride,
        previous:previous ? summarize(previous,frames,stride) : null, current:summarize(current,frames,stride)});
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
