import type { Node } from 'cc';

export type PreviewEffect = 'crowd' | 'floats' | 'ceiling' | 'bubbles';
export const PREVIEW_EFFECTS: readonly PreviewEffect[] = ['crowd', 'floats', 'ceiling', 'bubbles'];

type Entry = { node: Node; effect: PreviewEffect; initialActive: boolean };

// 仅场景效果预览创建；初始化及延迟资源完成时收集节点，比赛帧不遍历场馆。
export class SceneEffectPreviewState {
    private readonly _enabled: Record<PreviewEffect, boolean> = { crowd: true, floats: true, ceiling: true, bubbles: true };
    private readonly _entries = new Map<Node, Entry>();

    isEnabled(effect: PreviewEffect): boolean { return this._enabled[effect]; }

    refreshTargets(root: Node) {
        for (const node of this._entries.keys()) if (!node.isValid) this._entries.delete(node);
        const collect = (node: Node) => {
            if (!node.isValid) return;
            const name = node.name.toLowerCase();
            const effect: PreviewEffect | null = name === 'spectatorcrowd' ? 'crowd'
                : name.startsWith('lane_float_rope') ? 'floats'
                : name.includes('ceiling') ? 'ceiling'
                : name.endsWith('bubbles') ? 'bubbles' : null;
            if (effect) {
                let entry = this._entries.get(node);
                if (!entry) {
                    entry = { node, effect, initialActive: node.active };
                    this._entries.set(node, entry);
                }
                this.apply(entry);
                return; // 关闭根节点同时停掉观众动画、闪光灯或粒子子节点。
            }
            for (const child of node.children) collect(child);
        };
        if (root.isValid) collect(root);
    }

    setEnabled(effect: PreviewEffect, enabled: boolean): boolean {
        if (this._enabled[effect] === enabled) return false;
        this._enabled[effect] = enabled;
        for (const entry of this._entries.values()) if (entry.effect === effect) this.apply(entry);
        return true;
    }

    reset() { for (const effect of PREVIEW_EFFECTS) this.setEnabled(effect, true); }

    dispose() {
        for (const entry of this._entries.values()) {
            if (entry.node.isValid && entry.node.active !== entry.initialActive) entry.node.active = entry.initialActive;
        }
        this._entries.clear();
    }

    private apply(entry: Entry) {
        const active = entry.initialActive && this._enabled[entry.effect];
        if (entry.node.isValid && entry.node.active !== active) entry.node.active = active;
    }
}
