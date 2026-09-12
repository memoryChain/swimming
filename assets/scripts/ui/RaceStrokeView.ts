import type { RaceHudEntrance } from './RaceHudEntrance';
import { Color, Label, Node, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { StrokeType, Rating } from '../core/GameConstants';
import type { StrokeTimingGuide } from '../swimmer/SwimmerMotor';
import { makeUiNode } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

// 从定稿弧线贴图逐行测量的中心线；镜像复用，不能单独移动绿色区。
const ARC_X = [215.05,224.46,233.89,244.24,252.29,261.06,267.8,275.15,280.72,286.84,291.53,296.6,300.38,304.58,307.69,311.09,313.61,316.32,318.66,320.37,322.28,323.68,325.06,326.08,327.12,327.88,328.6,329.07,329.55,329.85,330.05,330.14,330.05];
const WHITE = new Color(245,250,252);
const OUTLINE = new Color(0,0,0,70);
const GREEN = new Color(204,238,83,242);
const GOLD = new Color(255,201,58);
const REST = new Vec3(1,1,1);
const PRESS = new Vec3(.88,.88,1);
const RIPPLE_COLOR = new Color(194,241,255);
const RIPPLE_SECONDS = 0.78;
const RIPPLE_START_DIAMETER = 104;
const RIPPLE_END_DIAMETER = 320;
const INNER_GLOW_SECONDS = 0.36;
const RIPPLE_COUNT = 3;
const MARKER_FLASH_SECONDS = 0.18;
const MARKER_GLOW_IDLE_OPACITY = 110;
type HandRipple = { node:Node; opacity:UIOpacity; age:number; diameter:number };
const HAND_READY = new Color(224,255,140);
const POP = new Vec3(1.08,1.08,1);
const POP_STRONG = new Vec3(1.15,1.15,1);
type PraiseArt = 'praiseGood'|'praiseGreat'|'praiseExcellent'|'praisePerfect'|'praiseAmazing'|'praiseCrazy'|'praiseUnbelievable';
const PRAISE_ART: Record<string, {key: PraiseArt; width: number; height: number}> = {
    Good: {key:'praiseGood',width:90,height:38},
    Great: {key:'praiseGreat',width:96,height:38},
    Excellent: {key:'praiseExcellent',width:147,height:38},
    Perfect: {key:'praisePerfect',width:119,height:38},
    Amazing: {key:'praiseAmazing',width:138,height:44},
    Crazy: {key:'praiseCrazy',width:97,height:44},
    Unbelievable: {key:'praiseUnbelievable',width:168,height:35},
};
export type StrokeArt = PraiseArt| 'strokeArc'|'strokeBand'|'strokeHand'|'strokeButton'|'strokeMarker'|'progress'|'strokeRipple'|'strokeInnerGlow'|'strokeMarkerGlow';
type Side = {markerOpacity:UIOpacity; markerGlow:Node; markerGlowOpacity:UIOpacity; markerGlowAge:number; innerGlow:Node; innerGlowOpacity:UIOpacity; innerGlowAge:number; ripples:HandRipple[]; rippleNext:number;   root:Node; sign:number; hand:Node; opacity:UIOpacity; marker:Node; bands:Sprite[]; starts:Node[]; ends:Node[]; praise:Sprite; praiseKey:string; zoneRatio:number; combo:Label; feedback:Node; feedbackOpacity:UIOpacity; held:boolean; inPerfect:boolean; handSprite:Sprite; markerSprite:Sprite; lastTier:number};

/** 只消费判定快照：弧线裁切、白点位置和评价不参与划水计算。 */
export class RaceStrokeView {
    private readonly sides: Side[] = [];
    readonly leftGuide: StrokeTimingGuide = { active:false,currentRatio:0,holdSeconds:0,actionSeconds:0,minHoldRatio:0,intervals:[] };
    readonly rightGuide: StrokeTimingGuide = { active:false,currentRatio:0,holdSeconds:0,actionSeconds:0,minHoldRatio:0,intervals:[] };
    private visible = false;
    private elapsed = 0;
    constructor(left:Node,right:Node,private readonly frame:(key:StrokeArt)=>SpriteFrame, entrance?:RaceHudEntrance, private readonly onPress?:()=>void) {
        for (let index=0;index<2;index++) {
            const sign=index===0?1:-1,root=makeUiNode(index===0?'LeftStrokeUi':'RightStrokeUi',index===0?left:right);
            const sprite=(name:string,key:StrokeArt,x:number,y:number,w:number,h:number)=>{
                const n=makeUiNode(name,root),s=n.addComponent(Sprite);s.spriteFrame=frame(key);s.sizeMode=Sprite.SizeMode.CUSTOM;s.trim=false;
                n.getComponent(UITransform)!.setContentSize(w,h);n.setPosition(sign*x,-y);n.setScale(sign,1,1);return s;
            };
            sprite('Arc','strokeArc',274,490,128,186);
            const bands:Sprite[]=[],starts:Node[]=[],ends:Node[]=[];
            // 现有判定最多形成少量区间，固定池不在比赛中增删节点。
            for(let i=0;i<4;i++) {
                const band=sprite('PerfectBand'+i,'strokeBand',274,490,128,186);band.type=Sprite.Type.FILLED;band.fillType=Sprite.FillType.VERTICAL;band.fillStart=0;band.fillRange=0;band.node.active=false;bands.push(band);
                for(const target of [starts,ends]){const tick=sprite('PerfectBoundary','progress',0,0,11,2);tick.color=GREEN;tick.node.active=false;target.push(tick.node);}
            }
            // 专用高清圆环，固定三槽；独立于手掌缩放，层级在按钮下方。
            const ripples:HandRipple[]=[];
            for(let i=0;i<RIPPLE_COUNT;i++) {
                const ring=sprite('HandRipple'+i,'strokeRipple',177,573,120,120);
                ring.color=RIPPLE_COLOR;
                const opacity=ring.node.addComponent(UIOpacity);opacity.opacity=0;
                ring.node.active=false;
                ripples.push({node:ring.node,opacity,age:RIPPLE_SECONDS,diameter:120});
            }
            const hand=makeUiNode('HandButtonVisual',root);hand.setPosition(sign*177,-573);
            let handSprite:Sprite,innerGlow:Node,innerGlowOpacity:UIOpacity;
            for(const [key,x,y,w,h] of [['strokeButton',0,0,120,120],['strokeHand',.5,7.5,51,55]] as const){
                const n=makeUiNode(key,hand),s=n.addComponent(Sprite);s.spriteFrame=frame(key);s.sizeMode=Sprite.SizeMode.CUSTOM;s.trim=false;n.getComponent(UITransform)!.setContentSize(w,h);n.setPosition(sign*x,y);n.setScale(sign,1,1);if(key==='strokeHand')handSprite=s;
                if(key==='strokeButton') {
                    // 高亮在按钮底图上、手掌和文字下，保持图标轮廓清晰。
                    innerGlow=makeUiNode('HandInnerGlow',hand);
                    const glow=innerGlow.addComponent(Sprite);glow.spriteFrame=frame('strokeInnerGlow');
                    glow.sizeMode=Sprite.SizeMode.CUSTOM;glow.trim=false;glow.color=RIPPLE_COLOR;
                    innerGlow.getComponent(UITransform)!.setContentSize(120,120);
                    innerGlowOpacity=innerGlow.addComponent(UIOpacity);innerGlowOpacity.opacity=0;innerGlow.active=false;
                }
            }
            const opacity=hand.addComponent(UIOpacity);opacity.opacity=210;
            this.label(hand,'StrokeCaption',index===0?'左划':'右划',0,-37,70,26,18);
            const markerGlow=sprite('MarkerGlow','strokeMarkerGlow',215,401,48,48).node;
            const markerGlowOpacity=markerGlow.addComponent(UIOpacity);markerGlowOpacity.opacity=0;markerGlow.active=false;
            const markerSprite=sprite('MovingDot','strokeMarker',215,401,18,18),marker=markerSprite.node;marker.active=false;
            const markerOpacity=marker.addComponent(UIOpacity);
            const feedback=makeUiNode('StrokePraise',root);feedback.setPosition(sign*423,-532);
            const feedbackOpacity=feedback.addComponent(UIOpacity);feedbackOpacity.opacity=0;
            const praiseNode=makeUiNode('Praise',feedback),praise=praiseNode.addComponent(Sprite);
            praise.sizeMode=Sprite.SizeMode.CUSTOM;praise.trim=false;
            const combo=this.label(feedback,'Combo','',sign*24,32,64,24,18);combo.color=GOLD;
            this.sides.push({markerOpacity,markerGlow,markerGlowOpacity,markerGlowAge:MARKER_FLASH_SECONDS,innerGlow,innerGlowOpacity,innerGlowAge:INNER_GLOW_SECONDS,ripples,rippleNext:0,root,sign,hand,opacity,marker,bands,starts,ends,praise,combo,feedback,feedbackOpacity,held:false,inPerfect:false,handSprite,markerSprite,lastTier:0,praiseKey:'',zoneRatio:.8});root.active=false;
            entrance?.wrap(root, 0, 0, 0.12, 0, true);
            root.once(Node.EventType.NODE_DESTROYED,()=>{Tween.stopAllByTarget(hand);Tween.stopAllByTarget(feedback);Tween.stopAllByTarget(feedbackOpacity);});
        }
    }
    setVisible(value:boolean) {
        if(value===this.visible)return;this.visible=value;this.elapsed=1/30;
        for(const s of this.sides){s.root.active=value;if(!value){this.clearRipples(s);Tween.stopAllByTarget(s.hand);s.hand.setScale(REST);s.held=false;s.inPerfect=false;s.handSprite.color=WHITE;s.markerSprite.color=WHITE;s.opacity.opacity=210;Tween.stopAllByTarget(s.feedback);Tween.stopAllByTarget(s.feedbackOpacity);s.feedbackOpacity.opacity=0;s.lastTier=0;}}
    }
    setPressed(side:StrokeType,pressed:boolean) {
        if(!this.visible)return;
        const s=this.sides[side===StrokeType.RIGHT?1:0];
        if(s.held===pressed)return;
        s.held=pressed;Tween.stopAllByTarget(s.hand);
        if(pressed){
            this.onPress?.();
            this.emitRipple(s);s.innerGlowAge=0;
            // 新一划取消旧的松手闪光，常态光晕由白点的显示快照驱动。
            if(s.markerGlowAge<MARKER_FLASH_SECONDS){
                s.markerGlowAge=MARKER_FLASH_SECONDS;
                if(s.marker.active)s.marker.active=false;
                if(s.markerGlow.active)s.markerGlow.active=false;
            }
            if(s.innerGlowOpacity.opacity!==230)s.innerGlowOpacity.opacity=230;
            if(!s.innerGlow.active)s.innerGlow.active=true;
        }
        s.hand.setScale(pressed?PRESS:REST);
        if(s.opacity.opacity!==(pressed?255:210))s.opacity.opacity=pressed?255:210;
    }
    showResult(side:StrokeType|undefined,rating:Rating) {
        if(!this.visible||side===undefined)return;
        if(rating!==Rating.GOOD&&rating!==Rating.PERFECT)return;
        const s=this.sides[side===StrokeType.RIGHT?1:0];
        // 后续新按压优先，旧队列结算不能抢占当前手掌状态。
        if(s.held)return;
        if(rating===Rating.PERFECT){
            s.markerGlowAge=0;
            if(s.markerGlow.position.x!==s.marker.position.x||s.markerGlow.position.y!==s.marker.position.y)
                s.markerGlow.setPosition(s.marker.position.x,s.marker.position.y);
            if(s.markerGlowOpacity.opacity!==255)s.markerGlowOpacity.opacity=255;
            if(s.markerOpacity.opacity!==255)s.markerOpacity.opacity=255;
            if(!s.marker.active)s.marker.active=true;
            if(!s.markerGlow.active)s.markerGlow.active=true;
        }
        Tween.stopAllByTarget(s.hand);
        s.hand.setScale(rating===Rating.PERFECT?POP_STRONG:POP);
        tween(s.hand).to(.2,{scale:REST},{easing:'quadOut'}).start();
    }
    consumeSample(dt:number):boolean {
        if(!this.visible)return false;
        this.elapsed+=Math.max(0,dt);
        if(this.elapsed<1/30)return false;
        const remainder=this.elapsed%(1/30);
        const sampleDt=this.elapsed-remainder;this.elapsed=remainder;
        this.updateRipples(sampleDt);
        return true;
    }
    private emitRipple(s:Side) {
        const ripple=s.ripples[s.rippleNext];
        s.rippleNext=(s.rippleNext+1)%RIPPLE_COUNT;
        ripple.age=0;
        if(ripple.diameter!==RIPPLE_START_DIAMETER){ripple.diameter=RIPPLE_START_DIAMETER;ripple.node.setScale(RIPPLE_START_DIAMETER/120,RIPPLE_START_DIAMETER/120,1);}
        if(ripple.opacity.opacity!==180)ripple.opacity.opacity=180;
        if(!ripple.node.active)ripple.node.active=true;
    }
    private updateRipples(dt:number) {
        for(const s of this.sides) {
            if(s.markerGlowAge<MARKER_FLASH_SECONDS){
                s.markerGlowAge=Math.min(MARKER_FLASH_SECONDS,s.markerGlowAge+dt);
                if(s.markerGlowAge>=MARKER_FLASH_SECONDS){
                    if(s.markerGlow.active)s.markerGlow.active=false;
                    if(s.marker.active)s.marker.active=false;
                }else{
                    // 先保留一个可见的高亮瞬间，再让白点和光晕同步消失。
                    const alpha=Math.round(255*(1-clamp((s.markerGlowAge-.05)/(MARKER_FLASH_SECONDS-.05))));
                    if(s.markerGlowOpacity.opacity!==alpha)s.markerGlowOpacity.opacity=alpha;
                    if(s.markerOpacity.opacity!==alpha)s.markerOpacity.opacity=alpha;
                }
            }
            if(s.innerGlow.active){
                s.innerGlowAge=Math.min(INNER_GLOW_SECONDS,s.innerGlowAge+dt);
                if(s.innerGlowAge>=INNER_GLOW_SECONDS)s.innerGlow.active=false;
                else {
                    const glowProgress=s.innerGlowAge/INNER_GLOW_SECONDS;
                    const alpha=Math.round(230*(1-glowProgress)*(1-glowProgress));
                    if(s.innerGlowOpacity.opacity!==alpha)s.innerGlowOpacity.opacity=alpha;
                }
            }
            for(const ripple of s.ripples) {
                if(!ripple.node.active)continue;
                ripple.age=Math.min(RIPPLE_SECONDS,ripple.age+dt);
                if(ripple.age>=RIPPLE_SECONDS){ripple.node.active=false;continue;}
                const progress=ripple.age/RIPPLE_SECONDS;
                const diameter=Math.round(RIPPLE_START_DIAMETER+(RIPPLE_END_DIAMETER-RIPPLE_START_DIAMETER)*(1-(1-progress)*(1-progress)));
                const alpha=Math.round(180*(1-progress)*(1-progress));
                if(ripple.diameter!==diameter){ripple.diameter=diameter;ripple.node.setScale(diameter/120,diameter/120,1);}
                if(ripple.opacity.opacity!==alpha)ripple.opacity.opacity=alpha;
            }

        }
    }
    private clearRipples(s:Side) {
        s.rippleNext=0;
        s.markerGlowAge=MARKER_FLASH_SECONDS;
        if(s.marker.active)s.marker.active=false;
        if(s.markerOpacity.opacity!==255)s.markerOpacity.opacity=255;
        if(s.markerGlow.active)s.markerGlow.active=false;
        s.innerGlowAge=INNER_GLOW_SECONDS;
        if(s.innerGlow.active)s.innerGlow.active=false;
        for(const ripple of s.ripples){ripple.age=RIPPLE_SECONDS;if(ripple.node.active)ripple.node.active=false;}
    }
    updateSide(side:StrokeType,guide:StrokeTimingGuide) {
        if(!this.visible)return;const s=this.sides[side===StrokeType.RIGHT?1:0];
        if(guide.active){
            s.markerGlowAge=MARKER_FLASH_SECONDS;
            if(s.markerGlowOpacity.opacity!==MARKER_GLOW_IDLE_OPACITY)s.markerGlowOpacity.opacity=MARKER_GLOW_IDLE_OPACITY;
            if(s.markerOpacity.opacity!==255)s.markerOpacity.opacity=255;
        }
        const markerVisible=guide.active||s.markerGlowAge<MARKER_FLASH_SECONDS;
        if(s.marker.active!==markerVisible)s.marker.active=markerVisible;
        if(s.markerGlow.active!==markerVisible)s.markerGlow.active=markerVisible;
        const endRatio=Math.max(.001,guide.displayEndRatio ?? 1);
        if(guide.active){
            this.position(s.marker,guide.currentRatio/endRatio,s.sign);
            if(s.markerGlow.active)this.position(s.markerGlow,guide.currentRatio/endRatio,s.sign);
        }
        let used=0,inPerfect=false;
        for(const interval of guide.intervals){
            if(interval.rating!==Rating.PERFECT||interval.endRatio<=interval.startRatio)continue;
            if(guide.active&&guide.currentRatio>=interval.startRatio&&guide.currentRatio<=interval.endRatio)inPerfect=true;
            if(used===s.bands.length)break;
            const band=s.bands[used],a=clamp(interval.startRatio/endRatio),b=clamp(interval.endRatio/endRatio);
            if(used===0)s.zoneRatio=(a+b)*.5;
            if(!band.node.active)band.node.active=true;
            // 贴图有4px上留白，路径有效高度177px；与白点完全同一映射。
            const start=1-(4+177*b)/186,range=177*(b-a)/186;
            if(band.fillStart!==start)band.fillStart=start;if(band.fillRange!==range)band.fillRange=range;
            if(!s.starts[used].active)s.starts[used].active=true;
            if(!s.ends[used].active)s.ends[used].active=true;
            this.position(s.starts[used],a,s.sign,true);this.position(s.ends[used],b,s.sign,true);
            used++;
        }
        if(s.inPerfect!==inPerfect){s.inPerfect=inPerfect;s.handSprite.color=inPerfect?HAND_READY:WHITE;s.markerSprite.color=inPerfect?HAND_READY:WHITE;}
        for(let i=used;i<s.bands.length;i++){if(s.bands[i].node.active)s.bands[i].node.active=false;if(s.starts[i].active)s.starts[i].active=false;if(s.ends[i].active)s.ends[i].active=false;}
    }
    showPraise(side:StrokeType|undefined,text:string,color:Color|undefined,combo:number) {
        if(!this.visible)return;
        if(!text){for(const s of this.sides)s.lastTier=0;return;}
        const s=this.sides[side===StrokeType.RIGHT?1:0];
        const art=PRAISE_ART[text];if(!art)return;
        if(s.praiseKey!==text){
            s.praiseKey=text;s.praise.spriteFrame=this.frame(art.key);
            s.praise.node.getComponent(UITransform)!.setContentSize(art.width,art.height);
            // 图片只调整排版，不做镜像、染色或非等比拉伸。
            s.praise.node.setPosition(s.sign*art.width/2,0);
        }
        // 固定在定稿下方评价位置；只缩短与弧线的水平间距，不跟随动态绿色区移动。
        s.feedback.setPosition(s.sign*335,-533);
        const count=combo>0?'x'+combo:'';if(s.combo.string!==count)s.combo.string=count;
        Tween.stopAllByTarget(s.feedback);Tween.stopAllByTarget(s.feedbackOpacity);s.feedbackOpacity.opacity=255;
        s.feedback.setScale(combo>=3 && Math.min(6,combo)>s.lastTier ? POP_STRONG : POP);tween(s.feedback).to(.16,{scale:REST},{easing:'backOut'}).start();
        tween(s.feedbackOpacity).delay(.6).to(.25,{opacity:0}).start();s.lastTier=Math.min(6,combo);
    }
    private position(n:Node,ratio:number,sign:number,boundary=false) {
        const r=clamp(ratio),v=r*32,i=Math.min(31,Math.floor(v)),f=v-i;
        const x=Math.round((ARC_X[i]+(ARC_X[i+1]-ARC_X[i])*f)*sign),y=-Math.round(401+177*r);
        if(n.position.x!==x||n.position.y!==y)n.setPosition(x,y);
        if(boundary){const angle=Math.round(Math.atan2(sign*(ARC_X[i+1]-ARC_X[i]),177/32)*180/Math.PI);if(n.angle!==angle)n.angle=angle;}
    }
    private label(parent:Node,name:string,text:string,x:number,y:number,w:number,h:number,size:number):Label {
        const n=makeUiNode(name,parent),l=n.addComponent(Label);l.overflow=Label.Overflow.SHRINK;l.enableWrapText=false;l.string=text;l.fontSize=size;l.color=WHITE;l.enableOutline=true;l.outlineWidth=1.5;l.outlineColor=OUTLINE;l.horizontalAlign=Label.HorizontalAlign.CENTER;l.verticalAlign=Label.VerticalAlign.CENTER;styleProjectUiLabel(l,'semibold',size+7);n.getComponent(UITransform)!.setContentSize(w,h);n.setPosition(x,y);return l;
    }
}
function clamp(v:number){return Math.max(0,Math.min(1,v));}
