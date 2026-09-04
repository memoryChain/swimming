import { _decorator, Camera, Color, Component, DirectionalLight, Layers, Material, Node, RenderTexture, Vec3 } from 'cc';
import {
    CharacterAction,
    sampledActionIdFor,
    selectActionFromPool,
} from '../character/CharacterActionConfig';
import { loadSampledAction } from '../character/SampledActionLoader';
import { CartoonSwimmerRig } from '../entity/CartoonSwimmerRig';
import { findPlayerCharacter, PlayerCharacterId, selectedPlayerColorScheme, selectedPlayerSkinTone } from './PlayerCharacterConfig';

const { ccclass } = _decorator;
const PREVIEW_CHARACTER_SCALE = 1.3;
const LOBBY_CHARACTER_SCALE = 1.58;
const PREVIEW_CHARACTER_Y_OFFSET = -0.99;
// Small lift of the showcase model so the central preview reads slightly higher
// on the prepare-race screen. Paired with PREPARE_RACE_MODEL_LIFT (px) in
// PrepareRaceFlow, which moves the floor shadow and rotate surface the same way.
const PREVIEW_CHARACTER_LIFT = 0.2;
const PREVIEW_CAMERA_TARGET = new Vec3(0, 0.88, 0);
const LOBBY_CAMERA_TARGET = new Vec3(0.28, 1.04, 0);
const LOBBY_FRONT_YAW_DEGREES = -37.3;
const SHADOW_SILHOUETTE_LAYER = 1 << 22;
const SHADOW_TEXTURE_SIZE = 192;
const CHARACTER_SELECT_ACTIONS: readonly CharacterAction[] = [
    CharacterAction.ArmStretching,
    CharacterAction.Happy,
    CharacterAction.WavingGesture,
];

// Lightweight 3D showcase rendered over the 2D prepare-race UI. It deliberately
// uses the production rig/model loader so a choice made here has the same visual
// identity as the swimmer that enters the race.
@ccclass('PrepareRaceCharacterPreview')
export class PrepareRaceCharacterPreview extends Component {
    private _cameraNode: Node | null = null;
    private _lightNode: Node | null = null;
    private _pivotNode: Node | null = null;
    private _swimmerNode: Node | null = null;
    private _shadowSilhouetteProxy: Node | null = null;
    private _shadowCameraNode: Node | null = null;
    private _shadowCamera: Camera | null = null;
    private _shadowTexture: RenderTexture | null = null;
    private _rig: CartoonSwimmerRig | null = null;
    private _yawDegrees = 0;
    private _centered = false;
    private _showcaseActionLoadToken = 0;
    private _selectedCharacterId = '';
    private _showcaseAction = CharacterAction.ArmStretching;
    private _lobbyPresentation = false;
    private _shadowCaptureEnabled = true;
    private readonly _modelPivot = new Vec3();
    private readonly _modelPivotInRotationRoot = new Vec3();
    private readonly _groundShadowPosition = new Vec3();

    get shadowTexture(): RenderTexture | null {
        return this._shadowTexture;
    }

    setLobbyPresentation(enabled: boolean, shadowCaptureEnabled = !enabled) {
        const presentationChanged = this._lobbyPresentation !== enabled;
        const shadowChanged = this._shadowCaptureEnabled !== shadowCaptureEnabled;
        if (!presentationChanged && !shadowChanged) return;
        this._lobbyPresentation = enabled;
        this._shadowCaptureEnabled = shadowCaptureEnabled;
        if (presentationChanged) {
            const scale = enabled ? LOBBY_CHARACTER_SCALE : PREVIEW_CHARACTER_SCALE;
            if (this._pivotNode?.isValid && this._pivotNode.scale.x !== scale) {
                this._pivotNode.setScale(scale, scale, scale);
            }
            this._yawDegrees = enabled ? LOBBY_FRONT_YAW_DEGREES : 0;
            this._pivotNode?.setRotationFromEuler(0, this._yawDegrees, 0);
            this._cameraNode?.lookAt(enabled ? LOBBY_CAMERA_TARGET : PREVIEW_CAMERA_TARGET);
        }
        if (this._shadowCamera) this._shadowCamera.enabled = this._shadowCaptureEnabled;
        if (this._shadowCaptureEnabled && this._rig && !this._shadowCamera) this.ensureShadowCapture();
    }

    onLoad() {
        this.node.layer = Layers.Enum.DEFAULT;
        this.buildCameraAndLight();
    }

