import { Button, Camera, Canvas, Label, Node, Sprite, UITransform, Vec3, view } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { makeLabel, makeTouchArea, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { getUILayer, UILayer } from './UILayers';

// 顺序与主界面、角色属性页一致。解释稳定规则，不写会随调参变化的倍率。
export const CHARACTER_ATTRIBUTE_TIPS = [
    {
        title: '体力',
        summary: '决定能维持多少次有力划水。\n体力越高，持续划水越久。',
        detail: '划水和海豚跳都会消耗体力。\n耗尽后划水更慢、推进更弱。\n比赛中体力不会自行恢复。',
    },
    {
        title: '技巧',
        summary: '增强每次手臂划水的推进。\n同样操作，技巧越高游得越快。',
        detail: '按住划水和松手推进都会增强。\n不改变左右转向和完美判定。\n不影响独立踢腿或起跳速度。',
    },
    {
        title: '爆发力',
        summary: '提高跳水、海豚跳和翻滚蹬墙\n这三种动作的初速度。',
        detail: '爆发力越高，起跳冲得越快。\n其他条件相同，推进距离更远。\n不提高普通划水或踢腿的速度。',
    },
] as const;

const WIDTH = 416;
const HEIGHT = 264;
const MARGIN = 16;
const TITLE_COLOR = uiColor(247, 250, 255);
const BODY_COLOR = uiColor(181, 201, 225);

/** 复用联机玩家 tips 原底板、分隔线、配色及关闭方式；只在点击时更新。 */
export class CharacterAttributeTips {
    readonly root: Node;
    private readonly panel: Node;
    private readonly dismiss: Node;
    private readonly title: Label;
    private readonly summary: Label;
    private readonly detail: Label;
    private readonly anchorPoint = new Vec3();
    private readonly screenPoint = new Vec3();
    private readonly overlayWorld = new Vec3();
    private disposed = false;
    private readonly onResize = (): void => this.hide();

    constructor(canvas: Node) {
        // 单独的 Popup 相机保证 tips 显示在角色 3D 预览上方。
        this.root = makeUiNode('CharacterAttributeTips', getUILayer(canvas, UILayer.Popup));
        this.dismiss = makeTouchArea('DismissAttributeTips', this.root, 1280, 720);
        this.dismiss.on(Button.EventType.CLICK, () => this.hide());
        // 面板本身消费触摸，阅读时点击文字不会穿透到旋转、升级或开始按钮。
        this.panel = makeTouchArea('AttributeTipsPanel', this.root, WIDTH, HEIGHT);
        const sprite = this.panel.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
        loadAvatarUiSpriteFrame(RESOURCE_PATHS.onlineRoomUi.popup, frame => {
            if (!this.disposed && sprite.isValid && frame && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        });
        // 原图等比放大两倍：保留顶部指示箭头及中间横线，文字分放在线的上下。
        this.title = this.text('AttributeTipsTitle', '', 26, 36, 80, true);
        this.summary = this.text('AttributeTipsSummary', '', 20, 56, 28, false);
        this.detail = this.text('AttributeTipsDetail', '', 18, 78, -56, false);
        const close = makeTouchArea('CloseAttributeTips', this.panel, 44, 44);
        close.setPosition(166, 84);
        const closeLabel = makeLabel('CloseText', close, '×', 26, uiColor(200, 216, 237)).getComponent(Label)!;
        closeLabel.overflow = Label.Overflow.CLAMP;
        styleProjectUiLabel(closeLabel, 'semibold', 32);
        closeLabel.node.getComponent(UITransform)!.setContentSize(44, 44);
        close.on(Button.EventType.CLICK, () => this.hide());
        this.root.active = false;
        view.on('canvas-resize', this.onResize);
        view.on('design-resolution-changed', this.onResize);
    }

    show(index: number, anchor: Node): void {
        const info = CHARACTER_ATTRIBUTE_TIPS[index];
        if (this.disposed || !this.root.isValid || !anchor.isValid || !anchor.activeInHierarchy || !info) return;
        const sourceCamera = canvasCamera(anchor);
        const popupCamera = canvasCamera(this.root);
        if (!sourceCamera || !popupCamera) {
            this.hide();
            return;
        }
        assign(this.title, info.title);
        assign(this.summary, info.summary);
        assign(this.detail, info.detail);
        const size = view.getVisibleSize();
        resize(this.root, size.width, size.height);
        resize(this.dismiss, size.width, size.height);
        anchor.getWorldPosition(this.anchorPoint);
        // 两个 Canvas 由不同相机渲染，世界坐标原点可能不同，必须经过屏幕坐标衔接。
        sourceCamera.worldToScreen(this.anchorPoint, this.screenPoint);
        popupCamera.screenToWorld(this.screenPoint, this.overlayWorld);
        this.root.getComponent(UITransform)!.convertToNodeSpaceAR(this.overlayWorld, this.anchorPoint);
        // 原图顶部箭头比中心左移44px；优先置于属性行下方，限制在可见画布内。
        const xLimit = Math.max(0, size.width / 2 - WIDTH / 2 - MARGIN);
        const yLimit = Math.max(0, size.height / 2 - HEIGHT / 2 - MARGIN);
        const x = Math.max(-xLimit, Math.min(xLimit, this.anchorPoint.x + 44));
        const y = Math.max(-yLimit, Math.min(yLimit, this.anchorPoint.y - 22 - HEIGHT / 2));
        if (this.panel.position.x !== x || this.panel.position.y !== y) this.panel.setPosition(x, y);
        if (!this.root.active) this.root.active = true;
    }

    hide(): void {
        if (!this.disposed && this.root.isValid && this.root.active) this.root.active = false;
    }

    dispose(): void {
        if (this.disposed) return;
        this.hide();
        this.disposed = true;
        view.off('canvas-resize', this.onResize);
        view.off('design-resolution-changed', this.onResize);
        this.root.destroy();
    }

    private text(name: string, value: string, size: number, height: number, y: number, heading: boolean): Label {
        const label = makeLabel(name, this.panel, value, size, heading ? TITLE_COLOR : BODY_COLOR).getComponent(Label)!;
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.CLAMP;
        label.enableWrapText = true;
        styleProjectUiLabel(label, heading ? 'semibold' : 'regular', size + 8);
        label.node.getComponent(UITransform)!.setContentSize(heading ? 290 : 344, height);
        label.node.setPosition(heading ? -27 : 0, y);
        return label;
    }
}

function assign(label: Label, value: string): void {
    if (label.string !== value) label.string = value;
}

function resize(node: Node, width: number, height: number): void {
    const transform = node.getComponent(UITransform)!;
    if (transform.contentSize.width !== width || transform.contentSize.height !== height) transform.setContentSize(width, height);
}

function canvasCamera(node: Node): Camera | null {
    for (let owner: Node | null = node; owner; owner = owner.parent) {
        const canvas = owner.getComponent(Canvas);
        if (canvas?.cameraComponent) return canvas.cameraComponent;
    }
    return null;
}
