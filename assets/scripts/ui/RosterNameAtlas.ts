import { Color, ImageAsset, Label, Rect, Size, SpriteFrame, Texture2D } from 'cc';

const PADDING = 2;
const MAX_SIZE = 1024;
type Cell = { x: number; y: number; width: number; height: number };
export type CachedNameFrame = { frame: SpriteFrame; width: number; height: number; x: number; y: number };

/** 每份名单独占一页；只在名单事件生成，移动/换位不绘图或上传纹理。 */
export class RosterNameAtlas {
    readonly names: CachedNameFrame[] = [];
    readonly ranks: SpriteFrame[] = [];
    private image: ImageAsset | null = null;
    private texture: Texture2D | null = null;
    private canvas: HTMLCanvasElement | null = null;

    static build(names: readonly Label[], rank: Label, background: Color): RosterNameAtlas {
        return this.buildPage(names, rank, background);
    }

    static buildNames(names: readonly Label[]): RosterNameAtlas {
        return this.buildPage(names);
    }

    private static buildPage(names: readonly Label[], rank?: Label, background?: Color): RosterNameAtlas {
        const atlas = new RosterNameAtlas();
        try {
            const sources = names.map(label => {
                label.updateRenderData(true);
                const canvas = label.assemblerData?.canvas;
                const data = label.renderData?.data;
                if (!canvas || !data || data.length !== 4) throw new Error('昵称字形尚未就绪');
                return { canvas, width: data[1].x - data[0].x, height: data[2].y - data[0].y,
                    x: (data[1].x + data[0].x) / 2, y: (data[2].y + data[0].y) / 2 };
            });
            const sizes = sources.map(source => ({ width: source.canvas.width, height: source.canvas.height }));
            if (rank) {
                rank.string = '1';
                rank.updateRenderData(true);
                const rankCanvas = rank.assemblerData?.canvas;
                if (!rankCanvas) throw new Error('名次字形尚未就绪');
                for (let i = 0; i < 8; i++) sizes.push({ width: rankCanvas.width, height: rankCanvas.height });
            }
            const layout = packRosterNameCells(sizes);
            // 使用 Creator 微信适配层的 canvas，与引擎 Label 的绘制入口相同。
            const canvas = document.createElement('canvas');
            atlas.canvas = canvas;
            canvas.width = layout.width; canvas.height = layout.height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('名牌纹理绘制不可用');
            for (let i = 0; i < sources.length; i++) {
                const cell = layout.cells[i];
                context.drawImage(sources[i].canvas, cell.x, cell.y);
            }
            if (rank && background) for (let i = 0; i < 8; i++) {
                rank.string = String(i + 1);
                rank.updateRenderData(true);
                const source = rank.assemblerData!.canvas;
                const cell = layout.cells[sources.length + i];
                if (source.width !== cell.width || source.height !== cell.height) throw new Error('名次纹理尺寸不一致');
                // 复用原静态正圆的颜色和直径，只绘制一次基本圆底。
                context.fillStyle = `rgba(${background.r},${background.g},${background.b},${background.a / 255})`;
                context.beginPath();
                context.arc(cell.x + cell.width / 2, cell.y + cell.height / 2, cell.width / 2, 0, Math.PI * 2);
                context.fill();
                context.drawImage(source, cell.x, cell.y);
            }
            atlas.image = new ImageAsset(canvas);
            atlas.texture = new Texture2D();
            atlas.texture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
            atlas.texture.setMipFilter(Texture2D.Filter.NONE);
            atlas.texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
            atlas.texture.image = atlas.image;
            for (let i = 0; i < layout.cells.length; i++) {
                const cell = layout.cells[i];
                const frame = new SpriteFrame();
                frame.texture = atlas.texture;
                frame.rect = new Rect(cell.x, cell.y, cell.width, cell.height);
                frame.originalSize = new Size(cell.width, cell.height);
                frame.packable = false;
                if (i < sources.length) {
                    const source = sources[i];
                    atlas.names.push({ frame, width: source.width, height: source.height, x: source.x, y: source.y });
                } else atlas.ranks.push(frame);
            }
            return atlas;
        } catch (error) {
            atlas.dispose();
            throw error;
        }
    }

    dispose(): void {
        for (const name of this.names) name.frame.destroy();
        for (const frame of this.ranks) frame.destroy();
        this.names.length = this.ranks.length = 0;
        this.texture?.destroy(); this.texture = null;
        this.image?.destroy(); this.image = null;
        if (this.canvas) { this.canvas.width = this.canvas.height = 1; this.canvas = null; }
    }
}

/** 固定上限的留白排布；容量不足则保留原 Label，不截字或覆盖其他名单。 */
export function packRosterNameCells(sizes: readonly { width: number; height: number }[]): { width: number; height: number; cells: Cell[] } {
    let best: { width: number; height: number; cells: Cell[] } | null = null;
    for (let width = 64; width <= MAX_SIZE; width *= 2) {
        let x = PADDING, y = PADDING, rowHeight = 0;
        const cells: Cell[] = [];
        for (const size of sizes) {
            if (size.width <= 0 || size.height <= 0 || size.width + PADDING * 2 > width) break;
            if (x + size.width + PADDING > width) { x = PADDING; y += rowHeight + PADDING * 2; rowHeight = 0; }
            cells.push({ x, y, width: size.width, height: size.height });
            x += size.width + PADDING * 2; rowHeight = Math.max(rowHeight, size.height);
        }
        let height = 64;
        while (height < y + rowHeight + PADDING) height *= 2;
        if (cells.length === sizes.length && height <= MAX_SIZE && (!best || width * height < best.width * best.height)) best = { width, height, cells };
    }
    if (!best) throw new Error('名牌纹理超过 1024² 预算');
    return best;
}