    refresh(characterId?: PlayerCharacterId) {
        const character = findPlayerCharacter(characterId);
        if (!character) return;
        // Page/tab transitions can ask to present the same character again. Keep
        // the existing rig and showcase action alive unless the model identity
        // actually changed; appearance updates have their own lightweight path.
        if (character.id === this._selectedCharacterId && this._rig && this._pivotNode?.isValid) {
            this.applyAppearance();
            return;
        }
        if (character.id !== this._selectedCharacterId) {
            this._selectedCharacterId = character.id;
            this._showcaseAction = selectActionFromPool(CHARACTER_SELECT_ACTIONS)
                ?? CharacterAction.ArmStretching;
        }
        this._shadowSilhouetteProxy?.destroy();
        this._shadowSilhouetteProxy = null;
        this._pivotNode?.destroy();
        const pivot = new Node('PrepareRaceCharacterPivot');
        pivot.layer = Layers.Enum.DEFAULT;
        pivot.setParent(this.node);
        // The flat locker-room backdrop reads its foreground floor near the
        // rotation hint. Place the preview there and scale it up so the
        // character feels present in the room instead of far away in the door.
        const presentationScale = this._lobbyPresentation ? LOBBY_CHARACTER_SCALE : PREVIEW_CHARACTER_SCALE;
        pivot.setScale(presentationScale, presentationScale, presentationScale);
        const swimmer = new Node('PrepareRaceSelectedCharacter');
        swimmer.layer = Layers.Enum.DEFAULT;
        swimmer.setParent(pivot);
        swimmer.setPosition(0, 0, 0);

        const rig = swimmer.addComponent(CartoonSwimmerRig);
        const skin = selectedPlayerSkinTone(character.id);
        const palette = selectedPlayerColorScheme();
        rig.setModelVariant(character.modelVariantId);
        rig.build(
            new Color(...skin.color, 255),
            new Color(...palette.suit, 255),
            new Color(...palette.cap, 255),
            character.robotStyle === true,
            true,
            true,
            false,
        );
        rig.setSplashCulled(true);
        rig.setWaterlineEffectEnabled(false);
        rig.setCastShadow(false);
        rig.setShowcaseStanding();
        this._pivotNode = pivot;
        this._swimmerNode = swimmer;
        this._rig = rig;
        this.applyAppearance();
        if (this._shadowCaptureEnabled) this.ensureShadowCapture();
        this._centered = false;
        this.loadShowcaseAction(rig, this._showcaseAction);
    }

    rotateBy(deltaDegrees: number) {
        this._yawDegrees += deltaDegrees;
        this._pivotNode?.setRotationFromEuler(0, this._yawDegrees, 0);
    }

    // Material updates are intentionally separate from refresh(): the latter
    // rebuilds the model and restarts its showcase animation, while choosing a
    // skin tone or outfit palette should leave the current action uninterrupted.
    applyAppearance() {
        if (!this._rig) {
            return;
        }
        const skin = selectedPlayerSkinTone(this._selectedCharacterId as PlayerCharacterId);
        const palette = selectedPlayerColorScheme();
        this._rig.setColorOverride({
            skin: skin.preserveOriginal ? undefined : new Color(...skin.color, 255),
            suit: new Color(...palette.suit, 255),
            cap: new Color(...palette.cap, 255),
        });
    }

    update() {
        if (!this._pivotNode || !this._swimmerNode || !this._rig) return;
        if (!this._centered) {
            // Use the rig's hip-centred presentation pivot rather than a renderer
            // bounding box. Bounds move with poses, while imported armature roots
            // can be offset behind the character's body.
            this._pivotNode.setRotationFromEuler(0, 0, 0);
            this._pivotNode.setPosition(0, PREVIEW_CHARACTER_Y_OFFSET + PREVIEW_CHARACTER_LIFT, 0);
            if (!this._rig.getModelWorldPivot(this._modelPivot)) return;
            // getModelWorldPivot 返回世界坐标，而 swimmer 使用旋转根节点下的本地坐标。
            // 先转换坐标空间，避免外层预览缩放再次放大偏移量，导致旋转轴落在背后。
            this._pivotNode.inverseTransformPoint(this._modelPivotInRotationRoot, this._modelPivot);
            const swimmerPosition = this._swimmerNode.position;
            this._swimmerNode.setPosition(
                swimmerPosition.x - this._modelPivotInRotationRoot.x,
                swimmerPosition.y,
                swimmerPosition.z - this._modelPivotInRotationRoot.z,
            );
            this._pivotNode.setRotationFromEuler(0, this._yawDegrees, 0);
            this._centered = true;
        }
        this.updateShadowCapture();
    }

