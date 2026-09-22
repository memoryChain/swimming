import { PREPARE_PANORAMA_HEIGHT, PREPARE_PANORAMA_WIDTH } from '../core/ResourcePaths';

export const CHARACTER_PREVIEW_RIGHT_SHIFT = 30;
// 展台中心来自金色台面横向测量，各页使用同一站位。
const PREPARE_PLATFORM_X = 1049;
export type PrepareSceneLayout = { x: number; backgroundX: number; backgroundY: number; scale: number; hallX: number };

/** 大厅与联机固定使用 detail=0；角色页过渡使用 0～1，缩放全程保持一致。 */
export function computePrepareSceneLayout(out: PrepareSceneLayout, width: number, height: number, detail: number): void {
    out.hallX = -174 * Math.max(width / 1280, height / 720);
    const characterX = -45 + CHARACTER_PREVIEW_RIGHT_SHIFT;
    out.scale = Math.max(height / PREPARE_PANORAMA_HEIGHT,
        (width / 2 + Math.max(out.hallX, characterX)) / PREPARE_PLATFORM_X,
        (width / 2 - Math.min(out.hallX, characterX)) / (PREPARE_PANORAMA_WIDTH - PREPARE_PLATFORM_X));
    out.x = out.hallX + (characterX - out.hallX) * detail;
    out.backgroundX = out.x + (PREPARE_PANORAMA_WIDTH / 2 - PREPARE_PLATFORM_X) * out.scale;
    out.backgroundY = 240 * (out.scale * PREPARE_PANORAMA_HEIGHT / 720 - height / 720);
}
