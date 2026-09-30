import { Label, Node, UITransform } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import type { InputRouter } from '../core/InputRouter';
import { makeLabel, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

/** 单人／八人测试读数；10Hz，隐藏时不读取姿态、不格式化、不重绘图形。 */
export class ButterflyDebugHud {
    private label: Label;
    private elapsed = 0;
    private displayedPhase = '';
    private displayedRepress = -1;
    private displayedProgress = -1;
    private displayedHeartRate = -1;
    private displayedQuality = NaN;
    private displayedTimedOut = false;
    private displayedCost = NaN;
    private displayedGain = NaN;

    constructor(parent: Node, width: number, height: number) {
        const node = makeLabel('ButterflyDebugStatus', parent, '', 19, uiColor(224, 250, 255));
        node.getComponent(UITransform).setContentSize(Math.min(820, width - 40), 60);
        node.setPosition(0, height / 2 - 124, 0);
        this.label = node.getComponent(Label);
        this.label.overflow = Label.Overflow.SHRINK;
        styleProjectUiLabel(this.label, 'regular', 26);
    }

    update(dt: number, visible: boolean,
        swimmer: Pick<Swimmer, 'butterflyState' | 'isButterflyRecoveryLocked' | 'butterflyAdmission'>,
        input?: Pick<InputRouter, 'butterflyRepressMask'>) {
        const node = this.label.node;
        if (node.active !== visible) node.active = visible;
        if (!visible || !node.activeInHierarchy) { this.elapsed = 0; return; }
        this.elapsed += dt;
        if (this.elapsed < 0.1) return;
        this.elapsed = 0;
        const beat = swimmer.butterflyState;
        if (!beat) return;
        let phase: string;
        if (beat.active && beat.held) phase = '蝶泳抱水 · 松手发力';
        else if (swimmer.isButterflyRecoveryLocked) phase = '回臂恢复中 · 可打腿，划臂等待';
        else if (beat.active) phase = '蝶泳回臂 · 可打腿，划臂等待';
        else {
            const admission = swimmer.butterflyAdmission;
            phase = admission === 'fallback' ? '当前按自由泳处理'
                : admission === 'wait' ? '等待手臂回收 · 可打腿' : '俯游就绪 · 可以进入蝶泳';
        }
        const repress = beat.held ? 0 : input?.butterflyRepressMask ?? 0;
        const progress = beat.active ? Math.round(beat.progress * 100) : 0;
        const heartRate = Math.round(beat.heartRate);
        // 先比较可见整数与事件读数，稳定状态不创建格式化字符串。
        if (phase === this.displayedPhase && repress === this.displayedRepress
            && progress === this.displayedProgress && heartRate === this.displayedHeartRate
            && beat.lastQuality === this.displayedQuality && beat.lastTimedOut === this.displayedTimedOut
            && beat.lastEnergyCost === this.displayedCost && beat.lastUltimateGain === this.displayedGain) return;
        this.displayedPhase = phase; this.displayedRepress = repress;
        this.displayedProgress = progress; this.displayedHeartRate = heartRate;
        this.displayedQuality = beat.lastQuality; this.displayedTimedOut = beat.lastTimedOut;
        this.displayedCost = beat.lastEnergyCost; this.displayedGain = beat.lastUltimateGain;
        const hint = repress === 1 ? ' · 左手需松开重按' : repress === 2 ? ' · 右手需松开重按'
            : repress === 3 ? ' · 双手需松开重按' : '';
        const rating = beat.lastQuality < 0 ? '等待第一拍' : beat.lastTimedOut ? '按住超时'
            : beat.lastQuality === 1 ? '完美' : beat.lastQuality > 0 ? '良好' : '松手偏早';
        const account = beat.lastQuality < 0 ? '按住更深，松手回浮，短按打腿'
            : `计费 ${beat.lastEnergyCost.toFixed(1)} 点 · 蓄气 +${beat.lastUltimateGain.toFixed(1)}`;
        const next = `${phase}${hint}　${progress}% · 起划心率 ${heartRate}\n上一拍：${rating}　${account}`;
        if (this.label.string !== next) this.label.string = next;
    }
}
