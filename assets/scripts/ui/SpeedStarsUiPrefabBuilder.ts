import { Color, EventMouse, EventTouch, Graphics, instantiate, Label, LabelOutline, Layout, Node, Prefab, resources, Sprite, SpriteFrame, sys, UITransform, view, Widget } from 'cc';
import { EDITOR } from 'cc/env';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { StrokeType } from '../core/GameConstants';
import { UIController } from './UIController';
import { makeButton, makeLabel, makeOutlineButton, makeUiNode, uiColor } from './RuntimeUiFactory';
import { UI_STYLE } from './UIStyle';

export type SpeedStarsStartUiCallbacks = {
    onStart: () => void;
    onRoom: () => void;
    onModelDebug: () => void;
    onAiDebug: () => void;
};

export type SpeedStarsUiCallbacks = {
    onStroke: (type: StrokeType) => void;
    onStrokeEnd: (type: StrokeType) => void;
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
                layoutStartScreen(root, startScreen);
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
    private readonly _activeStrokeTouches = new Map<number, StrokeType>();
    private readonly _activeDiveTouches = new Set<number>();
    private readonly _activeStrokeCounts: Record<StrokeType.LEFT | StrokeType.RIGHT, number> = {
        [StrokeType.LEFT]: 0,
        [StrokeType.RIGHT]: 0,
    };
    private _activePointerHoldCount = 0;
    private _activeMouseStrokeType: StrokeType | null = null;
    private _activeDiveMouse = false;

    constructor(private readonly _callbacks: SpeedStarsUiCallbacks) {}

    /**
     * Clear pointer bookkeeping when a race UI lifecycle ends. Cocos does not
     * guarantee TOUCH_END/TOUCH_CANCEL after an input node is deactivated, so a
     * swimmer can otherwise carry a held touch (and its reused mobile touch id)
     * into the next race.
     */
    resetInputState() {
        this._activeStrokeTouches.clear();
        this._activeDiveTouches.clear();
        this._activeStrokeCounts[StrokeType.LEFT] = 0;
        this._activeStrokeCounts[StrokeType.RIGHT] = 0;
        this._activePointerHoldCount = 0;
        this._activeMouseStrokeType = null;
        this._activeDiveMouse = false;
        this._diveHoldStartedAt = 0;
    }

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
        fitNodeToVisibleScreen(raceHud);
        fitNodeToVisibleScreen(requireNode(raceHud, 'CountdownOverlay'));
        fitNodeToVisibleScreen(requireNode(raceHud, 'CountdownShade'));
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
        ui.distanceLabel = requireLabel(raceHud, 'ProgressValue');
        const progressTrack = requireNode(raceHud, 'ProgressTrack');
        ui.progressTrackRoot = progressTrack;
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
        ui.countdownOverlay = requireNode(raceHud, 'CountdownOverlay');
        ui.countdownShade = requireNode(raceHud, 'CountdownShade');
        ui.countdownLabel = requireLabel(raceHud, 'CountdownLabel');
        ui.diveChargeTrack = requireNode(raceHud, 'DiveChargeTrack');
        ui.diveChargeFillNode = requireNode(raceHud, 'DiveChargeFill');
        this.buildDiveChargeBar(raceHud, ui);
        this.buildHeartRateBar(raceHud, ui);
        this.buildEnergyBar(raceHud, ui);
        this.buildUltimateEnergyBar(raceHud, ui);
        // Full-screen swim-input pad. Hidden during the awards ceremony so pointer events fall
        // through to the global input listeners that drive the free-look podium camera.
        // 全屏划水输入板。颁奖仪式时隐藏，让指针事件穿透到驱动颁奖自由视角相机的全局输入监听。
        ui.strokeInput = requireNode(raceHud, 'StrokeInput');
        ui.diveTouchArea = requireNode(raceHud, 'DiveTouchArea');
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

        // Sprint indicator: large centered label near the top of the screen,
        // hidden until the sprint phase begins. Has a glowing outline for impact.
        const sprintNode = makeUiNode('SprintLabel', raceHud);
        sprintNode.getComponent(UITransform).setContentSize(400, 150);
        const sprintLabel = sprintNode.addComponent(Label);
        sprintLabel.string = '冲刺';
        sprintLabel.fontSize = 72;
        sprintLabel.lineHeight = 88;
        sprintLabel.color = uiColor(255, 210, 90, 255);
        sprintLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        sprintLabel.verticalAlign = Label.VerticalAlign.CENTER;
        sprintLabel.overflow = Label.Overflow.NONE;
        // Position at the top center of the screen.
        const vs = view.getVisibleSize();
        sprintNode.setPosition(0, vs.height / 2 - 110, 0);
        sprintNode.active = false;
        const sprintOutline = sprintNode.addComponent(LabelOutline);
        sprintOutline.color = new Color(255, 120, 30, 220);
        sprintOutline.width = 5;
        ui.sprintLabel = sprintLabel;

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
        fitInputNodeToVisibleScreen(strokePad);
        strokePad.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.beginTouchStroke(event));
        strokePad.on(Node.EventType.TOUCH_END, (event: EventTouch) => this.endTouchStroke(event));
        strokePad.on(Node.EventType.TOUCH_CANCEL, (event: EventTouch) => this.endTouchStroke(event));
        strokePad.on(Node.EventType.MOUSE_UP, () => this.endMouseStroke());
        strokePad.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT || event.getButton() === EventMouse.BUTTON_RIGHT) {
                this.beginMouseStroke(event.getUILocation().x);
            }
        });

        const countdownOverlay = requireNode(raceHud, 'CountdownOverlay');
        fitInputNodeToVisibleScreen(countdownOverlay);
        countdownOverlay.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.beginDiveTouch(event));
        countdownOverlay.on(Node.EventType.TOUCH_END, (event: EventTouch) => this.endDiveTouch(event));
        countdownOverlay.on(Node.EventType.TOUCH_CANCEL, (event: EventTouch) => this.endDiveTouch(event));
        countdownOverlay.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT) {
                this.beginDiveMouse();
            }
        });
        countdownOverlay.on(Node.EventType.MOUSE_UP, () => this.endDiveMouse());

        const diveTouchArea = requireNode(raceHud, 'DiveTouchArea');
        fitInputNodeToVisibleScreen(diveTouchArea);
        diveTouchArea.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.beginDiveTouch(event));
        diveTouchArea.on(Node.EventType.TOUCH_END, (event: EventTouch) => this.endDiveTouch(event));
        diveTouchArea.on(Node.EventType.TOUCH_CANCEL, (event: EventTouch) => this.endDiveTouch(event));
        diveTouchArea.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => {
            if (event.getButton() === EventMouse.BUTTON_LEFT) {
                this.beginDiveMouse();
            }
        });
        diveTouchArea.on(Node.EventType.MOUSE_UP, () => this.endDiveMouse());

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

    private buildDiveChargeBar(raceHud: Node, ui: UIController) {
        const track = ui.diveChargeTrack;
        if (!track) {
            return;
        }
        // 旧版「从底向上长的填充」已弃用：甜区起跳用 轨道 + 甜区带 + 移动指针。
        if (ui.diveChargeFillNode) {
            ui.diveChargeFillNode.active = false;
        }
        const trackTransform = track.getComponent(UITransform);
        const trackW = trackTransform ? trackTransform.contentSize.width : 52;
        const trackH = trackTransform ? trackTransform.contentSize.height : 280;
        const zoneNode = makeUiNode('DiveChargeZone', track);
        zoneNode.getComponent(UITransform).setContentSize(trackW, trackH);
        ui.diveChargeZoneGfx = zoneNode.addComponent(Graphics);
        const markerNode = makeUiNode('DiveChargeMarker', track);
        markerNode.getComponent(UITransform).setContentSize(trackW, trackH);
        ui.diveChargeMarkerGfx = markerNode.addComponent(Graphics);
        ui.initDiveChargeBar();
    }

    private buildHeartRateBar(raceHud: Node, ui: UIController) {
        const visibleSize = view.getVisibleSize();
        const safeTop = raceSafeTopInset();
        const root = makeUiNode('HeartRateBar', raceHud);
        // Anchor near the top-left of the HUD.
        root.setPosition(-visibleSize.width / 2 + 150, visibleSize.height / 2 - safeTop - 60, 0);

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
        const safeTop = raceSafeTopInset();
        const root = makeUiNode('EnergyBar', raceHud);
        // Anchor just below the heart-rate bar.
        root.setPosition(-visibleSize.width / 2 + 150, visibleSize.height / 2 - safeTop - 108, 0);

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

    }

    private buildUltimateEnergyBar(raceHud: Node, ui: UIController) {
        const visibleSize = view.getVisibleSize();
        const safeTop = raceSafeTopInset();
        const root = makeUiNode('UltimateEnergyBar', raceHud);
        // Anchor just below the stamina (体能) bar.
        root.setPosition(-visibleSize.width / 2 + 150, visibleSize.height / 2 - safeTop - 156, 0);

        const label = makeLabel('UltimateEnergyLabel', root, '蓄气 0', 20, uiColor(255, 215, 90, 255));
        label.getComponent(UITransform).setContentSize(220, 26);
        label.setPosition(0, 20, 0);
        label.getComponent(Label).horizontalAlign = Label.HorizontalAlign.LEFT;

        const fillNode = makeUiNode('UltimateEnergyFill', root);
        fillNode.getComponent(UITransform).setContentSize(220, 16);
        const fillGfx = fillNode.addComponent(Graphics);

        ui.ultimateBarRoot = root;
        ui.ultimateBarFill = fillGfx;
        ui.ultimateLabel = label.getComponent(Label);
        ui.updateUltimateEnergyBar(0, false);
    }

    private layoutRaceProgress(raceHud: Node) {
        const visibleSize = view.getVisibleSize();
        // Sit lower than the very top edge so the top-of-frame jumbotron screen no longer
        // overlaps the progress bar.
        const topY = visibleSize.height / 2 - raceSafeTopInset() - 84;
        for (const name of ['ProgressTrack', 'ProgressValue']) {
            const node = requireNode(raceHud, name);
            node.setPosition(node.position.x, topY, node.position.z);
        }
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

    private beginTouchStroke(event: EventTouch) {
        const touchId = event.getID();
        if (touchId === null || this._activeStrokeTouches.has(touchId)) {
            return;
        }
        const type = strokeTypeForScreenX(event.getUILocation().x);
        this._activeStrokeTouches.set(touchId, type);
        this.beginStrokeInput(type);
    }

    private endTouchStroke(event: EventTouch) {
        const touchId = event.getID();
        if (touchId === null) {
            return;
        }
        const type = this._activeStrokeTouches.get(touchId);
        if (type === undefined) {
            return;
        }
        this._activeStrokeTouches.delete(touchId);
        this.endStrokeInput(type);
    }

    private beginMouseStroke(screenX: number) {
        if (this._activeMouseStrokeType !== null) {
            return;
        }
        this._activeMouseStrokeType = strokeTypeForScreenX(screenX);
        this.beginStrokeInput(this._activeMouseStrokeType);
    }

    private endMouseStroke() {
        if (this._activeMouseStrokeType === null) {
            return;
        }
        const type = this._activeMouseStrokeType;
        this._activeMouseStrokeType = null;
        this.endStrokeInput(type);
    }

    private beginStrokeInput(type: StrokeType) {
        const count = this._activeStrokeCounts[type];
        this._activeStrokeCounts[type] = count + 1;
        this.beginPointerHold();
        if (count === 0) {
            this._callbacks.onStroke(type);
        }
    }

    private endStrokeInput(type: StrokeType) {
        const count = this._activeStrokeCounts[type];
        if (count <= 0) {
            return;
        }
        const nextCount = count - 1;
        this._activeStrokeCounts[type] = nextCount;
        if (nextCount === 0) {
            this._callbacks.onStrokeEnd(type);
        }
        this.endPointerHold();
    }

    private beginDiveTouch(event: EventTouch) {
        const touchId = event.getID();
        if (touchId === null || this._activeDiveTouches.has(touchId)) {
            return;
        }
        this._activeDiveTouches.add(touchId);
        this.beginPointerHold();
    }

    private endDiveTouch(event: EventTouch) {
        const touchId = event.getID();
        if (touchId === null || !this._activeDiveTouches.delete(touchId)) {
            return;
        }
        this.endPointerHold();
    }

    private beginDiveMouse() {
        if (this._activeDiveMouse) {
            return;
        }
        this._activeDiveMouse = true;
        this.beginPointerHold();
    }

    private endDiveMouse() {
        if (!this._activeDiveMouse) {
            return;
        }
        this._activeDiveMouse = false;
        this.endPointerHold();
    }

    private beginPointerHold() {
        this._activePointerHoldCount += 1;
        if (this._activePointerHoldCount === 1) {
            this.beginDiveHold();
        }
    }

    private endPointerHold() {
        if (this._activePointerHoldCount <= 0) {
            return;
        }
        this._activePointerHoldCount -= 1;
        if (this._activePointerHoldCount === 0) {
            this.endDiveHold();
        }
    }
}

