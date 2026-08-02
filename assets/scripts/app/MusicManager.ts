import { assetManager, AudioClip, AudioSource, director, game, Node } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

export type MusicTrack = 'login' | 'race' | 'result';

type MusicTrackConfig = {
    path: string;
    loop: boolean;
    volume: number;
};

const MUSIC_NODE_NAME = 'SpeedSwimmingMusic';
const TRACKS: Record<MusicTrack, MusicTrackConfig> = {
    login: { path: RESOURCE_PATHS.music.login, loop: true, volume: 0.44 },
    race: { path: RESOURCE_PATHS.music.race, loop: true, volume: 0.60 },
    result: { path: RESOURCE_PATHS.music.result, loop: true, volume: 0.66 },
};

// One persistent AudioSource follows the player across Login and MainGame.
// The separate music Asset Bundle is a WeChat subpackage, keeping every MP3
// out of the initial package. Clips are still decoded one at a time.
export class MusicManager {
    private static _node: Node | null = null;
    private static _source: AudioSource | null = null;
    private static _track: MusicTrack | null = null;
    private static _requestId = 0;
    private static _volumeScale = 1;

    static playLogin() {
        this.play('login');
    }

    static playRace() {
        this.play('race');
    }

    static playResult() {
        this.play('result');
    }

    // User volume scale (0..1) applied on top of each track's base volume. At
    // zero the source stops outright; raising from zero resumes the track.
    static setVolume(scale: number) {
        const clamped = Math.max(0, Math.min(1, scale));
        const wasMuted = this._volumeScale <= 0;
        this._volumeScale = clamped;
        const source = this._source;
        if (source?.isValid && source.clip && this._track) {
            source.volume = TRACKS[this._track].volume * clamped;
        }
        if (clamped <= 0) {
            source?.stop();
            return;
        }
        if (!wasMuted || !this._track) {
            return;
        }
        const resumed = this.ensureSource();
        if (resumed && resumed.clip) {
            resumed.volume = TRACKS[this._track].volume * clamped;
            resumed.play();
            return;
        }
        const track = this._track;
        this._track = null;
        this.play(track);
    }

    private static play(track: MusicTrack) {
        if (this._volumeScale <= 0) {
            // Remember the requested track so raising the volume resumes it later.
            this._track = track;
            return;
        }
        const source = this.ensureSource();
        if (!source) {
            return;
        }
        if (this._track === track && source.clip) {
            // The persistent source is already playing this track. Calling
            // play() again restarts it, which previously happened on every
            // login-screen tap because the whole canvas used an unlock handler.
            return;
        }

        this._track = track;
        const requestId = ++this._requestId;
        const config = TRACKS[track];
        source.stop();
        source.clip = null;
        source.loop = config.loop;
        source.volume = config.volume * this._volumeScale;

        const loadClip = () => {
            const bundle = assetManager.getBundle(RESOURCE_PATHS.music.bundle);
            if (!bundle) {
                return;
            }
            bundle.load(config.path, AudioClip, (error, clip) => {
                if (requestId !== this._requestId || this._track !== track) {
                    return;
                }
                if (error || !clip) {
                    console.warn(`[SpeedSwimming] music failed to load: ${config.path}`, error);
                    return;
                }
                source.clip = clip;
                source.loop = config.loop;
                source.volume = config.volume * this._volumeScale;
                source.play();
            });
        };

        const loadedBundle = assetManager.getBundle(RESOURCE_PATHS.music.bundle);
        if (loadedBundle) {
            loadClip();
            return;
        }
        assetManager.loadBundle(RESOURCE_PATHS.music.bundle, (bundleError, bundle) => {
            if (requestId !== this._requestId || this._track !== track) {
                return;
            }
            if (bundleError || !bundle) {
                console.warn('[SpeedSwimming] music subpackage failed to load', bundleError);
                return;
            }
            loadClip();
        });
    }

    private static ensureSource(): AudioSource | null {
        if (this._node?.isValid && this._source?.isValid) {
            return this._source;
        }
        const scene = director.getScene();
        if (!scene) {
            return null;
        }
        const node = new Node(MUSIC_NODE_NAME);
        scene.addChild(node);
        game.addPersistRootNode(node);
        this._node = node;
        this._source = node.addComponent(AudioSource);
        return this._source;
    }
}
