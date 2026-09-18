import { Color, Label, LabelOutline, Node, UITransform } from 'cc';
import { makeLabel, makeUiNode } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

export type EntertainmentBannerTone = 'info' | 'warning' | 'danger' | 'success';

const TONE_COLORS: Record<EntertainmentBannerTone, Readonly<Color>> = {
    info: new Color(116, 226, 255, 255),
    warning: new Color(255, 196, 82, 255),
    danger: new Color(255, 86, 70, 255),
    success: new Color(120, 220, 150, 255),
};

type QueuedEvent = {
    text: string;
    tone: EntertainmentBannerTone;
    durationMs: number;
};

/**
 * 娱乐玩法共用的比赛文字通道。
 * 大型赛事广播与较轻的个人反馈各自只有一个稳定节点；事件触发时替换文字，
 * 不创建临时 Toast，也不在比赛热路径重建 UI。
 */
export class EntertainmentEventBanner {
    private eventRoot: Node | null = null;
    private eventLabel: Label | null = null;
    private eventUntil = 0;
    private personalRoot: Node | null = null;
    private personalLabel: Label | null = null;
    private personalUntil = 0;
    private readonly eventQueue: QueuedEvent[] = [];

    bind(hud: Node): void {
        if (this.eventRoot?.isValid || !hud?.isValid) return;

        // 赛事广播延续鲨鱼玩法已确认的大字、深描边风格。
        const eventRoot = makeUiNode('EntertainmentEventBanner', hud);
        eventRoot.getComponent(UITransform)!.setContentSize(840, 86);
        eventRoot.setPosition(0, 180, 0);
        const eventLabelNode = makeLabel('Label', eventRoot, '', 40, TONE_COLORS.warning);
        eventLabelNode.getComponent(UITransform)!.setContentSize(840, 74);
        const eventLabel = eventLabelNode.getComponent(Label)!;
        eventLabel.enableWrapText = false;
        eventLabel.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(eventLabel, 'semibold', 50);
        const eventOutline = eventLabelNode.addComponent(LabelOutline);
        eventOutline.color = new Color(6, 16, 30, 235);
        eventOutline.width = 6;
        eventRoot.active = false;

        // 个人反馈与赛事广播同源，但体量更小，避免每次拾取或传递都压住赛道。
        const personalRoot = makeUiNode('EntertainmentPersonalFeedback', hud);
        personalRoot.getComponent(UITransform)!.setContentSize(700, 52);
        personalRoot.setPosition(0, 112, 0);
        const personalLabelNode = makeLabel('Label', personalRoot, '', 28, TONE_COLORS.info);
        personalLabelNode.getComponent(UITransform)!.setContentSize(700, 50);
        const personalLabel = personalLabelNode.getComponent(Label)!;
        personalLabel.enableWrapText = false;
        personalLabel.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(personalLabel, 'semibold', 38);
        const personalOutline = personalLabelNode.addComponent(LabelOutline);
        personalOutline.color = new Color(6, 16, 30, 225);
        personalOutline.width = 4;
        personalRoot.active = false;

        this.eventRoot = eventRoot;
        this.eventLabel = eventLabel;
        this.personalRoot = personalRoot;
        this.personalLabel = personalLabel;
    }

    showEvent(text: string, tone: EntertainmentBannerTone, durationMs: number): void {
        this.eventQueue.length = 0;
        this.presentEvent(text, tone, durationMs);
    }

    enqueueEvent(text: string, tone: EntertainmentBannerTone, durationMs: number): void {
        if (!this.eventRoot?.isValid) return;
        if (!this.eventRoot.active) {
            this.presentEvent(text, tone, durationMs);
            return;
        }
        this.eventQueue.push({ text, tone, durationMs: Math.max(0, durationMs) });
    }

    showPersonal(text: string, tone: EntertainmentBannerTone, durationMs: number): void {
        const root = this.personalRoot;
        const label = this.personalLabel;
        if (!root?.isValid || !label) return;
        this.setLabel(label, text, tone);
        if (!root.active) root.active = true;
        this.personalUntil = Date.now() + Math.max(0, durationMs);
    }

    update(): void {
        if (!this.eventRoot?.active && !this.personalRoot?.active) return;
        const now = Date.now();
        const eventRoot = this.eventRoot;
        if (eventRoot?.active && now >= this.eventUntil) {
            const next = this.eventQueue.shift();
            if (next) this.presentEvent(next.text, next.tone, next.durationMs);
            else eventRoot.active = false;
        }
        const personalRoot = this.personalRoot;
        if (personalRoot?.active && now >= this.personalUntil) personalRoot.active = false;
    }

    hide(): void {
        if (this.eventRoot?.active) this.eventRoot.active = false;
        if (this.personalRoot?.active) this.personalRoot.active = false;
        this.eventUntil = 0;
        this.personalUntil = 0;
        this.eventQueue.length = 0;
    }

    private presentEvent(text: string, tone: EntertainmentBannerTone, durationMs: number): void {
        const root = this.eventRoot;
        const label = this.eventLabel;
        if (!root?.isValid || !label) return;
        this.setLabel(label, text, tone);
        if (!root.active) root.active = true;
        this.eventUntil = Date.now() + Math.max(0, durationMs);
    }

    private setLabel(label: Label, text: string, tone: EntertainmentBannerTone): void {
        if (label.string !== text) label.string = text;
        const color = TONE_COLORS[tone];
        if (!label.color.equals(color)) label.color = color;
    }
}

// 旧类名保留为源码兼容别名；新的调用统一使用 EntertainmentEventBanner。
export { EntertainmentEventBanner as SharkEventBanner };
