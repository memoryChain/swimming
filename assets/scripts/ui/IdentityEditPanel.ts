import {
    BlockInputEvents,
    Button,
    Label,
    Node,
    Sprite,
    UITransform,
} from 'cc';
import { AVATARS, generateRandomNickName } from '../backend/IdentityConfig';
import { PlayerData } from '../backend/PlayerData';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadAvatarSpriteFrame, loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { styleDynamicUiLabel, styleProjectUiLabel } from './ProjectUiFonts';
import {
    fitFullScreenBackgroundCover,
    makeLabel,
    makeRect,
    makeTouchArea,
    makeUiNode,
    uiColor,
} from './RuntimeUiFactory';

type AvatarView = {
    node: Node;
    button: Button;
};

const PANEL_Y = 27;
const AVATAR_X = [-200, -100, 0, 100, 200] as const;
const AVATAR_Y = [73, -27] as const;
const AVATAR_BASE_SIZE = 90;
// 圆底内径为原图的 72/86；略覆盖内缘，避免抗锯齿处漏出蓝线。
const AVATAR_ART_SIZE = 76;
const AVATAR_HIT_SIZE = 90;

export class IdentityEditPanel {
    private _root: Node | null = null;
    private _nicknameLabel: Label | null = null;
    private _selection: Node | null = null;
    private _confirmButton: Button | null = null;
    private _avatarViews = new Map<string, AvatarView>();
    private _selectedId: string | null = null;
    private _draftAvatarId: string = AVATARS[0].id;
    private _draftNickname = '';
    private _saving = false;

    build(parent: Node, designWidth: number, designHeight: number): Node {
        if (this._root?.isValid) return this._root;

        const root = makeUiNode('IdentityEdit', parent);
        root.getComponent(UITransform)!.setContentSize(designWidth, designHeight);
        root.active = false;
        this._root = root;

        const dim = makeRect('Dim', root, designWidth, designHeight, uiColor(2, 20, 38, 174));
        fitFullScreenBackgroundCover(dim, designWidth, designHeight);
        dim.on(Node.EventType.TOUCH_END, () => this.hide());

        const panel = makeArtwork(
            'Panel', root, RESOURCE_PATHS.avatarPickerUi.panel,
            696, 436, 0, PANEL_Y,
        );
        panel.addComponent(BlockInputEvents);

        const title = makeLabel('Title', panel, '选择头像', 30, uiColor(13, 39, 76, 255));
        const titleLabel = title.getComponent(Label)!;
        styleProjectUiLabel(titleLabel, 'semibold', 38);
        title.getComponent(UITransform)!.setContentSize(300, 44);
        title.setPosition(0, 160, 1);

        this.buildAvatarGrid(panel);
        this.buildNicknameRow(panel);
        this.buildActions(panel);
        return root;
    }

    show(): void {
        if (!this._root?.isValid) return;
        this._draftAvatarId = AVATARS.some((option) => option.id === PlayerData.avatarId)
            ? PlayerData.avatarId
            : AVATARS[0].id;
        this._draftNickname = PlayerData.nickName;
        this.setNicknameLabel(this._draftNickname);
        this.updateSelection(this._draftAvatarId);
        if (!this._root.active) this._root.active = true;
    }

    hide(): void {
        if (this._saving || !this._root?.isValid) return;
        if (this._root.active) this._root.active = false;
    }

    dispose(): void {
        if (this._root?.isValid) this._root.destroy();
        this._root = null;
        this._nicknameLabel = null;
        this._selection = null;
        this._confirmButton = null;
        this._avatarViews.clear();
        this._selectedId = null;
        this._saving = false;
    }

    private buildAvatarGrid(panel: Node): void {
        for (let i = 0; i < AVATARS.length; i++) {
            const option = AVATARS[i];
            const x = AVATAR_X[i % AVATAR_X.length];
            const y = AVATAR_Y[Math.floor(i / AVATAR_X.length)];
            const node = makeTouchArea(`Avatar_${option.id}`, panel, AVATAR_HIT_SIZE, AVATAR_HIT_SIZE);
            node.setPosition(x, y, 1);
            const button = node.getComponent(Button)!;

            makeArtwork(
                'Base', node, RESOURCE_PATHS.avatarPickerUi.avatarBase,
                AVATAR_BASE_SIZE, AVATAR_BASE_SIZE, 0, 0,
            );
            const portraitNode = makeUiNode('Portrait', node);
            portraitNode.getComponent(UITransform)!.setContentSize(AVATAR_ART_SIZE, AVATAR_ART_SIZE);
            const portrait = portraitNode.addComponent(Sprite);
            portrait.sizeMode = Sprite.SizeMode.CUSTOM;
            portrait.trim = false;
            loadAvatarSpriteFrame(option.id, (frame) => {
                if (frame && portrait.isValid && portraitNode.isValid && portrait.spriteFrame !== frame) {
                    portrait.spriteFrame = frame;
                }
            });

            node.on(Node.EventType.TOUCH_END, () => this.selectAvatar(option.id));
            this._avatarViews.set(option.id, { node, button });
        }

        const selection = makeUiNode('Selection', panel);
        selection.getComponent(UITransform)!.setContentSize(108, 108);
        makeArtwork(
            'Ring', selection, RESOURCE_PATHS.avatarPickerUi.selectedRing,
            103, 103, 0, 0,
        );
        makeArtwork(
            'Check', selection, RESOURCE_PATHS.avatarPickerUi.selectedCheck,
            40, 40, 34, -33,
        );
        this._selection = selection;
    }

