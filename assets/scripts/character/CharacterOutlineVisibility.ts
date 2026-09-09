import { Node, Vec3 } from 'cc';
import { PERFORMANCE_CONFIG } from '../core/PerformanceConfig';
import type { Swimmer } from '../entity/Swimmer';

// 仅消费本机显示位置，AI 与远端真人共用相同策略，不改变任何比赛或联机状态。
export class CharacterOutlineVisibility {
    private _untilRefresh = 0;
    private readonly _cameraPosition = new Vec3();
    private readonly _swimmerPosition = new Vec3();

    update(dt: number, camera: Node | null, player: Swimmer, opponents: readonly Swimmer[]): void {
        if (!camera?.isValid) {
            return;
        }
        this._untilRefresh -= dt;
        if (this._untilRefresh > 0) {
            return;
        }
        const config = PERFORMANCE_CONFIG.characterOutline;
        this._untilRefresh = config.refreshSeconds;
        camera.getWorldPosition(this._cameraPosition);
        player.cartoonRig?.setOutlineVisible(true);

        for (let index = 0; index < opponents.length; index++) {
            const swimmer = opponents[index];
            const rig = swimmer.cartoonRig;
            if (!rig?.isValid || !swimmer.node.isValid) {
                continue;
            }
            if (swimmer === player) {
                continue;
            }
            if (!swimmer.node.activeInHierarchy) {
                rig.setOutlineVisible(false);
                continue;
            }
            swimmer.node.getWorldPosition(this._swimmerPosition);
            const distanceSquared = Vec3.squaredDistance(this._cameraPosition, this._swimmerPosition);
            const threshold = rig.outlineVisible
                ? config.opponentDisableDistance
                : config.opponentEnableDistance;
            rig.setOutlineVisible(distanceSquared <= threshold * threshold);
        }
    }
}
