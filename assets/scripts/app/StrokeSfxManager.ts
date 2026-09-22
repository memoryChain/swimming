import { assetManager, AssetManager, AudioClip, AudioSource, director, game, Node } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

const SFX_NODE_NAME = 'SpeedSwimmingStrokeSfx';
const STROKE_VOLUME = 0.32;
const PERFECT_STROKE_VOLUME = 0.52;

export class StrokeSfxManager {
    private static _node: Node | null = null;
    private static _source: AudioSource | null = null;
    private static readonly _clips: Array<AudioClip | null> = RESOURCE_PATHS.music.strokeSfx.map(() => null);
    private static _loading = false;
    private static _nextClip = 0;
    private static _volumeScale = 1;
    private static _buoyPop: AudioClip | null = null;
    private static _buoyPopLoading = false;
    private static _lastBuoyPopMs = -Infinity;

    /** 复用现有音效输出与设置音量；加载完成不补播已经过去的触发。 */
    static preloadBuoyPop() {
        this.ensureSource();
        if (this._buoyPop || this._buoyPopLoading) return;
        this._buoyPopLoading = true;
        const load = (bundle: AssetManager.Bundle) => {
            bundle.load(RESOURCE_PATHS.music.buoyPop, AudioClip, (error, clip) => {
                this._buoyPopLoading = false;
                if (!error && clip) this._buoyPop = clip;
            });
        };
        const bundle = assetManager.getBundle(RESOURCE_PATHS.music.bundle);
        if (bundle) load(bundle);
        else assetManager.loadBundle(RESOURCE_PATHS.music.bundle, (error, loaded) => {
            if (!error && loaded) load(loaded);
            else this._buoyPopLoading = false;
        });
    }

    static playBuoyPop() {
        if (this._volumeScale <= 0 || !this._buoyPop || !this._source?.isValid) return;
        const now = Date.now();
        // 音频 0.18 秒，同类至少间隔 0.12 秒，最多两声重叠。
        if (now - this._lastBuoyPopMs < 120) return;
        this._lastBuoyPopMs = now;
        this._source.playOneShot(this._buoyPop, 0.48 * this._volumeScale);
    }

    static preload() {
        this.ensureSource();
        if (this._loading || this.hasEveryClip()) {
            return;
        }
        this._loading = true;
        const loadedBundle = assetManager.getBundle(RESOURCE_PATHS.music.bundle);
        if (loadedBundle) {
            this.loadClips(loadedBundle);
            return;
        }
        assetManager.loadBundle(RESOURCE_PATHS.music.bundle, (error, bundle) => {
            if (error || !bundle) {
                this._loading = false;
                console.warn('[SpeedSwimming] stroke SFX subpackage failed to load', error);
                return;
            }
            this.loadClips(bundle);
        });
    }

    static playStroke(perfect = false) {
        if (this._volumeScale <= 0) {
            return;
        }
        const source = this.ensureSource();
        if (!source) {
            return;
        }
        for (let offset = 0; offset < this._clips.length; offset++) {
            const index = (this._nextClip + offset) % this._clips.length;
            const clip = this._clips[index];
            if (!clip) {
                continue;
            }
            this._nextClip = (index + 1) % this._clips.length;
            source.playOneShot(clip, (perfect ? PERFECT_STROKE_VOLUME : STROKE_VOLUME) * this._volumeScale);
            return;
        }
        this.preload();
    }

    static setVolume(scale: number) {
        this._volumeScale = Math.max(0, Math.min(1, scale));
    }

    private static loadClips(bundle: AssetManager.Bundle) {
        let remaining = RESOURCE_PATHS.music.strokeSfx.length;
        RESOURCE_PATHS.music.strokeSfx.forEach((path, index) => {
            bundle.load(path, AudioClip, (error, clip) => {
                if (!error && clip) {
                    this._clips[index] = clip;
                } else {
                    console.warn(`[SpeedSwimming] stroke SFX failed to load: ${path}`, error);
                }
                remaining -= 1;
                if (remaining === 0) {
                    this._loading = false;
                }
            });
        });
    }

    private static hasEveryClip(): boolean {
        for (const clip of this._clips) {
            if (!clip) {
                return false;
            }
        }
        return true;
    }

    private static ensureSource(): AudioSource | null {
        if (this._node?.isValid && this._source?.isValid) {
            return this._source;
        }
        const scene = director.getScene();
        if (!scene) {
            return null;
        }
        const node = new Node(SFX_NODE_NAME);
        scene.addChild(node);
        game.addPersistRootNode(node);
        this._node = node;
        this._source = node.addComponent(AudioSource);
        return this._source;
    }
}
