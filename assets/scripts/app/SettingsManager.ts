import { sys } from 'cc';
import { MusicManager } from './MusicManager';
import { StrokeSfxManager } from './StrokeSfxManager';

const SETTINGS_STORAGE_KEY = 'SpeedSwimming.Settings.v1';
const DEFAULT_VOLUME = 0.8;

type SettingsData = {
    musicVolume: number;
    sfxVolume: number;
};

// Central audio settings: music / SFX volume (0..1, zero is effectively off),
// persisted locally and applied to MusicManager / StrokeSfxManager.
export class SettingsManager {
    private static _data: SettingsData | null = null;

    static get musicVolume(): number {
        return this.load().musicVolume;
    }

    static get sfxVolume(): number {
        return this.load().sfxVolume;
    }

    static setMusicVolume(volume: number) {
        const data = this.load();
        data.musicVolume = clamp01(volume);
        this.save(data);
        MusicManager.setVolume(data.musicVolume);
    }

    static setSfxVolume(volume: number) {
        const data = this.load();
        data.sfxVolume = clamp01(volume);
        this.save(data);
        StrokeSfxManager.setVolume(data.sfxVolume);
    }

    // Apply persisted settings to the audio managers. Call once at startup before
    // the first music request so a zeroed track is remembered but not played.
    static apply() {
        const data = this.load();
        MusicManager.setVolume(data.musicVolume);
        StrokeSfxManager.setVolume(data.sfxVolume);
    }

    private static load(): SettingsData {
        if (this._data) {
            return this._data;
        }
        let data: SettingsData = { musicVolume: DEFAULT_VOLUME, sfxVolume: DEFAULT_VOLUME };
        try {
            const raw = sys.localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (raw) {
                // Migrates the earlier boolean-toggle save: off becomes 0, on
                // becomes the default volume.
                const parsed = JSON.parse(raw) as Partial<SettingsData> & { musicOn?: boolean; sfxOn?: boolean };
                data = {
                    musicVolume: typeof parsed.musicVolume === 'number'
                        ? clamp01(parsed.musicVolume)
                        : parsed.musicOn === false ? 0 : DEFAULT_VOLUME,
                    sfxVolume: typeof parsed.sfxVolume === 'number'
                        ? clamp01(parsed.sfxVolume)
                        : parsed.sfxOn === false ? 0 : DEFAULT_VOLUME,
                };
            }
        } catch {
            // Corrupt or unavailable storage: fall back to defaults.
        }
        this._data = data;
        return data;
    }

    private static save(data: SettingsData) {
        this._data = data;
        try {
            sys.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
        } catch {
            // Storage may be unavailable in some preview environments.
        }
    }
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}