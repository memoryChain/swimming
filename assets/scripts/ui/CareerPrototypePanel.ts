import { Button, Label, Node, UITransform } from 'cc';
import { PlayerData } from '../backend/PlayerData';
import { getPlayerCharacterSelection } from '../app/PlayerCharacterConfig';
import { LEAGUES, cupName, roundName, SoloSource, RaceRule } from '../progression/CareerRules';
import { setSoloRaceTicket, consumeSoloReturn } from '../progression/SoloRaceSession';
import { getRaceModeConfig, RaceModeId, setRaceDifficulty, setSoloRaceDistance } from '../core/GameBalance';
import { SeededRandom } from '../core/SharedRNG';
import { makeLabel, makeUiNode, uiColor } from './RuntimeUiFactory';
import { styleCurrencyNumberLabel, styleProjectUiLabel } from './ProjectUiFonts';
import { careerArt, careerButtonFeedback } from './CareerUiArt';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { CareerEventPage } from './CareerEventPage';

/** 大厅生涯入口与赛事导航；数据事件只更新文字和进度，不重建层级。 */
export class CareerPrototypePanel {
    readonly root: Node;
    private screen: 'home' | 'quick' | 'career' = 'home';
    private tier = PlayerData.profile.career.league;
    private source: 'league' | 'cup' = 'league';
    private distance = PlayerData.profile.career.quick.distance;
    private rule = PlayerData.profile.career.quick.rule;
    private busy = false;
    private confirmAbandon = false;
    private status = '';
    private readonly visible = [false];
    private title: Label;
    private detail: Label;
    private notice: Label;
    private nextLeague: Label;
    private station: Label;
    private progress: Node;
    private progressValue = -1;
    private buttons: { node: Node; label: Label; action: () => void }[] = [];
    private readonly page: CareerEventPage;
    private pageVisible = false;
    private pageScreen: 'quick' | 'career' = 'career';
    private readonly changed = () => { if (this.root.isValid && (this.root.active || this.page.root.active)) this.refresh(); };

