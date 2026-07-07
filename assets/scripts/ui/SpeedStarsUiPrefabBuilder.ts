import { Color, EventMouse, Graphics, instantiate, Label, Node, Prefab, resources, Sprite, SpriteFrame, UITransform, view } from 'cc';
import { EDITOR } from 'cc/env';
import { getRaceDistance, RaceDistanceMode, RACE_DISTANCE_OPTIONS } from '../core/GameBalance';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { UIController } from './UIController';
import { makeButton, makeLabel, makeUiNode, uiColor } from './RuntimeUiFactory';

export type SpeedStarsStartUiCallbacks = {
    onStart: () => void;
    onDistanceSelect: (distance: RaceDistanceMode) => void;
    onModelDebug: () => void;
    onAiDebug: () => void;
};

export type SpeedStarsUiCallbacks = {
    onStroke: () => void;
    onStrokeEnd: () => void;
    onDiveHoldStart: () => void;
    onDiveHoldEnd: (holdSeconds: number) => void;
    onRestart: () => void;
    onMenu: () => void;
};

export type SpeedStarsUiRefs = {
    root: Node;
    raceHud: Node;
    uiController: UIController;
    timingGuideFillNode: Node;
    timingGuideMarker: Node;
};

export type SpeedStarsStartUiRefs = {
    root: Node;
    startScreen: Node;
};

export class SpeedStarsStartUiPrefabBuilder {
    constructor(private readonly _callbacks: SpeedStarsStartUiCallbacks) {}

    build(parent: Node, _w: number, _h: number, done: (error: Error | null, refs?: SpeedStarsStartUiRefs) => void) {
        loadSpeedStarsPrefab((error, prefab) => {
            if (error || !prefab) {
                done(error ?? new Error('SpeedStars UI prefab is missing'));
                return;
            }
            try {
                const root = instantiateRoot(parent, prefab);
                const startScreen = requireNode(root, 'StartScreen');
                const raceHud = requireNode(root, 'RaceHUD');
                raceHud.active = false;
                raceHud.destroy();
                bindStartScreen(startScreen, this._callbacks);
                done(null, { root, startScreen });
            } catch (buildError) {
                done(buildError instanceof Error ? buildError : new Error(`${buildError}`));
            }
        });
    }
}

export class SpeedStarsUiPrefabBuilder {
    private _diveHoldStartedAt = 0;

    constructor(private readonly _callbacks: SpeedStarsUiCallbacks) {}

    build(parent: Node, _w: number, _h: number, done: (error: Error | null, refs?: SpeedStarsUiRefs) => void) {
        loadSpeedStarsPrefab((error, prefab) => {
            if (error || !prefab) {
                done(error ?? new Error('SpeedStars UI prefab is missing'));
                return;
            }
            try {
                done(null, this.instantiateUi(parent, prefab));
            } catch (error) {
                done(error instanceof Error ? error : new Error(`${error}`));
            }
        });
    }