function strokeTypeForScreenX(screenX: number): StrokeType {
    return screenX < view.getVisibleSize().width / 2 ? StrokeType.LEFT : StrokeType.RIGHT;
}

function fitInputNodeToVisibleScreen(node: Node) {
    fitNodeToVisibleScreen(node);
}

function fitNodeToVisibleScreen(node: Node) {
    const visibleSize = view.getVisibleSize();
    node.setPosition(0, 0, node.position.z);
    node.getComponent(UITransform)?.setContentSize(visibleSize.width, visibleSize.height);
}

function layoutStartScreen(root: Node, startScreen: Node) {
    fitNodeToVisibleScreen(root);
    fitNodeToVisibleScreen(startScreen);

    // The current start artwork was authored as a portrait texture. Scale it
    // uniformly like CSS `cover` so landscape screens are filled without
    // stretching swimmers or venue details. The excess top/bottom is cropped.
    const background = requireNode(startScreen, 'StartShade');
    const transform = background.getComponent(UITransform);
    const visibleSize = view.getVisibleSize();
    if (transform && transform.contentSize.width > 0 && transform.contentSize.height > 0) {
        const coverScale = Math.max(
            visibleSize.width / transform.contentSize.width,
            visibleSize.height / transform.contentSize.height,
        );
        background.setPosition(0, 0, background.position.z);
        background.setScale(coverScale, coverScale, background.scale.z);
    }
}

