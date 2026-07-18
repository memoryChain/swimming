import { Camera, Color, EventMouse, Label, Layers, Material, MeshRenderer, Node, primitives, utils, Vec3, view } from 'cc';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { SWIMMER_BALANCE } from '../core/GameBalance';
import { GameState, Rating, StrokeType } from '../core/GameConstants';
import { InputManager } from '../core/InputManager';
import { RaceManager } from '../core/RaceManager';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { DEBUG_SWIMMER_ACTION_PREVIEWS, DEBUG_SWIMMER_MODEL_VARIANTS, DEFAULT_SKYBOX_VARIANT, RESOURCE_PATHS, SKYBOX_VARIANTS, SWIMMER_0621_2_COLOR_VARIANTS, isDebugOnlySwimmerModelVariant } from '../core/ResourcePaths';
import type { DebugSwimmerActionPreview } from '../core/ResourcePaths';
import type { RhythmResult } from '../core/RhythmTypes';
import { formatStrokeQualityLog, nextStrokeQualityCombo, ratingForStrokeQuality, rhythmResultFromStrokeQuality } from '../core/StrokeQualityScoring';
import { CartoonSwimmerRig } from '../entity/CartoonSwimmerRig';
import { StrokeQualityResult } from '../swimmer/SwimmerMotor';
import { SwimmerMotor } from '../swimmer/SwimmerMotor';
import { UIFlowController } from '../ui/UIFlowController';
import { DEFAULT_POOL_DEFINITION } from '../venue/VenueConfig';
import { StandardSkyboxApplier } from './StandardSkyboxApplier';

const DEBUG_ACTION_LANE_WIDTH = DEFAULT_POOL_DEFINITION.laneWidth;
const DEBUG_ACTION_SPACING = 1.65;
const DEBUG_ACTION_GROUP_CENTER_X = 12;
const DEBUG_WATER_LENGTH = 8.8;
const DEBUG_WATER_WIDTH = Math.max(DEBUG_ACTION_LANE_WIDTH, (DEBUG_SWIMMER_ACTION_PREVIEWS.length - 1) * DEBUG_ACTION_SPACING + 2.4);
const DEBUG_WATER_HALF_WIDTH = DEBUG_WATER_WIDTH * 0.5;
const DEBUG_STANDING_WATER_CLEARANCE = 0.03;
const DEFAULT_MODEL_DEBUG_SPEED_SCALE = 1;

export type ModelDebugFlowRefs = {
    worldRoot: Node | null;
    cameraNode: Node | null;
    cameraPos: Vec3;
    cameraTarget: Vec3;
    playerLaneZ: number;
    inputManager: InputManager | null;
    raceManager: RaceManager | null;
    raceCameraDirector: RaceCameraDirector;
    playerSwimmer: Swimmer | null;
    aiSwimmers: Swimmer[];
    aiControllers: AISwimmerController[];
    uiFlow: UIFlowController;
    speedLabel: Label | null;
    ratingLabel: Label | null;
    swimSpeedLabel: Label | null;
    modelLabel: Label | null;
    actionLabel: Label | null;
    flipTurnButton: Node | null;
    skyboxLabel: Label | null;
    skyboxApplier: StandardSkyboxApplier | null;
    resetExtraAiSwimmers: () => void;
    returnToLogin: () => void;
    setState: (state: GameState) => void;
    debug: (message: string) => void;
};

type ModelDebugActionPreviewInstance = {
    config: DebugSwimmerActionPreview;
    laneIndex: number;
    node: Node;
    rig: CartoonSwimmerRig;
};

