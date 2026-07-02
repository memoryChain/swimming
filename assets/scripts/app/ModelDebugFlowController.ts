import { Camera, Color, EventMouse, gfx, Label, Layers, Material, MeshRenderer, Node, primitives, resources, utils, Vec3, view } from 'cc';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { SWIMMER_BALANCE } from '../core/GameBalance';
import { GameState, Rating, StrokeType } from '../core/GameConstants';
import { InputManager } from '../core/InputManager';
import { MOTION_TUNING } from '../core/InputTuning';
import { RaceManager } from '../core/RaceManager';
import { DEBUG_SWIMMER_MODEL_VARIANTS, DEFAULT_SKYBOX_VARIANT, RESOURCE_PATHS, SKYBOX_VARIANTS, SWIMMER_0621_2_COLOR_VARIANTS, isDebugOnlySwimmerModelVariant } from '../core/ResourcePaths';
import type { RhythmResult } from '../core/RhythmTypes';
import { formatStabilityLog, nextStabilityCombo, ratingForStability, rhythmResultFromStability } from '../core/StabilityScoring';
import { StrokeStabilityResult } from '../swimmer/SwimmerMotor';
import { SwimmerMotor } from '../swimmer/SwimmerMotor';
import { UIFlowController } from '../ui/UIFlowController';
import { StandardSkyboxApplier } from './StandardSkyboxApplier';

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
    skyboxLabel: Label | null;
    skyboxApplier: StandardSkyboxApplier | null;
    resetExtraAiSwimmers: () => void;
    returnToLogin: () => void;
    setState: (state: GameState) => void;
    debug: (message: string) => void;
};

export class ModelDebugFlowController {
    private _active = false;
    private _cameraDragging = false;
    private _cameraYaw = Math.PI / 2;
    private _cameraPitch = 0.04;
    private _cameraDistance = 3.2;
    private _speedScale = MOTION_TUNING.animationSpeedScale;
    private readonly _debugMotor = new SwimmerMotor();
    private _lastRating: Rating | null = null;
    private _lastCombo = 0;
    private _lastStability = 0;
    private _modelVariantIndex = 0;
    private _colorVariantIndex = 0;
    private _skyboxVariantIndex = Math.max(0, SKYBOX_VARIANTS.findIndex((variant) => variant.id === DEFAULT_SKYBOX_VARIANT.id));
    private readonly _hiddenDebugSceneNodes = new Map<Node, boolean>();
    private _debugWaterRoot: Node | null = null;

    constructor(private readonly _refs: ModelDebugFlowRefs) {}

    get active(): boolean {
        return this._active;
    }