function raceSafeTopInset(): number {
    const visibleSize = view.getVisibleSize();
    const safeArea = sys.getSafeAreaRect(false);
    return Math.max(0, visibleSize.height - safeArea.y - safeArea.height);
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
    fitNodeToVisibleScreen(root);
    return root;
}

function bindStartScreen(startScreen: Node, callbacks: SpeedStarsStartUiCallbacks) {
    const legacyButtonNames = ['Distance50Button', 'Distance100Button', 'Distance200Button'];
    for (const buttonName of legacyButtonNames) {
        requireNode(startScreen, buttonName).active = false;
    }
    requireNode(startScreen, 'DistanceModeLabel').active = false;

    const startButton = requireNode(startScreen, 'StartButton');
    const startLabel = startButton.getChildByName('Label')?.getComponent(Label);
    if (startLabel) startLabel.string = '准备比赛';
    startButton.on(Node.EventType.TOUCH_END, callbacks.onStart);

    // Secondary entries share the unified outline style so they don't fight
    // the primary start button artwork for attention.
    const roomButton = makeOutlineButton('RoomButton', startScreen, 240, 58, UI_STYLE.panelAlt, '联机房间', UI_STYLE.cyanOutline, 10);
    roomButton.on(Node.EventType.TOUCH_END, callbacks.onRoom);

    const modelDebug = requireNode(startScreen, 'ModelDebugButton');
    modelDebug.active = EDITOR;
    modelDebug.on(Node.EventType.TOUCH_END, callbacks.onModelDebug);

    // 100m AI-debug 1v1 entry. Not a shipping feature, so park it in the
    // bottom-right corner instead of the main menu flow.
    const aiDebug = makeOutlineButton('AiDebugStartButton', startScreen, 200, 46, uiColor(40, 46, 56, 200), '100m AI 调试', uiColor(150, 160, 175, 140), 12);
    aiDebug.on(Node.EventType.TOUCH_END, callbacks.onAiDebug);
    const aiDebugTransform = aiDebug.getComponent(UITransform)!;
    const visibleSize = view.getVisibleSize();
    aiDebug.setPosition(
        visibleSize.width / 2 - 16 - aiDebugTransform.contentSize.width / 2,
        -visibleSize.height / 2 + 16 + aiDebugTransform.contentSize.height / 2,
        0,
    );

    // Arrange the difficulty row and the action buttons with Layout + Widget so the
    // engine handles spacing, centring and screen-fit instead of hand-written
    // coordinates. Editor-only debug buttons are inactive off-editor and Layout
    // skips them automatically.
    applyResponsiveStartMenu(
        startScreen,
        [],
        [startButton, roomButton, modelDebug],
    );

    // Lift the bottom hint strip fully inside the visible area: the prefab parks
    // it half off the bottom edge (y=-358 on a 720-tall design), which crops it.
    const controls = startScreen.getChildByName('Controls');
    const controlsTransform = controls?.getComponent(UITransform);
    if (controls && controlsTransform) {
        const margin = 14;
        controls.setPosition(0, -view.getVisibleSize().height / 2 + controlsTransform.contentSize.height / 2 + margin, 0);
    }
}