    constructor(parent: Node, private readonly start: () => void, private readonly friends: () => void,
        private readonly pageHost?: {
            parent: Node;
            visibility: (visible: boolean, screen: 'quick' | 'career') => void;
        }) {
        const previous = consumeSoloReturn();
        if (previous) {
            this.screen = previous.source === 'quick' ? 'quick' : 'career';
            this.source = previous.source === 'cup' ? 'cup' : 'league';
            this.tier = PlayerData.profile.career.league;
        }
        this.root = makeUiNode('CareerPrototype', parent);
        this.root.getComponent(UITransform)!.setContentSize(449, 380);
        this.root.setPosition(0, 0, 3);
        const art = RESOURCE_PATHS.lobbyB;
        careerArt(this.root, 'Surface', art.careerCard, 449, 250, 393.5, 75);
        careerArt(this.root, 'CareerBadge', art.careerBadge, 206, 192, 491, 147);
        this.at('Caption', '生涯之路', 237, 149, 80, 24, 16, uiColor(158, 99, 27)).horizontalAlign = Label.HorizontalAlign.CENTER;
        this.title = this.at('Title', '', 284, 105, 180, 52, 40);
        this.nextLeague = this.at('NextLeague', '', 366, 67, 334, 25, 16, uiColor(83, 107, 141));
        this.at('PointsHeading', '联赛积分', 249, 22, 90, 24, 16);
        // 当前值和分母分开排版，位数变化时保持右边界和基线稳定。
        this.detail = this.at('Detail', '', 492, 24, 60, 32, 26, uiColor(3, 193, 211));
        this.detail.horizontalAlign = Label.HorizontalAlign.RIGHT;
        styleCurrencyNumberLabel(this.detail, 31);
        const limit = this.at('PointsLimit', '/ 100', 550, 21, 44, 24, 16, uiColor(153, 169, 194));
        styleCurrencyNumberLabel(limit, 21);
        careerArt(this.root, 'ProgressTrack', art.progressTrack, 370, 10, 387, 1);
        this.progress = careerArt(this.root, 'ProgressFill', art.progressFill, 370, 10, 202, 1);
        this.progress.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        this.notice = this.at('Notice', '', 387, -21, 366, 25, 14, uiColor(83, 107, 141));
        const node = makeUiNode('Action0', this.root);
        node.getComponent(UITransform)!.setContentSize(441, 91); node.setPosition(389.5, -94.5, 1);
        node.addComponent(Button);
        careerArt(node, 'Surface', art.careerButton, 441, 91);
        careerArt(node, 'Arrow', art.arrow, 24, 30, 181.5, 0.5);
        careerButtonFeedback(node);
        const labelNode = makeLabel('Label', node, '', 28, uiColor(14, 32, 66));
        labelNode.setPosition(-84.5, 0);
        const label = labelNode.getComponent(Label)!;
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        styleProjectUiLabel(label, 'semibold', 36);
        // 热字体缓存可能同步测量空文本；先固定溢出模式，再恢复设计文本框。
        labelNode.getComponent(UITransform)!.setContentSize(220, 44);
        this.station = this.at('Station', '', 505, -94, 130, 28, 18);
        this.station.horizontalAlign = Label.HorizontalAlign.CENTER;
        const entry = { node, label, action: () => {} };
        node.on(Button.EventType.CLICK, () => { if (!this.busy) entry.action(); });
        this.buttons.push(entry);
        this.page = new CareerEventPage(pageHost?.parent ?? parent, {
            home: () => this.open('home'),
            tier: value => { if (value >= 0 && value < LEAGUES.length && this.tier !== value) { this.tier = value; this.confirmAbandon = false; this.status = ''; this.refresh(); } },
            distance: value => { if (this.distance !== value) { this.distance = value; this.refresh(); } },
            rule: value => this.setRule(value),
            start: source => { void this.begin(source ?? (this.screen === 'quick' ? 'quick' : 'league')); },
            cancelAbandon: () => { this.confirmAbandon = false; this.refresh(); },
            abandon: () => {
                if (!this.confirmAbandon) { this.confirmAbandon = true; this.refresh(); }
                else void this.abandon(getPlayerCharacterSelection().characterId);
            },
        });
        PlayerData.onChange(this.changed);
        this.root.once(Node.EventType.NODE_DESTROYED, () => {
            PlayerData.offChange(this.changed); this.page.dispose();
            if (this.pageVisible) this.pageHost?.visibility(false, this.pageScreen);
        });
        this.refresh();
    }

    private at(name: string, text: string, x: number, y: number, w: number, h: number, size: number,
        color = uiColor(14, 32, 66)): Label {
        const n = makeLabel(name, this.root, text, size, color);
        n.setPosition(x, y, 1); n.getComponent(UITransform)!.setContentSize(w, h);
        const l = n.getComponent(Label)!; l.horizontalAlign = Label.HorizontalAlign.LEFT; l.overflow = Label.Overflow.SHRINK; l.enableWrapText = false;
        styleProjectUiLabel(l, 'semibold', size + 5); return l;
    }
    private write(label: Label, text: string): void { if (label.string !== text) label.string = text; }
    private button(i: number, title: string, action: () => void, enabled = true): void {
        this.visible[i] = true;
        const b = this.buttons[i];
        this.write(b.label, title); b.action = action;
        const component = b.node.getComponent(Button)!;
        if (component.interactable !== (enabled && !this.busy)) component.interactable = enabled && !this.busy;
    }
    openQuick(mode?: RaceModeId): void {
        if (this.busy) return;
        if (mode) {
            const config = getRaceModeConfig(mode);
            this.distance = config.distance;
            this.rule = config.ruleset;
        }
        this.open('quick');
    }

