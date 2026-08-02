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
import { makeButton, makeLabel, makeRect, makeRoundedRect, makeUiNode, uiColor } from './RuntimeUiFactory';
import { getUILayer, UILayer } from './UILayers';
import { UI_STYLE } from './UIStyle';

const PANEL_W = 760;
const PANEL_H = 720;
const TABLE_W = 680;
const COL = { name: 100, apt: 90, cur: 130, max: 130, effect: 230 };
const ROW_H = 52;
const HEADER_H = 44;

const MECH_HEADING_H = 36;
const MECH_TITLE_H = 28;
const MECH_LINE_H = 22;
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
            '低区0-110 质量×0.7、回复最快；最佳110-150 质量×1.25；高压150-175 ×1.05；过载175-200 ×0.85且消耗大。',
        ],
    },
    {
        title: '划水质量',
        lines: [
            '松手时机决定：完美窗口中心=完美(满额推力)，良好窗口=良好(按比例)，失误=无推力。',
            '连击只影响比赛结算经验，不叠加推力；推力大小受技巧资质影响，但时机纯靠操作。',
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
            '被撞飞会补偿能量；攒满可放大招（后续开放）。当前阶段：海豚跳消耗 30 点，不足则完全无法触发。',
            '积攒速率受蓄气资质影响（±15%），但能量的获取与花费都由操作决定，不随等级成长。',
        ],
    },
];

export function openCharacterStatsPanel(canvasNode: Node, designWidth: number, designHeight: number): void {
    const popup = getUILayer(canvasNode, UILayer.Popup);
    popup.getChildByName('CharacterStatsPanel')?.destroy();
    const root = makeUiNode('CharacterStatsPanel', popup);

    const dim = makeRect('Dim', root, designWidth, designHeight, uiColor(2, 8, 14, 200));
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
    const tableH = HEADER_H + rows.length * ROW_H;
    const mechanicsItemsH = MECHANICS_ITEMS.reduce((sum, item) =>
        sum + MECH_TITLE_H + item.lines.length * MECH_LINE_H + MECH_ITEM_GAP, 0);
    const mechanicsH = MECH_TOP_GAP + MECH_HEADING_H + mechanicsItemsH + MECH_BOTTOM_PAD;
    const contentH = tableH + mechanicsH;
    const content = makeUiNode('StatsContent', viewNode);
    content.getComponent(UITransform)!.setContentSize(TABLE_W, contentH);
    scrollView.content = content;

    renderTable(content, rows, contentH);
    renderMechanicsSection(content, contentH / 2 - tableH - MECH_TOP_GAP);

    const note1 = makeLabel('Note1', panel, `体力为先天资质（0-100），决定赛中体能池上限；体能为赛中实际值，由资质与等级折算。等级通过比赛经验提升，满级 ${maxLevel}。`, 16, UI_STYLE.muted);
    note1.getComponent(UITransform)!.setContentSize(TABLE_W - 20, 28);
    note1.getComponent(Label)!.overflow = Label.Overflow.SHRINK;
    note1.setPosition(0, -PANEL_H / 2 + 60, 1);

    const close = makeButton('CloseButton', panel, 160, 52, UI_STYLE.panelAlt, '关闭');
    close.setPosition(0, -PANEL_H / 2 + 30, 2);
    close.on(Button.EventType.CLICK, () => root.destroy());
}

