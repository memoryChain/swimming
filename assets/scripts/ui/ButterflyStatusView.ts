import { Label, Node, UITransform } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import type { InputRouter } from '../core/InputRouter';
import { butterflyDepthAllowsStroke } from '../core/ButterflyTuning';
import { makeLabel, uiColor } from './RuntimeUiFactory';
import { styleProjectUiLabel } from './ProjectUiFonts';

/** 启用蝶泳后才创建；正式操作提示与测试数值分开，10Hz 消费状态。 */
export class ButterflyStatusView {
    private readonly label: Label;
    private elapsed = 0.1;

    constructor(parent: Node) {
        const node = makeLabel('ButterflyStatus', parent, '', 20, uiColor(224, 250, 255));
        node.setPosition(0, -660, 0);
        this.label = node.getComponent(Label);
        this.label.overflow = Label.Overflow.SHRINK;
        this.label.enableWrapText = false;
        this.label.enableOutline = true;
        this.label.outlineColor = uiColor(0, 0, 0, 51);
        this.label.outlineWidth = 1.5;
        styleProjectUiLabel(this.label, 'semibold', 27);
        node.getComponent(UITransform).setContentSize(600, 36);
        node.active = false;
    }

    update(dt: number, visible: boolean,
        swimmer: Pick<Swimmer, 'butterflyState' | 'isButterflyRecoveryLocked' | 'butterflyAdmission' | 'motor'>,
        input?: Pick<InputRouter, 'butterflyRepressMask'>) {
        const node = this.label.node;
        // 父层隐藏时不访问选手或输入；不因自身隐藏而永久停止采样。
        if (!visible || !node.parent.activeInHierarchy) {
            if (node.active) node.active = false;
            this.elapsed = 0.1;
            return;
        }
        this.elapsed += Math.max(0, dt);
        if (this.elapsed < 0.1) return;
        this.elapsed %= 0.1;
        const beat = swimmer.butterflyState;
        let text = '';
        if (beat) {
            const motor = swimmer.motor;
            if (motor.isTurtleTowActive) text = '抓圈中 · 左右划水下车';
            else if (beat.active && beat.held) text = '蝶泳抱水 · 松手发力';
            else if (swimmer.isButterflyRecoveryLocked || beat.active) text = '回臂中 · 短按打腿，划臂等待';
            else if (!butterflyDepthAllowsStroke(motor.ability.depth)) text = '水下 · 当前按自由泳处理';
            else {
                const admission = swimmer.butterflyAdmission;
                const repress = input?.butterflyRepressMask ?? 0;
                text = admission === 'fallback' ? '当前按自由泳处理'
                    : repress === 1 ? '左手松开重按 · 再次双手起划'
                    : repress === 2 ? '右手松开重按 · 再次双手起划'
                    : repress === 3 ? '双手松开重按 · 再次双手起划'
                    : admission === 'wait' ? '手臂回收中 · 可短按打腿'
                    : '双手同按进入蝶泳 · 短按打腿';
            }
        }
        if (this.label.string !== text) this.label.string = text;
        if (node.active !== !!text) node.active = !!text;
    }
}
