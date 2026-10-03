import { Color, gfx, Material, Mesh, MeshRenderer, Node } from 'cc';
import { GIANT_WAVE_TUNING, GiantWaveState, waveArrivalTime, waveDuration, waveEnvelope } from './GiantWaveRules';
import type { FloatingItemLayers } from './FloatingItemRenderer';

import type { GiantWaveMeshes } from './EntertainmentItemAssets';

/** Blender 导出的三份 GLB，沿用原有效果的变换和透明度，不在运行时造型。 */
export class GiantWavePresentation {
    private readonly body: WavePart;
    private readonly wake: WavePart;
    private readonly shore: WavePart;
    private height = GIANT_WAVE_TUNING.height;
    private readonly parts: WavePart[] = [];
    private sampleTick = -1;
    private samplePhase = "";
    private disposed = false;
    constructor(parent: Node, private readonly waterY: number, meshes: GiantWaveMeshes, layers: FloatingItemLayers | null = null) {
        try {
            this.body = new WavePart(parent, 'GiantWave', meshes.body, layers); this.parts.push(this.body);
            this.wake = new WavePart(parent, 'GiantWaveWake', meshes.wake, layers); this.parts.push(this.wake);
            this.shore = new WavePart(parent, 'GiantWaveShore', meshes.shore, layers); this.parts.push(this.shore);
        } catch (error) { this.dispose(); throw error; }
    }
    begin(height = GIANT_WAVE_TUNING.height): void { this.height = height; }
    update(s: GiantWaveState): void {
        if (this.disposed) return;
        if (s.phase !== 'active' && s.phase !== 'preview') { this.hide(); return; }
        const tick = Math.floor((s.phase === 'preview' ? s.timer : s.age) * 30 + 1e-6);
        if (s.phase === this.samplePhase && tick === this.sampleTick) return;
        this.samplePhase = s.phase; this.sampleTick = tick;
        if (s.phase === 'preview') {
            this.body.hide(); this.wake.hide();
            // 预告使用已有拍岸白沫，放在真实起浪端，保留明显高于水面的起伏。
            this.shore.apply(s.startX - s.direction * (s.length * .5 - .12), this.waterY + .03, s.z,
                .6, .26 + .06 * Math.sin(tick / 30 * 6), s.width, s.direction, .85);
            return;
        }
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
    hide(): void {
        if (this.disposed) return;
        for (const part of this.parts) part.hide();
        this.sampleTick = -1; this.samplePhase = '';
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const part of this.parts) part.dispose();
    }
}

/** 缓存写入，隐藏期间无材质／变换工作；共享网格由资源 Bundle 持有。 */
class WavePart {
    private readonly root: Node;
    private material: Material | null = null;
    private readonly tint = new Color(255, 255, 255, 0);
    private releaseLayers: (() => void) | null = null;
    private disposed = false;
    private x = NaN; private y = NaN; private z = NaN;
    private sx = NaN; private sy = NaN; private sz = NaN;
    private direction = 0;
    private alpha = 0;
    constructor(parent: Node, name: string, mesh: Mesh, layers: FloatingItemLayers | null) {
        this.root = new Node(name);
        try {
            parent.addChild(this.root); this.root.layer = parent.layer;
            this.material = new Material();
            this.material.initialize({ effectName: 'builtin-unlit', technique: 1,
                defines: { USE_VERTEX_COLOR: true }, states: {
                    rasterizerState: { cullMode: gfx.CullMode.NONE },
                    depthStencilState: { depthTest: true, depthWrite: false },
                } });
            this.material.setProperty('mainColor', this.tint);
            const renderer = this.root.addComponent(MeshRenderer);
            renderer.priority = name === 'GiantWaveWake' ? 0 : name === 'GiantWave' ? 1 : 2;
            renderer.mesh = mesh; renderer.setMaterial(this.material, 0);
            this.root.active = false;
            this.releaseLayers = layers?.registerFloatingObject(this.root) ?? null;
        } catch (error) { this.dispose(); throw error; }
    }
    apply(x: number, y: number, z: number, sx: number, sy: number, sz: number, direction: number, opacity: number): void {
        if (this.disposed) return;
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
            this.alpha = alpha; this.tint.a = alpha; this.material!.setProperty('mainColor', this.tint);
        }
    }
    hide(): void { if (!this.disposed && this.root.active) this.root.active = false; }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.releaseLayers?.();
        if (this.root.isValid) this.root.destroy();
        this.material?.destroy();
    }
}

function smoothStep(value: number): number {
    const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t);
}