// Build Layout containers for the start-menu buttons: a horizontal difficulty row
// stacked above a vertical action column, wrapped in one vertical block that a
// Widget keeps horizontally centred and that is uniformly scaled to fit the
// visible area. This keeps every button on screen for any aspect ratio without
// per-button coordinates.
function applyResponsiveStartMenu(startScreen: Node, difficultyNodes: Node[], actionNodes: Node[]) {
    const menu = makeUiNode('StartMenu', startScreen);
    const menuLayout = menu.addComponent(Layout);
    menuLayout.type = Layout.Type.VERTICAL;
    menuLayout.resizeMode = Layout.ResizeMode.CONTAINER;
    menuLayout.spacingY = 26;

    const difficultyRow = makeUiNode('DifficultyRow', menu);
    const rowLayout = difficultyRow.addComponent(Layout);
    rowLayout.type = Layout.Type.HORIZONTAL;
    rowLayout.resizeMode = Layout.ResizeMode.CONTAINER;
    rowLayout.spacingX = 22;
    for (const node of difficultyNodes) {
        node.setParent(difficultyRow);
        node.setPosition(0, 0, 0);
    }

    const actionColumn = makeUiNode('ActionColumn', menu);
    const columnLayout = actionColumn.addComponent(Layout);
    columnLayout.type = Layout.Type.VERTICAL;
    columnLayout.resizeMode = Layout.ResizeMode.CONTAINER;
    columnLayout.spacingY = 16;
    for (const node of actionNodes) {
        node.setParent(actionColumn);
        node.setPosition(0, 0, 0);
    }

    const widget = menu.addComponent(Widget);
    widget.isAlignHorizontalCenter = true;
    widget.horizontalCenter = 0;

    // Force an immediate pass so container sizes are known before we fit them.
    rowLayout.updateLayout();
    columnLayout.updateLayout();
    menuLayout.updateLayout();

    const visibleSize = view.getVisibleSize();
    const halfH = visibleSize.height / 2;
    // Reserve the top for the title art and leave a little room at the bottom.
    const topBound = Math.min(120, halfH - 20);
    const bottomBound = -halfH + 48;
    const areaWidth = Math.max(1, visibleSize.width - 40);
    const areaHeight = Math.max(1, topBound - bottomBound);

    const menuTransform = menu.getComponent(UITransform);
    const menuWidth = Math.max(1, menuTransform?.contentSize.width ?? 1);
    const menuHeight = Math.max(1, menuTransform?.contentSize.height ?? 1);
    const fit = Math.min(1, areaWidth / menuWidth, areaHeight / menuHeight);
    menu.setScale(fit, fit, 1);
    menu.setPosition(0, (topBound + bottomBound) / 2, menu.position.z);
    widget.updateAlignment();
}
