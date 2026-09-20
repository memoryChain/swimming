import { Node, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import type { CharacterAbilityId } from '../core/CharacterAbilityConfig';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { makeUiNode } from './RuntimeUiFactory';

/** 大厅与角色详情共用；只在能力切换时加载，节点及监听保持稳定。 */
export class CharacterSkillIcon {
    readonly node: Node;
    private readonly _sprite: Sprite;
    private _abilityId: CharacterAbilityId | undefined;
    private _request = 0;
    private _frame: SpriteFrame | null = null;

    constructor(parent: Node, private readonly _diameter: number, private readonly _fallback: Node | null = null) {
        this.node = makeUiNode('SkillIcon', parent);
        this.node.active = false;
        this._sprite = this.node.addComponent(Sprite);
        this._sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._sprite.trim = false;
        this.node.once(Node.EventType.NODE_DESTROYED, () => {
            ++this._request;
            this._frame?.destroy();
            this._frame = null;
        });
    }

    setAbility(abilityId: CharacterAbilityId): void {
        if (!this.node.isValid || abilityId === this._abilityId) return;
        this._abilityId = abilityId;
        const request = ++this._request;
        this.setVisible(false);
        if (abilityId === 'none') return;

        // 教练沿用已确认的 46×44 排版；新图保留源稿留白，按同一圆底比例展示。
        const coach = abilityId === 'breathControl';
        // 池壁、呼吸管和闪光靠近方形画布角部，略缩小以避开圆底内缘。
        const scale = abilityId === 'wallKick' ? 0.70
            : abilityId === 'kickDive' ? 0.75
                : abilityId === 'precision' ? 0.79 : 0.86;
        const width = this._diameter * (coach ? 46 / 74 : scale);
        const height = this._diameter * (coach ? 44 / 74 : scale);
        const transform = this.node.getComponent(UITransform)!;
        if (transform.contentSize.width !== width || transform.contentSize.height !== height) {
            transform.setContentSize(width, height);
        }
        const y = coach ? this._diameter / 74 : 0;
        if (this.node.position.y !== y || this.node.position.z !== 1) this.node.setPosition(0, y, 1);
        const path = RESOURCE_PATHS.characterSkillIcons[abilityId];
        loadRaceAsset(path, Texture2D, (error, texture) => {
            if (!this.node.isValid || !this._sprite.isValid || request !== this._request) return;
            if (error || !texture) {
                this._abilityId = undefined; // 允许下一次界面刷新重试。
                console.warn(`[CharacterSkillIcon] 技能图标加载失败：${path}`, error);
                return;
            }
            const previous = this._frame;
            const frame = new SpriteFrame();
            frame.texture = texture;
            this._frame = frame;
            this._sprite.spriteFrame = frame;
            previous?.destroy();
            this.setVisible(true);
        });
    }

    private setVisible(visible: boolean): void {
        if (this.node.active !== visible) this.node.active = visible;
        if (this._fallback?.isValid && this._fallback.active === visible) this._fallback.active = !visible;
    }
}
