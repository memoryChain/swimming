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

const PLAYER_NAME_COLOR = new Color(255, 214, 44, 255);
const RIVAL_NAME_COLOR = new Color(226, 236, 250, 255);
const LANE_COLOR = new Color(150, 205, 255, 255);

// Pre-race stage 1 roster info panel. Styled after the results ranking panel:
// a header plus one row per lane (lane number + avatar + name). Reuses the
// results-panel avatar/row-back sprite frames so it needs no new art. Populated
// from the current roster and faded in/out by the game flow.
export class PreRaceIntroPanel {
    private _panel: Node | null = null;
    private _opacity: UIOpacity | null = null;
    private readonly _rows: IntroRow[] = [];
    private _visible = false;

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

        return panel;
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
                row.group.active = false;
                continue;
            }
            row.group.active = true;
            row.laneLabel.string = `${entry.lane}`;
            row.nameLabel.string = entry.name;
            row.nameLabel.color = entry.isPlayer ? PLAYER_NAME_COLOR : RIVAL_NAME_COLOR;
            row.back.spriteFrame = entry.rowBack;
            row.back.node.active = Boolean(entry.rowBack);
            row.avatar.spriteFrame = entry.avatar;
            row.avatar.node.active = Boolean(entry.avatar);
            row.avatar.color = Color.WHITE;
        }
    }

    setVisible(visible: boolean) {
        if (!this._panel || !this._opacity || visible === this._visible) {
            return;
        }
        this._visible = visible;
        Tween.stopAllByTarget(this._opacity);
        if (visible) {
            this._panel.active = true;
            this._opacity.opacity = 0;
            tween(this._opacity).to(0.25, { opacity: 255 }).start();
        } else {
            const panel = this._panel;
            tween(this._opacity)
                .to(0.25, { opacity: 0 })
                .call(() => { panel.active = false; })
                .start();
        }
    }

    get node(): Node | null {
        return this._panel;
    }
}
