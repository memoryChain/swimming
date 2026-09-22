import { Node, Quat } from 'cc';
import { findNode } from './CharacterModelLoader';

// C1 mounts.json 的只读骨架采样：相对 Spine02 的位置、旋转与逆缩放。
// 重新采样见 art/timed-water-balloon/export_review.cjs，不修改角色源资产。
export const TIMED_WATER_BALLOON_MOUNTS: Readonly<Record<string, readonly number[]>> = {
    "muscleMan": [
        0.00018434,
        0.01100506,
        0.09723674,
        0.00624493,
        0.74578737,
        0.66613146,
        0.00557771,
        0.59737157,
        0.59737157,
        0.59737157
    ],
    "cartonSwimmer5": [
        0.00011558,
        0.00689896,
        0.06095679,
        0.006245,
        0.74578735,
        0.66613142,
        0.00557764,
        0.74074083,
        0.74074056,
        0.74074083
    ],
    "cartonSwimmer6": [
        0.00014764,
        0.0088142,
        0.07787918,
        0.00624494,
        0.74578729,
        0.66613146,
        0.00557776,
        0.76365034,
        0.76365025,
        0.76365038
    ],
    "cartonSwimmer8": [
        0.00018511,
        0.01105096,
        0.09764232,
        0.00624493,
        0.74578737,
        0.66613146,
        0.00557771,
        0.72621641,
        0.72621641,
        0.72621641
    ],
    "cartonSwimmer9": [
        0.00010278,
        0.0061355,
        0.05421109,
        0.00624501,
        0.74578735,
        0.6661314,
        0.00557767,
        0.74074078,
        0.74074065,
        0.74074061
    ],
    "cartonSwimmer10": [
        0.00015074,
        0.00899778,
        0.07950115,
        0.00624503,
        0.74578731,
        0.66613144,
        0.00557764,
        0.72621646,
        0.72621633,
        0.7262162
    ],
    "cartonSwimmer11": [
        0.00020751,
        0.01238671,
        0.10944447,
        0.00624499,
        0.74578736,
        0.66613141,
        0.00557764,
        0.69881219,
        0.69881206,
        0.69881206
    ],
    "cartonSwimmer12": [
        0.00015316,
        0.00914224,
        0.08077742,
        0.00624503,
        0.74578742,
        0.66613139,
        0.00557761,
        0.7407407,
        0.74074065,
        0.74074078
    ],
    "cartonSwimmer13": [
        0.00025105,
        0.01498678,
        0.13241762,
        0.00624489,
        0.7457874,
        0.66613137,
        0.00557763,
        0.71225071,
        0.71225071,
        0.71225071
    ],
    "cartonSwimmer14": [
        0.00014398,
        0.00859505,
        0.07594255,
        0.00624494,
        0.74578747,
        0.66613135,
        0.00557768,
        0.74074074,
        0.74074074,
        0.74074074
    ],
    "cartonSwimmer15": [
        0.00019386,
        0.01157286,
        0.10225366,
        0.00624493,
        0.74578737,
        0.66613146,
        0.00557771,
        0.66137566,
        0.66137566,
        0.66137566
    ]
};

export function createTimedWaterBalloonMount(model: Node, variantId: string): Node | null {
    const spine = findNode(model, 'Spine02');
    const config = TIMED_WATER_BALLOON_MOUNTS[variantId];
    if (!spine || !config) return null;
    const node = new Node('TimedWaterBalloonMount');
    node.setParent(spine);
    node.layer = model.layer;
    node.setPosition(config[0], config[1], config[2]);
    node.setRotation(new Quat(config[3], config[4], config[5], config[6]));
    node.setScale(config[7], config[8], config[9]);
    return node;
}