export class ModelDebugFlowController {
    private _active = false;
    private _cameraDragging = false;
    private _cameraYaw = 0;
    private _cameraPitch = 0.04;
    private _cameraDistance = 3.2;
    private _speedScale = DEFAULT_MODEL_DEBUG_SPEED_SCALE;
    private readonly _debugMotor = new SwimmerMotor();
    private _lastRating: Rating | null = null;
    private _lastCombo = 0;
    private _lastStrokeQuality = 0;
    private _modelVariantIndex = 0;
    private _actionPreviewIndex = Math.max(0, DEBUG_SWIMMER_ACTION_PREVIEWS.findIndex((preview) => preview.id === 'freestyle'));
    private _colorVariantIndex = 0;
    private _skyboxVariantIndex = Math.max(0, SKYBOX_VARIANTS.findIndex((variant) => variant.id === DEFAULT_SKYBOX_VARIANT.id));
    private readonly _hiddenDebugSceneNodes = new Map<Node, boolean>();
    private _debugWaterRoot: Node | null = null;
    private _actionPreviewRoot: Node | null = null;
    private readonly _actionPreviews: ModelDebugActionPreviewInstance[] = [];

    constructor(private readonly _refs: ModelDebugFlowRefs) {}

    get active(): boolean {
        return this._active;
    }

    enter(initialActionId = 'freestyle') {
        this._refs.debug('enterModelDebug');
        this._active = true;
        this._cameraYaw = 0;
        this._cameraPitch = 0.04;
        this._cameraDistance = this.isPortraitViewport() ? 6.5 : 5.5;
        this._cameraDragging = false;
        this._speedScale = DEFAULT_MODEL_DEBUG_SPEED_SCALE;
        this._lastRating = null;
        this._lastCombo = 0;
        this._lastStrokeQuality = 0;
        this._modelVariantIndex = Math.max(0, DEBUG_SWIMMER_MODEL_VARIANTS.findIndex((variant) => variant.id === this._refs.playerSwimmer?.cartoonRig?.modelVariantId));
        this._actionPreviewIndex = Math.max(0, DEBUG_SWIMMER_ACTION_PREVIEWS.findIndex((preview) => preview.id === initialActionId));
        this._colorVariantIndex = Math.max(0, SWIMMER_0621_2_COLOR_VARIANTS.findIndex((variant) => variant.id === this._refs.playerSwimmer?.cartoonRig?.colorVariantId));
        this._skyboxVariantIndex = Math.max(0, SKYBOX_VARIANTS.findIndex((variant) => variant.id === this._refs.skyboxApplier?.currentVariantId));
        this._debugMotor.startRace(0, SWIMMER_BALANCE.baseSpeed);

        if (this._refs.cameraNode) {
            this._refs.cameraPos.set(this._refs.cameraNode.position);
        }

        if (this._refs.inputManager) {
            this._refs.inputManager.modelDebugMode = true;
        }
        this.stopAllAi();
        this._refs.raceManager?.resetRace();
        this._refs.setState(GameState.READY);
        this._refs.uiFlow.showModelDebugHud();
        for (const swimmer of this._refs.aiSwimmers) {
            swimmer.node.active = false;
        }
        if (this._refs.playerSwimmer) {
            this._refs.playerSwimmer.reset();
            this._refs.playerSwimmer.cartoonRig?.setSkinOutfit('trunksA');
            this._refs.playerSwimmer.node.active = false;
        }
        this.hideNonPlayerWorldNodes(true);
        this.ensureActionPreviews();
        this.applyCurrentModelVariant();
        this.applyCurrentColorVariant();
        this.updateActionLabel();
        this.applySpeed();
        this.updateSkyboxLabel();
        this.updateDebugHud();
        this.updateDebugWaterReference();
        this.updateCamera(1);
        const camera = this._refs.cameraNode?.getComponent(Camera);
        if (camera) {
            camera.fov = this.isPortraitViewport() ? 34 : 28;
        }
    }

