import { uiColor } from './RuntimeUiFactory';

// Shared UI palette for all non-race screens (start menu, prepare-race, headbar).
// Keep every runtime-built UI on these tokens so screens stay visually unified.
export const UI_STYLE = {
    // Deep navy panel fills.
    panel: uiColor(10, 37, 64, 230),
    panelAlt: uiColor(18, 60, 104, 238),
    // Primary action cyan and secondary outline cyan.
    cyan: uiColor(20, 205, 229, 255),
    cyanOutline: uiColor(86, 196, 236, 200),
    // Warm orange accent (difficulty labels, decorative slashes).
    accent: uiColor(255, 168, 60, 255),
    // Disabled / locked elements.
    muted: uiColor(99, 123, 150, 225),
    // Text colors.
    white: uiColor(242, 250, 255, 255),
    faint: uiColor(180, 200, 220, 255),
    // Stat bar fills.
    barTrack: uiColor(24, 55, 90, 255),
};
