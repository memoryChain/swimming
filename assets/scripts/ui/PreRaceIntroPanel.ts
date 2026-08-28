import { Color, Label, Node, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform } from 'cc';
import { makeLabel, makeRect, makeUiNode, uiColor } from './RuntimeUiFactory';

export type PreRaceIntroEntry = {
    // 1-based lane number shown on the left of the row.
    lane: number;
    name: string;
    isPlayer: boolean;
    avatar: SpriteFrame | null;
    rowBack: SpriteFrame | null;
};

export type PreRaceEventInfo = {
    event: string;
    format: string;
    rule: string;
};

export type PreRaceIntroPhase = 'hidden' | 'raceInfo' | 'roster';

type IntroRow = {
    group: Node;
    back: Sprite;
    laneLabel: Label;
    avatar: Sprite;
    nameLabel: Label;
};

const MAX_ROWS = 8;
const PANEL_WIDTH = 560;
const ROW_HEIGHT = 46;
const HEADER_HEIGHT = 64;
const PANEL_HEIGHT = HEADER_HEIGHT + MAX_ROWS * ROW_HEIGHT + 28;
const AVATAR_SIZE = 38;
const EVENT_PANEL_WIDTH = 760;
const EVENT_PANEL_HEIGHT = 224;
const EVENT_HEADER_HEIGHT = 58;

const PLAYER_NAME_COLOR = new Color(255, 214, 44, 255);
const RIVAL_NAME_COLOR = new Color(226, 236, 250, 255);
const LANE_COLOR = new Color(150, 205, 255, 255);

// Pre-race broadcast overlay. Both panels are built once: the centered event
// card is used during the rising pool-length dolly, then the lane roster fades
// in near the far end. Runtime updates only switch phase on state edges.
export class PreRaceIntroPanel {
    private _panel: Node | null = null;
    private _opacity: UIOpacity | null = null;
    private _eventPanel: Node | null = null;
    private _eventOpacity: UIOpacity | null = null;
    private _eventLabel: Label | null = null;
    private _formatLabel: Label | null = null;
    private _ruleLabel: Label | null = null;
    private readonly _rows: IntroRow[] = [];
    private _phase: PreRaceIntroPhase = 'hidden';
    private _eventText = '';
    private _formatText = '';
    private _ruleText = '';

    build(parent: Node, w: number, _h: number): Node {
        const panel = makeUiNode('PreRaceIntroPanel', parent);
        panel.getComponent(UITransform)!.setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
        // Hug the left side so the pool overview stays visible on the right, echoing
        // the reference competitor screen.
        panel.setPosition(-w / 2 + PANEL_WIDTH / 2 + 40, 0, 0);
        this._panel = panel;
        this._opacity = panel.addComponent(UIOpacity);
        this._opacity.opacity = 0;
        panel.active = false;

        makeRect('IntroBack', panel, PANEL_WIDTH, PANEL_HEIGHT, uiColor(8, 22, 40, 232));

        const header = makeRect('IntroHeader', panel, PANEL_WIDTH, HEADER_HEIGHT, uiColor(22, 74, 140, 245));
        header.setPosition(0, PANEL_HEIGHT / 2 - HEADER_HEIGHT / 2, 0);
        const title = makeLabel('IntroTitle', header, '参赛选手', 30, uiColor(247, 251, 255));
        title.getComponent(UITransform)!.setContentSize(PANEL_WIDTH - 40, HEADER_HEIGHT);

        for (let i = 0; i < MAX_ROWS; i++) {
            this._rows.push(this.buildRow(panel, i));
        }

        this.buildEventPanel(parent);

        return panel;
    }

    private buildEventPanel(parent: Node) {
        const panel = makeUiNode('PreRaceEventPanel', parent);
        panel.getComponent(UITransform)!.setContentSize(EVENT_PANEL_WIDTH, EVENT_PANEL_HEIGHT);
        panel.setPosition(0, 12, 0);
        panel.active = false;
        const opacity = panel.addComponent(UIOpacity);
        opacity.opacity = 0;
        this._eventPanel = panel;
        this._eventOpacity = opacity;

        makeRect('EventBody', panel, EVENT_PANEL_WIDTH, EVENT_PANEL_HEIGHT, uiColor(7, 28, 68, 242));
        const header = makeRect(
            'EventHeader',
            panel,
            EVENT_PANEL_WIDTH - 120,
            EVENT_HEADER_HEIGHT,
            uiColor(194, 39, 48, 250),
        );
        header.setPosition(0, EVENT_PANEL_HEIGHT / 2 - EVENT_HEADER_HEIGHT / 2, 0);
        makeRect('EventHeaderAccent', panel, 18, EVENT_PANEL_HEIGHT, uiColor(57, 170, 225, 255))
            .setPosition(-EVENT_PANEL_WIDTH / 2 + 9, 0, 0);

        const eventNode = makeLabel('EventName', header, '', 30, uiColor(255, 250, 246));
        eventNode.getComponent(UITransform)!.setContentSize(EVENT_PANEL_WIDTH - 160, EVENT_HEADER_HEIGHT);
        this._eventLabel = eventNode.getComponent(Label)!;

        const formatNode = makeLabel('EventFormat', panel, '', 50, uiColor(248, 252, 255));
        formatNode.setPosition(0, 4, 0);
        formatNode.getComponent(UITransform)!.setContentSize(EVENT_PANEL_WIDTH - 80, 74);
        this._formatLabel = formatNode.getComponent(Label)!;

        const ruleNode = makeLabel('EventRule', panel, '', 22, uiColor(111, 224, 241));
        ruleNode.setPosition(0, -70, 0);
        ruleNode.getComponent(UITransform)!.setContentSize(EVENT_PANEL_WIDTH - 80, 42);
        this._ruleLabel = ruleNode.getComponent(Label)!;
    }

