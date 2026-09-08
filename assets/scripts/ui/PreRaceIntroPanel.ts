import { Color, Graphics, Label, Mask, Node, Sprite, Tween, tween, UIOpacity, UITransform, sys, view } from 'cc';
import { PLAYER_CHARACTER_DEFINITIONS } from '../app/PlayerCharacterConfig';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { styleDynamicUiLabel, styleProjectUiLabel } from './ProjectUiFonts';
import { makeLabel, makeUiNode } from './RuntimeUiFactory';

export type PreRaceIntroEntry = {
    lane: number;
    name: string;
    isPlayer: boolean;
    modelVariantId: string;
};
export type PreRaceEventInfo = { event: string; format: string; details: string; rule: string };
export type PreRaceIntroPhase = 'hidden' | 'raceInfo' | 'roster';

type IntroCard = {
    group: Node;
    normal: Node;
    self: Node;
    laneNormal: Node;
    laneSelf: Node;
    laneLabel: Label;
    laneCaption: Label;
    portrait: Sprite;
    nameLabel: Label;
    characterLabel: Label;
    selfTag: Node;
    selfState: boolean | null;
};
const WIDTH = 1290;
const HEIGHT = 720;
const MAX_CARDS = 8;
const ART = RESOURCE_PATHS.preRaceUi;
const NAVY = new Color(28, 53, 72, 255);
const MUTED = new Color(78, 100, 116, 255);
const WHITE = new Color(248, 251, 253, 255);
const CAPTION = new Color(169, 218, 225, 255);
const GOLD_CAPTION = new Color(71, 58, 29, 255);

/** 已批准的开场卡片；所有节点及遮罩仅挂载一次，镜头阶段只触发淡入淡出。 */
export class PreRaceIntroPanel {
    private _panel: Node | null = null;
    private _cardsPanel: Node | null = null;
    private _cardsOpacity: UIOpacity | null = null;
    private _eventPanel: Node | null = null;
    private _eventOpacity: UIOpacity | null = null;
    private _eventLabel: Label | null = null;
    private _formatLabel: Label | null = null;
    private _detailsLabel: Label | null = null;
    private _ruleLabel: Label | null = null;
    private readonly _cards: IntroCard[] = [];
    private readonly _paths = new WeakMap<Sprite, string>();
    private _phase: PreRaceIntroPhase = 'hidden';

    build(parent: Node, w: number, h: number): Node {
        if (this._panel?.isValid) return this._panel;
        const root = makeUiNode('PreRaceIntroPanel', parent);
        root.getComponent(UITransform)!.setContentSize(WIDTH, HEIGHT);
        this._panel = root;
        const layout = () => {
            if (!root.isValid) return;
            const size = view.getVisibleSize();
            const safe = sys.getSafeAreaRect(false);
            const width = size.width || w;
            const height = size.height || h;
            const left = Math.max(0, safe.x);
            const right = Math.max(0, width - safe.x - safe.width);
            const bottom = Math.max(0, safe.y);
            const top = Math.max(0, height - safe.y - safe.height);
            const scale = Math.min((width - left - right) / WIDTH, (height - top - bottom) / HEIGHT);
            if (root.scale.x !== scale) root.setScale(scale, scale, 1);
            const x = (left - right) / 2;
            const y = -height / 2 + bottom + HEIGHT * scale / 2;
            if (root.position.x !== x || root.position.y !== y) root.setPosition(x, y, 0);
        };
        layout();
        view.on('canvas-resize', layout);
        view.on('design-resolution-changed', layout);
        root.once(Node.EventType.NODE_DESTROYED, () => {
            view.off('canvas-resize', layout);
            view.off('design-resolution-changed', layout);
            if (this._cardsOpacity) Tween.stopAllByTarget(this._cardsOpacity);
            if (this._eventOpacity) Tween.stopAllByTarget(this._eventOpacity);
        });

        const event = makeUiNode('EventStrip', root);
        this._eventPanel = event;
        this._eventOpacity = event.addComponent(UIOpacity);
        this._eventOpacity.opacity = 0;
        event.active = false;
        this.art('Background', event, ART.eventStrip, 43, 353, 557, 70);
        this._formatLabel = this.label('Mode', event, '', 12, MUTED, 65, 360, 205, 20, 'left');
        this._eventLabel = this.label('Event', event, '', 27, NAVY, 65, 379, 205, 36, 'left');
        this._detailsLabel = this.label('Details', event, '', 16, WHITE, 307, 362, 260, 28, 'left');
        this._ruleLabel = this.label('Rule', event, '', 14, new Color(201, 214, 223), 307, 388, 265, 26, 'left', false);

        const cards = makeUiNode('CompetitorCards', root);
        this._cardsPanel = cards;
        this._cardsOpacity = cards.addComponent(UIOpacity);
        this._cardsOpacity.opacity = 0;
        cards.active = false;
        for (let i = 0; i < MAX_CARDS; i++) this._cards.push(this.buildCard(cards, i));
        return root;
    }