    enter() {
        this._refs.debug('enterModelDebug');
        this._active = true;
        this._cameraYaw = Math.PI / 2;
        this._cameraPitch = 0.04;
        this._cameraDistance = this.isPortraitViewport() ? 4.2 : 3.2;
        this._cameraDragging = false;
        this._speedScale = MOTION_TUNING.animationSpeedScale;
        this._lastRating = null;
        this._lastCombo = 0;
        this._lastStability = 0;
        this._modelVariantIndex = Math.max(0, DEBUG_SWIMMER_MODEL_VARIANTS.findIndex((variant) => variant.id === this._refs.playerSwimmer?.cartoonRig?.modelVariantId));
        this._colorVariantIndex = Math.max(0, SWIMMER_0621_2_COLOR_VARIANTS.findIndex((variant) => variant.id === this._refs.playerSwimmer?.cartoonRig?.colorVariantId));
        this._skyboxVariantIndex = Math.max(0, SKYBOX_VARIANTS.findIndex((variant) => variant.id === this._refs.skyboxApplier?.currentVariantId));
        this._debugMotor.startRace(0, SWIMMER_BALANCE.baseSpeed);

        if (this._refs.cameraNode) {
            this._refs.cameraPos.set(this._refs.cameraNode.position);
        }
        this.applySpeed();
        this.updateSkyboxLabel();
        this.updateDebugHud();

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
            this._refs.playerSwimmer.node.active = true;
            this._refs.playerSwimmer.reset();
            this._refs.playerSwimmer.node.setPosition(12, this._refs.playerSwimmer.swimWorldY, this._refs.playerLaneZ);
            this._refs.playerSwimmer.cartoonRig?.setSkinOutfit('trunksA');
            this.applyCurrentModelVariant();
            this._refs.playerSwimmer.cartoonRig?.setModelDebugMode(true);
        }
        this.hideNonPlayerWorldNodes(true);
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
        this._refs.uiFlow.hideModelDebugHud();
        for (const swimmer of this._refs.aiSwimmers) {
            swimmer.node.active = true;
        }
        this._refs.playerSwimmer?.cartoonRig?.setSkinOutfit('trunksA');
        if (this._refs.playerSwimmer?.cartoonRig && isDebugOnlySwimmerModelVariant(this._refs.playerSwimmer.cartoonRig.modelVariantId)) {
            this._refs.playerSwimmer.cartoonRig.setModelVariant('swimmer0621_2');
        }
        this._refs.playerSwimmer?.cartoonRig?.setModelDebugMode(false);
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
            this._refs.playerSwimmer?.cartoonRig?.triggerStroke(type);
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
        const stability = this._debugMotor.setStrokeHeld(type, held);
        if (!held) {
            this.applyDebugStabilityResult(this.makeDebugStabilityResult(stability));
        }
        this.updateDebugHud();
        return true;
    }

    update(dt: number) {
        if (!this._active) {
            return;
        }
        this.hideNonPlayerWorldNodes(false);
        this.syncSpeedFromTuning();
        const finished = this._debugMotor.update(dt, {
            isAI: false,
            aiPower: 1,
            aiMaxSpeedScale: 1,
        });
        for (const stability of this._debugMotor.consumeStabilityResults()) {
            this.applyDebugStabilityResult(this.makeDebugStabilityResult(stability));
        }
        if (finished) {
            this._debugMotor.startRace(0, Math.max(SWIMMER_BALANCE.baseSpeed, this._debugMotor.currentSpeed));
        }
        const rig = this._refs.playerSwimmer?.cartoonRig;
        rig?.refreshModelDebugSetup();
        if (rig?.usesDebugProceduralPose) {
            rig.updateBreaststrokePreview(dt);
        } else if (!rig?.usesDebugAnimationClip) {
            rig?.updateFreestyleFromMotor(dt, this._debugMotor);
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
        this._cameraDistance = clamp(this._cameraDistance - event.getScrollY() * 0.004, 0.85, 10.5);
        return true;
    }

    slowMotion() {
        if (!this._active) {
            return;
        }
        this._speedScale = clamp(this._speedScale - 0.1, 0.1, 1.5);
        MOTION_TUNING.animationSpeedScale = this._speedScale;
        this.applySpeed();
    }

    speedUpMotion() {
        if (!this._active) {
            return;
        }
        this._speedScale = clamp(this._speedScale + 0.1, 0.1, 1.5);
        MOTION_TUNING.animationSpeedScale = this._speedScale;
        this.applySpeed();
    }

    switchModelVariant() {
        if (!this._active || DEBUG_SWIMMER_MODEL_VARIANTS.length <= 0) {
            return;
        }
        this._modelVariantIndex = positiveMod(this._modelVariantIndex + 1, DEBUG_SWIMMER_MODEL_VARIANTS.length);
        this.applyCurrentModelVariant();
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
        const rig = this._refs.playerSwimmer?.cartoonRig;
        if (rig?.setModelVariant(variant.id)) {
            rig.setSkinOutfit('trunksA');
            if (variant.id === 'swimmer0621_2') {
                this.applyCurrentColorVariant();
            }
            rig.setModelDebugMode(true);
            this._refs.debug(`model debug variant=${variant.label}`);
        }
        this.updateModelLabel();
    }

    private applyCurrentColorVariant() {
        const variant = SWIMMER_0621_2_COLOR_VARIANTS[this._colorVariantIndex] ?? SWIMMER_0621_2_COLOR_VARIANTS[0];
        if (!variant) {
            return;
        }
        if (this._refs.playerSwimmer?.cartoonRig?.setColorVariant(variant.id)) {
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
        this._refs.modelLabel.string = model?.id === 'swimmer0621_2' && color
            ? `S2 ${color.label}`
            : `Model ${model?.label ?? '-'}`;
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
        if (this._refs.speedLabel) {
            this._refs.speedLabel.string = `Speed ${this._speedScale.toFixed(2)}x`;
        }
        this._refs.debug(`model debug speed=${this._speedScale.toFixed(2)}x`);
    }

    private syncSpeedFromTuning() {
        const next = clamp(MOTION_TUNING.animationSpeedScale, 0.1, 1.5);
        if (Math.abs(next - this._speedScale) < 0.001) {
            return;
        }
        this._speedScale = next;
        MOTION_TUNING.animationSpeedScale = next;
        this.applySpeed();
    }

    private applyDebugStabilityResult(result: RhythmResult | null): RhythmResult | null {
        if (!result) {
            return null;
        }
        this._refs.debug(formatStabilityLog('model stability', result));
        this._lastRating = result.rating;
        this._lastCombo = result.combo;
        this._lastStability = Math.max(0, result.speedMultiplier - 1);
        return result;
    }

    private makeDebugStabilityResult(stability: StrokeStabilityResult | null): RhythmResult | null {
        if (!stability) {
            return null;
        }
        const rating = ratingForStability(stability.stability);
        this._lastCombo = nextStabilityCombo(this._lastCombo, rating);
        const result = rhythmResultFromStability(stability, this._lastCombo);
        if (rating === Rating.PERFECT) {
            const comboSpeedBonus = this._debugMotor.applyPerfectComboBoost(this._lastCombo);
            if (comboSpeedBonus > 0) {
                result.comboSpeedBonus = comboSpeedBonus;
            }
        }
        return result;
    }

    private updateDebugHud() {
        if (this._refs.ratingLabel) {
            this._refs.ratingLabel.string = this._lastRating
                ? `${this._lastRating.toUpperCase()}  S${Math.round(this._lastStability * 100)}  ${this._lastCombo} COMBO`
                : 'READY';
            this._refs.ratingLabel.color = this.ratingColor(this._lastRating);
        }
        if (this._refs.swimSpeedLabel) {
            const speed = this._debugMotor.currentSpeed;
            const stability = Math.round(clamp(this._debugMotor.lastStability, 0, 1) * 100);
            const freshness = Math.round(clamp(this._debugMotor.lastInputFreshness, 0, 1) * 100);
            this._refs.swimSpeedLabel.string = `STB ${stability}%   FRS ${freshness}%   ACC ${signed(this._debugMotor.currentAcceleration)}   SPD ${speed.toFixed(2)} m/s`;
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
        const playerPosition = this._refs.playerSwimmer?.node.position;
        const baseX = playerPosition?.x ?? 12;
        const baseY = playerPosition?.y ?? 0.24;
        const baseZ = playerPosition?.z ?? this._refs.playerLaneZ;
        return new Vec3(baseX + 0.42, baseY + 0.76, baseZ);
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
        const player = this._refs.playerSwimmer;
        if (!worldRoot || !player?.node?.isValid) {
            return;
        }
        const water = this.ensureDebugWaterReference(worldRoot);
        const playerPosition = player.node.position;
        const waterY = player.cartoonRig?.waterY ?? playerPosition.y;
        water.active = true;
        water.setPosition(playerPosition.x + 0.42, waterY, playerPosition.z);
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
        const lane = makeDebugMaterial('ModelDebugWaterLane', new Color(30, 142, 218, 120), true);

        const waterRenderer = addDebugBox(root, 'ModelDebugWaterSlab', water, new Vec3(0, 0, 0), new Vec3(5.2, 0.018, 1.8));
        addDebugBox(root, 'ModelDebugWaterNearEdge', edge, new Vec3(0, 0.014, -0.92), new Vec3(5.2, 0.012, 0.018));
        addDebugBox(root, 'ModelDebugWaterFarEdge', edge, new Vec3(0, 0.014, 0.92), new Vec3(5.2, 0.012, 0.018));
        addDebugBox(root, 'ModelDebugWaterCenterLine', lane, new Vec3(0, 0.016, 0), new Vec3(5.2, 0.01, 0.012));
        this.applyTransparentDebugWaterMaterial(waterRenderer);

        this._debugWaterRoot = root;
        return root;
    }

    private applyTransparentDebugWaterMaterial(renderer: MeshRenderer) {
        resources.load(RESOURCE_PATHS.poolWaterMaterial, Material, (err, sourceMaterial) => {
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
    if (transparent) {
        material.overridePipelineStates({
            blendState: {
                targets: [{
                    blend: true,
                    blendSrc: gfx.BlendFactor.SRC_ALPHA,
                    blendDst: gfx.BlendFactor.ONE_MINUS_SRC_ALPHA,
                    blendSrcAlpha: gfx.BlendFactor.SRC_ALPHA,
                    blendDstAlpha: gfx.BlendFactor.ONE_MINUS_SRC_ALPHA,
                }],
            },
            depthStencilState: {
                depthTest: true,
                depthWrite: false,
            },
        });
    }
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
