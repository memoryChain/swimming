import { SpriteFrame, Texture2D } from 'cc';
import { AVATARS } from '../backend/IdentityConfig';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadRaceAsset } from '../core/RaceBundleLoader';

type FrameCallback = (frame: SpriteFrame | null) => void;

const FRAME_CACHE = new Map<string, SpriteFrame>();
const PENDING = new Map<string, FrameCallback[]>();

export function avatarTexturePath(avatarId: string): string {
    const index = AVATARS.findIndex((option) => option.id === avatarId);
    return RESOURCE_PATHS.avatarPickerUi.avatars[index >= 0 ? index : 0];
}

export function loadAvatarSpriteFrame(avatarId: string, done: FrameCallback): void {
    loadAvatarUiSpriteFrame(avatarTexturePath(avatarId), done);
}

export function loadAvatarUiSpriteFrame(path: string, done: FrameCallback): void {
    const cached = FRAME_CACHE.get(path);
    if (cached?.isValid) {
        done(cached);
        return;
    }

    const waiting = PENDING.get(path);
    if (waiting) {
        waiting.push(done);
        return;
    }

    PENDING.set(path, [done]);
    loadRaceAsset(path, Texture2D, (error, texture) => {
        let frame: SpriteFrame | null = null;
        if (!error && texture) {
            frame = new SpriteFrame();
            frame.texture = texture;
            FRAME_CACHE.set(path, frame);
        } else {
            console.warn(`[AvatarUI] 贴图加载失败：${path}`, error);
        }
        const callbacks = PENDING.get(path) ?? [];
        PENDING.delete(path);
        for (const callback of callbacks) callback(frame);
    });
}
