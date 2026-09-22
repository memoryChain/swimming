import { AnimationClip, AnimationState, Material, Mesh, MeshRenderer, Node, SkeletalAnimation, utils } from 'cc';
import type { SharkController } from '../entity/SharkController';
import { SHARK_TUNING, SharkState } from '../entity/SharkTuning';
import { SHARK_MODEL_PRESENTATION } from './ResourcePaths';
import { SHARK_FALLBACK_GEOMETRY } from './SharkFallbackGeometry';

const SAMPLE_INTERVAL = 1 / 24;
const AUTHORED_CONTACT_SECONDS = 0.09;
const AUTHORED_CONTACT_DURATION = 10 / 24;

/** 把有效判定时刻映射到作者接触标记；不改控制器的范围、时长或结果。 */
export function sharkContactClipTime(elapsed: number, duration: number, anticipation: number): number {
    const d = Math.max(0.05, duration);
    const a = Math.min(d, Math.max(0, anticipation));
    const t = Math.min(d, Math.max(0, elapsed));
    if (a > 0 && t < a) return AUTHORED_CONTACT_SECONDS * t / a;
    if (d <= a) return AUTHORED_CONTACT_DURATION;
    return AUTHORED_CONTACT_SECONDS + (AUTHORED_CONTACT_DURATION - AUTHORED_CONTACT_SECONDS) * (t - a) / (d - a);
}

/** 只持有短期外观状态。两条接触路径、晚加载和可靠事件共用同一序号。 */
export class SharkArtPresentation {
    private model: Node | null = null;
    private animation: SkeletalAnimation | null = null;
    private sampledState: AnimationState | null = null;
    private mode: 'none' | 'entry' | 'swim' | 'contact' = 'none';
    private lastSequence = -1;
    private contactElapsed = 0;
    private sampleElapsed = SAMPLE_INTERVAL;
    private lastSampleTime = -1;
    private reliableTail = false;
    private disposed = false;
    private fallbackRoot: Node | null = null;
    private fallbackMesh: Mesh | null = null;
    private fallbackMaterial: Material | null = null;
    private contactYaw = 0;
    private contactAdvance = 0;
    private lastVisualYaw = Number.NaN;
    private lastVisualAdvance = Number.NaN;

    buildFallback(parent: Node, layer: number): Node {
        const root = new Node('ToySharkFallback');
        root.setParent(parent);
        root.layer = layer;
        root.setPosition(0, SHARK_MODEL_PRESENTATION.visualYOffset, 0);
        root.setRotationFromEuler(...SHARK_MODEL_PRESENTATION.visualEulerDegrees);
        const scale = SHARK_MODEL_PRESENTATION.visualScale;
        root.setScale(scale, scale, scale);
        this.fallbackRoot = root;
        this.fallbackMesh = utils.createMesh(SHARK_FALLBACK_GEOMETRY);
        this.fallbackMaterial = new Material();
        this.fallbackMaterial.initialize({ effectName: 'builtin-unlit', defines: { USE_VERTEX_COLOR: true } });
        const renderer = root.addComponent(MeshRenderer);
        renderer.mesh = this.fallbackMesh;
        renderer.setMaterial(this.fallbackMaterial, 0);
        return root;
    }

    releaseFallback(): void {
        if (this.fallbackRoot?.isValid) this.fallbackRoot.destroy();
        this.fallbackRoot = null;
        this.fallbackMesh?.destroy();
        this.fallbackMaterial?.destroy();
        this.fallbackMesh = null;
        this.fallbackMaterial = null;
    }

    bind(model: Node, animation: SkeletalAnimation | null, shark: SharkController): void {
        if (this.disposed || !model.isValid) return;
        this.model = model;
        this.animation = animation;
        this.lastVisualYaw = Number.NaN;
        this.lastVisualAdvance = Number.NaN;
        // 更换资源只补当前姿态，不清掉事件序号，不能倒播已经结束的顶推。
        const previousMode = this.mode;
        this.mode = 'none';
        if (previousMode === 'contact') {
            this.startSampled('contact', 'Shark_Bite');
            this.sampleContact();
        }
        this.sync(shark, 0, false);
    }