    private instantiateUi(parent: Node, prefab: Prefab): SpeedStarsUiRefs {
        const root = instantiateRoot(parent, prefab);

        const startScreen = requireNode(root, 'StartScreen');
        const raceHud = requireNode(root, 'RaceHUD');
        startScreen.active = false;
        startScreen.destroy();
        raceHud.active = false;
        this.layoutRaceProgress(raceHud);

        const refs = this.bindRaceHud(raceHud);
        this.hideRaceOverlayReadouts(raceHud);

        const uiNode = new Node('UIController');
        uiNode.setParent(raceHud);
        uiNode.addComponent(UITransform);
        const ui = uiNode.addComponent(UIController);
        ui.timerLabel = requireLabel(raceHud, 'Timer');
        ui.placementLabel = requireLabel(raceHud, 'Placement');
        ui.distanceLabel = requireLabel(raceHud, 'ProgressValue');
        const progressTrack = requireNode(raceHud, 'ProgressTrack');
        const progressTrackTransform = progressTrack.getComponent(UITransform);
        progressTrackTransform?.setContentSize(progressTrackTransform.contentSize.width, 8);
        const progressTrackSprite = progressTrack.getComponent(Sprite);
        if (progressTrackSprite) {
            progressTrackSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            progressTrackSprite.trim = false;
        }
        const progressDot = requireNode(raceHud, 'ProgressDot');
        const progressDotSprite = progressDot.getComponent(Sprite);
        if (progressDotSprite) {
            progressDotSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        }
        progressDot.getComponent(UITransform)?.setContentSize(60, 18);
        ui.progressDot = progressDot;
        ui.progressTrackWidth = Math.max(0, progressTrack.getComponent(UITransform).contentSize.width - 60);
        ui.speedBarRoot = null;
        ui.speedLabel = requireLabel(raceHud, 'SpeedValue');
        ui.telemetryLabel = requireLabel(raceHud, 'SwimTelemetry');
        ui.countdownOverlay = requireNode(raceHud, 'CountdownOverlay');
        ui.countdownShade = requireNode(raceHud, 'CountdownShade');
        ui.countdownLabel = requireLabel(raceHud, 'CountdownLabel');
        ui.diveChargeTrack = requireNode(raceHud, 'DiveChargeTrack');
        ui.diveChargeFillNode = requireNode(raceHud, 'DiveChargeFill');
        this.buildHeartRateBar(raceHud, ui);
        this.buildEnergyBar(raceHud, ui);
        ui.resultPanel = requireNode(raceHud, 'ResultPanel');
        ui.resultTitle = requireLabel(raceHud, 'ResultTitle');
        ui.resultTime = requireLabel(raceHud, 'ResultTime');
        ui.resultPlacementStat = requireLabel(raceHud, 'ResultPlacementStat');
        ui.resultSpeedStat = requireLabel(raceHud, 'ResultSpeedStat');
        ui.ratingLabel = requireLabel(raceHud, 'Rating');
        ui.comboLabel = requireLabel(raceHud, 'Combo');
        ui.resultRows = [];
        ui.resultRankLabels = [];
        ui.resultTimeLabels = [];
        ui.resultSpeedLabels = [];
        ui.resultRowBacks = [];
        ui.resultAvatars = [];
        ui.resultAvatarFrames = [];
        for (let i = 0; i < 8; i++) {
            ui.resultRows.push(requireLabel(raceHud, `ResultRow${i}`));
            ui.resultRankLabels.push(requireLabel(raceHud, `ResultRank${i}`));
            ui.resultTimeLabels.push(requireLabel(raceHud, `ResultTimeValue${i}`));
            ui.resultSpeedLabels.push(requireLabel(raceHud, `ResultSpeedValue${i}`));
            ui.resultRowBacks.push(requireNode(raceHud, `ResultRowBack${i}`));
            const avatar = requireNode(raceHud, `ResultAvatar${i}`).getComponent(Sprite);
            if (!avatar?.spriteFrame) {
                throw new Error(`SpeedStarsUI avatar is missing SpriteFrame: ResultAvatar${i}`);
            }
            avatar.sizeMode = Sprite.SizeMode.CUSTOM;
            avatar.node.getComponent(UITransform)?.setContentSize(38, 38);
            ui.resultAvatars.push(avatar);
            ui.resultAvatarFrames.push(avatar.spriteFrame);
        }
        ui.resultRowNormalFrame = ui.resultRowBacks[0]?.getComponent(Sprite)?.spriteFrame ?? null;
        ui.resultRowPlayerFrame = ui.resultRowBacks[7]?.getComponent(Sprite)?.spriteFrame ?? null;

        return {
            root,
            raceHud,
            uiController: ui,
            timingGuideFillNode: requireNode(raceHud, 'SpeedFill'),
            timingGuideMarker: requireNode(raceHud, 'TimingMarker'),
        };
    }

