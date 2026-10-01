import { SpriteAtlas, SpriteFrame, Texture2D } from 'cc';
import { EDITOR, PREVIEW } from 'cc/env';
import { AVATARS } from '../backend/IdentityConfig';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { trackRaceAsset } from '../core/RaceLoading';
import { trackUiCallback } from './UiAssetBarrier';

type FrameCallback = (frame: SpriteFrame | null) => void;

const FRAME_CACHE = new Map<string, SpriteFrame>();
const PENDING = new Map<string, FrameCallback[]>();
const ATLASES = new Map<string, SpriteAtlas>();
const ATLAS_PENDING = new Map<string, ((atlas: SpriteAtlas | null) => void)[]>();

/** 页面首次打开时集中准备实际使用的美术，热缓存同步完成。 */
export function preloadUiArt(sources: readonly unknown[], done: (error: Error | null) => void): void {
    const paths = new Set<string>();
    const collect = (value: unknown) => {
        if (typeof value === 'string') { if (value.startsWith('ui/')) paths.add(value); }
        else if (value && typeof value === 'object') for (const key of Object.keys(value)) collect((value as Record<string, unknown>)[key]);
    };
    for (const source of sources) collect(source);
    let pending = paths.size;
    let failure: Error | null = null;
    if (!pending) { done(null); return; }
    for (const path of paths) loadAvatarUiSpriteFrame(path, frame => {
        if (!frame) failure ??= new Error(`界面素材缺失：${path}`);
        if (--pending === 0) done(failure);
    });
}

function loadUiAtlas(path: string, done: (atlas: SpriteAtlas | null) => void): void {
    const cached = ATLASES.get(path);
    if (cached?.isValid) { done(cached); return; }
    const waiting = ATLAS_PENDING.get(path);
    if (waiting) { waiting.push(done); return; }
    ATLAS_PENDING.set(path, [done]);
    loadRaceAsset(path, SpriteAtlas, (error, atlas) => {
        if (!error && atlas) { atlas.addRef(); ATLASES.set(path, atlas); }
        const callbacks = ATLAS_PENDING.get(path)!;
        ATLAS_PENDING.delete(path);
        for (const callback of callbacks) callback(error ? null : atlas ?? null);
    });
}

export function avatarTexturePath(avatarId: string): string {
    const index = AVATARS.findIndex((option) => option.id === avatarId);
    return RESOURCE_PATHS.avatarPickerUi.avatars[index >= 0 ? index : 0];
}

export function loadAvatarSpriteFrame(avatarId: string, done: FrameCallback): void {
    loadAvatarUiSpriteFrame(avatarTexturePath(avatarId), done);
}

export function loadAvatarUiSpriteFrame(path: string, done: FrameCallback): void {
    // 共用请求可能在大厅已发出；比赛阶段的新订阅也必须被等待。
    done = trackRaceAsset(done);
    done = trackUiCallback(done, frame => frame ? null : new Error(`头像资源缺失：${path}`));
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
    const finish = (frame: SpriteFrame | null) => {
        if (frame) {
            FRAME_CACHE.set(path, frame);
        } else {
            console.warn(`[AvatarUI] 界面图片加载失败：${path}`);
        }
        const callbacks = PENDING.get(path) ?? [];
        PENDING.delete(path);
        for (const callback of callbacks) callback(frame);
    };
    if (path.endsWith('/spriteFrame')) {
        const imagePath = path.slice(3, -'/spriteFrame'.length);
        const split = imagePath.lastIndexOf('/');
        const atlasPath = RESOURCE_PATHS.uiAtlases[imagePath.slice(0, split)];
        if (!atlasPath) { finish(null); return; }
        loadUiAtlas(atlasPath, atlas => {
            const frame = atlas?.getSpriteFrame(imagePath.slice(split + 1));
            if (frame) { frame.packable = false; finish(frame); return; }
            // 自动图集只在构建时合并；编辑器预览读取原 SpriteFrame。
            if (atlas && (EDITOR || PREVIEW)) {
                loadRaceAsset(path, SpriteFrame, (error, original) => {
                    // 预览没有构建图集，原帧仍需参与引擎动态合批。
                    if (original) original.packable = true;
                    finish(error ? null : original ?? null);
                });
            } else finish(null);
        });
    } else {
        loadRaceAsset(path, Texture2D, (error, texture) => {
            if (error || !texture) { finish(null); return; }
            const frame = new SpriteFrame(); frame.texture = texture;
            texture.addRef();
            finish(frame);
        });
    }
}