    private buildCameraAndLight() {
        const light = new Node('PrepareRacePreviewLight');
        light.layer = Layers.Enum.DEFAULT;
        light.setParent(this.node);
        // Overhead changing-room light: its planar shadow drops straight below
        // the standing character instead of stretching across the floor.
        light.setRotationFromEuler(-90, 0, 0);
        const directional = light.addComponent(DirectionalLight);
        directional.color = new Color(230, 245, 255, 255);
        directional.illuminance = 1.5;
        directional.shadowEnabled = true;
        this._lightNode = light;

        const cameraNode = new Node('PrepareRacePreviewCamera');
        cameraNode.layer = Layers.Enum.DEFAULT;
        cameraNode.setParent(this.node);
        cameraNode.setPosition(3.5, 1.5, 4.6);
        cameraNode.lookAt(this._lobbyPresentation ? LOBBY_CAMERA_TARGET : PREVIEW_CAMERA_TARGET);
        const camera = cameraNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        camera.visibility = Layers.BitMask.DEFAULT;
        camera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        camera.fov = 34;
        camera.near = 0.05;
        camera.far = 40;
        // Login's UI camera draws first; this camera then overlays only the
        // central 3D character without clearing the generated locker-room image.
        camera.priority = 1;
        this._cameraNode = cameraNode;
    }

    onDestroy() {
        this._showcaseActionLoadToken += 1;
        this._cameraNode?.destroy();
        this._lightNode?.destroy();
        this._shadowCameraNode?.destroy();
        this._shadowTexture?.destroy();
    }

    private ensureShadowCapture() {
        if (!this._shadowTexture) {
            const texture = new RenderTexture('PrepareRaceShadowRT');
            texture.reset({ width: SHADOW_TEXTURE_SIZE, height: SHADOW_TEXTURE_SIZE });
            this._shadowTexture = texture;
        }
        if (this._shadowCamera) {
            return;
        }
        const cameraNode = new Node('PrepareRaceShadowCamera');
        cameraNode.layer = Layers.Enum.DEFAULT;
        cameraNode.setParent(this.node);
        const camera = cameraNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.ORTHO;
        camera.orthoHeight = 2.8;
        camera.visibility = SHADOW_SILHOUETTE_LAYER;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = new Color(0, 0, 0, 0);
        camera.near = 0.05;
        camera.far = 20;
        // Capture before the UI camera samples this texture in the same frame.
        camera.priority = -1;
        camera.targetTexture = this._shadowTexture;
        this._shadowCameraNode = cameraNode;
        this._shadowCamera = camera;
    }

    private updateShadowCapture() {
        if (!this._shadowCaptureEnabled) return;
        if (!this._rig?.getGroundContactWorldPosition(this._groundShadowPosition)) {
            return;
        }
        const cameraNode = this._shadowCameraNode;
        if (cameraNode) {
            cameraNode.setPosition(
                this._groundShadowPosition.x,
                this._groundShadowPosition.y + 4.5,
                this._groundShadowPosition.z,
            );
            cameraNode.lookAt(this._groundShadowPosition);
        }
        if (!this._shadowSilhouetteProxy?.isValid && this._pivotNode) {
            const material = new Material();
            material.initialize({ effectName: 'builtin-unlit', technique: 1 });
            material.name = 'PrepareRaceRealtimeShadowSilhouette';
            material.setProperty('mainColor', new Color(0, 0, 0, 142));
            this._shadowSilhouetteProxy = this._rig.createShadowSilhouetteProxy(
                this._pivotNode,
                material,
                SHADOW_SILHOUETTE_LAYER,
            );
        }
    }

    private loadShowcaseAction(rig: CartoonSwimmerRig, action: CharacterAction) {
        const token = ++this._showcaseActionLoadToken;
        const actionId = sampledActionIdFor(action);
        // Store the requested id on the rig immediately so model-specific action
        // overrides that finish first can activate the same randomly chosen pose.
        rig.setShowcaseAction(action);
        loadSampledAction(actionId, (error) => {
            if (error) {
                console.warn(`[SpeedSwimming] prepare-race showcase action failed to load action=${actionId}`, error);
                return;
            }
            // Character switching can replace the rig while the race bundle is
            // streaming. Only apply the action to the still-visible preview.
            if (token !== this._showcaseActionLoadToken || this._rig !== rig || !rig.node?.isValid) {
                return;
            }
            rig.setShowcaseAction(action);
            rig.setShowcaseStanding();
        });
    }
}
