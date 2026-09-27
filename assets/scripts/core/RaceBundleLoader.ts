import { assetManager, Asset, AssetManager, ImageAsset, JsonAsset, Prefab } from 'cc';
import { decodeSampledMotion } from '../character/SampledMotionStorage';
import { RESOURCE_PATHS } from './ResourcePaths';
import { trackRaceAsset } from './RaceLoading';
import { trackUiCallback } from '../ui/UiAssetBarrier';

export const RACE_BUNDLE_NAME = 'race';

type AssetConstructor<T extends Asset> = new (...args: any[]) => T;
type BundleLoadCallback = (error: Error | null, bundle?: AssetManager.Bundle) => void;

export function loadRaceBundle(done: BundleLoadCallback) {
    loadAssetBundle(RACE_BUNDLE_NAME, done);
}

function loadAssetBundle(name: string, done: BundleLoadCallback) {
    const loaded = assetManager.getBundle(name);
    if (loaded) {
        done(null, loaded);
        return;
    }

    // Cocos handles WeChat native subpackages here when the bundle compression
    // type is `subpackage`; calling wx.loadSubpackage manually bypasses its
    // bundle registry and can use a root that disagrees with game.json.
    assetManager.loadBundle(name, (error, bundle) => {
        if (error || !bundle) {
            done(error ?? new Error(`Failed to load Asset Bundle: ${name}`));
            return;
        }
        done(null, bundle);
    });
}

// 保持界面调用处的逻辑路径；嵌套 UI Bundle 内部路径不带 ui/ 前缀。
function assetLocation(path: string): { bundle: string; path: string } {
    const ui = RESOURCE_PATHS.uiBundle;
    if (path === ui.root || path.startsWith(`${ui.root}/`)) {
        return { bundle: ui.name, path: path.slice(ui.root.length + 1) };
    }
    return { bundle: RACE_BUNDLE_NAME, path };
}

export function loadRaceAsset<T extends Asset>(
    path: string,
    type: AssetConstructor<T>,
    done: (error: Error | null, asset?: T) => void,
) {
    done = trackRaceAsset(done);
    // 模型候选路径允许失败后尝试下一条，最终错误由角色就绪状态报告。
    done = trackUiCallback(done, (type as AssetConstructor<Asset>) === Prefab ? undefined : (error, asset) => error ?? (!asset ? new Error(`界面资源缺失：${path}`) : null));
    const location = assetLocation(path);
    loadAssetBundle(location.bundle, (bundleError, bundle) => {
        if (bundleError || !bundle) {
            done(bundleError ?? new Error(`Race Asset Bundle is unavailable: ${path}`));
            return;
        }
        const complete = (error: Error | null, asset?: T) => {
            if (!error && asset instanceof JsonAsset) {
                try {
                    // 写回 Cocos 缓存，同一曲线供预览、选手骨架和比赛共用，只还原一次。
                    asset.json = decodeSampledMotion(asset.json) as Record<string, any>;
                } catch (decodeError) {
                    done(decodeError instanceof Error ? decodeError : new Error(String(decodeError)));
                    return;
                }
            }
            done(error, asset);
        };
        // 已使用过的资源同步交付，首次访问才请求对应 Bundle 中的文件。
        const info = bundle.getInfoWithPath?.(location.path, type);
        const cached = info && assetManager.assets?.get(info.uuid);
        if (cached?.isValid && cached instanceof type) complete(null, cached as T);
        else bundle.load(location.path, type, complete);
    });
}

export function loadRaceAssetDir<T extends Asset>(
    path: string,
    type: AssetConstructor<T>,
    done: (error: Error | null, assets?: T[]) => void,
) {
    done = trackRaceAsset(done);
    const location = assetLocation(path);
    loadAssetBundle(location.bundle, (bundleError, bundle) => {
        if (bundleError || !bundle) {
            done(bundleError ?? new Error(`Race Asset Bundle is unavailable: ${path}`));
            return;
        }
        const complete = (error: Error | null, assets?: T[]) => {
            if (!error) {
                try {
                    for (const asset of assets ?? []) {
                        if (asset instanceof JsonAsset) {
                            asset.json = decodeSampledMotion(asset.json) as Record<string, any>;
                        }
                    }
                } catch (decodeError) {
                    done(decodeError instanceof Error ? decodeError : new Error(String(decodeError)));
                    return;
                }
            }
            done(error, assets);
        };
        const infos = bundle.getDirWithPath?.(location.path, type);
        const cached = infos?.map(info => assetManager.assets.get(info.uuid));
        if (cached?.length && cached.every(asset => asset?.isValid && asset instanceof type)) complete(null, cached as T[]);
        else bundle.loadDir(location.path, type, complete);
    });
}

// 场馆已随微信分包下载，首次进场集中解析并保留，随后建场景复用缓存。
const retainedVenueAssets = new Map<string, Asset>();
export function prepareVenueResources(progress: (fraction: number) => void, done: (error: Error | null) => void): void {
    loadRaceBundle((error, bundle) => {
        if (error || !bundle) { done(error ?? new Error('场馆资源不可用')); return; }
        const uuids = new Set<string>();
        for (const dir of RESOURCE_PATHS.venuePreloadDirs) {
            for (const info of bundle.getDirWithPath(dir, Asset)) {
                // 原始图片由纹理依赖加载；CLEANUP_IMAGE_CACHE 会在上传 GPU 后释放它。
                // 只保留并检查实际使用的纹理、模型等资产，不能要求图片仍留在缓存中。
                if (info.ctor !== ImageAsset) uuids.add(info.uuid);
            }
        }
        if (!uuids.size) { done(new Error('场馆资源缺失')); return; }
        const missing: { uuid: string; bundle: string }[] = [];
        const keep = (uuid: string, asset: Asset) => {
            if (retainedVenueAssets.get(uuid) !== asset) { asset.addRef(); retainedVenueAssets.set(uuid, asset); }
        };
        for (const uuid of uuids) {
            const cached = assetManager.assets.get(uuid);
            if (cached?.isValid) keep(uuid, cached);
            else missing.push({ uuid, bundle: bundle.name });
        }
        if (!missing.length) { progress(1); done(null); return; }
        assetManager.loadAny(missing, { maxConcurrency: 6, maxRequestsPerFrame: 6 },
            (finished, total) => progress(total ? finished / total : 0),
            (loadError: Error | null) => {
                if (loadError) { done(loadError); return; }
                for (const uuid of uuids) {
                    const asset = assetManager.assets.get(uuid);
                    if (!asset?.isValid) { done(new Error(`场馆资源缺失：${uuid}`)); return; }
                    keep(uuid, asset);
                }
                progress(1); done(null);
            });
    });
}
