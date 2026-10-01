import { Sprite, UITransform, Vec2 } from 'cc';

export type UiLinearFillGeometry = { lower: number; span: number };
const FULL_FRAME: UiLinearFillGeometry = { lower: 0, span: 1 };

/** FILLED 不补偿 trim；按原画布还原子图几何，保持与 SIMPLE 底图同一坐标。只在创建时调用。 */
export function configureUiFillGeometry(sprite: Sprite, fillType: Sprite['fillType']): UiLinearFillGeometry {
    sprite.type = Sprite.Type.FILLED;
    sprite.fillType = fillType;
    const frame = sprite.spriteFrame!;
    const rect = frame.rect, original = frame.originalSize, offset = frame.offset;
    const transform = sprite.node.getComponent(UITransform)!;
    const width = transform.contentSize.width, height = transform.contentSize.height;
    const sx = width / original.width, sy = height / original.height;
    const croppedWidth = rect.width * sx, croppedHeight = rect.height * sy;
    const dx = (offset.x + (0.5 - transform.anchorX) * (original.width - rect.width)) * sx;
    const dy = (offset.y + (0.5 - transform.anchorY) * (original.height - rect.height)) * sy;
    const position = sprite.node.position, scale = sprite.node.scale;
    if (dx || dy) sprite.node.setPosition(position.x + dx * scale.x, position.y + dy * scale.y, position.z);
    if (width !== croppedWidth || height !== croppedHeight) transform.setContentSize(croppedWidth, croppedHeight);
    if (fillType === Sprite.FillType.RADIAL) {
        // 圆心来自未裁切画布；裁后矩形的中点不一定是美术圆心。
        sprite.fillCenter = new Vec2(0.5 - offset.x / rect.width, 0.5 - offset.y / rect.height);
        return FULL_FRAME;
    }
    const vertical = fillType === Sprite.FillType.VERTICAL;
    const rawSize = vertical ? original.height : original.width;
    const croppedSize = vertical ? rect.height : rect.width;
    const displacement = vertical ? offset.y : offset.x;
    if (rawSize === croppedSize && !displacement) return FULL_FRAME;
    return { lower: ((rawSize - croppedSize) * 0.5 + displacement) / rawSize, span: croppedSize / rawSize };
}

/** 仍以原画布表达进度，裁剪到实际子图；比赛更新不分配对象，只写变化值。 */
export function setUiLinearFill(sprite: Sprite, geometry: UiLinearFillGeometry, start: number, range: number): void {
    const first = Math.max(0, Math.min(1, (start - geometry.lower) / geometry.span));
    const last = Math.max(0, Math.min(1, (start + range - geometry.lower) / geometry.span));
    const visibleRange = last - first;
    if (sprite.fillStart !== first) sprite.fillStart = first;
    if (sprite.fillRange !== visibleRange) sprite.fillRange = visibleRange;
}
