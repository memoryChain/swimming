import { assetManager, Asset, AssetManager } from 'cc';

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
        bundle.load(path, type, done);
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
        bundle.loadDir(path, type, done);
    });
}
