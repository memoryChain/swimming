import { assetManager, Asset, AssetManager, JsonAsset } from 'cc';
import { decodeSampledMotion } from '../character/SampledMotionStorage';

export const RACE_BUNDLE_NAME = 'race';

type AssetConstructor<T extends Asset> = new (...args: any[]) => T;
type BundleLoadCallback = (error: Error | null, bundle?: AssetManager.Bundle) => void;

export function loadRaceBundle(done: BundleLoadCallback) {
    const loaded = assetManager.getBundle(RACE_BUNDLE_NAME);
    if (loaded) {
        done(null, loaded);
        return;
    }

    // Cocos handles WeChat native subpackages here when the bundle compression
    // type is `subpackage`; calling wx.loadSubpackage manually bypasses its
    // bundle registry and can use a root that disagrees with game.json.
    assetManager.loadBundle(RACE_BUNDLE_NAME, (error, bundle) => {
        if (error || !bundle) {
            done(error ?? new Error(`Failed to load Asset Bundle: ${RACE_BUNDLE_NAME}`));
            return;
        }
        done(null, bundle);
    });
}

export function loadRaceAsset<T extends Asset>(
    path: string,
    type: AssetConstructor<T>,
    done: (error: Error | null, asset?: T) => void,
) {
    loadRaceBundle((bundleError, bundle) => {
        if (bundleError || !bundle) {
            done(bundleError ?? new Error(`Race Asset Bundle is unavailable: ${path}`));
            return;
        }
        bundle.load(path, type, (error, asset) => {
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
        });
    });
}

export function loadRaceAssetDir<T extends Asset>(
    path: string,
    type: AssetConstructor<T>,
    done: (error: Error | null, assets?: T[]) => void,
) {
    loadRaceBundle((bundleError, bundle) => {
        if (bundleError || !bundle) {
            done(bundleError ?? new Error(`Race Asset Bundle is unavailable: ${path}`));
            return;
        }
        bundle.loadDir(path, type, (error, assets) => {
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
        });
    });
}
