import { Color, Material, MeshRenderer, Node, Vec3, Vec4, primitives, utils } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

type DashPartKind = 'impact' | 'bow' | 'tail';

type DashPart = {
    kind: DashPartKind;
    node: Node;
    material: Material;
    params: Vec4;
};

export type WaveDashWaterEffectOptions = {
    owner: Node;
    parent: Node;
    name: string;
    waterY: number;
    reduced?: boolean;
};

const EFFECT_SAMPLE_INTERVAL = 1 / 30;
const IMPACT_SECONDS = 0.09;
const RELEASE_SECONDS = 0.13;
const FULL_FOAM_COLOR = new Color(224, 249, 255, 218);
const FULL_RIPPLE_COLOR = new Color(72, 202, 244, 154);
const REDUCED_FOAM_COLOR = new Color(224, 249, 255, 150);
const REDUCED_RIPPLE_COLOR = new Color(72, 202, 244, 104);

// World-space dash water built from the authored swimmer-splash material. The
// focused swimmer gets one continuous triangular bow wave (centre + wings), a
// one-shot impact and a tail; reduced swimmers retain only the tail.
export class WaveDashWaterEffect {
    public readonly node: Node;

    private readonly _parts: DashPart[] = [];
    private readonly _tmpPosition = new Vec3();
    private _built = false;
    private _requestedActive = false;
    private _culled = false;
    private _elapsed = 0;
    private _releaseRemaining = 0;
    private _sampleElapsed = EFFECT_SAMPLE_INTERVAL;
    private _lastRootYawDegrees = Number.NaN;
    private _lastVisualSpeedRatio = Number.NaN;
    private _lastImpactRatio = Number.NaN;
    private _lastReleaseRatio = Number.NaN;

    constructor(private readonly _options: WaveDashWaterEffectOptions) {
        this.node = new Node(_options.name);
        this.node.setParent(_options.parent);
        this.node.setPosition(_options.owner.position.x, _options.waterY, _options.owner.position.z);
        this.node.active = false;
    }

    build() {
        loadRaceAsset(RESOURCE_PATHS.swimmerSplashMaterial, Material, (err, material) => {
            if (err || !material || !this.node?.isValid) {
                console.warn('[SpeedSwimming] failed to load wave dash water material', err);
                return;
            }
            this.createPart('tail', material);
            if (!this._options.reduced) {
                this.createPart('impact', material);
                this.createPart('bow', material);
            }
            this._built = true;
            this.refreshParts(0);
        });
    }

    setActive(active: boolean) {
        if (this._requestedActive === active) {
            return;
        }
        this._requestedActive = active;
        if (active) {
            this._elapsed = 0;
            this._releaseRemaining = 0;
            this._sampleElapsed = EFFECT_SAMPLE_INTERVAL;
            this.invalidateVisualSample();
        } else {
            this._releaseRemaining = RELEASE_SECONDS;
            this.invalidateVisualSample();
        }
    }

    setCulled(culled: boolean) {
        if (this._culled === culled) {
            return;
        }
        this._culled = culled;
        if (culled && this.node.active) {
            this.node.active = false;
        }
    }

    reset() {
        this._requestedActive = false;
        this._elapsed = 0;
        this._releaseRemaining = 0;
        this._sampleElapsed = EFFECT_SAMPLE_INTERVAL;
        this.invalidateVisualSample();
        if (this.node.active) {
            this.node.active = false;
        }
    }

    update(dt: number, movementDirection: number, movementHeadingRadians: number, speed: number) {
        if (!this._built || !this.node?.isValid) {
            return;
        }
        if (!this._requestedActive && this._releaseRemaining <= 0 && !this.node.active) {
            return;
        }
        const safeDt = Math.max(0, dt);
        if (this._requestedActive) {
            this._elapsed += safeDt;
        } else if (this._releaseRemaining > 0) {
            this._releaseRemaining = Math.max(0, this._releaseRemaining - safeDt);
        }
        const visible = !this._culled && (this._requestedActive || this._releaseRemaining > 0);
        if (this.node.active !== visible) {
            this.node.active = visible;
        }
        if (!visible) {
            return;
        }

        this._tmpPosition.set(this._options.owner.position.x, this._options.waterY, this._options.owner.position.z);
        this.node.setPosition(this._tmpPosition);
        const direction = movementDirection >= 0 ? 1 : -1;
        // Unlike regular splash parts (which mirror their local positions), the
        // bow is one directional mesh. On the return length it therefore needs
        // an explicit half turn before applying the steering offset; without it
        // the V points back toward the swimmer and reads as two stray wake strips.
        const yawDegrees = (direction < 0 ? 180 : 0)
            - direction * movementHeadingRadians * 180 / Math.PI;
        if (yawDegrees !== this._lastRootYawDegrees) {
            this._lastRootYawDegrees = yawDegrees;
            this.node.setRotationFromEuler(0, yawDegrees, 0);
        }

        this._sampleElapsed += safeDt;
        if (this._sampleElapsed < EFFECT_SAMPLE_INTERVAL) {
            return;
        }
        this._sampleElapsed %= EFFECT_SAMPLE_INTERVAL;
        this.refreshParts(speed);
    }

    destroy() {
        this._parts.length = 0;
        if (this.node?.isValid) {
            this.node.destroy();
        }
    }