    exit(showStart: boolean) {
        if (!this._active) {
            return;
        }
        this._refs.debug('exitModelDebug');
        this._active = false;
        this._cameraDragging = false;
        if (this._refs.inputManager) {
            this._refs.inputManager.modelDebugMode = false;
        }
        this.restoreHiddenDebugSceneNodes();
        this.destroyDebugWaterReference();
        this.destroyActionPreviews();
        this._refs.uiFlow.hideModelDebugHud();
        for (const swimmer of this._refs.aiSwimmers) {
            swimmer.node.active = true;
        }
        this._refs.playerSwimmer?.cartoonRig?.setSkinOutfit('trunksA');
        if (this._refs.playerSwimmer?.cartoonRig && isDebugOnlySwimmerModelVariant(this._refs.playerSwimmer.cartoonRig.modelVariantId)) {
            this._refs.playerSwimmer.cartoonRig.setModelVariant('swimmer0621_2');
        }
        this._refs.playerSwimmer?.cartoonRig?.setModelDebugMode(false);
        if (this._refs.playerSwimmer?.node) {
            this._refs.playerSwimmer.node.active = true;
        }
        this._debugMotor.stopRace();
        this._refs.playerSwimmer?.reset();
        this._refs.resetExtraAiSwimmers();
        this._refs.raceCameraDirector.resetBroadcastCamera();
        const camera = this._refs.cameraNode?.getComponent(Camera);
        if (camera) {
            camera.fov = 36;
        }
        if (showStart) {
            this._refs.returnToLogin();
        }
    }

    handleStroke(type: StrokeType): boolean {
        if (!this._active) {
            return false;
        }
        const queued = this._debugMotor.recordStroke(type);
        if (queued) {
            this.freestylePreview()?.rig.triggerStroke(type);
        }
        if (type === StrokeType.LEFT) {
            this._refs.debug('model debug: left hand + right foot');
        } else if (type === StrokeType.RIGHT) {
            this._refs.debug('model debug: right hand + left foot');
        } else {
            this._refs.debug('model debug: both hands + both feet');
        }
        this.updateDebugHud();
        return true;
    }

    handleStrokeHeld(type: StrokeType, held: boolean): boolean {
        if (!this._active) {
            return false;
        }
        const strokeQualityResult = this._debugMotor.setStrokeHeld(type, held);
        if (!held) {
            if (strokeQualityResult?.downgradedToKick) {
                this.freestylePreview()?.rig.triggerKick();
            } else {
                this.applyDebugStrokeQualityResult(this.makeDebugStrokeQualityResult(strokeQualityResult));
            }
        }
        this.updateDebugHud();
        return true;
    }

    handleKickStroke(type: StrokeType): boolean {
        if (!this._active) {
            return false;
        }
        if (this._debugMotor.recordKickTap(type)) {
            this.freestylePreview()?.rig.triggerKick();
        }
        this._refs.debug(`model debug: kick tap ${type}`);
        this.updateDebugHud();
        return true;
    }

    update(dt: number) {
        if (!this._active) {
            return;
        }
        this.hideNonPlayerWorldNodes(false);
        const finished = this._debugMotor.update(dt, {
            isAI: false,
        });
        for (const strokeQualityResult of this._debugMotor.consumeStrokeQualityResults()) {
            this.applyDebugStrokeQualityResult(this.makeDebugStrokeQualityResult(strokeQualityResult));
        }
        if (finished) {
            this._debugMotor.startRace(0, Math.max(SWIMMER_BALANCE.baseSpeed, this._debugMotor.currentSpeed));
        }
        for (const preview of this._actionPreviews) {
            preview.rig.refreshModelDebugSetup();
            if (preview.config.pose === 'freestyle') {
                preview.rig.updateFreestyleFromMotor(dt, this._debugMotor);
            } else {
                preview.rig.updateDebugActionPreview(dt);
            }
        }
        this.updateDebugWaterReference();
        this.updateDebugHud();
    }

