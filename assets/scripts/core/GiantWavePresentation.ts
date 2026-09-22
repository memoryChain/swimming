import { Color, gfx, Material, MeshRenderer, Node, utils } from 'cc';
import { GIANT_WAVE_TUNING, GiantWaveState, waveArrivalTime, waveDuration, waveEnvelope } from './GiantWaveRules';

type WaveGeometry = { positions: number[]; colors: number[]; indices: number[] };

/** 三个固定网格：卷起的浪面、碎泡沫尾流、拍岸水片。运行期只改变换和透明度。 */
export class GiantWavePresentation {
    private readonly body: WavePart;
    private readonly wake: WavePart;
    private readonly shore: WavePart;
    private height = GIANT_WAVE_TUNING.height;
    constructor(parent: Node, private readonly waterY: number) {
        this.body = new WavePart(parent, 'GiantWave', buildWaveGeometry());
        this.wake = new WavePart(parent, 'GiantWaveWake', buildWakeGeometry());
        this.shore = new WavePart(parent, 'GiantWaveShore', buildShoreGeometry());
    }
    begin(): void { this.height = GIANT_WAVE_TUNING.height; }
    update(s: GiantWaveState): void {
        if (s.phase !== 'active') { this.hide(); return; }
        const grow = smoothStep(s.age / s.growthTime);
        const born = smoothStep(s.age / Math.min(0.7, s.entrance));
        const hitAge = s.age - waveArrivalTime(s);
        const hit = smoothStep(hitAge / s.impactTime);
        const residue = 1 - smoothStep((hitAge - s.impactTime) / s.fadeTime);
        const lengthScale = (0.25 + 0.75 * grow) * (1 - hit * 0.8);
        // 小浪贴起点水边展开；到岸后浪头保持接岸，后坡向前压缩。
        const offset = hitAge >= 0 ? 1 : -1;
        const bodyX = s.x + offset * s.direction * s.length * (1 - lengthScale) * 0.5;
        const ripple = Math.sin(Math.floor(s.age * 30) / 30 * 3.6) * 0.025 * grow * (1 - hit);
        this.body.apply(bodyX, this.waterY + 0.025, s.z,
            s.length * lengthScale, Math.max(0.001, this.height * waveEnvelope(s) * (1 + ripple) * (1 - hit * 0.85)),
            s.width * (0.5 + 0.5 * grow), s.direction, born * (1 - hit) * residue);
        const behind = Math.max(0, (s.x - s.startX) * s.direction + s.length * 0.5);
        const wakeLength = Math.min(behind, s.length * (0.8 + grow * 0.6 + hit * 0.2));
        // 尾流随浪展开，抵岸后向池内铺开并缓慢散去。
        this.wake.apply(s.x + s.direction * s.length * 0.5 * hit, this.waterY + 0.032, s.z, Math.max(0.001, wakeLength), 1,
            s.width * (0.45 + 0.5 * grow), s.direction, born * (0.3 + 0.5 * grow) * residue);
        if (hitAge >= 0 && s.age < waveDuration(s)) {
            const lift = Math.sin(Math.PI * Math.min(1, hitAge / s.impactTime));
            const splash = smoothStep(hitAge / 0.16) * (1 - smoothStep(hitAge / s.impactTime));
            const wallX = s.endX + s.direction * (s.length * 0.5 - 0.025);
            this.shore.apply(wallX, this.waterY + 0.03, s.z,
                0.5 + hit * 1.1, Math.max(0.001, this.height * (0.12 + lift * 1.9)),
                s.width * 0.96, s.direction, splash);
        } else this.shore.hide();
    }
    hide(): void { this.body.hide(); this.wake.hide(); this.shore.hide(); }
    dispose(): void { this.body.dispose(); this.wake.dispose(); this.shore.dispose(); }
}

/** 缓存写入，隐藏期间无材质／变换工作；每个网格只创建一次。 */
class WavePart {
    private readonly root: Node;
    private readonly material = new Material();
    private readonly tint = new Color(255, 255, 255, 0);
    private readonly mesh;
    private x = NaN; private y = NaN; private z = NaN;
    private sx = NaN; private sy = NaN; private sz = NaN;
    private direction = 0;
    private alpha = 0;
    constructor(parent: Node, name: string, geometry: WaveGeometry) {
        this.root = new Node(name); parent.addChild(this.root);
        this.root.layer = parent.layer;
        this.mesh = utils.createMesh(geometry);
        this.material.initialize({ effectName: 'builtin-unlit', technique: 1,
            defines: { USE_VERTEX_COLOR: true }, states: {
                rasterizerState: { cullMode: gfx.CullMode.NONE },
                depthStencilState: { depthTest: true, depthWrite: false },
            } });
        this.material.setProperty('mainColor', this.tint);
        const renderer = this.root.addComponent(MeshRenderer);
        renderer.priority = name === 'GiantWaveWake' ? 0 : name === 'GiantWave' ? 1 : 2;
        renderer.mesh = this.mesh; renderer.setMaterial(this.material, 0);
        this.root.active = false;
    }
    apply(x: number, y: number, z: number, sx: number, sy: number, sz: number, direction: number, opacity: number): void {
        const alpha = Math.round(Math.round(Math.max(0, Math.min(1, opacity)) * 64) / 64 * 255);
        if (!alpha) { this.hide(); return; }
        if (!this.root.active) this.root.active = true;
        if (x !== this.x || y !== this.y || z !== this.z) {
            this.x = x; this.y = y; this.z = z; this.root.setPosition(x, y, z);
        }
        if (sx !== this.sx || sy !== this.sy || sz !== this.sz) {
            this.sx = sx; this.sy = sy; this.sz = sz; this.root.setScale(sx, sy, sz);
        }
        if (direction !== this.direction) {
            this.direction = direction; this.root.setRotationFromEuler(0, direction > 0 ? 0 : 180, 0);
        }
        if (alpha !== this.alpha) {
            this.alpha = alpha; this.tint.a = alpha; this.material.setProperty('mainColor', this.tint);
        }
    }
    hide(): void { if (this.root.active) this.root.active = false; }
    dispose(): void {
        if (this.root.isValid) this.root.destroy();
        this.mesh.destroy(); this.material.destroy();
    }
}