    private buildCard(parent: Node, index: number): IntroCard {
        const group = makeUiNode(`LaneCard${index + 1}`, parent);
        // 各卡使用同一套局部坐标；总排列顺序只由泳道号决定。
        group.setPosition(152 * index, 0, 0);
        group.active = false;
        const normal = this.art('CardNormal', group, ART.cardNormal, 43, 435, 140, 237).node;
        const self = this.art('CardSelf', group, ART.cardSelf, 41, 433, 144, 241).node;
        self.active = false;

        const clip = makeUiNode('PortraitClip', group);
        this.place(clip, 43, 435, 140, 166);
        clip.addComponent(Mask).type = Mask.Type.GRAPHICS_STENCIL;
        const graphics = clip.getComponent(Graphics)!;
        graphics.clear();
        graphics.roundRect(-70, -83, 140, 166, 10);
        graphics.fill();
        const portraitNode = makeUiNode('Portrait', clip);
        portraitNode.getComponent(UITransform)!.setContentSize(166, 166);
        const portrait = portraitNode.addComponent(Sprite);
        portrait.sizeMode = Sprite.SizeMode.CUSTOM;
        portrait.trim = false;
        portraitNode.active = false;

        const laneNormal = this.art('LaneNormal', group, ART.laneNormal, 49, 431, 43, 53).node;
        const laneSelf = this.art('LaneSelf', group, ART.laneSelf, 49, 431, 43, 53).node;
        laneSelf.active = false;
        const laneCaption = this.label('LaneCaption', group, '泳道', 10, CAPTION, 49, 435, 43, 16);
        const laneLabel = this.label('LaneNumber', group, '', 28, WHITE, 49, 449, 43, 34);
        const nameLabel = this.label('Nickname', group, '', 17, NAVY, 51, 611, 124, 30);
        styleDynamicUiLabel(nameLabel, 24);
        const characterLabel = this.label('CharacterName', group, '', 12, MUTED, 51, 639, 124, 22, 'center', false);
        const selfTag = makeUiNode('SelfTag', group);
        this.art('Background', selfTag, ART.selfTag, 48, 615, 25, 22);
        this.label('Text', selfTag, '我', 12, NAVY, 48, 615, 25, 22);
        selfTag.active = false;
        return { group, normal, self, laneNormal, laneSelf, laneLabel, laneCaption, portrait, nameLabel, characterLabel, selfTag, selfState: null };
    }

    populate(entries: PreRaceIntroEntry[]) {
        for (let i = 0; i < this._cards.length; i++) {
            const card = this._cards[i];
            // 缺少某条泳道时留空，不把后面的选手挪到错误的泳道号。
            const entry = entries.find(candidate => candidate.lane === i + 1);
            this.active(card.group, Boolean(entry));
            if (!entry) {
                this._paths.delete(card.portrait);
                this.active(card.portrait.node, false);
                continue;
            }
            this.text(card.laneLabel, String(entry.lane));
            // 昵称按 Unicode 码点截断，避免拆开代理对；保留固定字号与“我”标签安全区。
            this.text(card.nameLabel, compactIntroName(entry.name, entry.isPlayer ? 10 : 14));
            const character = PLAYER_CHARACTER_DEFINITIONS.find(item => item.modelVariantId === entry.modelVariantId);
            this.text(card.characterLabel, character?.name ?? '参赛选手');
            this.setArt(card.portrait, character ? RESOURCE_PATHS.characterUi.portraits[character.id] : '');
            if (card.selfState !== entry.isPlayer) {
                card.selfState = entry.isPlayer;
                this.active(card.normal, !entry.isPlayer);
                this.active(card.self, entry.isPlayer);
                this.active(card.laneNormal, !entry.isPlayer);
                this.active(card.laneSelf, entry.isPlayer);
                this.active(card.selfTag, entry.isPlayer);
                card.laneLabel.color = entry.isPlayer ? NAVY : WHITE;
                card.laneCaption.color = entry.isPlayer ? GOLD_CAPTION : CAPTION;
                this.place(card.nameLabel.node, entry.isPlayer ? 78 : 51, 611, entry.isPlayer ? 97 : 124, 30);
                card.nameLabel.horizontalAlign = entry.isPlayer ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
            }
        }
    }

