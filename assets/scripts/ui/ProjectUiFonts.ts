import { CacheMode, Font, Label } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

export type ProjectUiFontWeight = 'regular' | 'semibold';

type FontState = {
    asset: Font | null;
    loading: boolean;
    failed: boolean;
    waiting: Set<Label>;
};

const FONT_STATES: Record<ProjectUiFontWeight, FontState> = {
    regular: { asset: null, loading: false, failed: false, waiting: new Set<Label>() },
    semibold: { asset: null, loading: false, failed: false, waiting: new Set<Label>() },
};

/**
 * Applies the checked-in project font when available. The temporary system
 * fallback only covers the asynchronous load window and is never the intended
 * final presentation.
 */
export function styleProjectUiLabel(
    label: Label,
    weight: ProjectUiFontWeight,
    lineHeight: number,
): void {
    label.lineHeight = lineHeight;
    label.cacheMode = CacheMode.CHAR;

    const state = FONT_STATES[weight];
    if (state.asset) {
        applyFont(label, state.asset);
        return;
    }

    label.fontFamily = 'Arial';
    label.isBold = weight === 'semibold';
    if (state.failed) {
        return;
    }
    state.waiting.add(label);
    if (!state.loading) {
        loadFont(weight, state);
    }
}

function loadFont(weight: ProjectUiFontWeight, state: FontState): void {
    state.loading = true;
    loadRaceAsset(RESOURCE_PATHS.uiFonts[weight], Font, (error, asset) => {
        state.loading = false;
        if (error || !asset) {
            state.failed = true;
            state.waiting.clear();
            console.warn(`[SpeedSwimming] 项目 UI 字体加载失败：${weight}`, error);
            return;
        }
        state.asset = asset;
        for (const label of state.waiting) {
            if (label.isValid) {
                applyFont(label, asset);
            }
        }
        state.waiting.clear();
    });
}

function applyFont(label: Label, font: Font): void {
    if (label.font !== font) {
        label.font = font;
    }
    if (label.isBold) {
        label.isBold = false;
    }
}