    updateCamera(smooth = 0.18) {
        if (!this._refs.cameraNode) {
            return;
        }
        const target = this.debugCameraTarget();
        const cosPitch = Math.cos(this._cameraPitch);
        const desiredPos = new Vec3(
            target.x + Math.cos(this._cameraYaw) * cosPitch * this._cameraDistance,
            target.y + Math.sin(this._cameraPitch) * this._cameraDistance,
            target.z + Math.sin(this._cameraYaw) * cosPitch * this._cameraDistance,
        );
        Vec3.lerp(this._refs.cameraPos, this._refs.cameraPos, desiredPos, smooth);
        Vec3.lerp(this._refs.cameraTarget, this._refs.cameraTarget, target, smooth);
        this._refs.cameraNode.setPosition(this._refs.cameraPos);
        this._refs.cameraNode.lookAt(this._refs.cameraTarget);
    }

    onMouseDown(event: EventMouse): boolean {
        if (!this._active) {
            return false;
        }
        const button = event.getButton();
        this._cameraDragging = button === EventMouse.BUTTON_LEFT || button === EventMouse.BUTTON_RIGHT || button === EventMouse.BUTTON_MIDDLE;
        return true;
    }

    onMouseMove(event: EventMouse): boolean {
        if (!this._active) {
            return false;
        }
        if (!this._cameraDragging) {
            return true;
        }
        this._cameraYaw -= event.getDeltaX() * 0.008;
        this._cameraPitch += event.getDeltaY() * 0.006;
        this._cameraPitch = clamp(this._cameraPitch, -1.35, 1.35);
        return true;
    }

    onMouseUp(): boolean {
        if (!this._active) {
            return false;
        }
        this._cameraDragging = false;
        return true;
    }

    onMouseWheel(event: EventMouse): boolean {
        if (!this._active) {
            return false;
        }
        this._cameraDistance = clamp(this._cameraDistance - event.getScrollY() * 0.004, 0.85, 20);
        return true;
    }

    slowMotion() {
        if (!this._active) {
            return;
        }
        this._speedScale = clamp(this._speedScale - 0.1, 0.1, 1.5);
        this.applySpeed();
    }

    speedUpMotion() {
        if (!this._active) {
            return;
        }
        this._speedScale = clamp(this._speedScale + 0.1, 0.1, 1.5);
        this.applySpeed();
    }

    switchModelVariant() {
        if (!this._active || DEBUG_SWIMMER_MODEL_VARIANTS.length <= 0) {
            return;
        }
        this._modelVariantIndex = positiveMod(this._modelVariantIndex + 1, DEBUG_SWIMMER_MODEL_VARIANTS.length);
        this.applyCurrentModelVariant();
    }

    switchActionPreview() {
        if (!this._active || DEBUG_SWIMMER_ACTION_PREVIEWS.length <= 0) {
            return;
        }
        this._actionPreviewIndex = positiveMod(this._actionPreviewIndex + 1, DEBUG_SWIMMER_ACTION_PREVIEWS.length);
        this.refreshActionPreviewVisibility();
        this.updateActionLabel();
        const preview = this.currentActionPreview();
        if (preview) {
            this._refs.debug(`model debug action=${preview.config.label}`);
            this.updateCamera(0.32);
        }
    }

    triggerFlipTurn() {
        if (!this._active) {
            return;
        }
        const preview = this.currentActionPreview();
        if (preview?.config.pose !== 'flipTurn') {
            return;
        }
        if (preview.rig.triggerDebugFlipTurn()) {
            this._refs.debug('model debug flip turn triggered');
        }
    }

    switchColorVariant() {
        if (!this._active || SWIMMER_0621_2_COLOR_VARIANTS.length <= 0) {
            return;
        }
        this._colorVariantIndex = positiveMod(this._colorVariantIndex + 1, SWIMMER_0621_2_COLOR_VARIANTS.length);
        this.applyCurrentColorVariant();
    }

    switchSkyboxVariant() {
        if (!this._active || SKYBOX_VARIANTS.length <= 0) {
            return;
        }
        this._skyboxVariantIndex = positiveMod(this._skyboxVariantIndex + 1, SKYBOX_VARIANTS.length);
        this.applyCurrentSkyboxVariant();
    }