    setRaceInfo(info: PreRaceEventInfo) {
        this.text(this._eventLabel, info.event);
        this.text(this._formatLabel, info.format);
        this.text(this._detailsLabel, info.details);
        this.text(this._ruleLabel, info.rule);
    }

    setPhase(phase: PreRaceIntroPhase) {
        if (phase === this._phase) return;
        const old = this._phase;
        this._phase = phase;
        // 赛制条跨两个镜头保持，不能在名单入场时重放其动画。
        if ((old !== 'hidden') !== (phase !== 'hidden')) {
            this.transition(this._eventPanel, this._eventOpacity, phase !== 'hidden');
        }
        if ((old === 'roster') !== (phase === 'roster')) {
            this.transition(this._cardsPanel, this._cardsOpacity, phase === 'roster');
        }
    }
    setVisible(visible: boolean) { this.setPhase(visible ? 'roster' : 'hidden'); }
    get node(): Node | null { return this._panel; }

    private transition(panel: Node | null, opacity: UIOpacity | null, visible: boolean) {
        if (!panel?.isValid || !opacity) return;
        Tween.stopAllByTarget(opacity);
        if (visible) {
            if (!panel.active) { panel.active = true; opacity.opacity = 0; }
            tween(opacity).to(0.25, { opacity: 255 }).start();
        } else if (panel.active) {
            tween(opacity).to(0.2, { opacity: 0 }).call(() => {
                if (panel.isValid) panel.active = false;
            }).start();
        }
    }
    private active(node: Node, value: boolean) { if (node.active !== value) node.active = value; }
    private text(label: Label | null, value: string) { if (label && label.string !== value) label.string = value; }
    private place(node: Node, x: number, y: number, w: number, h: number) {
        node.getComponent(UITransform)!.setContentSize(w, h);
        node.setPosition(x + w / 2 - WIDTH / 2, HEIGHT / 2 - y - h / 2, 0);
    }
    private label(name: string, parent: Node, text: string, size: number, color: Color,
        x: number, y: number, w: number, h: number, align: 'left' | 'center' = 'center', bold = true): Label {
        const node = makeLabel(name, parent, text, size, color);
        const label = node.getComponent(Label)!;
        // 缓存字体会同步测量空字符串；先固定溢出模式，最后恢复设计框，避免零宽文本。
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        label.horizontalAlign = align === 'left' ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
        styleProjectUiLabel(label, bold ? 'semibold' : 'regular', size + 7);
        this.place(node, x, y, w, h);
        return label;
    }
    private art(name: string, parent: Node, path: string, x: number, y: number, w: number, h: number): Sprite {
        const node = makeUiNode(name, parent);
        this.place(node, x, y, w, h);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
        this.setArt(sprite, path);
        return sprite;
    }
    private setArt(sprite: Sprite, path: string) {
        if (this._paths.get(sprite) === path) return;
        this._paths.set(sprite, path);
        if (!path) { sprite.spriteFrame = null; this.active(sprite.node, false); return; }
        // 更换参赛者时先清掉旧卡面；迟到回调必须同时核查请求身份和节点生命周期。
        if (sprite.spriteFrame) sprite.spriteFrame = null;
        loadAvatarUiSpriteFrame(path, frame => {
            if (!sprite.isValid || this._paths.get(sprite) !== path) return;
            if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.trim = false;
            // 底板正常/本人显隐由状态控制，不能被异步加载回调反转。
            if (sprite.node.name === 'Portrait') this.active(sprite.node, Boolean(frame));
        });
    }
}

/** 用近似字宽预算保护固定卡片；UTF-16 代理对不拆开，后续按 Label 实际宽度兜底缩字。 */
export function compactIntroName(name: string, budget: number): string {
    let result = '';
    let width = 0;
    for (const char of name.replace(/[\r\n\t]/g, ' ')) {
        const next = char.charCodeAt(0) < 128 ? 1 : 2;
        if (width + next > budget) return result + '…';
        result += char;
        width += next;
    }
    return result;
}
