/** 背景杂物整排避开危险及其短期运动带；不分配对象，不依赖显示或相机。 */
export function litterRowOverlapsDanger(rowX: number, dangerX: number,
    alongRadius: number, predictedTravel = 0): boolean {
    const end = dangerX + predictedTravel;
    return rowX >= Math.min(dangerX, end) - alongRadius
        && rowX <= Math.max(dangerX, end) + alongRadius;
}