    private bindRaceHud(raceHud: Node): { speedBarRoot: Node } {
        const strokePad = requireNode(raceHud, 'StrokeInput');
        strokePad.on(Node.EventType.TOUCH_START, () => this.beginStrokeHold());
        strokePad.on(Node.EventType.TOUCH_END, () => this.endStrokeHold());
        strokePad.on(Node.EventType.TOUCH_CANCEL, () => this.endStrokeHold());
        strokePad.on(Node.EventType.MOUSE_UP, () => this.endStrokeHold());
        strokePad.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT || event.getButton() === EventMouse.BUTTON_RIGHT) {
                this.beginStrokeHold();
            }
        });

        const countdownOverlay = requireNode(raceHud, 'CountdownOverlay');
        countdownOverlay.on(Node.EventType.TOUCH_START, () => this.beginDiveHold());
        countdownOverlay.on(Node.EventType.TOUCH_END, () => this.endDiveHold());
        countdownOverlay.on(Node.EventType.TOUCH_CANCEL, () => this.endDiveHold());
        countdownOverlay.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT) {
                this.beginDiveHold();
            }
        });
        countdownOverlay.on(Node.EventType.MOUSE_UP, () => this.endDiveHold());

        const diveTouchArea = requireNode(raceHud, 'DiveTouchArea');
        diveTouchArea.on(Node.EventType.TOUCH_START, () => this.beginDiveHold());
        diveTouchArea.on(Node.EventType.TOUCH_END, () => this.endDiveHold());
        diveTouchArea.on(Node.EventType.TOUCH_CANCEL, () => this.endDiveHold());
        diveTouchArea.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT) {
                this.beginDiveHold();
            }
        });
        diveTouchArea.on(Node.EventType.MOUSE_UP, () => this.endDiveHold());

        requireNode(raceHud, 'RestartButton').on(Node.EventType.TOUCH_END, () => this._callbacks.onRestart());
        requireNode(raceHud, 'MenuButton').on(Node.EventType.TOUCH_END, () => this._callbacks.onMenu());

        const speedBarRoot = requireNode(raceHud, 'SpeedBarRoot');
        reparentAt(requireNode(raceHud, 'SpeedFill'), speedBarRoot, 0, -3);
        reparentAt(requireNode(raceHud, 'TimingMarker'), speedBarRoot, 0, -108);
        reparentAt(requireNode(raceHud, 'SpeedText'), speedBarRoot, -56, 118);
        return { speedBarRoot };
    }

    private hideRaceOverlayReadouts(raceHud: Node) {
        for (const name of ['TopLeftPlate', 'Placement', 'TimerPlate', 'Timer', 'SpeedValue', 'SpeedBarRoot']) {
            requireNode(raceHud, name).active = false;
        }
    }

    private buildHeartRateBar(raceHud: Node, ui: UIController) {
        const visibleSize = view.getVisibleSize();
        const root = makeUiNode('HeartRateBar', raceHud);
        // Anchor near the top-left of the HUD.
        root.setPosition(-visibleSize.width / 2 + 150, visibleSize.height / 2 - 60, 0);

        const label = makeLabel('HeartRateLabel', root, '心率 0', 20, uiColor(120, 196, 255, 255));
        label.getComponent(UITransform).setContentSize(220, 26);
        label.setPosition(0, 20, 0);
        label.getComponent(Label).horizontalAlign = Label.HorizontalAlign.LEFT;

        const fillNode = makeUiNode('HeartRateFill', root);
        fillNode.getComponent(UITransform).setContentSize(220, 16);
        const fillGfx = fillNode.addComponent(Graphics);

        ui.heartRateBarRoot = root;
        ui.heartRateBarFill = fillGfx;
        ui.heartRateLabel = label.getComponent(Label);
        ui.updateHeartRateBar(0, 'LOW');
        ui.setHeartRateBarVisible(false);
    }

    private buildEnergyBar(raceHud: Node, ui: UIController) {
        const visibleSize = view.getVisibleSize();
        const root = makeUiNode('EnergyBar', raceHud);
        // Anchor just below the heart-rate bar.
        root.setPosition(-visibleSize.width / 2 + 150, visibleSize.height / 2 - 108, 0);

        const label = makeLabel('EnergyLabel', root, '体能 0', 20, uiColor(120, 220, 255, 255));
        label.getComponent(UITransform).setContentSize(220, 26);
        label.setPosition(0, 20, 0);
        label.getComponent(Label).horizontalAlign = Label.HorizontalAlign.LEFT;

        const fillNode = makeUiNode('EnergyFill', root);
        fillNode.getComponent(UITransform).setContentSize(220, 16);
        const fillGfx = fillNode.addComponent(Graphics);

        ui.energyBarRoot = root;
        ui.energyBarFill = fillGfx;
        ui.energyLabel = label.getComponent(Label);
        ui.updateEnergyBar(100, false);
        ui.setEnergyBarVisible(false);
    }

    private layoutRaceProgress(raceHud: Node) {
        const visibleSize = view.getVisibleSize();
        const topY = visibleSize.height / 2 - 28;
        for (const name of ['ProgressTrack', 'ProgressValue']) {
            const node = requireNode(raceHud, name);
            node.setPosition(node.position.x, topY, node.position.z);
        }
        const telemetry = requireNode(raceHud, 'SwimTelemetry');
        telemetry.setPosition(telemetry.position.x, topY - 34, telemetry.position.z);
        requireNode(raceHud, 'ProgressText').active = false;
    }

    private beginDiveHold() {
        if (this._diveHoldStartedAt > 0) {
            return;
        }
        this._diveHoldStartedAt = Date.now() / 1000;
        this._callbacks.onDiveHoldStart();
    }

    private endDiveHold() {
        if (this._diveHoldStartedAt <= 0) {
            return;
        }
        const holdSeconds = Math.max(0, Date.now() / 1000 - this._diveHoldStartedAt);
        this._diveHoldStartedAt = 0;
        this._callbacks.onDiveHoldEnd(holdSeconds);
    }

    private beginStrokeHold() {
        this.beginDiveHold();
        this._callbacks.onStroke();
    }

    private endStrokeHold() {
        this._callbacks.onStrokeEnd();
        this.endDiveHold();
    }
}