    private buildNicknameRow(panel: Node): void {
        makeArtwork(
            'NicknameRow', panel, RESOURCE_PATHS.avatarPickerUi.nicknameRow,
            628, 58, 0, -131,
        );
        makeArtwork(
            'NicknameField', panel, RESOURCE_PATHS.avatarPickerUi.nicknameField,
            330, 44, -55, -131,
        );

        const caption = makeLabel('NicknameCaption', panel, '昵称', 20, uiColor(57, 83, 148, 255));
        const captionLabel = caption.getComponent(Label)!;
        styleProjectUiLabel(captionLabel, 'semibold', 28);
        caption.getComponent(UITransform)!.setContentSize(58, 44);
        caption.setPosition(-266, -131, 2);

        const nickname = makeLabel('Nickname', panel, '', 20, uiColor(13, 39, 76, 255));
        const nicknameLabel = nickname.getComponent(Label)!;
        styleDynamicUiLabel(nicknameLabel, 28);
        nicknameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        nicknameLabel.overflow = Label.Overflow.SHRINK;
        nickname.getComponent(UITransform)!.setContentSize(290, 44);
        nickname.setPosition(-55, -131, 2);
        this._nicknameLabel = nicknameLabel;

        const random = makeTouchArea('RandomNickname', panel, 156, 48);
        random.setPosition(209, -131, 2);
        makeArtwork(
            'Icon', random, RESOURCE_PATHS.avatarPickerUi.refreshIcon,
            43, 36, -48, 0,
        );
        const randomText = makeLabel('Label', random, '随机昵称', 18, uiColor(75, 115, 224, 255));
        const randomLabel = randomText.getComponent(Label)!;
        styleProjectUiLabel(randomLabel, 'semibold', 26);
        randomText.getComponent(UITransform)!.setContentSize(100, 40);
        randomText.setPosition(27, 0, 1);
        random.on(Node.EventType.TOUCH_END, () => this.randomizeNickname());
    }

    private buildActions(panel: Node): void {
        const cancel = makeTouchArea('Cancel', panel, 272, 70);
        cancel.setPosition(-170, -216, 2);
        makeArtwork(
            'Artwork', cancel, RESOURCE_PATHS.avatarPickerUi.cancelButton,
            258, 57, 0, 0,
        );
        const cancelText = makeLabel('Label', cancel, '取 消', 26, uiColor(13, 52, 82, 255));
        styleProjectUiLabel(cancelText.getComponent(Label)!, 'semibold', 34);
        cancelText.getComponent(UITransform)!.setContentSize(220, 52);
        cancelText.setPosition(0, 0, 1);
        cancel.on(Node.EventType.TOUCH_END, () => this.hide());

        const confirm = makeTouchArea('Confirm', panel, 272, 70);
        confirm.setPosition(170, -216, 2);
        makeArtwork(
            'Artwork', confirm, RESOURCE_PATHS.avatarPickerUi.confirmButton,
            258, 57, 0, 0,
        );
        const confirmText = makeLabel('Label', confirm, '确认使用', 26, uiColor(86, 55, 0, 255));
        styleProjectUiLabel(confirmText.getComponent(Label)!, 'semibold', 34);
        confirmText.getComponent(UITransform)!.setContentSize(220, 52);
        confirmText.setPosition(0, 0, 1);
        confirm.on(Node.EventType.TOUCH_END, () => { void this.confirm(); });
        this._confirmButton = confirm.getComponent(Button)!;
    }

    private selectAvatar(avatarId: string): void {
        if (this._saving || avatarId === this._selectedId) return;
        this._draftAvatarId = avatarId;
        this.updateSelection(avatarId);
    }

    private updateSelection(avatarId: string): void {
        if (avatarId === this._selectedId) return;
        if (this._selectedId) {
            const previous = this._avatarViews.get(this._selectedId);
            if (previous && !previous.button.interactable) previous.button.interactable = true;
        }
        const next = this._avatarViews.get(avatarId);
        if (!next) return;
        if (next.button.interactable) next.button.interactable = false;
        const position = next.node.position;
        if (this._selection?.isValid) {
            this._selection.setPosition(position.x, position.y, 3);
        }
        this._selectedId = avatarId;
    }

    private randomizeNickname(): void {
        if (this._saving) return;
        this._draftNickname = generateRandomNickName();
        this.setNicknameLabel(this._draftNickname);
    }

    private setNicknameLabel(value: string): void {
        if (this._nicknameLabel?.isValid && this._nicknameLabel.string !== value) {
            this._nicknameLabel.string = value;
        }
    }

    private async confirm(): Promise<void> {
        if (this._saving) return;
        this._saving = true;
        if (this._confirmButton?.isValid && this._confirmButton.interactable) {
            this._confirmButton.interactable = false;
        }
        try {
            const patch: { avatarId?: string; nickName?: string } = {};
            if (this._draftAvatarId !== PlayerData.avatarId) patch.avatarId = this._draftAvatarId;
            if (this._draftNickname !== PlayerData.nickName) patch.nickName = this._draftNickname;
            if (patch.avatarId || patch.nickName) await PlayerData.setIdentity(patch);
            if (this._root?.isValid && this._root.active) this._root.active = false;
        } catch (error) {
            console.warn('[AvatarUI] 保存头像资料失败', error);
        } finally {
            this._saving = false;
            if (this._confirmButton?.isValid && !this._confirmButton.interactable) {
                this._confirmButton.interactable = true;
            }
        }
    }
}

function makeArtwork(
    name: string,
    parent: Node,
    path: string,
    width: number,
    height: number,
    x: number,
    y: number,
): Node {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(width, height);
    node.setPosition(x, y, 0);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    loadAvatarUiSpriteFrame(path, (frame) => {
        if (frame && node.isValid && sprite.isValid && sprite.spriteFrame !== frame) {
            sprite.spriteFrame = frame;
        }
    });
    return node;
}
