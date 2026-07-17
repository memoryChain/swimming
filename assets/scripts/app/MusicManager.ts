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

    static playLogin() {
        this.play('login');
    }

    static playRace() {
        this.play('race');
    }

    static playResult() {
        this.play('result');
    }

    // Mobile browsers and WeChat can suspend audio until the first gesture.
    // Calling play again from that gesture resumes the already loaded clip.
    static unlock() {
        this.ensureSource();
        if (this._source?.clip) {
            this._source.play();
        }
    }

    private static play(track: MusicTrack) {
        const source = this.ensureSource();
        if (!source) {
            return;
        }
        if (this._track === track && source.clip) {
            source.play();
            return;
        }

        this._track = track;
        const requestId = ++this._requestId;
        const config = TRACKS[track];
        source.stop();
        source.clip = null;
        source.loop = config.loop;
        source.volume = config.volume;

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
                source.volume = config.volume;
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