    private applyCurrentModelVariant() {
        const variant = DEBUG_SWIMMER_MODEL_VARIANTS[this._modelVariantIndex] ?? DEBUG_SWIMMER_MODEL_VARIANTS[0];
        if (!variant) {
            return;
        }
        let applied = false;
        for (const preview of this._actionPreviews) {
            if (preview.rig.setModelVariant(variant.id)) {
                preview.rig.setSkinOutfit('trunksA');
                preview.rig.setDebugActionPose(preview.config.pose, preview.config.sampledActionId);
                preview.rig.setModelDebugMode(true);
                applied = true;
            }
        }
        if (applied) {
            if (variant.dynamicColor) {
                this.applyCurrentColorVariant();
            }
            this._refs.debug(`model debug variant=${variant.label}`);
        }
        this.updateModelLabel();
    }

    private applyCurrentColorVariant() {
        const variant = SWIMMER_0621_2_COLOR_VARIANTS[this._colorVariantIndex] ?? SWIMMER_0621_2_COLOR_VARIANTS[0];
        if (!variant) {
            return;
        }
        let applied = false;
        for (const preview of this._actionPreviews) {
            if (preview.rig.setColorVariant(variant.id)) {
                applied = true;
            }
        }
        if (applied) {
            this._refs.debug(`model debug color=${variant.label}`);
        }
        this.updateModelLabel();
    }

    private updateModelLabel() {
        if (!this._refs.modelLabel) {
            return;
        }
        const model = DEBUG_SWIMMER_MODEL_VARIANTS[this._modelVariantIndex] ?? DEBUG_SWIMMER_MODEL_VARIANTS[0];
        const color = SWIMMER_0621_2_COLOR_VARIANTS[this._colorVariantIndex] ?? SWIMMER_0621_2_COLOR_VARIANTS[0];
        if (model?.dynamicColor && color) {
            const colorLabel = model.dynamicColor.usesCapChannel
                ? color.label
                : color.suitLabel ?? color.label;
            this._refs.modelLabel.string = `${model.dynamicColor.labelPrefix} ${colorLabel}`;
            return;
        }
        this._refs.modelLabel.string = `Model ${model?.label ?? '-'}`;
    }

    private updateActionLabel() {
        const preview = DEBUG_SWIMMER_ACTION_PREVIEWS[this._actionPreviewIndex] ?? DEBUG_SWIMMER_ACTION_PREVIEWS[0];
        if (this._refs.actionLabel) {
            this._refs.actionLabel.string = `Action ${preview?.label ?? '-'}`;
        }
        if (this._refs.flipTurnButton) {
            this._refs.flipTurnButton.active = preview?.pose === 'flipTurn';
        }
    }

    private applyCurrentSkyboxVariant() {
        const variant = SKYBOX_VARIANTS[this._skyboxVariantIndex] ?? DEFAULT_SKYBOX_VARIANT;
        if (!variant) {
            return;
        }
        this._refs.skyboxApplier?.apply(variant.id);
        this.updateSkyboxLabel();
        this._refs.debug(`model debug skybox=${variant.label}`);
    }

    private updateSkyboxLabel() {
        const variant = SKYBOX_VARIANTS[this._skyboxVariantIndex] ?? DEFAULT_SKYBOX_VARIANT;
        if (this._refs.skyboxLabel && variant) {
            this._refs.skyboxLabel.string = `Sky ${variant.label}`;
        }
    }

    private applySpeed() {
        this.applySpeedToPreviews();
        if (this._refs.speedLabel) {
            this._refs.speedLabel.string = `Speed ${this._speedScale.toFixed(2)}x`;
        }
        this._refs.debug(`model debug speed=${this._speedScale.toFixed(2)}x`);
    }

    private applySpeedToPreviews() {
        for (const preview of this._actionPreviews) {
            preview.rig.setDebugMotionSpeedScale(this._speedScale);
        }
    }