function emptyGeometry(): WaveGeometry { return { positions: [], colors: [], indices: [] }; }
function buildWaveGeometry(): WaveGeometry {
    const g = emptyGeometry();
    // 薄透后坡、青蓝浪腹、浅青卷唇、碎白浪冠、向前回落的水片。
    const profile = [[-0.5, 0], [-0.34, 0.08], [-0.16, 0.28], [0.02, 0.59],
        [0.13, 0.86], [0.20, 1], [0.26, 0.97], [0.30, 0.80],
        [0.34, 0.42], [0.39, 0.12], [0.45, 0.03], [0.5, 0]];
    const alpha = [0, 0.26, 0.65, 0.9, 0.96, 1, 1, 0.9, 0.68, 0.36, 0.15, 0];
    const foam = [0, 0, 0, 0.04, 0.22, 0.92, 1, 0.63, 0.06, 0.12, 0.18, 0];
    const columns = 28;
    for (let col = 0; col <= columns; col++) {
        const edge = col === 0 || col === columns ? 0 : Math.sin(Math.PI * col / columns);
        const lateral = edge * edge;
        const foamStrength = smoothStep((lateral - 0.06) / 0.64);
        const scallop = Math.sin(col * 1.83) * Math.sin(col * 0.71);
        for (let p = 0; p < profile.length; p++) {
            const crest = p >= 4 && p <= 7;
            const x = crest ? 0.23 + (profile[p][0] - 0.23) * (0.2 + 0.8 * foamStrength) : profile[p][0];
            const ripple = scallop * 0.025 * edge * (crest ? 1 : 0.4);
            g.positions.push(x + ripple, profile[p][1] * lateral * (1 + scallop * 0.045), col / columns - 0.5);
            const white = foam[p] * foamStrength * (0.78 + scallop * 0.18);
            const green = p < 5 ? 0.48 + p * 0.044 : 0.65;
            const blue = p < 5 ? 0.7 + p * 0.035 : 0.83;
            g.colors.push(0.055 + 0.91 * white, green + (0.99 - green) * white,
                blue + (1 - blue) * white, alpha[p] * smoothStep(lateral / 0.65));
            if (col < columns && p < profile.length - 1) quad(g, col * profile.length + p, profile.length);
        }
    }
    return g;
}
function buildWakeGeometry(): WaveGeometry {
    const g = emptyGeometry();
    // 三条疏密不同、两端收细的弧形碎沫带合为一网格，避免整块白色尾巴。
    for (let band = 0; band < 3; band++) {
        const base = g.positions.length / 3;
        for (let col = 0; col <= 28; col++) {
            const z = col / 28 - 0.5, side = Math.sin(Math.PI * col / 28);
            const broken = 0.35 + 0.65 * Math.abs(Math.sin(col * 1.42 + band * 2.1));
            const x = -0.06 - band * 0.3 - z * z * 0.3 + Math.sin(col * 1.6 + band) * 0.018;
            for (let row = 0; row < 3; row++) {
                g.positions.push(x + (row - 1) * (0.014 + band * 0.006) * side, 0, z);
                g.colors.push(0.65 + broken * 0.3, 0.93, 1,
                    row === 1 ? side * side * broken * (0.55 - band * 0.12) : 0);
                if (col < 28 && row < 2) quad(g, base + col * 3 + row, 3);
            }
        }
    }
    return g;
}
function buildShoreGeometry(): WaveGeometry {
    const g = emptyGeometry();
    // 靠岸薄水片向池内弯曲，分层渐隐；疏密浪尖与分离小水滴共用同一网格。
    for (let col = 0; col <= 28; col++) {
        const z = col / 28 - 0.5, edge = Math.pow(Math.sin(Math.PI * col / 28), 2);
        const tip = 0.55 + 0.45 * Math.abs(Math.sin(col * 1.71));
        for (let row = 0; row < 5; row++) {
            const t = row / 4;
            g.positions.push(-0.02 - t * t * 0.65, t * tip * edge, z);
            g.colors.push(0.58 + t * 0.4, 0.91 + t * 0.08, 1,
                (row === 0 || row === 4 ? 0 : 0.85) * edge * (0.6 + tip * 0.4));
            if (col < 28 && row < 4) quad(g, col * 5 + row, 5);
        }
    }
    for (let i = 0; i < 12; i++) {
        const z = (i + 0.5) / 12 - 0.5, edge = Math.sin(Math.PI * (z + 0.5));
        const y = (0.65 + 0.26 * Math.abs(Math.sin(i * 2.3))) * edge;
        const x = -0.55 - 0.28 * Math.abs(Math.sin(i * 1.7));
        const a = g.positions.length / 3;
        g.positions.push(x, y - 0.06, z, x - 0.025, y, z - 0.008,
            x - 0.04, y + 0.08, z, x - 0.025, y, z + 0.008);
        for (let j = 0; j < 4; j++) g.colors.push(0.87, 0.98, 1, j % 2 ? 0.8 * edge : 0);
        g.indices.push(a, a + 1, a + 2, a, a + 2, a + 3);
    }
    return g;
}
function quad(g: WaveGeometry, a: number, stride: number): void {
    g.indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
}
function smoothStep(value: number): number {
    const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t);
}
