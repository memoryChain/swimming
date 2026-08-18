import { Camera, Color, Label, LabelOutline, Layers, Node, RenderTexture, Sprite, SpriteFrame, UITransform, Vec3, view } from 'cc';
import type { SharkController } from '../entity/SharkController';
import { SHARK_TUNING, SharkState } from '../entity/SharkTuning';
import type { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { SWIMMER_LAYER, UNDERWATER_LAYER } from '../venue/WaterSurfaceBinder';
import { makeLabel, makeRoundedRect, makeUiNode, uiColor } from '../ui/RuntimeUiFactory';

const FEED_WIDTH = 224;
const FEED_HEIGHT = 126;
const PANEL_HEIGHT = 164;
const PANEL_MARGIN = 18;
const RENDER_INTERVAL_SECONDS = 1 / 30;

const WARNING_COLOR = new Color(255, 190, 86, 255);
const HUNT_COLOR = new Color(255, 82, 72, 255);
const FEED_CLEAR_COLOR = new Color(13, 48, 86, 255);

export type SharkPictureInPictureOptions = {
    worldRoot: Node;
    hud: Node;
    course: RaceCourseLayout;
};

// A local-only presentation feed for the globally-authoritative shark event. It deliberately
// observes the restored SharkController state rather than simulating target selection or movement.
// The compact RT is rendered only while the shark exists, at a capped cadence suitable for WeChat.
export class SharkPictureInPictureCamera {
    private _camera: Camera | null = null;
    private _cameraNode: Node | null = null;
    private _renderTexture: RenderTexture | null = null;
    private _spriteFrame: SpriteFrame | null = null;
    private _root: Node | null = null;
    private _statusLabel: Label | null = null;
    private _active = false;
    private _lastState = SharkState.INACTIVE;
    private _renderElapsed = RENDER_INTERVAL_SECONDS;
    private _warningPush = 0;
    private _biteHoldSeconds = 0;
    private _lastFov = 46;
    private readonly _cameraPosition = new Vec3();
    private readonly _focus = new Vec3();
    private readonly _biteHoldCameraPosition = new Vec3();
    private readonly _biteHoldFocus = new Vec3();

    constructor(private readonly _options: SharkPictureInPictureOptions) {
        this.buildCamera();
        this.buildHud();
    }

    update(shark: SharkController | null, dt: number): void {
        const safeDt = Math.max(0, dt);
        const active = !!shark?.active && !!shark.node?.activeInHierarchy;
        let holdBiteView = false;
        if (active && shark) {
            this.setVisible(true);
            this.presentState(shark.state);
            this.updateWarningPush(shark, safeDt);
            if (shark.state === SharkState.BITE) {
                this._biteHoldSeconds = Math.max(0, SHARK_TUNING.biteCameraHoldSeconds);
            }
        } else if (this._biteHoldSeconds > 0) {
            this._biteHoldSeconds = Math.max(0, this._biteHoldSeconds - safeDt);
            if (this._biteHoldSeconds <= 0) {
                this.setVisible(false);
                return;
            }
            this.setVisible(true);
            holdBiteView = true;
        } else {
            this.setVisible(false);
            return;
        }

        this._renderElapsed += safeDt;
        if (this._renderElapsed < RENDER_INTERVAL_SECONDS) {
            const camera = this._camera;
            if (camera?.isValid && camera.enabled) {
                camera.enabled = false;
            }
            return;
        }
        this._renderElapsed %= RENDER_INTERVAL_SECONDS;
        if (holdBiteView) {
            this._cameraNode!.setPosition(this._biteHoldCameraPosition);
            this._cameraNode!.lookAt(this._biteHoldFocus);
            this.setFov(34);
        } else if (shark) {
            this.updateCameraPose(shark);
            if (shark.state === SharkState.BITE) {
                this._biteHoldCameraPosition.set(this._cameraPosition);
                this._biteHoldFocus.set(this._focus);
            }
        }
        const camera = this._camera;
        if (camera?.isValid && !camera.enabled) {
            camera.enabled = true;
        }
    }

    dispose(): void {
        if (this._camera?.isValid) {
            this._camera.targetTexture = null;
            this._camera.enabled = false;
        }
        if (this._cameraNode?.isValid) {
            this._cameraNode.destroy();
        }
        if (this._root?.isValid) {
            this._root.destroy();
        }
        this._spriteFrame?.destroy();
        this._renderTexture?.destroy();
        this._camera = null;
        this._cameraNode = null;
        this._renderTexture = null;
        this._spriteFrame = null;
        this._root = null;
        this._statusLabel = null;
    }

    private buildCamera(): void {
        const node = new Node('SharkPictureInPictureCamera');
        node.setParent(this._options.worldRoot);
        node.layer = Layers.Enum.DEFAULT;
        const camera = node.addComponent(Camera);
        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        // Reuse the same pool-bottom scene used by the original feed. It keeps the
        // established water quality without allocating an additional render pass.
        camera.visibility = SWIMMER_LAYER | UNDERWATER_LAYER;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = FEED_CLEAR_COLOR;
        camera.near = 0.1;
        camera.far = 100;
        camera.fov = 46;
        camera.priority = -4;
        camera.enabled = false;

        const texture = new RenderTexture('SharkPictureInPictureRT');
        texture.reset({ width: FEED_WIDTH, height: FEED_HEIGHT });
        camera.targetTexture = texture;

        this._cameraNode = node;
        this._camera = camera;
        this._renderTexture = texture;
    }

    private buildHud(): void {
        const hud = this._options.hud;
        const visibleSize = view.getVisibleSize();
        const root = makeRoundedRect(
            'SharkPictureInPicture',
            hud,
            FEED_WIDTH + 12,
            PANEL_HEIGHT,
            uiColor(5, 16, 30, 232),
            10,
            uiColor(91, 174, 221, 215),
            2,
        );
        root.setPosition(
            visibleSize.width * 0.5 - (FEED_WIDTH + 12) * 0.5 - PANEL_MARGIN,
            visibleSize.height * 0.5 - PANEL_HEIGHT * 0.5 - PANEL_MARGIN,
            0,
        );

        const titleNode = makeLabel('Title', root, '鲨鱼镜头', 18, uiColor(224, 243, 255));
        titleNode.getComponent(UITransform)!.setContentSize(FEED_WIDTH, 26);
        titleNode.setPosition(0, PANEL_HEIGHT * 0.5 - 16, 0);
        const title = titleNode.getComponent(Label)!;
        title.isBold = true;

        const statusNode = makeLabel('Status', root, '', 14, WARNING_COLOR);
        statusNode.getComponent(UITransform)!.setContentSize(FEED_WIDTH, 20);
        statusNode.setPosition(0, PANEL_HEIGHT * 0.5 - 37, 0);
        const status = statusNode.getComponent(Label)!;
        const outline = statusNode.addComponent(LabelOutline);
        outline.color = uiColor(0, 6, 14, 230);
        outline.width = 2;

        const image = makeUiNode('Feed', root);
        image.getComponent(UITransform)!.setContentSize(FEED_WIDTH, FEED_HEIGHT);
        image.setPosition(0, -13, 0);
        const sprite = image.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const spriteFrame = new SpriteFrame();
        spriteFrame.texture = this._renderTexture!;
        sprite.spriteFrame = spriteFrame;

        root.active = false;
        this._root = root;
        this._statusLabel = status;
        this._spriteFrame = spriteFrame;
    }

    private setVisible(active: boolean): void {
        if (this._active === active) {
            return;
        }
        this._active = active;
        this._renderElapsed = RENDER_INTERVAL_SECONDS;
        const root = this._root;
        if (root?.isValid && root.active !== active) {
            root.active = active;
        }
        const camera = this._camera;
        if (camera?.isValid && !active && camera.enabled) {
            camera.enabled = false;
        }
        if (!active) {
            this._lastState = SharkState.INACTIVE;
            this._warningPush = 0;
            this._biteHoldSeconds = 0;
        }
    }

    private presentState(state: SharkState): void {
        if (state === this._lastState) {
            return;
        }
        this._lastState = state;
        const label = this._statusLabel;
        if (!label) {
            return;
        }
        const isBiting = state === SharkState.BITE;
        const isHunting = state === SharkState.HUNT || isBiting;
        const text = isBiting ? '吞没目标中' : isHunting ? '正在追击最近选手' : '已落水，锁定目标中';
        if (label.string !== text) {
            label.string = text;
        }
        const color = isHunting ? HUNT_COLOR : WARNING_COLOR;
        if (label.color.r !== color.r || label.color.g !== color.g || label.color.b !== color.b || label.color.a !== color.a) {
            label.color = color;
        }
    }

    private updateCameraPose(shark: SharkController): void {
        const sharkPosition = shark.node.position;
        const targetPosition = shark.target?.node?.position ?? null;
        const waterY = this._options.course.waterY;
        if (!targetPosition || shark.state === SharkState.WARNING) {
            // The warning opens on a broad pool view, then steadily pushes toward the
            // shark. This keeps the summon readable before showing its body swimming.
            const targetX = targetPosition?.x ?? sharkPosition.x;
            const targetZ = targetPosition?.z ?? sharkPosition.z;
            const dx = targetX - sharkPosition.x;
            const dz = targetZ - sharkPosition.z;
            const length = Math.sqrt(dx * dx + dz * dz);
            const forwardX = length > 0.001 ? dx / length : 1;
            const forwardZ = length > 0.001 ? dz / length : 0;
            const sideX = -forwardZ;
            const sideZ = forwardX;
            const wideFocusX = (sharkPosition.x + targetX) * 0.5;
            const wideFocusZ = (sharkPosition.z + targetZ) * 0.5;
            const closeFocusX = sharkPosition.x + forwardX * 0.8;
            const closeFocusZ = sharkPosition.z + forwardZ * 0.8;
            const push = this._warningPush;
            this._focus.set(
                wideFocusX + (closeFocusX - wideFocusX) * push,
                waterY + 0.04,
                wideFocusZ + (closeFocusZ - wideFocusZ) * push,
            );
            this._cameraPosition.set(
                sharkPosition.x + sideX * 3.1 * push - forwardX * 1.15 * push,
                waterY + 17 - 14.2 * push,
                sharkPosition.z + 8.5 * (1 - push) + sideZ * 3.1 * push - forwardZ * 1.15 * push,
            );
            this.setFov(56 - 20 * push);
        } else if (shark.state === SharkState.BITE) {
            const dx = targetPosition.x - sharkPosition.x;
            const dz = targetPosition.z - sharkPosition.z;
            const length = Math.sqrt(dx * dx + dz * dz);
            const forwardX = length > 0.001 ? dx / length : 1;
            const forwardZ = length > 0.001 ? dz / length : 0;
            const sideX = -forwardZ;
            const sideZ = forwardX;
            this._focus.set(
                sharkPosition.x + forwardX * 0.45,
                waterY - 0.16,
                sharkPosition.z + forwardZ * 0.45,
            );
            this._cameraPosition.set(
                sharkPosition.x - forwardX * 0.9 + sideX * 2.7,
                waterY + 1.05,
                sharkPosition.z - forwardZ * 0.9 + sideZ * 2.7,
            );
            this.setFov(34);
        } else {
            // Pursuit shot: keep the shark as the composition anchor. Centering the
            // shark/target midpoint made distant targets pull the shark out of the
            // small feed, leaving an unhelpful water-only picture.
            const dx = targetPosition.x - sharkPosition.x;
            const dz = targetPosition.z - sharkPosition.z;
            const length = Math.sqrt(dx * dx + dz * dz);
            const forwardX = length > 0.001 ? dx / length : 1;
            const forwardZ = length > 0.001 ? dz / length : 0;
            const sideX = length > 0.001 ? -dz / length : 0;
            const sideZ = length > 0.001 ? dx / length : 1;
            const targetLead = Math.min(1.35, length * 0.32);
            this._focus.set(
                sharkPosition.x + forwardX * targetLead,
                waterY - 0.08,
                sharkPosition.z + forwardZ * targetLead,
            );
            this._cameraPosition.set(
                sharkPosition.x - forwardX * 1.5 + sideX * 3.8,
                waterY + 1.35,
                sharkPosition.z - forwardZ * 1.5 + sideZ * 3.8,
            );
            this.setFov(40);
        }
        this._cameraNode!.setPosition(this._cameraPosition);
        this._cameraNode!.lookAt(this._focus);
    }

    private updateWarningPush(shark: SharkController, dt: number): void {
        if (shark.state !== SharkState.WARNING) {
            this._warningPush = 1;
            return;
        }
        const duration = Math.max(0.001, SHARK_TUNING.warningSeconds);
        const desired = Math.max(0, Math.min(1, 1 - shark.remainingSeconds / duration));
        const smooth = Math.min(1, dt * 4.5);
        this._warningPush += (desired - this._warningPush) * smooth;
    }

    private setFov(value: number): void {
        if (Math.abs(value - this._lastFov) < 0.05) {
            return;
        }
        this._lastFov = value;
        if (this._camera?.isValid) {
            this._camera.fov = value;
        }
    }
}
