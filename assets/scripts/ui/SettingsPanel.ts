// Authored settings popup sharing the avatar-picker modal language. The stable
// hierarchy is mounted once; reopening only resets draft values and visibility.

import {
    BlockInputEvents,
    Label,
    Node,
    Sprite,
    UITransform,
} from 'cc';
import { SettingsManager } from '../app/SettingsManager';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { styleProjectUiLabel } from './ProjectUiFonts';
import {
    DragSlider,
    fitFullScreenBackgroundCover,
    makeDragSlider,
    makeLabel,
    makeRect,
    makeTouchArea,
    makeUiNode,
    uiColor,
} from './RuntimeUiFactory';

type VolumeRow = {
    slider: DragSlider;
    valueLabel: Label;
};

const PANEL_Y = 27;
const PANEL_HEIGHT = 376;
const ACTION_Y = -186;

export class SettingsPanel {
    private _root: Node | null = null;
    private _musicRow: VolumeRow | null = null;
    private _sfxRow: VolumeRow | null = null;
    private _initialMusic = 0.8;
    private _initialSfx = 0.8;
    private _draftMusic = 0.8;
    private _draftSfx = 0.8;

    build(parent: Node, designWidth: number, designHeight: number): Node {
        if (this._root?.isValid) return this._root;

        const root = makeUiNode('SettingsPanel', parent);
        root.getComponent(UITransform)!.setContentSize(designWidth, designHeight);
        root.active = false;
        this._root = root;

        const dim = makeRect('Dim', root, designWidth, designHeight, uiColor(2, 20, 38, 174));
        fitFullScreenBackgroundCover(dim, designWidth, designHeight);
        dim.on(Node.EventType.TOUCH_END, () => this.cancel());

        const panel = makeArtwork(
            'Panel', root, RESOURCE_PATHS.avatarPickerUi.panel,
            696, PANEL_HEIGHT, 0, PANEL_Y,
        );
        panel.addComponent(BlockInputEvents);

        const title = makeLabel('Title', panel, '音量设置', 30, uiColor(13, 39, 76, 255));
        styleProjectUiLabel(title.getComponent(Label)!, 'semibold', 38);
        title.getComponent(UITransform)!.setContentSize(300, 44);
        title.setPosition(0, 136, 1);

        const subtitle = makeLabel(
            'Subtitle', panel, '调整音乐与比赛音效音量', 18, uiColor(76, 104, 166, 255),
        );
        styleProjectUiLabel(subtitle.getComponent(Label)!, 'regular', 26);
        subtitle.getComponent(UITransform)!.setContentSize(420, 32);
        subtitle.setPosition(0, 100, 1);

        this._musicRow = this.buildVolumeRow(
            panel, '音乐', '背景音乐', 34,
            (volume) => {
                this._draftMusic = volume;
                SettingsManager.previewMusicVolume(volume);
            },
        );
        this._sfxRow = this.buildVolumeRow(
            panel, '音效', '划水与反馈音效', -48,
            (volume) => {
                this._draftSfx = volume;
                SettingsManager.previewSfxVolume(volume);
            },
        );

        const hint = makeLabel('Hint', panel, '拖动滑块调节，0% 为静音', 15, uiColor(111, 130, 172, 255));
        styleProjectUiLabel(hint.getComponent(Label)!, 'regular', 22);
        hint.getComponent(UITransform)!.setContentSize(420, 28);
        hint.setPosition(0, -96, 1);

        this.buildActions(panel);
        return root;
    }

    show(): void {
        if (!this._root?.isValid || !this._musicRow || !this._sfxRow) return;
        this._initialMusic = SettingsManager.musicVolume;
        this._initialSfx = SettingsManager.sfxVolume;
        this._draftMusic = this._initialMusic;
        this._draftSfx = this._initialSfx;
        this.updateRow(this._musicRow, this._draftMusic);
        this.updateRow(this._sfxRow, this._draftSfx);
        if (!this._root.active) this._root.active = true;
    }

    hide(): void {
        if (this._root?.isValid && this._root.active) this._root.active = false;
    }

    dispose(): void {
        if (this._root?.isValid) this._root.destroy();
        this._root = null;
        this._musicRow = null;
        this._sfxRow = null;
    }

