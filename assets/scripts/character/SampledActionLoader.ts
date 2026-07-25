import { JsonAsset } from 'cc';
import { loadRaceAsset, loadRaceAssetDir } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import {
    haveAllSampledDebugActions,
    findSampledDebugAction,
    registerSampledDebugAction,
    SAMPLED_ACTION_IDS,
} from './SampledActionMotionCurve';
import type { SampledActionId, SampledActionMotion } from './SampledActionMotionCurve';
import { haveBreaststrokeSamples, registerBreaststrokeSamples } from './BreaststrokeMotionCurve';
import type { BreaststrokeMotionSample } from './BreaststrokeMotionCurve';

type LoadCallback = (error: Error | null) => void;
type ActionLoadCallback = (error: Error | null) => void;

let loading = false;
const pendingCallbacks: LoadCallback[] = [];
const pendingActionCallbacks = new Map<SampledActionId, ActionLoadCallback[]>();

// The character-select screen needs one presentation action, while the race
// itself needs the complete set. Keep this targeted path so opening the
// preparation screen does not eagerly deserialize every emote curve.
export function loadSampledAction(actionId: SampledActionId, done: ActionLoadCallback) {
    if (findSampledDebugAction(actionId)) {
        done(null);
        return;
    }
    const pending = pendingActionCallbacks.get(actionId);
    if (pending) {
        pending.push(done);
        return;
    }
    pendingActionCallbacks.set(actionId, [done]);
    loadRaceAsset(`${RESOURCE_PATHS.sampledActionsDir}/${actionId}`, JsonAsset, (error, asset) => {
        let resultError = error ?? null;
        if (!resultError && asset) {
            try {
                const action = parseSampledAction(asset.json);
                if (action.id !== actionId) {
                    throw new Error(`Sampled action id mismatch: expected ${actionId}, got ${action.id}`);
                }
                registerSampledDebugAction(action);
            } catch (parseError) {
                resultError = parseError instanceof Error ? parseError : new Error(String(parseError));
            }
        } else if (!resultError) {
            resultError = new Error(`Sampled action is unavailable: ${actionId}`);
        }
        const callbacks = pendingActionCallbacks.get(actionId) ?? [];
        pendingActionCallbacks.delete(actionId);
        for (const callback of callbacks) {
            callback(resultError);
        }
    });
}

export function loadSampledActionsForRace(done: LoadCallback) {
    if (haveAllSampledDebugActions() && haveBreaststrokeSamples()) {
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
                    if (isBreaststrokeMotionJson(asset.json)) {
                        registerBreaststrokeSamples(parseBreaststrokeMotion(asset.json));
                        continue;
                    }
                    const action = parseSampledAction(asset.json);
                    registerSampledDebugAction(action);
                }
                const missing = SAMPLED_ACTION_IDS.filter((id) => !findLoadedAction(id));
                if (missing.length > 0) {
                    throw new Error(`Missing sampled race actions: ${missing.join(', ')}`);
                }
                if (!haveBreaststrokeSamples()) {
                    throw new Error('Missing breaststroke swim motion in race bundle');
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

// The breaststroke tread-water curve shares the sampled-actions folder but uses a
// different per-sample schema (root/head/hand/foot vectors) from the emote actions
// (hipTranslation). Detect it by shape so the directory scan can route it here.
function isBreaststrokeMotionJson(value: unknown): boolean {
    const data = value as { samples?: unknown } | null;
    if (!data || typeof data !== 'object' || !Array.isArray(data.samples) || data.samples.length === 0) {
        return false;
    }
    const first = data.samples[0] as Record<string, unknown> | null;
    return !!first && 'foot' in first && 'hand' in first;
}

function parseBreaststrokeMotion(value: unknown): BreaststrokeMotionSample[] {
    const data = value as { samples?: unknown } | null;
    if (!data || typeof data !== 'object' || !Array.isArray(data.samples) || data.samples.length === 0) {
        throw new Error('Invalid breaststroke motion JSON in race bundle');
    }
    return data.samples as BreaststrokeMotionSample[];
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