type StatRow = {
    name: string;
    aptitude: string;
    current: string;
    max: string;
    effect: string;
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
            current: fmt(current.energyTotal, 1),
            max: fmt(atMax.energyTotal, 1),
            effect: '决定赛中体能池上限',
        },
        {
            name: '技巧',
            aptitude: `${character.technique}`,
            current: `${fmt(current.strokeQualityAccel, 2)} / ${fmt(current.perfectComboMaxOvercap, 2)}`,
            max: `${fmt(atMax.strokeQualityAccel, 2)} / ${fmt(atMax.perfectComboMaxOvercap, 2)}`,
            effect: '划水推力 / 超速上限',
        },
        {
            name: '爆发力',
            aptitude: `${character.burst}`,
            current: `${fmt(current.maxSpeed, 2)} / ${fmt(current.diveMaxLaunchSpeed, 2)}`,
            max: `${fmt(atMax.maxSpeed, 2)} / ${fmt(atMax.diveMaxLaunchSpeed, 2)}`,
            effect: '最大游速 / 出发速度',
        },
        {
            name: '踢腿',
            aptitude: `${character.kick}`,
            current: fmt(current.kickMaxSpeed, 2),
            max: fmt(atMax.kickMaxSpeed, 2),
            effect: '踢腿速度上限（资质×倍率 + 等级）',
        },
        {
            name: '体重',
            aptitude: `${weightToPhysicalRating(character.weight)}`,
            current: '固定',
            max: '固定',
            effect: `对抗（体重 ${character.weight}，碰撞击退抗性）`,
        },
        {
            name: '蓄气',
            aptitude: `${character.energyGain}`,
            current: '固定',
            max: '固定',
            effect: `大招能量积攒速率（×${energyGainMultiplier(character.energyGain).toFixed(2)}）`,
        },
    ];
}

function renderTable(content: Node, rows: StatRow[], contentH: number): void {
    const colX = getColumnX();
    const topY = contentH / 2;

    const headerBg = makeRect('HeaderBg', content, TABLE_W, HEADER_H, uiColor(20, 70, 110, 200));
    headerBg.setPosition(0, topY - HEADER_H / 2, 0);
    header(content, '属性', colX.name, topY - HEADER_H / 2);
    header(content, '资质', colX.apt, topY - HEADER_H / 2);
    header(content, '当前', colX.cur, topY - HEADER_H / 2);
    header(content, '满级', colX.max, topY - HEADER_H / 2);
    header(content, '作用', colX.effect, topY - HEADER_H / 2);

    rows.forEach((row, i) => {
        const y = topY - HEADER_H - ROW_H / 2 - i * ROW_H;
        if (i % 2 === 1) {
            const zebra = makeRect(`RowBg${i}`, content, TABLE_W, ROW_H, uiColor(255, 255, 255, 10));
            zebra.setPosition(0, y, 0);
        }
        cell(content, row.name, colX.name, y, UI_STYLE.white, 20);
        cell(content, row.aptitude, colX.apt, y, uiColor(255, 210, 120, 255), 19);
        cell(content, row.current, colX.cur, y, uiColor(150, 220, 170, 255), 18);
        cell(content, row.max, colX.max, y, uiColor(120, 200, 255, 255), 18);
        cell(content, row.effect, colX.effect, y, UI_STYLE.faint, 17);
    });

    const sepGfx = content.addComponent(Graphics);
    sepGfx.strokeColor = uiColor(86, 196, 236, 50);
    sepGfx.lineWidth = 1;
    const seps = [colX.name + COL.name / 2, colX.name + COL.name, colX.apt + COL.apt / 2, colX.cur + COL.cur / 2, colX.max + COL.max / 2];
    const tableBottom = topY - HEADER_H - rows.length * ROW_H;
    for (const x of seps) {
        sepGfx.moveTo(x, topY);
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
            addLeftLabel(content, 'MechLine', line, 15, UI_STYLE.faint, y);
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

function cell(content: Node, text: string, x: number, y: number, color: Color, fontSize: number): void {
    const node = makeLabel('C', content, text, fontSize, color);
    const w = x === getColumnX().effect ? COL.effect - 12 : 96;
    node.getComponent(UITransform)!.setContentSize(w, ROW_H - 8);
    const label = node.getComponent(Label)!;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    node.setPosition(x, y, 1);
}

function fmt(value: number, digits: number): string {
    return value.toFixed(digits);
}
