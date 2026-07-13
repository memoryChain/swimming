import { JsonAsset } from 'cc';
import { loadRaceAssetDir } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import {
    haveAllSampledDebugActions,
    findSampledDebugAction,
    registerSampledDebugAction,
    SAMPLED_ACTION_IDS,
} from './SampledActionMotionCurve';
import type { SampledActionId, SampledActionMotion } from './SampledActionMotionCurve';

type LoadCallback = (error: Error | null) => void;

let loading = false;
const pendingCallbacks: LoadCallback[] = [];

export function loadSampledActionsForRace(done: LoadCallback) {
    if (haveAllSampledDebugActions()) {
        done(null);
        return;
    }
    pendingCallbacks.push(done);
    if (loading) {
        return;
    }
    loading = true;

    loadRaceAssetDir(RESOURCE_PATHS.sampledActionsDir, JsonAsset, (error, assets) => {
        let resultError = error;
        if (!resultError) {
            try {
                for (const asset of assets ?? []) {
                    const action = parseSampledAction(asset.json);
                    registerSampledDebugAction(action);
                }
                const missing = SAMPLED_ACTION_IDS.filter((id) => !findLoadedAction(id));
                if (missing.length > 0) {
                    throw new Error(`Missing sampled race actions: ${missing.join(', ')}`);
                }
            } catch (parseError) {
                resultError = parseError instanceof Error ? parseError : new Error(String(parseError));
            }
        }

        loading = false;
        const callbacks = pendingCallbacks.splice(0, pendingCallbacks.length);
        for (const callback of callbacks) {
            callback(resultError ?? null);
        }
    });
}

function findLoadedAction(id: SampledActionId): boolean {
    return Boolean(findSampledDebugAction(id));
}

function parseSampledAction(value: unknown): SampledActionMotion {
    const action = value as Partial<SampledActionMotion> | null;
    if (!action || typeof action !== 'object'
        || SAMPLED_ACTION_IDS.indexOf(action.id as SampledActionId) < 0
        || !Array.isArray(action.samples)
        || action.samples.length === 0) {
        throw new Error('Invalid sampled action JSON in race bundle');
    }
    return action as SampledActionMotion;
}
