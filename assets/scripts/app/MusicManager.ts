import { assetManager, AudioClip, AudioSource, director, Game, game, Node } from 'cc';
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
    private static _loadedTrack: MusicTrack | null = null;
    private static _requestId = 0;
    private static _volumeScale = 1;
    private static _background = false;
    private static _lifecycleBound = false;
    private static _ended = false;
    private static _lastPlaybackTime = -1;
    private static _stalledSeconds = 0;
    private static _startGraceSeconds = 0;

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
        if (source?.isValid && source.clip && this._loadedTrack) {
            source.volume = TRACKS[this._loadedTrack].volume * clamped;
        }
        if (clamped <= 0) {
            this.resetPlaybackWatch();
            source?.stop();
            return;
        }
        if (!wasMuted || !this._track) {
            return;
        }
        this.play(this._track);
    }

    private static play(track: MusicTrack) {
        if (this._volumeScale <= 0) {
            // Remember the requested track so raising the volume resumes it later.
            if (this._track !== track) {
                ++this._requestId;
            }
            this._track = track;
            return;
        }
        const source = this.ensureSource();
        if (!source) {
            return;
        }
        if (this._loadedTrack === track && source.clip) {
            // The persistent source is already playing this track. Calling
            // play() again restarts it, which previously happened on every
            // login-screen tap because the whole canvas used an unlock handler.
            this._track = track;
            this.resumeCurrentTrack();
            return;
        }

        this._track = track;
        const requestId = ++this._requestId;
        this.resetPlaybackWatch();
        const config = TRACKS[track];
        source.stop();
        source.clip = null;
        this._loadedTrack = null;
        source.loop = config.loop;
        source.volume = config.volume * this._volumeScale;

        const loadClip = () => {
            const bundle = assetManager.getBundle(RESOURCE_PATHS.music.bundle);
            if (!bundle) {
                return;
            }
            bundle.load(config.path, AudioClip, (error, clip) => {
                if (requestId !== this._requestId || this._track !== track || !source.isValid) {
                    return;
                }
                if (error || !clip) {
                    console.warn(`[SpeedSwimming] music failed to load: ${config.path}`, error);
                    return;
                }
                source.clip = clip;
                this._loadedTrack = track;
                source.loop = config.loop;
                source.volume = config.volume * this._volumeScale;
                this.resumeCurrentTrack();
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

    private static resetPlaybackWatch() {
        this._ended = false;
        this._lastPlaybackTime = -1;
        this._stalledSeconds = 0;
        this._startGraceSeconds = 0;
    }

    // 原生循环仍是主路径。每半秒检查实际进度，覆盖漏发 ENDED、停止后仍报告
    // playing、以及 ENDED 先于状态更新的后端；正常循环和重复界面请求不重播。
    private static checkPlayback(dt: number) {
        const source = this._source;
        if (this._background || this._volumeScale <= 0 || !source?.isValid
            || !source.clip || !this._track || this._loadedTrack !== this._track) {
            this.resetPlaybackWatch();
            return;
        }
        this._startGraceSeconds = Math.max(0, this._startGraceSeconds - dt);
        const time = source.currentTime;
        if (Number.isFinite(time) && (this._lastPlaybackTime < 0 || Math.abs(time - this._lastPlaybackTime) > 0.01)) {
            this._lastPlaybackTime = time;
            this._stalledSeconds = 0;
        } else {
            this._stalledSeconds += dt;
        }
        // 刚加载时 AudioSource.play 会等待异步解码，不能不断堆积 play 请求。
        if (!this._ended && (this._startGraceSeconds > 0
            || (source.playing && this._stalledSeconds < 2))) return;
        // 音频焦点中断交给引擎恢复，避免和电话等系统声音争抢。
        if (source.state === AudioSource.AudioState.INTERRUPTED) return;
        this.resetPlaybackWatch();
        // playing 为 true 时 AudioSource.play 自己会排队 stop→play；这里不能
        // 再 stop 一次，否则小游戏后端可能等待一个不会再触发的 onStop。
        source.loop = TRACKS[this._track].loop;
        source.volume = TRACKS[this._track].volume * this._volumeScale;
        this._startGraceSeconds = 10;
        source.play();
    }

    private static resumeCurrentTrack() {
        const source = this._source;
        const track = this._track;
        if (this._background || this._volumeScale <= 0 || !track
            || this._loadedTrack !== track || !source?.isValid || !source.clip || source.playing
            || this._startGraceSeconds > 0) {
            return;
        }
        source.loop = TRACKS[track].loop;
        source.volume = TRACKS[track].volume * this._volumeScale;
        this.resetPlaybackWatch();
        this._startGraceSeconds = 10;
        source.play();
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
        this._source.playOnAwake = false;
        this._loadedTrack = null;
        const source = this._source;
        // 延至当前事件栈结束后再恢复：Web Audio 在发出 ENDED 后才写入停止状态。
        const resumeAfterEnded = () => {
            if (this._source === source && this._ended) this.checkPlayback(0);
        };
        node.on(AudioSource.EventType.ENDED, () => {
            if (this._source !== source) return;
            this._ended = true;
            source.scheduleOnce(resumeAfterEnded, 0);
        });
        node.on(AudioSource.EventType.STARTED, () => {
            if (this._source === source) {
                this._startGraceSeconds = 0;
                this._lastPlaybackTime = -1;
                this._stalledSeconds = 0;
            }
        });
        source.schedule((dt: number) => {
            if (this._source === source) this.checkPlayback(dt);
        }, 0.5);
        if (!this._lifecycleBound) {
            this._lifecycleBound = true;
            game.on(Game.EVENT_HIDE, () => {
                this._background = true;
                this.resetPlaybackWatch();
            });
            game.on(Game.EVENT_SHOW, () => {
                this._background = false;
                this.resumeCurrentTrack();
            });
        }
        return this._source;
    }
}