    reset(): void {
        this.applyContactTransform(0, 0);
        this.lastSequence = -1;
        this.contactElapsed = 0;
        this.reliableTail = false;
        this.sampleElapsed = SAMPLE_INTERVAL;
        this.lastSampleTime = -1;
        this.mode = 'none';
        this.sampledState = null;
        this.animation?.stop();
    }

    dispose(): void {
        if (this.disposed) return;
        this.reset();
        this.releaseFallback();
        this.disposed = true;
        this.animation = null;
        this.model = null;
    }

    /** 可靠结果已发生时从接触点接续，丢失蓄势快照也不再次蓄势。 */
    notifyContact(sequence: number, shark: SharkController, target: Node | null = null, elapsedSinceHit = 0): void {
        if (this.disposed || !Number.isFinite(sequence) || sequence < shark.sequence) return;
        const revision = Math.max(0, Math.floor(sequence));
        const duration = Math.max(0.05, SHARK_TUNING.bitePresentationSeconds);
        const inContact = shark.state === SharkState.BITE || shark.state === SharkState.PATROL_BITE;
        if (revision <= this.lastSequence) {
            if (revision === this.lastSequence && this.mode === 'contact') {
                this.contactElapsed = Math.max(this.contactElapsed, Math.min(duration, SHARK_TUNING.biteAnticipationSeconds + elapsedSinceHit),
                    inContact ? duration - shark.remainingSeconds : 0);
                this.sampleContact();
            }
            return;
        }
        this.lastSequence = revision;
        this.captureContactAim(shark, target ?? shark.target?.node ?? null);
        this.contactElapsed = inContact
            ? Math.max(SHARK_TUNING.biteAnticipationSeconds + elapsedSinceHit, duration - shark.remainingSeconds)
            : Math.min(duration, Math.max(0, SHARK_TUNING.biteAnticipationSeconds + elapsedSinceHit));
        if (this.contactElapsed >= duration) {
            this.startSwim();
            return;
        }
        this.reliableTail = !inContact;
        this.startSampled('contact', 'Shark_Bite');
        this.sampleContact();
    }

    sync(shark: SharkController, dt: number, predictBetweenSnapshots: boolean): void {
        if (this.disposed || !shark) return;
        if (shark.state === SharkState.INACTIVE) {
            if (this.mode !== 'none' || this.lastSequence >= 0) this.reset();
            return;
        }
        if (!shark.node.activeInHierarchy) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const duration = Math.max(0.05, SHARK_TUNING.bitePresentationSeconds);
        const contact = shark.state === SharkState.BITE || shark.state === SharkState.PATROL_BITE;
        let changed = false;
        if (contact && shark.sequence > this.lastSequence) {
            this.lastSequence = shark.sequence;
            this.captureContactAim(shark, shark.target?.node ?? null);
            this.contactElapsed = Math.max(0, duration - shark.remainingSeconds);
            this.reliableTail = false;
            this.startSampled('contact', 'Shark_Bite');
            changed = true;
        } else if (this.mode === 'contact') {
            if (shark.sequence > this.lastSequence || (!contact && !this.reliableTail)) {
                this.startSwim();
            } else {
                if (predictBetweenSnapshots || this.reliableTail) this.contactElapsed += step;
                if (contact && shark.sequence === this.lastSequence) {
                    this.contactElapsed = Math.max(this.contactElapsed, duration - shark.remainingSeconds);
                    this.reliableTail = false;
                }
            }
        }
        if (this.mode === 'contact') {
            this.sampleElapsed += step;
            if (changed || this.sampleElapsed >= SAMPLE_INTERVAL || this.contactElapsed >= duration) {
                this.sampleElapsed = 0;
                this.sampleContact();
            }
            if (this.contactElapsed >= duration) this.startSwim();
            return;
        }
        if (shark.entryActive) {
            if (this.mode !== 'entry') this.startSampled('entry', 'Shark_Entry_Rise');
            this.sampleElapsed += step;
            if (this.sampleElapsed >= SAMPLE_INTERVAL) {
                this.sampleElapsed = 0;
                this.sample(shark.entryProgress * (this.sampledState?.duration ?? 1.1));
            }
        } else if (this.mode !== 'swim') this.startSwim();
    }

