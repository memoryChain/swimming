import { BlockInputEvents, Button, Graphics, Label, Mask, Node, UITransform, sys, view } from 'cc';
import { findPlayerCharacter } from '../app/PlayerCharacterConfig';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import type { EventPageActions, EventPageState } from './CareerEventPage';
import { CareerControl, CareerImage, careerColor, careerImage, careerLabel, careerText,
    showCareerNode, CAREER_INK, CAREER_MUTED, CAREER_WHITE } from './CareerPageWidgets';
import { makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleCurrencyNumberLabel } from './ProjectUiFonts';

const ART = RESOURCE_PATHS.careerUi;
const SELECTED = uiColor(43, 183, 73), SELECTED_FILL = uiColor(234, 249, 238);
const BORDER = uiColor(215, 227, 242), FILL = uiColor(237, 243, 250);
type Choice = { control: CareerControl; surface: Graphics; check: CareerImage; selected: boolean | null };

/** 仅在创建后调用一次：按字号下移2–4px，校正弹窗文字与底板的视觉中心。 */
function alignQuickText(label: Label): void {
    const p = label.node.position;
    label.node.setPosition(p.x, p.y - Math.round(label.fontSize * 0.1), p.z);
}

/** 大厅上的单人准备弹窗；美术全部复用，选项只在状态边沿更新，无逐帧工作。 */
export class QuickRacePopup {
    readonly root: Node;
    private readonly design: Node;
    private readonly choices: Choice[] = [];
    private readonly close: CareerControl;
    private readonly start: CareerControl;
    private readonly change: CareerControl;
    private readonly avatar: CareerImage;
    private readonly name: Label;
    private readonly level: Label;
    private readonly levelPill: CareerImage;
    private readonly status: Label;
    private readonly startArrow: CareerImage;
    private readonly backdropButton: Button;
    private busy = false;
    private readonly layoutLevel = () => {
        const width = this.name.node.getComponent(UITransform)!.contentSize.width;
        const x = 475 + width + 12 + 35 - 640;
        for (const node of [this.levelPill.node, this.level.node]) {
            if (node.position.x !== x) node.setPosition(x, node.position.y);
        }
    };
    private readonly resize = () => {
        if (!this.root.isValid) return;
        const size = view.getVisibleSize(), safe = sys.getSafeAreaRect(false), origin = view.getVisibleOrigin();
        // 安全区坐标含可视原点；用对称留白保持弹窗中心，不把设备边距当成弹窗平移。
        const horizontal = safe.width ? Math.max(0, safe.x - origin.x, origin.x + size.width - safe.x - safe.width) : 0;
        const vertical = safe.height ? Math.max(0, safe.y - origin.y, origin.y + size.height - safe.y - safe.height) : 0;
        const scale = Math.max(0.1, Math.min(1, (size.width - horizontal * 2) / 1290, (size.height - vertical * 2) / 720));
        if (this.design.scale.x !== scale) this.design.setScale(scale, scale, 1);
    };

    constructor(parent: Node, private readonly actions: EventPageActions) {
        this.root = makeUiNode('QuickRacePopup', parent);
        this.root.active = false;
        const dim = makeRect('QuickBackdrop', this.root, 4000, 2400, uiColor(0, 22, 46, 150));
        dim.addComponent(BlockInputEvents);
        this.backdropButton = dim.addComponent(Button);
        this.backdropButton.transition = Button.Transition.NONE;
        dim.on(Button.EventType.CLICK, () => { if (!this.busy) actions.home(); });
        this.design = makeUiNode('QuickDesign', this.root);
        this.design.getComponent(UITransform)!.setContentSize(1290, 720);
        // 复用生涯控件的1280坐标助手，补偿5px后按1290画布排版。
        const body = makeUiNode('QuickContent', this.design);
        body.setPosition(-5, 0);
        // 源图696×436，保持近乎等比的820×514，顶部波点不会被压扁。
        const sheet = careerImage(body, 'QuickSheet', RESOURCE_PATHS.avatarPickerUi.panel, 235, 98, 820, 514);
        sheet.node.addComponent(BlockInputEvents);
        alignQuickText(careerLabel(body, 'QuickTitle', '快速比赛', 355, 137, 580, 54, 38, CAREER_INK, true));
        this.close = new CareerControl(body, 'CloseQuick', '×', 985, 130, 54, 54, () => actions.home(), false, 40);
        alignQuickText(this.close.label);
        careerColor(this.close.label, CAREER_MUTED);

        const clip = makeUiNode('QuickAvatarClip', body);
        clip.setPosition(312 - 640, 360 - 222);
        clip.getComponent(UITransform)!.setContentSize(62, 62);
        clip.addComponent(Mask).type = Mask.Type.GRAPHICS_ELLIPSE;
        this.avatar = new CareerImage(clip, 'QuickAvatar', '', 62, 62, 0, 0, true);
        careerImage(body, 'QuickActiveTag', ART.tagActive, 367, 207, 96, 30);
        alignQuickText(careerLabel(body, 'QuickActiveLabel', '当前出场', 369, 207, 92, 30, 19, uiColor(29, 108, 60), true));
        this.name = careerLabel(body, 'QuickCharacterName', '', 475, 201, 190, 44, 25);
        this.name.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        this.name.node.setPosition(475 - 640, 360 - 223);
        alignQuickText(this.name);
        this.name.overflow = Label.Overflow.NONE;
        this.levelPill = careerImage(body, 'QuickLevelPill', ART.panelWhite, 671, 209, 70, 28, false, true);
        careerColor(this.levelPill.sprite, CAREER_INK);
        this.level = careerLabel(body, 'QuickLevel', '', 671, 208, 70, 30, 16, CAREER_WHITE, true);
        styleCurrencyNumberLabel(this.level, 23);
        alignQuickText(this.level);
        this.name.node.on(Node.EventType.SIZE_CHANGED, this.layoutLevel);
        this.change = new CareerControl(body, 'QuickChangeCharacter', '更换', 911, 197, 100, 50,
            () => actions.characters?.(), false, 24);
        this.change.label.node.setPosition(-14, 0);
        alignQuickText(this.change.label);
        careerImage(body, 'QuickChangeArrow', ART.arrow, 994, 210, 27, 24);
        const divider = careerImage(body, 'QuickDivider', ART.panelWhite, 275, 264, 740, 2);
        careerColor(divider.sprite, BORDER);

        this.heading(body, 'Distance', '比赛距离', 278);
        this.choice(body, 'Distance200', '200米', 275, 322, () => actions.distance(200));
        this.choice(body, 'Distance400', '400米', 655, 322, () => actions.distance(400));
        this.heading(body, 'Rule', '玩法规则', 396);
        this.choice(body, 'RuleStandard', '标准竞速', 275, 440, () => actions.rule('standard'));
        this.choice(body, 'RuleWild', '狂野模式', 655, 440, () => actions.rule('wild'));

        // 玩法卡底部506，按钮顶部552，留46px；仅失败时在此显示一行错误。
        this.status = careerLabel(body, 'QuickStatus', '', 290, 518, 710, 25, 17, uiColor(170, 67, 58), true, false);
        alignQuickText(this.status);
        this.start = new CareerControl(body, 'StartEvent', '开始比赛', 470, 552, 350, 77,
            () => actions.start('quick'), false, 30);
        const surface = new CareerImage(this.start.root, 'QuickStartSurface', RESOURCE_PATHS.avatarPickerUi.confirmButton,
            350, 77, 0, 0, true);
        surface.node.setSiblingIndex(0);
        this.start.label.node.setPosition(-20, 0);
        alignQuickText(this.start.label);
        this.startArrow = new CareerImage(this.start.root, 'QuickStartArrow', ART.arrow, 29, 26, 90, 0);
        this.resize();
        view.on('canvas-resize', this.resize); view.on('design-resolution-changed', this.resize);
        this.root.once(Node.EventType.NODE_DESTROYED, () => {
            view.off('canvas-resize', this.resize); view.off('design-resolution-changed', this.resize);
        });
    }