    private applyDebugStrokeQualityResult(result: RhythmResult | null): RhythmResult | null {
        if (!result) {
            return null;
        }
        this._refs.debug(formatStrokeQualityLog('model strokeQuality', result));
        this._lastRating = result.rating;
        this._lastCombo = result.combo;
        this._lastStrokeQuality = Math.max(0, result.speedMultiplier - 1);
        return result;
    }

    private makeDebugStrokeQualityResult(strokeQualityResult: StrokeQualityResult | null): RhythmResult | null {
        if (!strokeQualityResult) {
            return null;
        }
        const rating = ratingForStrokeQuality(strokeQualityResult.strokeQuality);
        this._lastCombo = nextStrokeQualityCombo(this._lastCombo, rating);
        const result = rhythmResultFromStrokeQuality(strokeQualityResult, this._lastCombo);
        return result;
    }

    private updateDebugHud() {
        if (this._refs.ratingLabel) {
            this._refs.ratingLabel.string = this._lastRating
                ? `${this._lastRating.toUpperCase()}  Q${Math.round(this._lastStrokeQuality * 100)}  ${this._lastCombo} COMBO`
                : 'READY';
            this._refs.ratingLabel.color = this.ratingColor(this._lastRating);
        }
        if (this._refs.swimSpeedLabel) {
            const speed = this._debugMotor.currentSpeed;
            const strokeQuality = Math.round(clamp(this._debugMotor.lastStrokeQuality, 0, 1) * 100);
            this._refs.swimSpeedLabel.string = `QUALITY ${strokeQuality}%   ACC ${signed(this._debugMotor.currentAcceleration)}   SPD ${speed.toFixed(2)} m/s`;
        }
    }

    private ratingColor(rating: Rating | null): Color {
        if (rating === Rating.PERFECT) {
            return new Color(255, 224, 89, 255);
        }
        if (rating === Rating.GOOD) {
            return new Color(80, 242, 161, 255);
        }
        if (rating === Rating.BAD) {
            return new Color(255, 92, 92, 255);
        }
        return new Color(230, 244, 250, 255);
    }

    private stopAllAi() {
        for (const controller of this._refs.aiControllers) {
            controller.stopSwimming();
        }
    }

    private debugCameraTarget(): Vec3 {
        const previewPosition = this.currentActionPreview()?.node.position;
        const baseX = previewPosition?.x ?? DEBUG_ACTION_GROUP_CENTER_X;
        const baseY = previewPosition?.y ?? this._refs.playerSwimmer?.swimWorldY ?? 0.24;
        const baseZ = previewPosition?.z ?? this._refs.playerLaneZ;
        return new Vec3(baseX + 0.42, baseY + 0.76, baseZ);
    }