    private buildRow(panel: Node, index: number): IntroRow {
        const rowCenterY = PANEL_HEIGHT / 2 - HEADER_HEIGHT - ROW_HEIGHT * (index + 0.5) - 8;
        const group = makeUiNode(`IntroRow${index}`, panel);
        group.getComponent(UITransform)!.setContentSize(PANEL_WIDTH, ROW_HEIGHT);
        group.setPosition(0, rowCenterY, 0);

        const backNode = makeUiNode('Back', group);
        backNode.getComponent(UITransform)!.setContentSize(PANEL_WIDTH - 28, ROW_HEIGHT - 6);
        const back = backNode.addComponent(Sprite);
        back.sizeMode = Sprite.SizeMode.CUSTOM;
        back.type = Sprite.Type.SIMPLE;

        const laneLabelNode = makeLabel('Lane', group, '', 26, LANE_COLOR);
        laneLabelNode.getComponent(UITransform)!.setContentSize(44, ROW_HEIGHT);
        laneLabelNode.setPosition(-PANEL_WIDTH / 2 + 40, 0, 0);
        const laneLabel = laneLabelNode.getComponent(Label)!;

        const avatarNode = makeUiNode('Avatar', group);
        avatarNode.getComponent(UITransform)!.setContentSize(AVATAR_SIZE, AVATAR_SIZE);
        avatarNode.setPosition(-PANEL_WIDTH / 2 + 96, 0, 0);
        const avatar = avatarNode.addComponent(Sprite);
        avatar.sizeMode = Sprite.SizeMode.CUSTOM;
        avatar.type = Sprite.Type.SIMPLE;

        const nameWidth = PANEL_WIDTH - 180;
        const nameNode = makeLabel('Name', group, '', 24, RIVAL_NAME_COLOR);
        const nameLabel = nameNode.getComponent(Label)!;
        nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        nameNode.getComponent(UITransform)!.setContentSize(nameWidth, ROW_HEIGHT);
        nameNode.setPosition(-PANEL_WIDTH / 2 + 128 + nameWidth / 2, 0, 0);

        return { group, back, laneLabel, avatar, nameLabel };
    }

    populate(entries: PreRaceIntroEntry[]) {
        for (let i = 0; i < this._rows.length; i++) {
            const row = this._rows[i];
            const entry = entries[i];
            if (!entry) {
                if (row.group.active) {
                    row.group.active = false;
                }
                continue;
            }
            if (!row.group.active) {
                row.group.active = true;
            }
            const laneText = `${entry.lane}`;
            if (row.laneLabel.string !== laneText) {
                row.laneLabel.string = laneText;
            }
            if (row.nameLabel.string !== entry.name) {
                row.nameLabel.string = entry.name;
            }
            const nameColor = entry.isPlayer ? PLAYER_NAME_COLOR : RIVAL_NAME_COLOR;
            if (!row.nameLabel.color.equals(nameColor)) {
                row.nameLabel.color = nameColor;
            }
            if (row.back.spriteFrame !== entry.rowBack) {
                row.back.spriteFrame = entry.rowBack;
            }
            const rowBackVisible = Boolean(entry.rowBack);
            if (row.back.node.active !== rowBackVisible) {
                row.back.node.active = rowBackVisible;
            }
            if (row.avatar.spriteFrame !== entry.avatar) {
                row.avatar.spriteFrame = entry.avatar;
            }
            const avatarVisible = Boolean(entry.avatar);
            if (row.avatar.node.active !== avatarVisible) {
                row.avatar.node.active = avatarVisible;
            }
            if (!row.avatar.color.equals(Color.WHITE)) {
                row.avatar.color = Color.WHITE;
            }
        }
    }

    setRaceInfo(info: PreRaceEventInfo) {
        if (this._eventLabel && info.event !== this._eventText) {
            this._eventText = info.event;
            this._eventLabel.string = info.event;
        }
        if (this._formatLabel && info.format !== this._formatText) {
            this._formatText = info.format;
            this._formatLabel.string = info.format;
        }
        if (this._ruleLabel && info.rule !== this._ruleText) {
            this._ruleText = info.rule;
            this._ruleLabel.string = info.rule;
        }
    }

    setPhase(phase: PreRaceIntroPhase) {
        if (phase === this._phase) {
            return;
        }
        this._phase = phase;
        this.transitionPanel(this._eventPanel, this._eventOpacity, phase === 'raceInfo');
        this.transitionPanel(this._panel, this._opacity, phase === 'roster');
    }

    setVisible(visible: boolean) {
        this.setPhase(visible ? 'roster' : 'hidden');
    }

    private transitionPanel(panel: Node | null, opacity: UIOpacity | null, visible: boolean) {
        if (!panel || !opacity) {
            return;
        }
        Tween.stopAllByTarget(opacity);
        if (visible) {
            if (!panel.active) {
                panel.active = true;
                opacity.opacity = 0;
            }
            tween(opacity).to(0.25, { opacity: 255 }).start();
        } else {
            if (!panel.active) {
                return;
            }
            tween(opacity)
                .to(0.25, { opacity: 0 })
                .call(() => { panel.active = false; })
                .start();
        }
    }

    get node(): Node | null {
        return this._panel;
    }
}
