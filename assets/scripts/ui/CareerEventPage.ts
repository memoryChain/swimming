import { BlockInputEvents, Button, Label, Mask, Node, ScrollView, UITransform, UIOpacity, Vec2, view } from 'cc';
import type { PlayerProfile } from '../backend/PlayerProfile';
import { LEAGUES, cupDistance, cupName, cupRounds, roundName, RaceRule, SoloSource } from '../progression/CareerRules';
import { findPlayerCharacter, PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { makeButton, makeLabel, makeRect, makeUiNode, uiColor, fitFullScreenBackgroundCover } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { careerArt, careerButtonFeedback } from './CareerUiArt';

type Control = { root: Node; label: Label; selected: Node };
export interface EventPageState {
    screen: 'quick' | 'career'; source: 'league' | 'cup'; tier: number;
    characterId: PlayerCharacterId; distance: 200 | 400; rule: RaceRule;
    busy: boolean; confirmAbandon: boolean; status: string; profile: PlayerProfile;
}
export interface EventPageActions {
    home(): void; tier(value: number): void;
    distance(value: 200 | 400): void; rule(value: RaceRule): void;
    start(source?: SoloSource): void; abandon(): void; cancelAbandon?(): void;
}
const INK = uiColor(9,45,66), WHITE = uiColor(255,255,255);
const ROW_HEIGHT = 220, VIEW_HEIGHT = 490, CONTENT_HEIGHT = ROW_HEIGHT * LEAGUES.length + 200;

/** 联赛节点与当前角色杯赛共用一张纵向地图，滚动只由ScrollView驱动。 */
export class CareerEventPage {
    readonly root: Node;
    private readonly title: Label;
    private readonly subtitle: Label;
    private readonly map: Node;
    private readonly scroll: ScrollView;
    private readonly content: Node;
    private readonly nodes: Control[] = [];
    private readonly detail: Node;
    private readonly detailTitle: Label;
    private readonly points: Label;
    private readonly cupTitle: Label;
    private readonly cupState: Label;
    private readonly rounds: Label[] = [];
    private readonly leagueStart: Control;
    private readonly cupStart: Control;
    private readonly back: Control;
    private readonly current: Control;
    private readonly rulesButton: Control;
    private readonly rules: Node;
    private readonly rulesClose: Control;
    private readonly abandon: Control;
    private readonly quick: Node;
    private readonly quickChoices: Control[];
    private readonly quickStart: Control;
    private readonly footer: Label;
    private snapshot: EventPageState | null = null;
    private entered = false;
    private selectedTier = -1;

    constructor(parent: Node, private readonly actions: EventPageActions) {
        this.root = makeRect('CareerEventPage',parent,3000,1600,uiColor(24,162,202));
        this.root.addComponent(BlockInputEvents); this.root.active=false;
        const bg=careerArt(this.root,'Background',RESOURCE_PATHS.lobbyUi.background,1280,720);
        const fit=()=>{if(bg.isValid)fitFullScreenBackgroundCover(bg,1280,720);};fit();
        view.on('canvas-resize',fit);view.on('design-resolution-changed',fit);
        this.root.once(Node.EventType.NODE_DESTROYED,()=>{view.off('canvas-resize',fit);view.off('design-resolution-changed',fit);});
        this.title=this.text(this.root,'PageTitle','生涯之路',0,285,620,52,36);this.title.color=WHITE;
        this.subtitle=this.text(this.root,'PageSubtitle','',0,239,950,30,19);this.subtitle.color=WHITE;
        this.back=this.button(this.root,'BackToLobby','返回大厅',-480,285,185,50,actions.home);
        this.rulesButton=this.button(this.root,'RulesButton','玩法说明',480,285,185,50,()=>{if(!this.snapshot?.busy)this.active(this.rules,true);});
        this.map=makeUiNode('CareerMap',this.root);this.map.setPosition(0,-25);
        this.map.getComponent(UITransform)!.setContentSize(1150,VIEW_HEIGHT);
        this.map.addComponent(Mask).type=Mask.Type.GRAPHICS_RECT;
        this.scroll=this.map.addComponent(ScrollView);
        this.scroll.horizontal=false;this.scroll.vertical=true;this.scroll.inertia=true;this.scroll.elastic=true;
        this.scroll.brake=0.5;this.scroll.cancelInnerEvents=true;
        this.content=makeUiNode('RouteContent',this.map);
        this.content.getComponent(UITransform)!.setContentSize(1150,CONTENT_HEIGHT);
        this.content.setPosition(0,(VIEW_HEIGHT-CONTENT_HEIGHT)/2);this.scroll.content=this.content;
        for(let i=0;i<LEAGUES.length;i++) {
            const y=this.rowY(i),x=-415+(i%2)*40;
            if(i<LEAGUES.length-1) makeRect(`RouteLink${i}`,this.content,8,ROW_HEIGHT-90,uiColor(190,242,252)).setPosition(-395,y+ROW_HEIGHT/2);
            const n=this.button(this.content,`LeagueTier${i}`,'',x,y,235,114,()=>actions.tier(i));
            this.nodes.push(n);
        }
        this.detail=this.card(this.content,'SelectedEventPanel',135,0,660,348);
        this.detailTitle=this.text(this.detail,'SelectedLeague','',0,127,570,40,29);
        this.points=this.text(this.detail,'LeaguePoints','',0,85,550,34,23);
        this.leagueStart=this.button(this.detail,'StartLeague','开始联赛',0,35,330,54,()=>actions.start('league'),true);
        this.cupTitle=this.text(this.detail,'CupName','',0,-17,560,30,23);
        for(let i=0;i<3;i++)this.rounds.push(this.text(this.detail,`CupRound${i}`,'',-200+i*200,-57,194,48,17));
        this.cupStart=this.button(this.detail,'StartCup','参加杯赛',0,-117,330,52,()=>actions.start('cup'),true);
        this.cupState=this.text(this.detail,'CupState','',0,-155,580,25,16);
        this.current=this.button(this.root,'ReturnCurrent','定位当前联赛',-390,-305,280,48,()=>{
            if(!this.snapshot)return;
            const tier=this.snapshot.profile.career.league;
            actions.tier(tier);this.focus(tier,true);
        });
        this.quick=makeUiNode('QuickPage',this.root);
        this.text(this.quick,'DistanceHeading','比赛距离',-285,150,500,40,28);
        this.text(this.quick,'RuleHeading','玩法规则',285,150,500,40,28);
        this.quickChoices=[
            this.button(this.quick,'Distance200','200米\n一分多钟',-285,50,490,112,()=>actions.distance(200)),
            this.button(this.quick,'Distance400','400米\n约三分钟',-285,-85,490,112,()=>actions.distance(400)),
            this.button(this.quick,'RuleStandard','标准竞速\n专注节奏',165,105,235,62,()=>actions.rule('standard')),
            this.button(this.quick,'RuleWild','狂野模式\n自由争位',405,105,235,62,()=>actions.rule('wild')),
            this.button(this.quick,'RuleStimulant','兴奋剂乱斗\n抢药失控',165,35,235,62,()=>actions.rule('stimulant')),
            this.button(this.quick,'RuleShark','鲨鱼大乱斗\n追猎淘汰',405,35,235,62,()=>actions.rule('shark')),
            this.button(this.quick,'RuleWhirlpool','漩涡冲浪赛\n外圈借力',165,-35,235,62,()=>actions.rule('whirlpool')),
            this.button(this.quick,'RuleCannon','炮火逃生赛\n躲避炮弹',405,-35,235,62,()=>actions.rule('cannon')),
            this.button(this.quick,'RuleTimedBomb','定时炸弹模式\n随机发放传递',165,-105,235,62,()=>actions.rule('timed-bomb')),
            this.button(this.quick,'RuleMinefield','水雷模式\n碰到立即爆炸',405,-105,235,62,()=>actions.rule('minefield')),
        ];
        this.text(this.quick,'QuickNotes','AI按角色等级与生涯进度自动匹配\n完赛获得金币，不增加联赛积分',0,-195,1050,75,23);
        this.quickStart=this.button(this.quick,'StartEvent','开始比赛',370,-285,380,60,()=>actions.start('quick'),true);
        this.footer=this.text(this.root,'EventStatus','',100,-345,930,26,17);this.footer.color=WHITE;
        this.rules=makeRect('RulesOverlay',this.root,3000,1600,uiColor(0,22,46,190));this.rules.addComponent(BlockInputEvents);
        const sheet=this.card(this.rules,'RulesSheet',0,0,850,490);
        this.text(sheet,'RulesTitle','生涯比赛说明',0,180,720,50,32);
        this.text(sheet,'RulesText','上下滑动探索联赛，点击节点查看本级赛事。\n联赛与杯赛均采用狂野模式。\n前四名获得20 / 14 / 10 / 6积分。\n本级积分满100后开放对应杯赛，夺冠晋级。\n联赛进度账号共享，杯赛进度属于当前角色。\n杯赛可分轮完成，轮间可以培养角色。',0,15,730,245,23);
        this.abandon=this.button(sheet,'AbandonCup','放弃本届杯赛',-190,-177,355,56,actions.abandon);
        this.rulesClose=this.button(sheet,'CloseRules','返回地图',220,-177,260,56,()=>{
            if(!this.snapshot?.busy){actions.cancelAbandon?.();this.active(this.rules,false);}
        });this.rules.active=false;
    }
    private rowY(tier:number):number{return -CONTENT_HEIGHT/2+100+ROW_HEIGHT*(tier+0.5);}
    private focus(tier:number,animated:boolean):void {
        this.scroll.stopAutoScroll();
        const offset=Math.max(0,Math.min(CONTENT_HEIGHT-VIEW_HEIGHT,CONTENT_HEIGHT/2-this.rowY(tier)-VIEW_HEIGHT/2));
        this.scroll.scrollToOffset(new Vec2(0,offset),animated?0.25:0);
    }
    private text(parent:Node,name:string,value:string,x:number,y:number,w:number,h:number,size:number):Label {
        const n=makeLabel(name,parent,value,size,INK);n.setPosition(x,y);n.getComponent(UITransform)!.setContentSize(w,h);
        const l=n.getComponent(Label)!;l.enableWrapText=true;l.overflow=Label.Overflow.SHRINK;
        styleProjectUiLabel(l,size>=27?'semibold':'regular',size+5);return l;
    }
    private card(parent:Node,name:string,x:number,y:number,w:number,h:number):Node {
        const n=makeRect(name,parent,w,h,WHITE);n.setPosition(x,y);
        careerArt(n,'Surface',RESOURCE_PATHS.characterUi.detailPanelBackground,w,h,0,0,true);return n;
    }
    private button(parent:Node,name:string,value:string,x:number,y:number,w:number,h:number,action:()=>void,primary=false):Control {
        const root=makeButton(name,parent,w,h,uiColor(25,142,182),'');root.setPosition(x,y);
        careerArt(root,'Surface',primary?RESOURCE_PATHS.lobbyUi.characterButton:h>80?RESOURCE_PATHS.characterUi.detailPanelBackground:RESOURCE_PATHS.avatarPickerUi.cancelButton,w,h,0,0,true);
        careerButtonFeedback(root);
        const label=this.text(root,'Label',value,primary?-12:0,0,w-(primary?70:18),h-10,23);
        const selected=makeRect('SelectionMark',root,w-16,5,uiColor(255,227,35));selected.setPosition(0,-h/2+5);selected.active=false;
        root.on(Button.EventType.CLICK,()=>{if(!this.snapshot?.busy&&root.getComponent(Button)!.interactable)action();});
        return {root,label,selected};
    }
    private active(n:Node,v:boolean):void{if(n.active!==v)n.active=v;}
    private write(l:Label,v:string):void{if(l.string!==v)l.string=v;}
    private enabled(c:Control,v:boolean):void {
        const b=c.root.getComponent(Button)!;if(b.interactable!==v)b.interactable=v;
        const o=c.root.getComponent(UIOpacity)??c.root.addComponent(UIOpacity);
        if(o.opacity!==(v?255:135))o.opacity=v?255:135;
    }
    refresh(s:EventPageState):void {
        this.snapshot=s;const c=s.profile.career,isMap=s.screen==='career',cup=c.cups[s.characterId];
        this.active(this.map,isMap);this.active(this.current.root,isMap);this.active(this.quick,!isMap);
        this.write(this.title,isMap?'生涯之路':'单人快速比赛');
        this.write(this.subtitle,`${findPlayerCharacter(s.characterId)?.name} · ${isMap?'上下滑动探索，点击联赛节点':'选择距离与玩法规则'}`);
        this.enabled(this.back,!s.busy);this.enabled(this.current,!s.busy);this.enabled(this.rulesButton,!s.busy);this.enabled(this.rulesClose,!s.busy);
        if(this.scroll.enabled===s.busy)this.scroll.enabled=!s.busy;
        if(isMap) {
            for(let i=0;i<this.nodes.length;i++) {
                const n=this.nodes[i];this.write(n.label,`${i+1}. ${LEAGUES[i].name}\n${i<c.league?'已通过':i===c.league?'当前联赛':'未解锁'}`);
                this.active(n.selected,i===s.tier);this.enabled(n,!s.busy);
            }
            if(this.selectedTier!==s.tier||!this.entered) {
                this.detail.setPosition(135,this.rowY(s.tier));this.active(this.rules,false);
                this.focus(s.tier,this.entered);this.selectedTier=s.tier;
            }
            this.entered=true;
            const unlocked=s.tier<=c.league,points=s.tier<c.league?100:s.tier===c.league?c.points:0;
            this.write(this.detailTitle,LEAGUES[s.tier].name);
            this.write(this.points,`联赛积分 ${points} / 100${!unlocked?' · 尚未解锁':''}`);
            this.enabled(this.leagueStart,!s.busy&&unlocked);
            this.write(this.leagueStart.label,unlocked?'开始联赛':'晋级前一级后开放');
            const same=cup?.tier===s.tier?cup:null,active=same?.state==='active';
            const other=cup?.state==='active'&&cup.tier!==s.tier;
            const cupOpen=unlocked&&(points>=100||active);
            this.write(this.cupTitle,cupName(s.tier));
            const count=cupRounds(s.tier);
            for(let i=0;i<3;i++) {
                const l=this.rounds[i];this.active(l.node,i<count);if(i>=count)continue;
                const x=count===2?-145+i*290:-200+i*200;if(l.node.position.x!==x)l.node.setPosition(x,-57);
                const status=same?.state==='won'||(same&&i<same.round)?'已通过':same?.state==='lost'&&i===same.round?'未通过':active&&same.round===i?'待比赛':i===count-1?'第一名夺冠':i===0?'前四晋级':'前三晋级';
                this.write(l,`${roundName(s.tier,i)} · ${cupDistance(s.tier,i)}米\n${status}`);
            }
            this.enabled(this.cupStart,!s.busy&&cupOpen&&!other);
            this.write(this.cupStart.label,other?'该角色还有未完成杯赛':!cupOpen?'积分满100开放杯赛':active?`继续${roundName(s.tier,same.round)}`:same?'重新挑战杯赛':'参加杯赛');
            this.write(this.cupState,active?'可分轮完成，切回当前角色继续':same?.state==='won'?'本角色已夺冠':same?.state==='lost'?'本届结束，重新挑战从预赛开始':s.tier===LEAGUES.length-1?'最高联赛 · 挑战冠军荣誉':'杯赛夺冠后晋级下一联赛');
            this.active(this.abandon.root,!!active);this.enabled(this.abandon,!s.busy);
            this.write(this.abandon.label,s.confirmAbandon?'再次点击确认放弃':'放弃本届杯赛');
        } else {
            const ruleIndex=s.rule==='standard'?2:s.rule==='wild'?3:s.rule==='stimulant'?4:s.rule==='shark'?5:s.rule==='whirlpool'?6:s.rule==='cannon'?7:s.rule==='minefield'?9:8;
            const entertainment=s.rule!=='standard'&&s.rule!=='wild';
            this.quickChoices.forEach((n,i)=>{this.enabled(n,!s.busy&&!(i===1&&entertainment));this.active(n.selected,i===(s.distance===200?0:1)||i===ruleIndex);});
            this.enabled(this.quickStart,!s.busy);this.write(this.quickStart.label,`开始比赛 · ${s.distance}米`);this.active(this.abandon.root,false);
        }
        this.write(this.footer,s.status||(s.busy?'正在保存并准备比赛…':isMap?'联赛账号共享 · 杯赛跟随角色':'好友对战无成长奖励'));
    }
    hide():void {this.scroll.stopAutoScroll();this.active(this.rules,false);this.entered=false;}
    dispose():void {this.hide();if(this.root.isValid)this.root.destroy();}
}
