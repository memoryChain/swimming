import { assetManager, AssetManager, AudioClip, AudioSource, director, game, Node } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

const SFX_NODE_NAME = 'SpeedSwimmingStrokeSfx';
const STROKE_VOLUME = 0.28;
const STROKE_VOICE_COUNT = 2;
const MIN_STROKE_SFX_INTERVAL_SECONDS = 0.08;

// Reuse a small fixed voice pool. The stroke clip is longer than a normal stroke
// cadence, and unbounded playOneShot overlap can periodically stall WeChat's
// audio backend while it allocates or reclaims temporary voices.
export class StrokeSfxManager {
    private static _node: Node | null = null;
    private static _sources: AudioSource[] = [];
    private static readonly _clips: Array<AudioClip | null> = RESOURCE_PATHS.music.strokeSfx.map(() => null);
    private static _loading = false;
    private static _nextClip = 0;
    private static _nextVoice = 0;
    private static _lastPlaySeconds = -Infinity;

    static preload() {
        this.ensureSources();
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

    static playStroke() {
        const sources = this.ensureSources();
        const nowSeconds = performance.now() * 0.001;
        if (sources.length === 0 || nowSeconds - this._lastPlaySeconds < MIN_STROKE_SFX_INTERVAL_SECONDS) {
            return;
        }
        for (let offset = 0; offset < this._clips.length; offset++) {
            const index = (this._nextClip + offset) % this._clips.length;
            const clip = this._clips[index];
            if (!clip) {
                continue;
            }
            this._nextClip = (index + 1) % this._clips.length;
            const source = sources[this._nextVoice];
            this._nextVoice = (this._nextVoice + 1) % sources.length;
            source.stop();
            source.clip = clip;
            source.volume = STROKE_VOLUME;
            source.play();
            this._lastPlaySeconds = nowSeconds;
            return;
        }
        this.preload();
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

    private static ensureSources(): AudioSource[] {
        if (this._node?.isValid && this._sources.length === STROKE_VOICE_COUNT
            && this._sources.every((source) => source?.isValid)) {
            return this._sources;
        }
        const scene = director.getScene();
        if (!scene) {
            return [];
        }
        const node = new Node(SFX_NODE_NAME);
        scene.addChild(node);
        game.addPersistRootNode(node);
        this._node = node;
        this._sources = [];
        for (let index = 0; index < STROKE_VOICE_COUNT; index++) {
            const voiceNode = new Node(`${SFX_NODE_NAME}_${index + 1}`);
            voiceNode.setParent(node);
            this._sources.push(voiceNode.addComponent(AudioSource));
        }
        return this._sources;
    }
}
