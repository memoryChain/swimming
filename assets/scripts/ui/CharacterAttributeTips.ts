import { Button, Camera, Canvas, Label, Node, UITransform, Vec3, view } from 'cc';
import { makeLabel, makeRoundedRect, makeTouchArea, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { getUILayer, UILayer } from './UILayers';

// 顺序与主界面、角色属性页一致。解释稳定规则，不写会随调参变化的倍率。
export const CHARACTER_ATTRIBUTE_TIPS = [
    { title: '体力', summary: '划水更持久，比赛中不恢复。' },
    { title: '技巧', summary: '增强每次划水的推进。' },
    { title: '爆发力', summary: '提高跳水、海豚跳和蹬墙初速度。' },
] as const;

const WIDTH = 360;
// 24px 上下留白；标题 32px；标题后 20px；每组两行各 26px、组间 14px。
const PADDING = 24;
const TITLE_HEIGHT = 32;
const LINE_HEIGHT = 26;
const GROUP_GAP = 14;
const HEADER_GAP = 20;
const HEIGHT = PADDING * 2 + TITLE_HEIGHT + HEADER_GAP
    + CHARACTER_ATTRIBUTE_TIPS.length * LINE_HEIGHT * 2
    + (CHARACTER_ATTRIBUTE_TIPS.length - 1) * GROUP_GAP;
const MARGIN = 16;
const TITLE_COLOR = uiColor(247, 250, 255);
const BODY_COLOR = uiColor(202, 218, 235);

/** 大厅和角色页共用的属性说明；静态底板只创建一次，三项文案一次建立。 */
export class CharacterAttributeTips {
    readonly root: Node;
    private readonly panel: Node;
    private readonly dismiss: Node;
    private readonly anchorPoint = new Vec3();
    private readonly screenPoint = new Vec3();
    private readonly overlayWorld = new Vec3();
    private presented = false;
    private disposed = false;
    private readonly onResize = (): void => this.hide();

    constructor(canvas: Node, private readonly onPresentedChanged?: (presented: boolean) => void) {
        // 与其他交互弹窗共用主 HUD；显示时由宿主暂停更高优先级的 3D 预览。
        this.root = makeUiNode('CharacterAttributeTips', getUILayer(canvas, UILayer.Hud));
        this.dismiss = makeTouchArea('DismissAttributeTips', this.root, 1280, 720);
        this.dismiss.on(Button.EventType.CLICK, () => this.hide());
        // 面板本身消费触摸，阅读时点击文字不会穿透到旋转、升级或开始按钮。
        this.panel = makeTouchArea('AttributeTipsPanel', this.root, WIDTH, HEIGHT);
        // 简单静态形状，不使用拉伸图片、逐帧绘制或装饰特效。
        makeRoundedRect('CardSurface', this.panel, WIDTH, HEIGHT, uiColor(23, 43, 64, 250), 20,
            uiColor(105, 146, 168, 180), 1);
        const titleY = HEIGHT / 2 - PADDING - TITLE_HEIGHT / 2;
        const title = this.text('AttributeTipsTitle', '属性说明', 24, TITLE_HEIGHT, titleY, true);
        title.node.getComponent(UITransform)!.setContentSize(260, TITLE_HEIGHT);
        title.node.setPosition(-26, titleY);
        const contentTop = HEIGHT / 2 - PADDING - TITLE_HEIGHT - HEADER_GAP;
        CHARACTER_ATTRIBUTE_TIPS.forEach((info, index) => {
            const y = contentTop - LINE_HEIGHT / 2 - index * (LINE_HEIGHT * 2 + GROUP_GAP);
            const heading = this.text(`AttributeTipsHeading${index}`, info.title, 20, LINE_HEIGHT, y, true);
            heading.color = uiColor(133, 237, 219);
            this.text(`AttributeTipsSummary${index}`, info.summary, 18, LINE_HEIGHT, y - LINE_HEIGHT, false);
        });
        const close = makeTouchArea('CloseAttributeTips', this.panel, 44, 44);
        close.setPosition(148, titleY);
        const closeLabel = makeLabel('CloseText', close, '×', 26, uiColor(200, 216, 237)).getComponent(Label)!;
        closeLabel.overflow = Label.Overflow.CLAMP;
        styleProjectUiLabel(closeLabel, 'semibold', 32);
        closeLabel.node.getComponent(UITransform)!.setContentSize(44, 44);
        close.on(Button.EventType.CLICK, () => this.hide());
        this.root.active = false;
        view.on('canvas-resize', this.onResize);
        view.on('design-resolution-changed', this.onResize);
    }

    show(anchor: Node): void {
        if (this.disposed || !this.root.isValid || !anchor.isValid || !anchor.activeInHierarchy) return;
        const sourceCamera = canvasCamera(anchor);
        const targetCamera = canvasCamera(this.root);
        if (!sourceCamera || !targetCamera) {
            this.hide();
            return;
        }
        const size = view.getVisibleSize();
        resize(this.root, size.width, size.height);
        resize(this.dismiss, size.width, size.height);
        const anchorTransform = anchor.getComponent(UITransform)!;
        this.anchorPoint.set(anchorTransform.contentSize.width / 2 + 28, 0, 0);
        anchorTransform.convertToWorldSpaceAR(this.anchorPoint, this.overlayWorld);
        // 保留屏幕坐标衔接，既支持当前同 Canvas，也避免未来锚点来自其他 Canvas 时错位。
        sourceCamera.worldToScreen(this.overlayWorld, this.screenPoint);
        targetCamera.screenToWorld(this.screenPoint, this.overlayWorld);
        this.root.getComponent(UITransform)!.convertToNodeSpaceAR(this.overlayWorld, this.anchorPoint);
        // 属性区右边缘加面板边距；空间不足时放左侧，避免盖住属性或超出屏幕。
        const xLimit = Math.max(0, size.width / 2 - WIDTH / 2 - MARGIN);
        const yLimit = Math.max(0, size.height / 2 - HEIGHT / 2 - MARGIN);
        let preferredX = this.anchorPoint.x + WIDTH / 2;
        const anchorY = this.anchorPoint.y;
        if (preferredX > xLimit) {
            this.anchorPoint.set(-anchorTransform.contentSize.width / 2 - 28, 0, 0);
            anchorTransform.convertToWorldSpaceAR(this.anchorPoint, this.overlayWorld);
            sourceCamera.worldToScreen(this.overlayWorld, this.screenPoint);
            targetCamera.screenToWorld(this.screenPoint, this.overlayWorld);
            this.root.getComponent(UITransform)!.convertToNodeSpaceAR(this.overlayWorld, this.anchorPoint);
            preferredX = this.anchorPoint.x - WIDTH / 2;
        }
        const x = Math.max(-xLimit, Math.min(xLimit, preferredX));
        const y = Math.max(-yLimit, Math.min(yLimit, anchorY));
        if (this.panel.position.x !== x || this.panel.position.y !== y) this.panel.setPosition(x, y);
        if (!this.root.active) this.root.active = true;
        this.setPresented(true);
    }

    hide(): void {
        if (!this.disposed && this.root.isValid && this.root.active) this.root.active = false;
        this.setPresented(false);
    }

    dispose(): void {
        if (this.disposed) return;
        this.hide();
        this.disposed = true;
        view.off('canvas-resize', this.onResize);
        view.off('design-resolution-changed', this.onResize);
        this.root.destroy();
    }

    private setPresented(presented: boolean): void {
        if (this.presented === presented) return;
        this.presented = presented;
        this.onPresentedChanged?.(presented);
    }

    private text(name: string, value: string, size: number, height: number, y: number, heading: boolean): Label {
        const label = makeLabel(name, this.panel, value, size, heading ? TITLE_COLOR : BODY_COLOR).getComponent(Label)!;
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.CLAMP;
        label.enableWrapText = false;
        styleProjectUiLabel(label, heading ? 'semibold' : 'regular', height);
        label.node.getComponent(UITransform)!.setContentSize(312, height);
        label.node.setPosition(0, y);
        return label;
    }
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
