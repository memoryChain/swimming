import { BlockInputEvents, Button, Label, Node, Sprite, UITransform } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { platformEngagement } from '../platform/PlatformEngagement';
import { SidebarState } from '../platform/DouyinEngagement';
import { loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { PopupUiMotion } from './PopupUiMotion';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { fitFullScreenSolidCover, makeLabel, makeRect, makeTouchArea, makeUiNode, uiColor } from './RuntimeUiFactory';
import { showToast } from './Toast';

/** 复用已随包的弹窗、按钮与字体；隐藏时无更新工作。 */
export class SidebarReturnPanel {
    private root: Node | null = null;
    private motion: PopupUiMotion | null = null;
    private status: Label | null = null;
    private actionText: Label | null = null;
    private action: Button | null = null;
    private offState: (() => void) | null = null;
    private presented = false;

    constructor(private readonly onPresentedChanged: (presented: boolean) => void) {}

    build(parent: Node, width: number, height: number): void {
        if (this.root?.isValid) return;
        const root = makeUiNode('SidebarReturnPanel', parent);
        root.getComponent(UITransform)!.setContentSize(width, height);
        root.active = false;
        this.root = root;
        const dim = makeRect('Dim', root, width, height, uiColor(2, 20, 38, 174));
        fitFullScreenSolidCover(dim, width, height);
        dim.on(Node.EventType.TOUCH_END, () => this.hide());
        const panel = artwork('Panel', root, RESOURCE_PATHS.avatarPickerUi.panel, 696, 420, 0, 27);
        panel.addComponent(BlockInputEvents);
        this.motion = new PopupUiMotion(root, dim, panel);
        artwork('Header', panel, RESOURCE_PATHS.characterUi.headerBackground, 696, 155, 0, 132);
        label('Title', panel, '首页侧边栏', 30, 480, 44, -50, 156, 'semibold');
        label('Subtitle', panel, '下次从首页侧边栏，快速找到划水大师', 18, 550, 32, 0, 113);
        label('Steps', panel, '1. 点击下方按钮，前往首页侧边栏\n2. 在侧边栏找到「划水大师」\n3. 点击游戏图标，返回游戏', 22, 560, 114, 0, 19);
        this.status = label('Status', panel, '', 18, 580, 32, 0, -85);
        const close = makeTouchArea('Close', panel, 272, 70);
        close.setPosition(-170, -176, 2);
        artwork('Artwork', close, RESOURCE_PATHS.avatarPickerUi.cancelButton, 258, 57, 0, 0);
        label('Text', close, '关闭', 26, 220, 52, 0, 0, 'semibold').horizontalAlign = Label.HorizontalAlign.CENTER;
        close.on(Button.EventType.CLICK, () => this.hide());
        this.motion.bindButton(close, () => true);
        const go = makeTouchArea('Go', panel, 272, 70);
        go.setPosition(170, -176, 2);
        artwork('Artwork', go, RESOURCE_PATHS.characterUi.confirmButton, 258, 57, 0, 0);
        this.actionText = label('Text', go, '', 24, 240, 52, 0, 0, 'semibold');
        this.actionText.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.action = go.getComponent(Button)!;
        this.motion.bindButton(go, () => this.action?.interactable === true);
        go.on(Button.EventType.CLICK, () => this.go());
        this.offState = platformEngagement()?.subscribe(state => this.render(state)) ?? null;
    }

    show(): void {
        const service = platformEngagement();
        if (!this.root?.isValid || !service?.state.supported || this.motion?.showing) return;
        service.report('sidebar_guide_click', { entry: 'lobby' });
        this.setPresented(true);
        this.motion?.show();
        this.render(service.state);
    }

    hide(): void {
        this.motion?.hide(() => this.setPresented(false));
    }

    dispose(): void {
        this.offState?.(); this.offState = null;
        this.motion?.dispose(); this.motion = null;
        this.setPresented(false);
        if (this.root?.isValid) this.root.destroy();
        this.root = null;
    }

    private go(): void {
        const service = platformEngagement();
        if (!service || !this.motion?.interactive || !this.action?.interactable) return;
        if (service.state.returned) { this.hide(); return; }
        // 导航立即隐藏并恢复预览，不等待 Tween；避免后台暂停导致遮罩残留。
        this.motion.hideImmediately();
        this.setPresented(false);
        void service.navigateSidebar().then(result => {
            if (!this.root?.isValid) return;
            if (result === 'failed' || result === 'unavailable') {
                showToast(this.root.parent!, '暂时无法跳转侧边栏，请稍后再试');
            }
        });
    }

    private render(state: SidebarState): void {
        if (!this.root?.isValid || !this.root.active || !this.status || !this.actionText || !this.action) return;
        const text = state.returned ? '已确认从侧边栏进入游戏' : '从侧边栏返回后，这里会显示复访完成';
        const action = state.returned ? '知道了' : state.navigating ? '正在跳转' : '去首页侧边栏';
        if (this.status.string !== text) this.status.string = text;
        if (this.actionText.string !== action) this.actionText.string = action;
        const enabled = state.supported && !state.navigating;
        if (this.action.interactable !== enabled) this.action.interactable = enabled;
    }

    private setPresented(presented: boolean): void {
        if (this.presented === presented) return;
        this.presented = presented;
        this.onPresentedChanged(presented);
    }
}

function artwork(name: string, parent: Node, path: string, width: number, height: number, x: number, y: number): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, 0);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
    loadAvatarUiSpriteFrame(path, frame => { if (frame && node.isValid && sprite.isValid) sprite.spriteFrame = frame; });
    return node;
}

function label(name: string, parent: Node, text: string, size: number, width: number, height: number,
    x: number, y: number, weight: 'regular' | 'semibold' = 'regular'): Label {
    const node = makeLabel(name, parent, text, size, uiColor(13, 39, 76, 255));
    const result = node.getComponent(Label)!;
    result.overflow = Label.Overflow.SHRINK;
    result.horizontalAlign = Label.HorizontalAlign.LEFT;
    styleProjectUiLabel(result, weight, size + 8);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, 2);
    return result;
}