    private buildVolumeRow(
        parent: Node,
        title: string,
        description: string,
        y: number,
        onChange: (volume: number) => void,
    ): VolumeRow {
        makeArtwork(
            `${title}Row`, parent, RESOURCE_PATHS.avatarPickerUi.nicknameRow,
            606, 68, 0, y,
        );

        const titleNode = makeLabel(`${title}Title`, parent, title, 22, uiColor(13, 39, 76, 255));
        const titleLabel = titleNode.getComponent(Label)!;
        styleProjectUiLabel(titleLabel, 'semibold', 30);
        titleLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        titleNode.getComponent(UITransform)!.setContentSize(168, 30);
        titleNode.setPosition(-210, y + 10, 2);

        const descriptionNode = makeLabel(
            `${title}Description`, parent, description, 14, uiColor(91, 111, 157, 255),
        );
        const descriptionLabel = descriptionNode.getComponent(Label)!;
        styleProjectUiLabel(descriptionLabel, 'regular', 20);
        descriptionLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        descriptionNode.getComponent(UITransform)!.setContentSize(168, 22);
        descriptionNode.setPosition(-210, y - 15, 2);

        let row: VolumeRow;
        const slider = makeDragSlider(`${title}Slider`, parent, 300, 14, 0.8, (ratio) => {
            const normalized = quantizeVolume(ratio);
            if (row.valueLabel.string !== formatVolume(normalized)) {
                row.valueLabel.string = formatVolume(normalized);
            }
            onChange(normalized);
        });
        slider.node.setPosition(36, y, 2);

        const valueNode = makeLabel(`${title}Value`, parent, '80%', 23, uiColor(13, 39, 76, 255));
        const valueLabel = valueNode.getComponent(Label)!;
        styleProjectUiLabel(valueLabel, 'semibold', 32);
        valueNode.getComponent(UITransform)!.setContentSize(76, 40);
        valueNode.setPosition(250, y, 2);

        row = { slider, valueLabel };
        return row;
    }

    private buildActions(panel: Node): void {
        const cancel = makeTouchArea('Cancel', panel, 272, 70);
        cancel.setPosition(-170, ACTION_Y, 2);
        makeArtwork(
            'Artwork', cancel, RESOURCE_PATHS.avatarPickerUi.cancelButton,
            258, 57, 0, 0,
        );
        const cancelText = makeLabel('Label', cancel, '取 消', 26, uiColor(13, 52, 82, 255));
        styleProjectUiLabel(cancelText.getComponent(Label)!, 'semibold', 34);
        cancelText.getComponent(UITransform)!.setContentSize(220, 52);
        cancelText.setPosition(0, 0, 1);
        cancel.on(Node.EventType.TOUCH_END, () => this.cancel());

        const confirm = makeTouchArea('Confirm', panel, 272, 70);
        confirm.setPosition(170, ACTION_Y, 2);
        makeArtwork(
            'Artwork', confirm, RESOURCE_PATHS.avatarPickerUi.confirmButton,
            258, 57, 0, 0,
        );
        const confirmText = makeLabel('Label', confirm, '保存设置', 26, uiColor(86, 55, 0, 255));
        styleProjectUiLabel(confirmText.getComponent(Label)!, 'semibold', 34);
        confirmText.getComponent(UITransform)!.setContentSize(220, 52);
        confirmText.setPosition(0, 0, 1);
        confirm.on(Node.EventType.TOUCH_END, () => this.confirm());
    }

    private updateRow(row: VolumeRow, volume: number): void {
        const normalized = quantizeVolume(volume);
        row.slider.setRatio(normalized);
        const text = formatVolume(normalized);
        if (row.valueLabel.string !== text) row.valueLabel.string = text;
    }

    private cancel(): void {
        if (this._draftMusic !== this._initialMusic) {
            SettingsManager.previewMusicVolume(this._initialMusic);
        }
        if (this._draftSfx !== this._initialSfx) {
            SettingsManager.previewSfxVolume(this._initialSfx);
        }
        this.hide();
    }

    private confirm(): void {
        SettingsManager.setVolumes(this._draftMusic, this._draftSfx);
        this.hide();
    }
}

function quantizeVolume(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function formatVolume(value: number): string {
    return `${Math.round(value * 100)}%`;
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