    private heading(parent: Node, name: string, text: string, y: number): void {
        const marker = makeUiNode(`${name}Marker`, parent);
        marker.setPosition(279 - 640, 360 - y - 20);
        marker.getComponent(UITransform)!.setContentSize(8, 24);
        // 简单静态标记只构建一次，4px圆角保留直边，不缩挤大圆角纹理。
        const shape = marker.addComponent(Graphics);
        shape.fillColor = uiColor(120, 86, 246);
        shape.roundRect(-4, -12, 8, 24, 4); shape.fill();
        alignQuickText(careerLabel(parent, `${name}Heading`, text, 295, y, 330, 38, 27));
    }

    private choice(parent: Node, name: string, title: string, x: number, y: number, action: () => void): void {
        const control = new CareerControl(parent, name, title, x, y, 360, 66, action, false, 29);
        const shape = makeUiNode(`${name}Surface`, control.root);
        shape.getComponent(UITransform)!.setContentSize(360, 66);
        shape.setSiblingIndex(0);
        const surface = shape.addComponent(Graphics);
        control.label.node.getComponent(UITransform)!.setContentSize(276, 42);
        alignQuickText(control.label);
        const check = new CareerImage(control.root, `${name}Check`, RESOURCE_PATHS.avatarPickerUi.selectedCheck,
            32, 32, 154, 0, true);
        this.choices.push({ control, surface, check, selected: null });
    }

    refresh(s: EventPageState): void {
        this.busy = s.busy;
        const character = findPlayerCharacter(s.characterId);
        this.avatar.set(RESOURCE_PATHS.characterUi.portraits[s.characterId]);
        careerText(this.name, character?.name ?? ''); this.layoutLevel();
        careerText(this.level, `LV.${s.profile.characters[s.characterId]?.level ?? 1}`);
        this.change.update('更换', !s.busy && !!this.actions.characters);
        this.close.update('×', !s.busy);
        if (this.backdropButton.interactable === s.busy) this.backdropButton.interactable = !s.busy;
        this.start.update(s.busy ? '准备中…' : '开始比赛', !s.busy);
        showCareerNode(this.startArrow.node, !s.busy);
        careerText(this.status, s.status);
        for (let i = 0; i < this.choices.length; i++) {
            const choice = this.choices[i];
            choice.control.update(choice.control.label.string, !s.busy);
            const selected = i === (s.distance === 200 ? 0 : 1) || i === (s.rule === 'standard' ? 2 : 3);
            if (choice.selected === selected) continue;
            choice.selected = selected;
            // 基础控件仅在选择边沿重绘；单路径3px描边使直边和转角等宽。
            const shape = choice.surface;
            shape.clear(); shape.fillColor = selected ? SELECTED_FILL : FILL;
            shape.strokeColor = selected ? SELECTED : BORDER; shape.lineWidth = 3;
            shape.roundRect(-178.5, -31.5, 357, 63, 12);
            shape.fill(); shape.stroke();
            showCareerNode(choice.check.node, selected);
        }
    }
}