    private startSampled(mode: 'contact' | 'entry', clip: string): void {
        this.mode = mode;
        this.sampleElapsed = SAMPLE_INTERVAL;
        this.lastSampleTime = -1;
        this.sampledState = this.animation?.isValid ? this.animation.getState(clip) : null;
        if (!this.sampledState) return;
        this.sampledState.wrapMode = AnimationClip.WrapMode.Normal;
        this.sampledState.speed = 0;
        this.animation!.play(clip);
    }

    private sampleContact(): void {
        this.sample(sharkContactClipTime(this.contactElapsed,
            SHARK_TUNING.bitePresentationSeconds, SHARK_TUNING.biteAnticipationSeconds));
        const anticipation = Math.max(0.001, Math.min(SHARK_TUNING.bitePresentationSeconds, SHARK_TUNING.biteAnticipationSeconds));
        const tail = Math.max(0.001, SHARK_TUNING.bitePresentationSeconds - anticipation);
        const envelope = this.contactElapsed <= anticipation
            ? Math.min(1, this.contactElapsed / anticipation)
            : Math.max(0, 1 - (this.contactElapsed - anticipation) / tail);
        this.applyContactTransform(this.contactYaw, this.contactAdvance * envelope);
    }

    private captureContactAim(shark: SharkController, target: Node | null): void {
        this.contactYaw = 0;
        this.contactAdvance = 0;
        if (!target?.isValid) return;
        // 两者都挂在比赛世界根下，只校准演员层；背后／侧方补命中也使用圆鼻头。
        const dx = target.position.x - shark.node.position.x;
        const dz = target.position.z - shark.node.position.z;
        const length = Math.sqrt(dx * dx + dz * dz);
        if (length < 0.001) return;
        this.contactYaw = Math.atan2(-dz, dx) * 180 / Math.PI - shark.node.eulerAngles.y;
        // 鼻端接近目标身体，而非把原命中圆的外缘当作可见接触面。
        this.contactAdvance = Math.min(0.55, Math.max(0, length - SHARK_TUNING.biteMouthForwardOffset - 0.25));
    }

    private applyContactTransform(yaw: number, advance: number): void {
        const model = this.model?.isValid ? this.model : this.fallbackRoot;
        if (!model?.isValid) return;
        const yawChanged = yaw !== this.lastVisualYaw;
        if (yawChanged) {
            model.setRotationFromEuler(0, SHARK_MODEL_PRESENTATION.visualEulerDegrees[1] + yaw, 0);
            this.lastVisualYaw = yaw;
        }
        if (advance !== this.lastVisualAdvance || yawChanged) {
            const radians = yaw * Math.PI / 180;
            model.setPosition(Math.cos(radians) * advance, SHARK_MODEL_PRESENTATION.visualYOffset, -Math.sin(radians) * advance);
            this.lastVisualAdvance = advance;
        }
    }

    private sample(time: number): void {
        const state = this.sampledState;
        if (!state || !this.model?.isValid || time === this.lastSampleTime) return;
        this.lastSampleTime = time;
        state.setTime(Math.min(state.duration, time));
        state.sample();
    }

    private startSwim(): void {
        this.applyContactTransform(0, 0);
        this.mode = 'swim';
        this.reliableTail = false;
        this.sampledState = null;
        const state = this.animation?.isValid ? this.animation.getState('Shark_Swim_Loop') : null;
        if (!state) return;
        state.wrapMode = AnimationClip.WrapMode.Loop;
        state.speed = SHARK_MODEL_PRESENTATION.swimAnimationSpeed;
        this.animation!.crossFade('Shark_Swim_Loop', SHARK_MODEL_PRESENTATION.swimBlendSeconds);
    }
}
