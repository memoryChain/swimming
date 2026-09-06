// Character stats popup: a scrollable table of the selected character's
// attributes, separating fixed traits from level-growth ones and showing what
// each one affects in race terms. Below the table, an "operation-driven" section
// explains systems (heart rate, stroke quality, energy) that are decided by the
// player's input rather than character aptitude. Built in code (no prefab).

import { Button, Color, Graphics, Label, Mask, Node, ScrollView, UITransform } from 'cc';
import { findPlayerCharacter, getPlayerCharacterSelection, weightToPhysicalRating } from '../app/PlayerCharacterConfig';
import { getProgressionManager } from '../progression/ProgressionManager';
import { PROGRESSION_BALANCE } from '../progression/ProgressionBalance';
import { resolvePlayerBalance } from '../progression/PlayerBalanceOverrides';
import { energyGainMultiplier } from '../core/UltimateEnergyBalance';
import { fitFullScreenBackgroundCover, makeButton, makeLabel, makeRect, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { getUILayer, UILayer } from './UILayers';
import { UI_STYLE } from './UIStyle';

const PANEL_W = 760;
const PANEL_H = 720;
const TABLE_W = 680;
const COL = { name: 100, apt: 90, cur: 130, max: 130, effect: 230 };
const LINE_H = 28;
const ROW_PAD_V = 12;
const HEADER_H = 44;

function rowHeight(lines: number): number {
    return lines * LINE_H + ROW_PAD_V * 2;
}

const MECH_HEADING_H = 36;
const MECH_TITLE_H = 28;
const MECH_LINE_H = 24;
const MECH_ITEM_GAP = 14;
const MECH_TOP_GAP = 28;
const MECH_BOTTOM_PAD = 20;

type MechanicsItem = {
    title: string;
    lines: string[];
};

const MECHANICS_ITEMS: MechanicsItem[] = [
    {
        title: '心率',
        lines: [
            '由划水按压力度与节奏驱动：持续用力划水升高，停顿回落，不受角色资质影响。',
            '心率区间缩放完美松手窗口的宽度（不影响推力大小）：',
            '最佳区 110-150：窗口最宽(×1.125)，最容易打出完美；',
            '低区 0-110：窗口偏窄(×0.85)，但体能回复最快；',
            '高压区 150-175：接近常态(×1.025)；',
            '过载区 175-200：窗口收窄(×0.925)，体能消耗最大。',
        ],
    },
    {
        title: '划水质量',
        lines: [
            '松手时机决定：完美窗口中心=完美(满额推力)，良好窗口=良好(按比例)，失误=无推力。',
            '连击只影响比赛结算金币，不叠加推力；推力大小受技巧资质影响，但时机纯靠操作。',
        ],
    },
    {
        title: '体能消耗',
        lines: [
            '每次划水按心率区间消耗体能，冲刺消耗×1.6~2.5；停顿按心率回复，低区最快。',
            '体能影响推进效率(不影响划水质量)，最后10%急降；体能池上限由体力资质与等级决定。',
        ],
    },
    {
        title: '蓄气（大招能量）',
        lines: [
            '赛内 0-100 临时资源，每局重置为零。被动每秒缓慢增长（保底），PERFECT/GOOD 划水额外积攒，连续 PERFECT 有连击奖励。',
            '被撞飞会补偿能量；蓄满 100 点可释放全角色共用的海豚跳大招，释放后清空。',
            '积攒速率受蓄气资质影响（±15%），但能量的获取与花费都由操作决定，不随等级成长。',
        ],
    },
];

export function openCharacterStatsPanel(canvasNode: Node, designWidth: number, designHeight: number): void {
    const popup = getUILayer(canvasNode, UILayer.Popup);
    popup.getChildByName('CharacterStatsPanel')?.destroy();
    const root = makeUiNode('CharacterStatsPanel', popup);

    const dim = makeRect('Dim', root, designWidth, designHeight, uiColor(2, 8, 14, 200));
    fitFullScreenBackgroundCover(dim);
    dim.on(Node.EventType.TOUCH_END, () => root.destroy());

    const panel = makeRoundedRect('Panel', root, PANEL_W, PANEL_H, uiColor(14, 36, 58, 252), 18, uiColor(86, 196, 236, 110), 2);
    makeLabel('Title', panel, '角色属性', 34, UI_STYLE.white).setPosition(0, PANEL_H / 2 - 44, 1);

    const character = findPlayerCharacter(getPlayerCharacterSelection().characterId);
    if (!character) {
        root.destroy();
        return;
    }

    const progression = getProgressionManager();
    const level = progression.getCharacterLevel(character.id);
    const maxLevel = PROGRESSION_BALANCE.maxLevel;
    const stats = { stamina: character.stamina, technique: character.technique, burst: character.burst, kick: character.kick };
    const current = resolvePlayerBalance(stats, level, maxLevel, character.weight, character.energyGain, character.kick);
    const atMax = resolvePlayerBalance(stats, maxLevel, maxLevel, character.weight, character.energyGain, character.kick);

    const subtitle = makeLabel('Subtitle', panel, `${character.name}　Lv.${level}${level >= maxLevel ? '（满级）' : ''}`, 22, uiColor(150, 200, 255));
    subtitle.setPosition(0, PANEL_H / 2 - 84, 1);

    const viewTop = PANEL_H / 2 - 112;
    const viewBottom = -PANEL_H / 2 + 80;
    const viewH = viewTop - viewBottom;
    const viewNode = makeUiNode('StatsScrollView', panel);
    viewNode.getComponent(UITransform)!.setContentSize(TABLE_W, viewH);
    viewNode.setPosition(0, (viewTop + viewBottom) / 2, 1);
    const scrollView = viewNode.addComponent(ScrollView);
    scrollView.horizontal = false;
    scrollView.vertical = true;
    scrollView.inertia = true;
    scrollView.elastic = true;
    scrollView.brake = 0.5;
    scrollView.cancelInnerEvents = true;
    const mask = viewNode.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_RECT;
    mask.inverted = false;

    const rows = buildRows(character, current, atMax);
    const tableH = HEADER_H + rows.reduce((sum, row) => sum + rowHeight(row.lines.length), 0);
    const mechanicsItemsH = MECHANICS_ITEMS.reduce((sum, item) =>
        sum + MECH_TITLE_H + item.lines.length * MECH_LINE_H + MECH_ITEM_GAP, 0);
    const mechanicsH = MECH_TOP_GAP + MECH_HEADING_H + mechanicsItemsH + MECH_BOTTOM_PAD;
    const contentH = tableH + mechanicsH;
    const content = makeUiNode('StatsContent', viewNode);
    content.getComponent(UITransform)!.setContentSize(TABLE_W, contentH);
    scrollView.content = content;

    renderTable(content, rows, contentH);
    renderMechanicsSection(content, contentH / 2 - tableH - MECH_TOP_GAP);

    const note1 = makeLabel('Note1', panel, `体力为先天资质（0-100），决定赛中体能池上限；体能为赛中实际值，由资质与等级折算。等级通过花费金币提升，满级 ${maxLevel}。`, 16, UI_STYLE.muted);
    note1.getComponent(UITransform)!.setContentSize(TABLE_W - 20, 28);
    note1.getComponent(Label)!.overflow = Label.Overflow.SHRINK;
    note1.setPosition(0, -PANEL_H / 2 + 60, 1);

    const close = makeButton('CloseButton', panel, 160, 52, UI_STYLE.panelAlt, '关闭');
    close.setPosition(0, -PANEL_H / 2 + 30, 2);
    close.on(Button.EventType.CLICK, () => root.destroy());
}

type StatLine = {
    label: string;
    current: string;
    max: string;
};

type StatRow = {
    name: string;
    aptitude: string;
    lines: StatLine[];
};

function buildRows(
    character: ReturnType<typeof findPlayerCharacter> & {},
    current: ReturnType<typeof resolvePlayerBalance>,
    atMax: ReturnType<typeof resolvePlayerBalance>,
): StatRow[] {
    return [
        {
            name: '体力',
            aptitude: `${character.stamina}`,
            lines: [{ label: '体能池上限', current: fmt(current.energyTotal, 1), max: fmt(atMax.energyTotal, 1) }],
        },
        {
            name: '技巧',
            aptitude: `${character.technique}`,
            lines: [
                { label: '划水推力', current: fmt(current.strokeQualityAccel, 2), max: fmt(atMax.strokeQualityAccel, 2) },
                { label: '超速上限', current: fmt(current.perfectComboMaxOvercap, 2), max: fmt(atMax.perfectComboMaxOvercap, 2) },
            ],
        },
        {
            name: '爆发力',
            aptitude: `${character.burst}`,
            lines: [
                { label: '最大游速', current: fmt(current.maxSpeed, 2), max: fmt(atMax.maxSpeed, 2) },
                { label: '出发速度', current: fmt(current.diveMaxLaunchSpeed, 2), max: fmt(atMax.diveMaxLaunchSpeed, 2) },
            ],
        },
        {
            name: '踢腿',
            aptitude: `${character.kick}`,
            lines: [{ label: '踢腿速度上限', current: fmt(current.kickMaxSpeed, 2), max: fmt(atMax.kickMaxSpeed, 2) }],
        },
        {
            name: '体重',
            aptitude: `${weightToPhysicalRating(character.weight)}`,
            lines: [{ label: `对抗（体重 ${character.weight}）`, current: '固定', max: '固定' }],
        },
        {
            name: '蓄气',
            aptitude: `${character.energyGain}`,
            lines: [{ label: `大招积攒 ×${energyGainMultiplier(character.energyGain).toFixed(2)}`, current: '固定', max: '固定' }],
        },
    ];
}

function renderTable(content: Node, rows: StatRow[], contentH: number): void {
    const colX = getColumnX();
    let cursorY = contentH / 2;

    const headerBg = makeRect('HeaderBg', content, TABLE_W, HEADER_H, uiColor(20, 70, 110, 200));
    headerBg.setPosition(0, cursorY - HEADER_H / 2, 0);
    header(content, '属性', colX.name, cursorY - HEADER_H / 2);
    header(content, '资质', colX.apt, cursorY - HEADER_H / 2);
    header(content, '当前', colX.cur, cursorY - HEADER_H / 2);
    header(content, '满级', colX.max, cursorY - HEADER_H / 2);
    header(content, '作用', colX.effect, cursorY - HEADER_H / 2);
    cursorY -= HEADER_H;

    rows.forEach((row, i) => {
        const h = rowHeight(row.lines.length);
        const rowCenterY = cursorY - h / 2;
        if (i % 2 === 1) {
            const zebra = makeRect(`RowBg${i}`, content, TABLE_W, h, uiColor(255, 255, 255, 10));
            zebra.setPosition(0, rowCenterY, 0);
        }
        centeredCell(content, row.name, colX.name, rowCenterY, h, COL.name - 8, UI_STYLE.white, 20);
        centeredCell(content, row.aptitude, colX.apt, rowCenterY, h, COL.apt - 8, uiColor(255, 210, 120, 255), 19);
        row.lines.forEach((line, li) => {
            const lineY = rowCenterY + (row.lines.length - 1 - 2 * li) * LINE_H / 2;
            centeredCell(content, line.current, colX.cur, lineY, LINE_H, COL.cur - 8, uiColor(150, 220, 170, 255), 18);
            centeredCell(content, line.max, colX.max, lineY, LINE_H, COL.max - 8, uiColor(120, 200, 255, 255), 18);
            centeredCell(content, line.label, colX.effect, lineY, LINE_H, COL.effect - 12, UI_STYLE.faint, 17);
        });
        cursorY -= h;
    });

    const sepGfx = content.addComponent(Graphics);
    sepGfx.strokeColor = uiColor(86, 196, 236, 50);
    sepGfx.lineWidth = 1;
    const seps = [colX.name + COL.name / 2, colX.apt + COL.apt / 2, colX.cur + COL.cur / 2, colX.max + COL.max / 2];
    const tableBottom = cursorY;
    for (const x of seps) {
        sepGfx.moveTo(x, contentH / 2);
        sepGfx.lineTo(x, tableBottom);
    }
    sepGfx.stroke();
}

function renderMechanicsSection(content: Node, topY: number): void {
    let y = topY;
    addLeftLabel(content, 'MechHeading', '【操作相关】由你的操作决定，不受角色资质影响', 20, UI_STYLE.cyan, y);
    y -= MECH_HEADING_H;

    for (const item of MECHANICS_ITEMS) {
        addLeftLabel(content, 'MechTitle', `● ${item.title}`, 18, UI_STYLE.white, y);
        y -= MECH_TITLE_H;
        for (const line of item.lines) {
            addLeftLabel(content, 'MechLine', line, 16, UI_STYLE.faint, y);
            y -= MECH_LINE_H;
        }
        y -= MECH_ITEM_GAP;
    }
}

function addLeftLabel(content: Node, name: string, text: string, fontSize: number, color: Color, y: number): void {
    const node = makeLabel(name, content, text, fontSize, color);
    node.getComponent(UITransform)!.setContentSize(TABLE_W - 40, fontSize + 10);
    const label = node.getComponent(Label)!;
    label.horizontalAlign = Label.HorizontalAlign.LEFT;
    label.overflow = Label.Overflow.SHRINK;
    node.setPosition(0, y, 1);
}

function getColumnX(): { name: number; apt: number; cur: number; max: number; effect: number } {
    const left = -TABLE_W / 2;
    return {
        name: left + COL.name / 2,
        apt: left + COL.name + COL.apt / 2,
        cur: left + COL.name + COL.apt + COL.cur / 2,
        max: left + COL.name + COL.apt + COL.cur + COL.max / 2,
        effect: left + COL.name + COL.apt + COL.cur + COL.max + COL.effect / 2,
    };
}

function header(content: Node, text: string, x: number, y: number): void {
    const node = makeLabel('H', content, text, 20, UI_STYLE.cyan);
    node.getComponent(UITransform)!.setContentSize(90, HEADER_H);
    node.getComponent(Label)!.horizontalAlign = Label.HorizontalAlign.CENTER;
    node.setPosition(x, y, 1);
}

function centeredCell(content: Node, text: string, x: number, y: number, h: number, w: number, color: Color, fontSize: number): void {
    const node = makeLabel('C', content, text, fontSize, color);
    node.getComponent(UITransform)!.setContentSize(w, h);
    const label = node.getComponent(Label)!;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    node.setPosition(x, y, 1);
}

function fmt(value: number, digits: number): string {
    return value.toFixed(digits);
}