function requireNode(root: Node, name: string): Node {
    const node = findNode(root, name);
    if (!node) {
        throw new Error(`SpeedStarsUI missing node: ${name}`);
    }
    return node;
}

function requireLabel(root: Node, name: string): Label {
    const label = requireNode(root, name).getComponent(Label);
    if (!label) {
        throw new Error(`SpeedStarsUI node is missing Label: ${name}`);
    }
    return label;
}

function findNode(root: Node, name: string): Node | null {
    if (root.name === name) {
        return root;
    }
    for (const child of root.children) {
        const found = findNode(child, name);
        if (found) {
            return found;
        }
    }
    return null;
}

function reparentAt(node: Node, parent: Node, x: number, y: number) {
    node.setParent(parent);
    node.setPosition(x, y, 0);
}

function loadSpeedStarsPrefab(done: (error: Error | null, prefab?: Prefab) => void) {
    const prefabPath = RESOURCE_PATHS.speedStarsUiPrefab;
    resources.load(prefabPath, Prefab, (error, prefab) => {
        if (error || !prefab) {
            done(new Error(`Failed to load ${prefabPath}: ${error?.message ?? 'missing prefab'}`));
            return;
        }
        done(null, prefab);
    });
}

function instantiateRoot(parent: Node, prefab: Prefab): Node {
    const root = instantiate(prefab);
    root.name = 'SpeedStarsUI';
    root.active = true;
    root.setParent(parent);
    root.setPosition(0, 0, 0);
    return root;
}

function bindStartScreen(startScreen: Node, callbacks: SpeedStarsStartUiCallbacks) {
    const distanceButtons: { distance: RaceDistanceMode; node: Node }[] = [];
    for (const distance of RACE_DISTANCE_OPTIONS) {
        distanceButtons.push({ distance, node: requireNode(startScreen, `Distance${distance}Button`) });
    }
    const skins = distanceButtonSkins(distanceButtons);
    for (const button of distanceButtons) {
        button.node.on(Node.EventType.TOUCH_END, () => {
            callbacks.onDistanceSelect(button.distance);
            updateDistanceButtons(distanceButtons, skins);
        });
    }
    updateDistanceButtons(distanceButtons, skins);

    requireNode(startScreen, 'StartButton').on(Node.EventType.TOUCH_END, callbacks.onStart);
    const modelDebug = requireNode(startScreen, 'ModelDebugButton');
    modelDebug.active = EDITOR;
    modelDebug.on(Node.EventType.TOUCH_END, callbacks.onModelDebug);

    // 100m AI-debug 1v1 entry. Built in code and anchored below the model-debug
    // button (when shown) or the start button, so it never overlaps existing
    // buttons and needs no prefab change. Opens a difficulty picker first.
    const anchor = EDITOR ? modelDebug : requireNode(startScreen, 'StartButton');
    const aiDebug = makeButton('AiDebugStartButton', startScreen, 260, 64, uiColor(60, 110, 180, 235), '100m AI 调试');
    aiDebug.setPosition(anchor.position.x, anchor.position.y - 84, 0);
    aiDebug.on(Node.EventType.TOUCH_END, callbacks.onAiDebug);
}

type DistanceButtonSkins = {
    normal: SpriteFrame | null;
    selected: SpriteFrame | null;
};

function distanceButtonSkins(buttons: { distance: RaceDistanceMode; node: Node }[]): DistanceButtonSkins {
    return {
        normal: buttons.find((button) => button.distance === 50)?.node.getComponent(Sprite)?.spriteFrame ?? null,
        selected: buttons.find((button) => button.distance === 100)?.node.getComponent(Sprite)?.spriteFrame ?? null,
    };
}

function updateDistanceButtons(buttons: { distance: RaceDistanceMode; node: Node }[], skins: DistanceButtonSkins) {
    const selected = getRaceDistance();
    for (const button of buttons) {
        const active = button.distance === selected;
        const sprite = button.node.getComponent(Sprite);
        if (sprite) {
            sprite.spriteFrame = active ? skins.selected : skins.normal;
            sprite.color = Color.WHITE;
        }
        const label = button.node.getChildByName('Label')?.getComponent(Label);
        if (label) {
            label.color = active
                ? new Color(12, 16, 24, 255)
                : new Color(12, 16, 24, 230);
            label.fontFamily = 'Microsoft YaHei';
            label.isBold = true;
            label.isItalic = false;
            label.enableOutline = false;
            label.enableShadow = false;
            label.fontSize = active ? 29 : 27;
            label.lineHeight = active ? 33 : 31;
        }
    }
}
