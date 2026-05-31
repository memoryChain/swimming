import { _decorator, Component, Node, Vec3 } from 'cc';

const { ccclass } = _decorator;

type WaveNode = {
    node: Node;
    base: Vec3;
    baseScale: Vec3;
    phase: number;
    amplitude: number;
    speed: number;
    transformMotion: boolean;
};

@ccclass('WaterSurface')
export class WaterSurface extends Component {
    private _waves: WaveNode[] = [];
    private _time = 0;

    start() {
        this._waves.length = 0;
        this.collect(this.node);
    }

    update(dt: number) {
        this._time += dt;
        for (const wave of this._waves) {
            if (!wave.transformMotion) {
                continue;
            }
            const offset = Math.sin(this._time * wave.speed + wave.phase) * wave.amplitude;
            wave.node.setPosition(wave.base.x + offset * 0.45, wave.base.y + Math.abs(offset) * 0.28, wave.base.z);
            const stretch = 1 + Math.sin(this._time * wave.speed * 0.73 + wave.phase) * 0.12;
            wave.node.setScale(wave.baseScale.x * stretch, wave.baseScale.y, wave.baseScale.z);
        }
    }

    private collect(node: Node) {
        if (this.isWaterMotionNode(node)) {
            const p = node.position;
            this._waves.push({
                node,
                base: new Vec3(p.x, p.y, p.z),
                baseScale: node.scale.clone(),
                phase: (p.x * 0.17 + p.z * 1.91) % 6.28,
                amplitude: this.isMainWaterPlane(node) ? 0.012 : 0.045,
                speed: this.isMainWaterPlane(node) ? 1.2 : 2.1 + Math.abs(p.z) * 0.07,
                transformMotion: !this.isMainWaterPlane(node),
            });
        }
        for (const child of node.children) {
            this.collect(child);
        }
    }

    private isWaterMotionNode(node: Node): boolean {
        return node.name === 'PoolWaterSurface'
            || node.name === 'flat_transparent_water_plane'
            || node.name === 'WaterCenterReflection'
            || node.name === 'WaterGlint'
            || node.name === 'WaterGlintShort'
            || node.name === 'LaneWave'
            || node.name === 'LaneBlueRipple'
            || node.name === 'WallFoamLeft'
            || node.name === 'WallFoamRight';
    }

    private isMainWaterPlane(node: Node): boolean {
        return node.name === 'PoolWaterSurface' || node.name === 'flat_transparent_water_plane';
    }
}