    private ensureActionPreviews() {
        const worldRoot = this._refs.worldRoot;
        if (!worldRoot) {
            return;
        }
        if (!this._actionPreviewRoot?.isValid) {
            this._actionPreviewRoot = new Node('ModelDebugActionPreviewRoot');
            this._actionPreviewRoot.setParent(worldRoot);
            this._actionPreviewRoot.layer = Layers.Enum.DEFAULT;
        }
        this._actionPreviewRoot.active = true;
        const baseY = this._refs.playerSwimmer?.swimWorldY ?? 0;
        const waterY = this._refs.playerSwimmer?.waterWorldY ?? baseY;
        for (let actionIndex = 0; actionIndex < DEBUG_SWIMMER_ACTION_PREVIEWS.length; actionIndex++) {
            const config = DEBUG_SWIMMER_ACTION_PREVIEWS[actionIndex];
            let preview = this._actionPreviews.find((item) => item.config.id === config.id);
            if (!preview) {
                const node = new Node(`ModelDebugAction_${config.id}`);
                node.setParent(this._actionPreviewRoot);
                node.layer = Layers.Enum.DEFAULT;
                const rig = node.addComponent(CartoonSwimmerRig);
                preview = { config, laneIndex: actionIndex, node, rig };
                this._actionPreviews.push(preview);
                rig.setModelVariant(DEBUG_SWIMMER_MODEL_VARIANTS[this._modelVariantIndex]?.id ?? 'swimmer0621_2');
                rig.setColorVariant(SWIMMER_0621_2_COLOR_VARIANTS[this._colorVariantIndex]?.id ?? 'original');
                rig.setDebugActionPose(config.pose, config.sampledActionId);
                rig.build(
                    new Color(246, 176, 118),
                    new Color(245, 42, 64),
                    new Color(255, 220, 72),
                    false,
                    true,
                );
                rig.setSkinOutfit('trunksA');
            }
            preview.laneIndex = actionIndex;
            preview.node.active = true;
            preview.rig.setDebugActionPose(config.pose, config.sampledActionId);
            preview.rig.setWaterY(waterY);
            preview.rig.setModelDebugMode(true);
            const previewY = config.pose === 'sampledAction'
                ? Math.max(baseY, waterY + DEBUG_STANDING_WATER_CLEARANCE)
                : baseY;
            preview.node.setPosition(this.debugActionPreviewX(), previewY, this.debugActionLaneZ(actionIndex));
            preview.node.setRotationFromEuler(0, 0, 0);
        }
    }

    private destroyActionPreviews() {
        for (const preview of this._actionPreviews) {
            if (preview.node?.isValid) {
                preview.node.destroy();
            }
        }
        this._actionPreviews.length = 0;
        if (this._actionPreviewRoot?.isValid) {
            this._actionPreviewRoot.destroy();
        }
        this._actionPreviewRoot = null;
    }

    private debugActionPreviewX(): number {
        return DEBUG_ACTION_GROUP_CENTER_X;
    }

    private debugActionLaneZ(actionIndex: number): number {
        const centerIndex = (DEBUG_SWIMMER_ACTION_PREVIEWS.length - 1) * 0.5;
        return this._refs.playerLaneZ + (actionIndex - centerIndex) * DEBUG_ACTION_SPACING;
    }

    private refreshActionPreviewVisibility() {
        for (const preview of this._actionPreviews) {
            preview.node.active = true;
        }
    }

    private debugActionLaneGroupCenterZ(): number {
        return this._refs.playerLaneZ;
    }

    private currentActionPreview(): ModelDebugActionPreviewInstance | null {
        const config = DEBUG_SWIMMER_ACTION_PREVIEWS[this._actionPreviewIndex] ?? DEBUG_SWIMMER_ACTION_PREVIEWS[0];
        return this._actionPreviews.find((preview) => preview.config.id === config?.id) ?? this._actionPreviews[0] ?? null;
    }

    private freestylePreview(): ModelDebugActionPreviewInstance | null {
        return this._actionPreviews.find((preview) => preview.config.pose === 'freestyle') ?? null;
    }

    private hideNonPlayerWorldNodes(resetExisting: boolean) {
        const worldRoot = this._refs.worldRoot;
        const playerNode = this._refs.playerSwimmer?.node;
        if (!worldRoot || !playerNode) {
            return;
        }
        if (resetExisting) {
            this.restoreHiddenDebugSceneNodes();
        }
        for (const child of worldRoot.children) {
            if (this.shouldKeepDebugWorldNode(child, playerNode)) {
                continue;
            }
            if (this._hiddenDebugSceneNodes.has(child)) {
                child.active = false;
                continue;
            }
            this._hiddenDebugSceneNodes.set(child, child.active);
            child.active = false;
        }
    }

    private restoreHiddenDebugSceneNodes() {
        for (const [node, active] of this._hiddenDebugSceneNodes) {
            if (node?.isValid) {
                node.active = active;
            }
        }
        this._hiddenDebugSceneNodes.clear();
    }

