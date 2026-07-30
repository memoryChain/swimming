// Settings popup with music / SFX volume sliders (zero mutes). Built in code (no
// prefab); opened from the headbar settings button on non-race screens.

import { Camera, Label, Node, UITransform } from 'cc';
import { makeDragSlider, makeLabel, makeRect, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { getUILayer, UILayer } from './UILayers';
import { SettingsManager } from '../app/SettingsManager';

export function openSettingsPanel(canvasNode: Node, designWidth: number, designHeight: number): void {
    const popup = getUILayer(canvasNode, UILayer.Popup);
    popup.getChildByName('SettingsPanel')?.destroy();
    const root = makeUiNode('SettingsPanel', popup);

    const dim = makeRect('Dim', root, designWidth, designHeight, uiColor(2, 8, 14, 200));
    dim.on(Node.EventType.TOUCH_END, () => root.destroy());

    const panel = makeRoundedRect('Panel', root, 520, 340, uiColor(14, 36, 58, 250), 16, uiColor(86, 196, 236, 90), 1.5);
    makeLabel('Title', panel, '设置', 30, uiColor(240, 250, 255)).setPosition(0, 126, 1);

    const camera = canvasNode.getChildByName('Camera')?.getComponent(Camera) ?? null;

    buildVolumeRow(panel, '音乐', SettingsManager.musicVolume, 40, camera, (v) => SettingsManager.setMusicVolume(v));
    buildVolumeRow(panel, '音效', SettingsManager.sfxVolume, -46, camera, (v) => SettingsManager.setSfxVolume(v));
}

function buildVolumeRow(
    parent: Node,
    label: string,
    initial: number,
    y: number,
    camera: Camera | null,
    onChange: (volume: number) => void,
): void {
    const nameNode = makeLabel('Name', parent, label, 24, uiColor(240, 250, 255));
    nameNode.getComponent(UITransform)!.setContentSize(100, 40);
    nameNode.setPosition(-176, y, 1);

    let valueLabel: Label;
    const slider = makeDragSlider('Slider', parent, 220, 12, initial, (ratio) => {
        valueLabel.string = `${Math.round(ratio * 100)}`;
        onChange(ratio);
    }, camera);
    slider.node.setPosition(20, y, 1);

    const valueNode = makeLabel('Value', parent, `${Math.round(initial * 100)}`, 20, uiColor(200, 220, 240));
    valueNode.getComponent(UITransform)!.setContentSize(56, 32);
    valueNode.setPosition(196, y, 1);
    valueLabel = valueNode.getComponent(Label)!;
}