    private createPart(kind: DashPartKind, sourceMaterial: Material) {
        const node = new Node(`WaveDash${kind}`);
        node.setParent(this.node);
        node.layer = this.node.layer;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = kind === 'bow'
            ? utils.createMesh(createBowWaveGeometry())
            : utils.createMesh(primitives.plane({
                width: kind === 'impact' ? 1.15 : 1.55,
                length: kind === 'tail' ? 0.7 : 0.38,
                widthSegments: 2,
                lengthSegments: 1,
            }));
        const material = new Material();
        material.copy(sourceMaterial);
        material.name = `RuntimeWaveDash${kind}`;
        material.setProperty('foamColor', this._options.reduced ? REDUCED_FOAM_COLOR : FULL_FOAM_COLOR);
        material.setProperty('rippleColor', this._options.reduced ? REDUCED_RIPPLE_COLOR : FULL_RIPPLE_COLOR);
        material.setProperty('dashWaveParams', new Vec4(kind === 'bow' ? 1 : 0, 0, 0, 0));
        material.setProperty('shapeParams', shapeParamsFor(kind));
        renderer.setMaterial(material, 0);
        this._parts.push({ kind, node, material, params: new Vec4() });
    }

    private refreshParts(speed: number) {
        const speedRatio = quantize(clamp(speed / 5.8, 0.72, 1), 0.05);
        const releaseRatio = quantize(this._requestedActive ? 1 : clamp(this._releaseRemaining / RELEASE_SECONDS, 0, 1), 0.05);
        const impactRatio = quantize(clamp(1 - this._elapsed / IMPACT_SECONDS, 0, 1), 0.05);
        if (speedRatio === this._lastVisualSpeedRatio
            && releaseRatio === this._lastReleaseRatio
            && impactRatio === this._lastImpactRatio) {
            return;
        }
        this._lastVisualSpeedRatio = speedRatio;
        this._lastReleaseRatio = releaseRatio;
        this._lastImpactRatio = impactRatio;
        for (const part of this._parts) {
            const active = part.kind === 'impact'
                ? this._requestedActive && impactRatio > 0.001
                : releaseRatio > 0.001;
            if (part.node.active !== active) {
                part.node.active = active;
            }
            if (!active) {
                continue;
            }
            applyPartTransform(part, impactRatio, releaseRatio);
            const burst = part.kind === 'impact'
                ? impactRatio
                : part.kind === 'bow'
                    ? 0.78 * releaseRatio
                    : 0.45 * releaseRatio;
            const intensity = part.kind === 'impact'
                ? 1.42 * impactRatio
                : part.kind === 'bow'
                    ? 1.48 * releaseRatio
                    : part.kind === 'tail'
                        ? 1.08 * releaseRatio
                        : 0.86 * releaseRatio;
            part.params.set(
                intensity,
                speedRatio,
                burst,
                seedFor(part.kind),
            );
            part.material.setProperty('splashParams', part.params);
        }
    }

    private invalidateVisualSample() {
        this._lastVisualSpeedRatio = Number.NaN;
        this._lastImpactRatio = Number.NaN;
        this._lastReleaseRatio = Number.NaN;
    }
}

function applyPartTransform(part: DashPart, impactRatio: number, releaseRatio: number) {
    switch (part.kind) {
        case 'impact': {
            const progress = 1 - impactRatio;
            part.node.setPosition(0.48 + progress * 0.14, 0.014, 0);
            part.node.setRotationFromEuler(0, 0, 0);
            const scale = 0.68 + progress * 0.72;
            part.node.setScale(scale, 1, scale * 0.7);
            break;
        }
        case 'bow':
            // One mesh owns the tip and both wings, so transparent sorting can
            // never pull the two sides apart from the central ship-bow wedge.
            part.node.setPosition(0, 0.022, 0);
            part.node.setRotationFromEuler(0, 0, 0);
            part.node.setScale(releaseRatio, 1, releaseRatio);
            break;
        case 'tail':
            part.node.setPosition(-0.86, 0.008, 0);
            part.node.setRotationFromEuler(0, 0, 0);
            part.node.setScale((1.05 + releaseRatio * 0.32) * releaseRatio, 1, (0.62 + releaseRatio * 0.12) * releaseRatio);
            break;
    }
}

function shapeParamsFor(kind: DashPartKind): Vec4 {
    switch (kind) {
        case 'impact': return new Vec4(0.05, 0.45, 1, 0);
        case 'bow': return new Vec4(0.76, 0.82, 0, 0);
        case 'tail': return new Vec4(0.9, 1.6, 0, 0);
        default: return new Vec4(1.15, 1.25, 0, 0);
    }
}

function seedFor(kind: DashPartKind): number {
    switch (kind) {
        case 'impact': return 3.1;
        case 'bow': return 5.4;
        case 'tail': return 16.2;
    }
}

// One connected low-poly ship-bow mesh. +X is the swim direction: the tip is
// deliberately a visible distance in front of the head (not hidden by it), and
// the two wings open much wider toward the rear than at their forward join.
function createBowWaveGeometry() {
    const positions = [
        1.55, 0, 0,
        0.95, 0, -0.09,
        0.22, 0, -0.34,
        0.95, 0, 0.09,
        0.22, 0, 0.34,
        0.82, 0, -0.22,
        -0.82, 0, -1.05,
        -0.54, 0, -0.58,
        0.82, 0, 0.22,
        -0.82, 0, 1.05,
        -0.54, 0, 0.58,
    ];
    const normals = [
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
    ];
    const uvs = [
        1, 0.5,
        0.70, 0.36,
        0.30, 0.18,
        0.70, 0.64,
        0.30, 0.82,
        0.62, 0.18,
        0, 0,
        0.18, 0.18,
        0.62, 0.82,
        0, 1,
        0.18, 0.82,
    ];
    return {
        positions,
        normals,
        uvs,
        indices: [0, 2, 1, 0, 1, 3, 0, 3, 4, 0, 4, 2, 1, 6, 5, 1, 7, 6, 3, 8, 9, 3, 9, 10],
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function quantize(value: number, step: number): number {
    return Math.round(value / step) * step;
}