    private shouldKeepDebugWorldNode(node: Node, playerNode: Node): boolean {
        if (node === playerNode || this.isAncestorOf(node, playerNode)) {
            return true;
        }
        return node.name === 'StadiumSun'
            || node.name === 'CartoonFillLight'
            || node.name === 'CartoonTopLight'
            || node.name === 'ModelDebugActionPreviewRoot'
            || node.name === 'ModelDebugWaterReference';
    }

    private isAncestorOf(candidate: Node, node: Node): boolean {
        let current: Node | null = node;
        while (current) {
            if (current === candidate) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    private isPortraitViewport(): boolean {
        const visibleSize = view.getVisibleSize();
        return visibleSize.height > visibleSize.width;
    }

    private updateDebugWaterReference() {
        const worldRoot = this._refs.worldRoot;
        const preview = this.currentActionPreview();
        if (!worldRoot || !preview?.node?.isValid) {
            return;
        }
        const water = this.ensureDebugWaterReference(worldRoot);
        const previewPosition = preview.node.position;
        const waterY = preview.rig.waterY ?? previewPosition.y;
        water.active = true;
        water.setPosition(DEBUG_ACTION_GROUP_CENTER_X + 0.42, waterY, this.debugActionLaneGroupCenterZ());
    }

    private ensureDebugWaterReference(parent: Node): Node {
        if (this._debugWaterRoot?.isValid) {
            return this._debugWaterRoot;
        }

        const root = new Node('ModelDebugWaterReference');
        root.setParent(parent);
        root.layer = Layers.Enum.DEFAULT;

        const water = makeDebugMaterial('ModelDebugWater', new Color(42, 208, 232, 72), true);
        const edge = makeDebugMaterial('ModelDebugWaterEdge', new Color(215, 255, 255, 150), true);

        const waterRenderer = addDebugBox(root, 'ModelDebugWaterSlab', water, new Vec3(0, 0, 0), new Vec3(DEBUG_WATER_LENGTH, 0.018, DEBUG_WATER_WIDTH));
        addDebugBox(root, 'ModelDebugWaterNearEdge', edge, new Vec3(0, 0.014, -DEBUG_WATER_HALF_WIDTH - 0.02), new Vec3(DEBUG_WATER_LENGTH, 0.012, 0.018));
        addDebugBox(root, 'ModelDebugWaterFarEdge', edge, new Vec3(0, 0.014, DEBUG_WATER_HALF_WIDTH + 0.02), new Vec3(DEBUG_WATER_LENGTH, 0.012, 0.018));
        this.applyTransparentDebugWaterMaterial(waterRenderer);

        this._debugWaterRoot = root;
        return root;
    }

    private applyTransparentDebugWaterMaterial(renderer: MeshRenderer) {
        loadRaceAsset(RESOURCE_PATHS.poolWaterMaterial, Material, (err, sourceMaterial) => {
            if (err || !sourceMaterial || !renderer?.node?.isValid) {
                console.warn('[SpeedSwimming] model debug transparent water material load failed', err);
                return;
            }
            const material = new Material();
            material.copy(sourceMaterial);
            material.name = 'ModelDebugTransparentWater';
            material.setProperty('deepColor', new Color(0, 92, 178, 42));
            material.setProperty('shallowColor', new Color(42, 208, 232, 54));
            material.setProperty('foamColor', new Color(196, 248, 255, 76));
            renderer.setMaterial(material, 0);
        });
    }

    private destroyDebugWaterReference() {
        if (this._debugWaterRoot?.isValid) {
            this._debugWaterRoot.destroy();
        }
        this._debugWaterRoot = null;
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function signed(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function positiveMod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function makeDebugMaterial(name: string, color: Color, transparent = false): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit' });
    material.name = name;
    material.setProperty('mainColor', color);
    return material;
}

function addDebugBox(parent: Node, name: string, material: Material, position: Vec3, scale: Vec3): MeshRenderer {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.DEFAULT;
    node.setPosition(position);
    node.setScale(scale);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(primitives.box());
    renderer.setMaterial(material, 0);
    return renderer;
}
