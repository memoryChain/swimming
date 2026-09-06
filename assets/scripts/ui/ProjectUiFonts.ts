import { CacheMode, Font, Label } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

export type ProjectUiFontWeight = 'regular' | 'semibold';

// 公共金币栏与联机英文数字共享现有系统英文字体声明；不是随包字体资源。
export const PROJECT_UI_ENGLISH_BOLD_FAMILY = 'Arial Black';

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
const REQUESTED_WEIGHTS = new WeakMap<Label, ProjectUiFontWeight>();

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
    // 共用 CHAR 图集只有 1024×1024，多字号/颜色会耗尽后漏字。
    // 界面文案按状态更新，使用独立文本纹理，避免跨页面累积字符缓存。
    label.cacheMode = CacheMode.NONE;
    REQUESTED_WEIGHTS.set(label, weight);

    const state = FONT_STATES[weight];
    if (state.asset) {
        applyFont(label, state.asset);
        return;
    }

    label.useSystemFont = true;
    label.fontFamily = 'sans-serif';
    label.isBold = false;
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
            if (label.isValid && REQUESTED_WEIGHTS.get(label) === weight) {
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

/** 昵称等无界文本必须保留系统全覆盖字体，不能切到静态子集。 */
export function styleDynamicUiLabel(label: Label, lineHeight: number): void {
    REQUESTED_WEIGHTS.delete(label);
    label.cacheMode = CacheMode.NONE;
    label.useSystemFont = true;
    label.fontFamily = 'sans-serif';
    label.isBold = false;
    label.lineHeight = lineHeight;
}