    private open(screen: 'home' | 'quick' | 'career', source: 'league' | 'cup' = 'league'): void {
        this.screen = screen; this.source = source; this.confirmAbandon = false;
        if (screen === 'career') {
            const cup = PlayerData.profile.career.cups[getPlayerCharacterSelection().characterId];
            this.tier = source === 'cup' && cup?.state === 'active' ? cup.tier : PlayerData.profile.career.league;
        }
        this.status = ''; this.refresh();
    }
    refresh(): void {
        const p = PlayerData.profile, c = p.career, id = getPlayerCharacterSelection().characterId;
        const cp = c.cups[id];
        this.visible.fill(false);
        if (this.screen === 'home') {
            this.write(this.title, LEAGUES[c.league].name);
            this.write(this.nextLeague, c.league < LEAGUES.length - 1
                ? `下一站 ${LEAGUES[c.league + 1].name}` : '已到达最高联赛级别');
            const points = Math.max(0, Math.min(100, c.points));
            this.write(this.detail, `${points}`);
            if (this.progressValue !== points) {
                this.progressValue = points;
                this.progress.setScale(points / 100, 1, 1);
            }
            const continuing = cp?.state === 'active';
            this.button(0, continuing ? '继续杯赛' : '继续生涯', () => this.open('career', continuing ? 'cup' : 'league'));
            this.write(this.station, continuing ? roundName(cp.tier, cp.round) : `联赛·第${c.league + 1}站`);
            this.write(this.notice, continuing ? `${cupName(cp.tier)} · ${roundName(cp.tier, cp.round)}待开始`
                : points < 100 ? `再获${100 - points}积分，开放晋级杯` : '晋级杯已开放，前往挑战');
        } else {
            this.page.refresh({ screen: this.screen, source: this.source, tier: this.tier,
                characterId: id, distance: this.distance, rule: this.rule, busy: this.busy,
                confirmAbandon: this.confirmAbandon, status: this.status, profile: p });
        }
        const visible = this.screen !== 'home';
        if (this.root.active === visible) this.root.active = !visible;
        if (this.page.root.active !== visible) this.page.root.active = visible;
        if (this.pageVisible !== visible) {
            if (!visible) this.page.hide();
            this.pageVisible = visible;
            if (visible) this.pageScreen = this.screen === 'quick' ? 'quick' : 'career';
            this.pageHost?.visibility(visible, this.pageScreen);
        }
        for (let i = 0; i < this.buttons.length; i++) {
            if (this.buttons[i].node.active !== this.visible[i]) this.buttons[i].node.active = this.visible[i];
        }
        if (this.status) this.write(this.notice, this.status);
    }
    private setRule(rule: RaceRule): void {
        if (this.rule === rule) return;
        this.rule = rule;
        if (rule !== 'standard' && rule !== 'wild' && rule !== 'entertainment') this.distance = 200;
        this.refresh();
    }
    private async abandon(id: string): Promise<void> {
        this.busy = true; this.refresh();
        try { await PlayerData.executeCareer({ type: 'abandon', characterId: id }); }
        catch { this.status = '保存失败，请重试'; }
        finally { this.busy = false; this.confirmAbandon = false; if (this.root.isValid) this.refresh(); }
    }
    private async begin(source: SoloSource): Promise<void> {
        if (this.busy) return;
        this.busy = true; this.refresh();
        let launching = false;
        try {
            const result = await PlayerData.executeCareer({ type: 'begin', source, tier: this.tier,
                characterId: getPlayerCharacterSelection().characterId, distance: this.distance, rule: this.rule,
                seed: SeededRandom.entropySeed() });
            if (!this.root.isValid) return;
            if (result.ok && result.ticket) {
                setSoloRaceTicket(result.ticket);
                setRaceDifficulty(result.ticket.rule === 'standard' ? 'beginner'
                    : result.ticket.rule === 'entertainment' ? 'entertainment-brawl'
                    : result.ticket.rule === 'stimulant' ? 'stimulant-brawl'
                        : result.ticket.rule === 'shark' ? 'shark-brawl'
                            : result.ticket.rule === 'whirlpool' ? 'whirlpool-brawl'
                                : result.ticket.rule === 'cannon' || result.ticket.rule === 'last-place' ? 'last-place-brawl'
                                    : result.ticket.rule === 'timed-bomb' || result.ticket.rule === 'mine-relay' ? 'timed-bomb-brawl'
                                        : result.ticket.rule === 'minefield' ? 'minefield-brawl'
                        : result.ticket.distance === 400 ? 'championship' : 'competitive');
                setSoloRaceDistance(result.ticket.distance);
                launching = true;
                this.start();
            } else this.status = result.message;
        } catch { this.status = '保存失败，请重试'; }
        finally { if (!launching) this.busy = false; if (this.root.isValid) this.refresh(); }
    }
}
