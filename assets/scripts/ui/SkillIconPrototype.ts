import { Graphics, Node, UITransform } from 'cc';
import type { PlayerSkillIconKind } from '../app/PlayerCharacterConfig';
import { makeUiNode, uiColor } from './RuntimeUiFactory';

// Temporary vector badges shared by the character-select card and the in-race
// ultimate button. They are intentionally built once with the surrounding UI,
// then only the in-race charge ring is updated by UIController.
export function makeSkillIconPrototype(
    name: string,
    parent: Node,
    size: number,
    kind: PlayerSkillIconKind,
): Node {
    const root = makeUiNode(name, parent);
    root.getComponent(UITransform)!.setContentSize(size, size);

    const base = makeGraphicsNode('Base', root, size);
    drawSkillBadgeBase(base, size);
    const track = makeGraphicsNode('ChargeTrack', root, size + 5);
    drawSkillBadgeTrack(track, size + 5);
    const glyph = makeGraphicsNode('Glyph', root, size);
    drawSkillGlyph(glyph, kind);
    return root;
}

export function drawSkillBadgeBase(gfx: Graphics, size: number): void {
    const radius = size / 2 - 1;
    gfx.clear();
    gfx.fillColor = uiColor(12, 27, 44, 232);
    gfx.circle(0, 0, radius);
    gfx.fill();
    gfx.strokeColor = uiColor(91, 143, 169, 230);
    gfx.lineWidth = 1.5;
    gfx.circle(0, 0, radius);
    gfx.stroke();
}

export function drawSkillBadgeTrack(gfx: Graphics, size: number): void {
    const radius = size / 2 - 2;
    gfx.clear();
    gfx.strokeColor = uiColor(17, 78, 108, 245);
    gfx.lineWidth = 7;
    gfx.circle(0, 0, radius);
    gfx.stroke();
}

export function drawSkillGlyph(gfx: Graphics, kind: PlayerSkillIconKind): void {
    gfx.clear();
    switch (kind) {
    case 'shark':
        drawSharkGlyph(gfx);
        return;
    case 'charm':
        drawHeartGlyph(gfx);
        return;
    case 'dash':
        drawDashGlyph(gfx);
        return;
    case 'siren':
        drawSirenGlyph(gfx);
        return;
    }
}

function makeGraphicsNode(name: string, parent: Node, size: number): Graphics {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(size, size);
    return node.addComponent(Graphics);
}

function drawSharkGlyph(gfx: Graphics): void {
    gfx.fillColor = uiColor(99, 216, 246, 255);
    gfx.moveTo(-22, -2);
    gfx.quadraticCurveTo(-9, 12, 12, 5);
    gfx.lineTo(23, 0);
    gfx.lineTo(13, -5);
    gfx.quadraticCurveTo(-5, -13, -22, -2);
    gfx.close();
    gfx.fill();
    gfx.moveTo(-3, 5);
    gfx.lineTo(3, 21);
    gfx.lineTo(10, 4);
    gfx.close();
    gfx.fill();
    gfx.moveTo(-17, -3);
    gfx.lineTo(-26, -14);
    gfx.lineTo(-22, 2);
    gfx.close();
    gfx.fill();
    gfx.fillColor = uiColor(7, 37, 60, 255);
    gfx.circle(10, 1, 2);
    gfx.fill();
}

function drawHeartGlyph(gfx: Graphics): void {
    gfx.fillColor = uiColor(255, 116, 174, 255);
    gfx.moveTo(0, -16);
    gfx.bezierCurveTo(-20, -29, -30, 1, 0, 23);
    gfx.bezierCurveTo(30, 1, 20, -29, 0, -16);
    gfx.close();
    gfx.fill();
}

function drawDashGlyph(gfx: Graphics): void {
    gfx.strokeColor = uiColor(255, 223, 104, 255);
    gfx.lineWidth = 5;
    for (let index = 0; index < 3; index++) {
        const offset = -12 + index * 12;
        gfx.moveTo(-18, offset - 6);
        gfx.lineTo(2, offset);
        gfx.lineTo(-18, offset + 6);
    }
    gfx.stroke();
}

function drawSirenGlyph(gfx: Graphics): void {
    gfx.strokeColor = uiColor(182, 137, 255, 255);
    gfx.lineWidth = 4;
    gfx.circle(0, 0, 5);
    gfx.arc(0, 0, 13, -0.9, 0.9, false);
    gfx.arc(0, 0, 22, -0.9, 0.9, false);
    gfx.stroke();
}
