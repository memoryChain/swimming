import { Button, Label, Node, UITransform } from 'cc';
import { PlayerData } from '../backend/PlayerData';
import { getPlayerCharacterSelection, findPlayerCharacter } from '../app/PlayerCharacterConfig';
import { LEAGUES, cupName, roundName, SoloSource, RaceRule } from '../progression/CareerRules';
import { setSoloRaceTicket, consumeSoloReturn } from '../progression/SoloRaceSession';
import { setRaceDifficulty, setSoloRaceDistance } from '../core/GameBalance';
import { SeededRandom } from '../core/SharedRNG';
import { makeButton, makeLabel, makeRect, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { careerArt, careerButtonFeedback } from './CareerUiArt';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { CareerEventPage } from './CareerEventPage';

/** 临时功能界面：每次挂载只构建一次，选项更新不重建角色预览。 */
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
    private buttons: { node: Node; label: Label; action: () => void }[] = [];
    private readonly page: CareerEventPage;
    private pageVisible = false;
    private readonly changed = () => { if (this.root.isValid && (this.root.active || this.page.root.active)) this.refresh(); };

    constructor(parent: Node, private readonly start: () => void, private readonly friends: () => void,
        private readonly pageHost?: { parent: Node; visibility: (visible: boolean) => void }) {
        const previous = consumeSoloReturn();
        if (previous) {
            this.screen = previous.source === 'quick' ? 'quick' : 'career';
            this.source = previous.source === 'cup' ? 'cup' : 'league';
            this.tier = PlayerData.profile.career.league;
        }
        this.root = makeRect('CareerPrototype', parent, 400, 450, uiColor(226, 245, 248, 248));
        this.root.setPosition(422, 38, 3);
        careerArt(this.root, 'Surface', RESOURCE_PATHS.characterUi.detailPanelBackground, 400, 450, 0, 0, true);
        careerArt(this.root, 'CareerIllustration', RESOURCE_PATHS.lobbyUi.modeChampionship, 354, 147, 0, 75);
        const caption = this.text('IllustrationCaption', 16, 26, 15); caption.string = '从泳馆新秀，游向冠军';
        this.title = this.text('Title', 171, 36, 26);
        this.detail = this.text('Detail', -60, 95, 20);
        this.notice = this.text('Notice', -185, 32, 16);
        for (let i = 0; i < 1; i++) {
            const node = makeButton(`Action${i}`, this.root, 360, 44, uiColor(18, 100, 139), '');
            node.setPosition(0, -139, 1);
            careerArt(node, 'Surface', RESOURCE_PATHS.lobbyUi.characterButton, 360, 52, 0, 0, true);
            careerButtonFeedback(node);
            const labelNode = makeLabel('Label', node, '', 20, uiColor(9, 45, 66));
            labelNode.getComponent(UITransform)!.setContentSize(296, 40); labelNode.setPosition(-12, 0);
            const label = labelNode.getComponent(Label)!;
            styleProjectUiLabel(label, 'semibold', 25);
            const entry = { node, label, action: () => {} };
            node.on(Button.EventType.CLICK, () => { if (!this.busy) entry.action(); });
            this.buttons.push(entry);
        }
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
            if (this.pageVisible) this.pageHost?.visibility(false);
        });
        this.refresh();
    }

    private text(name: string, y: number, h: number, size: number): Label {
        const n = makeLabel(name, this.root, '', size, uiColor(9, 45, 66));
        n.setPosition(0, y, 1); n.getComponent(UITransform)!.setContentSize(334, h);
        const l = n.getComponent(Label)!; l.overflow = Label.Overflow.SHRINK; l.enableWrapText = true;
        styleProjectUiLabel(l, 'regular', size + 5); return l;
    }
    private write(label: Label, text: string): void { if (label.string !== text) label.string = text; }
    private button(i: number, title: string, action: () => void, enabled = true): void {
        this.visible[i] = true;
        const b = this.buttons[i];
        this.write(b.label, title); b.action = action;
        const component = b.node.getComponent(Button)!;
        if (component.interactable !== (enabled && !this.busy)) component.interactable = enabled && !this.busy;
    }
    openQuick(): void { if (!this.busy) this.open('quick'); }

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
        const cp = c.cups[id], ch = p.characters[id];
        const who = `${findPlayerCharacter(id)?.name ?? id} Lv.${ch?.level ?? 1}`;
        this.visible.fill(false);
        if (this.screen === 'home') {
            this.write(this.title, '生涯比赛');
            this.write(this.detail, `${LEAGUES[c.league].name} · ${c.points}/100积分\n${who}\n${cp?.state === 'active' ? `${cupName(cp.tier)} · ${roundName(cp.tier, cp.round)}` : '赢取金币，培养角色挑战晋级杯'}`);
            this.button(0, '进入生涯', () => this.open('career'));
            this.write(this.notice, '联赛账号共享，杯赛按角色保存');
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
            this.pageVisible = visible; this.pageHost?.visibility(visible);
        }
        for (let i = 0; i < this.buttons.length; i++) {
            if (this.buttons[i].node.active !== this.visible[i]) this.buttons[i].node.active = this.visible[i];
        }
        if (this.status) this.write(this.notice, this.status);
    }
    private setRule(rule: RaceRule): void { if (this.rule !== rule) { this.rule = rule; this.refresh(); } }
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
                setRaceDifficulty(result.ticket.rule === 'standard' ? 'beginner' : 'competitive');
                setSoloRaceDistance(result.ticket.distance);
                launching = true;
                this.start();
            } else this.status = result.message;
        } catch { this.status = '保存失败，请重试'; }
        finally { if (!launching) this.busy = false; if (this.root.isValid) this.refresh(); }
    }
}
