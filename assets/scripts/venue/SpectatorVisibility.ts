// 8/9/10 为水面/池底/泳者，11/12 为转播屏及其水面；13 专用于观众和闪光。
export const SPECTATOR_LAYER = 1 << 13;

// 只改本相机的观众位，保留其他层；不写 crowdRoot.active，避免覆盖手动开关。
export function setSpectatorCameraUnderwater(camera: { visibility: number }, underwater: boolean): void {
    const visibility = underwater ? camera.visibility & ~SPECTATOR_LAYER : camera.visibility | SPECTATOR_LAYER;
    if (camera.visibility !== visibility) camera.visibility = visibility;
}
