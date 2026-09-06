// Appearance popup: pick skin tone + outfit color directly from a swatch grid.
// Built in code (no prefab); opened from the prepare-race 外观 button. Mirrors
// the SettingsPanel modal pattern (UILayer.Popup + dim tap-to-close).

import { Button, Graphics, Node, UITransform } from 'cc';
import {
    PLAYER_COLOR_SCHEMES,
    PLAYER_SKIN_TONES,
    selectedPlayerColorScheme,
    selectedPlayerCharacterSupportsSkinTone,
    selectedPlayerSkinTone,
    setPlayerColorScheme,
    setPlayerSkinTone,
} from '../app/PlayerCharacterConfig';
import { fitFullScreenBackgroundCover, makeButton, makeLabel, makeRect, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { getUILayer, UILayer } from './UILayers';
import { UI_STYLE } from './UIStyle';

const SWATCH_SIZE = 48;
const SWATCH_PITCH = 60;

type SwatchOption = { id: string; color: readonly [number, number, number] };

export type AppearancePanelOptions = {
    // Called whenever a choice changes so the caller can refresh the 3D preview
    // and the on-screen color indicator.
    onChange?: () => void;
};

// Opens a modal appearance picker in the Popup layer. Re-opening destroys the
// previous panel first, so only one instance is ever shown.
export function openAppearancePanel(canvasNode: Node, designWidth: number, designHeight: number, options: AppearancePanelOptions = {}): void {
    const popup = getUILayer(canvasNode, UILayer.Popup);
    popup.getChildByName('AppearancePanel')?.destroy();
    const root = makeUiNode('AppearancePanel', popup);

    const dim = makeRect('Dim', root, designWidth, designHeight, uiColor(2, 8, 14, 200));
    fitFullScreenBackgroundCover(dim);
    dim.on(Node.EventType.TOUCH_END, () => root.destroy());

    const perRow = 4;
    const rows = Math.ceil(PLAYER_COLOR_SCHEMES.length / perRow);
    const panelHeight = Math.max(360, rows * SWATCH_PITCH + 240);
    const panel = makeRoundedRect('Panel', root, 460, panelHeight, uiColor(14, 36, 58, 250), 16, uiColor(86, 196, 236, 90), 1.5);
    makeLabel('Title', panel, '外观', 30, uiColor(240, 250, 255)).setPosition(0, panelHeight / 2 - 42, 1);

    const swatches: { node: Node; option: SwatchOption; group: 'skin' | 'color'; selected?: boolean }[] = [];
    const refresh = () => {
        const skinId = selectedPlayerSkinTone().id;
        const colorId = selectedPlayerColorScheme().id;
        for (const entry of swatches) {
            const selected = entry.group === 'skin' ? entry.option.id === skinId : entry.option.id === colorId;
            if (entry.selected === selected) continue;
            entry.selected = selected;
            const gfx = entry.node.getComponent(Graphics);
            if (gfx) drawSwatch(gfx, entry.option.color, selected);
        }
    };

    const skinSupported = selectedPlayerCharacterSupportsSkinTone();
    const skinY = panelHeight / 2 - 104;
    const colorY = skinSupported ? skinY - 92 - (rows - 1) * SWATCH_PITCH / 2 : 20;

    if (skinSupported) {
        makeLabel('SkinLabel', panel, '肤色', 22, UI_STYLE.cyan).setPosition(-150, skinY, 1);
        const host = makeUiNode('SkinSwatches', panel);
        host.setPosition(40, skinY, 1);
        PLAYER_SKIN_TONES.forEach((tone, index) => {
            const option: SwatchOption = { id: tone.id, color: tone.color };
            const x = (index - (PLAYER_SKIN_TONES.length - 1) / 2) * SWATCH_PITCH;
            const node = makeColorSwatch(host, option, x, 0);
            swatches.push({ node, option, group: 'skin' });
            node.on(Button.EventType.CLICK, () => {
                if (selectedPlayerSkinTone().id === tone.id) return;
                setPlayerSkinTone(tone.id);
                refresh();
                options.onChange?.();
            });
        });
    }

    makeLabel('ColorLabel', panel, '服装', 22, UI_STYLE.cyan).setPosition(-150, colorY, 1);
    const colorHost = makeUiNode('ColorSwatches', panel);
    colorHost.setPosition(40, colorY, 1);
    PLAYER_COLOR_SCHEMES.forEach((scheme, index) => {
        const option: SwatchOption = { id: scheme.id, color: scheme.suit };
        const col = index % perRow;
        const row = Math.floor(index / perRow);
        const x = (col - (perRow - 1) / 2) * SWATCH_PITCH;
        const y = -(row - (rows - 1) / 2) * SWATCH_PITCH;
        const node = makeColorSwatch(colorHost, option, x, y);
        swatches.push({ node, option, group: 'color' });
        node.on(Button.EventType.CLICK, () => {
            if (selectedPlayerColorScheme().id === scheme.id) return;
            setPlayerColorScheme(scheme.id);
            refresh();
            options.onChange?.();
        });
    });

    refresh();

    const close = makeButton('CloseButton', panel, 140, 48, UI_STYLE.panel, '完成');
    close.setPosition(0, -panelHeight / 2 + 40, 2);
    close.on(Button.EventType.CLICK, () => root.destroy());
}

function makeColorSwatch(parent: Node, option: SwatchOption, x: number, y: number): Node {
    const node = makeUiNode(`Swatch_${option.id}`, parent);
    node.getComponent(UITransform)!.setContentSize(SWATCH_SIZE, SWATCH_SIZE);
    node.setPosition(x, y, 1);
    const gfx = node.addComponent(Graphics);
    const button = node.addComponent(Button);
    button.target = node;
    button.transition = Button.Transition.NONE;
    drawSwatch(gfx, option.color, false);
    return node;
}

function drawSwatch(gfx: Graphics, color: readonly [number, number, number], selected: boolean): void {
    const half = SWATCH_SIZE / 2;
    gfx.clear();
    gfx.fillColor = uiColor(color[0], color[1], color[2], 255);
    gfx.roundRect(-half, -half, SWATCH_SIZE, SWATCH_SIZE, 10);
    gfx.fill();
    if (selected) {
        gfx.lineWidth = 3;
        gfx.strokeColor = UI_STYLE.cyan;
        gfx.roundRect(-half + 2, -half + 2, SWATCH_SIZE - 4, SWATCH_SIZE - 4, 8);
        gfx.stroke();
    }
}
