import { Button, Color, EventMouse, EventTouch, Graphics, instantiate, Label, LabelOutline, Node, Prefab, resources, Sprite, SpriteFrame, sys, Texture2D, UITransform, view } from 'cc';
import { EDITOR } from 'cc/env';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { StrokeType } from '../core/GameConstants';
import { UIController } from './UIController';
import { SettlementView } from './SettlementView';
import type { RaceLeaderboardRow } from './UIController';
import {
    fitFullScreenBackgroundCover,
    fitNodeToVisibleScreen,
    makeButton,
    makeLabel,
    makeUiNode,
    uiColor,
} from './RuntimeUiFactory';

export type SpeedStarsStartUiCallbacks = {
    onStart: () => void;
    onModelDebug: () => void;
    onAiDebug: () => void;
    onUnderwaterDebug: () => void;
};

export type SpeedStarsUiCallbacks = {
    resolveResultAvatar?: (row: RaceLeaderboardRow) => string | undefined;
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

type LoginTextures = {
    background: Texture2D;
    logo: Texture2D;
    primaryButton: Texture2D;
    primaryArrow: Texture2D;
    onlineButton: Texture2D;
    onlineIcon: Texture2D;
};

export class SpeedStarsStartUiPrefabBuilder {
    constructor(private readonly _callbacks: SpeedStarsStartUiCallbacks) {}

    build(parent: Node, _w: number, _h: number, done: (error: Error | null, refs?: SpeedStarsStartUiRefs) => void) {
        loadLoginTextures((artError, art) => {
            if (artError || !art) {
                done(artError ?? new Error('Login UI artwork is missing'));
                return;
            }
            loadSpeedStarsPrefab((error, prefab) => {
                if (error || !prefab) {
                    done(error ?? new Error('SpeedStars UI prefab is missing'));
                    return;
                }
                try {
                    const root = instantiateRoot(parent, prefab);
                    const startScreen = requireNode(root, 'StartScreen');
                    applyLoginArtwork(startScreen, art);
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

        // 旧行资源仍供赛前名册复用，但旧结算面板不再显示。
        ui.resultPanel.active = false;
        ui.settlementView = new SettlementView(raceHud, this._callbacks);
        ui.resultPanel = ui.settlementView.root;

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

function layoutStartScreen(root: Node, startScreen: Node) {
    fitNodeToVisibleScreen(root);
    fitNodeToVisibleScreen(startScreen);

    // The approved login PSD uses a 1280x720 design canvas. Keep the background
    // in cover mode, while the logo/actions use one uniform center-anchored
    // scale so wider/taller phones never stretch the authored artwork.
    const background = requireNode(startScreen, 'StartShade');
    const visibleSize = view.getVisibleSize();
    fitFullScreenBackgroundCover(background);

    const artScale = Math.min(visibleSize.width / 1280, visibleSize.height / 720);
    layoutPsdNode(requireNode(startScreen, 'TitlePlate'), 28, 157, 608, 262, artScale);
    layoutPsdNode(requireNode(startScreen, 'StartButton'), -0.5, -151.5, 373, 119, artScale);
    layoutPsdNode(requireNode(startScreen, 'ModelDebugButton'), 0.5, -243.5, 149, 57, artScale);

    // These belong to the previous start-screen composition. The PSD-derived
    // logo and buttons replace them without rebuilding the stable prefab tree.
    for (const name of ['SpeedBackPlate', 'Logo', 'Kicker', 'Controls', 'SwimLogo']) {
        const node = findNode(startScreen, name);
        if (node?.active) {
            node.active = false;
        }
    }
}

function applyLoginArtwork(startScreen: Node, art: LoginTextures) {
    setSpriteTexture(requireNode(startScreen, 'StartShade'), art.background);

    const logo = requireNode(startScreen, 'TitlePlate');
    setSpriteTexture(logo, art.logo);

    const primary = requireNode(startScreen, 'StartButton');
    setSpriteTexture(primary, art.primaryButton);
    configurePsdButton(primary);
    const primaryLabel = primary.getChildByName('Label')?.getComponent(Label);
    if (primaryLabel) {
        stylePsdLabel(primaryLabel, '开游', 40, uiColor(0, 29, 65), 110, 50, 0, 0.5);
    }
    makePsdSprite('PrimaryArrow', primary, art.primaryArrow, 38, 38, 122.5, -0.5);

    const online = requireNode(startScreen, 'ModelDebugButton');
    setSpriteTexture(online, art.onlineButton);
    configurePsdButton(online);
    const onlineLabel = online.getChildByName('Label')?.getComponent(Label);
    if (onlineLabel) {
        stylePsdLabel(onlineLabel, '联机', 23, uiColor(0, 29, 65), 60, 34, 13, -0.5);
    }
    makePsdSprite('OnlineIcon', online, art.onlineIcon, 28, 21, -32.5, 1);
}

function setSpriteTexture(node: Node, texture: Texture2D) {
    const sprite = node.getComponent(Sprite) || node.addComponent(Sprite);
    const frame = new SpriteFrame();
    frame.texture = texture;
    sprite.spriteFrame = frame;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
}

function makePsdSprite(name: string, parent: Node, texture: Texture2D, width: number, height: number, x: number, y: number) {
    const node = makeUiNode(name, parent);
    node.getComponent(UITransform)!.setContentSize(width, height);
    setSpriteTexture(node, texture);
    node.setPosition(x, y, 1);
}

function stylePsdLabel(label: Label, text: string, fontSize: number, color: Color, width: number, height: number, x: number, y: number) {
    label.string = text;
    label.fontFamily = 'PingFang SC';
    label.fontSize = fontSize;
    label.lineHeight = Math.ceil(fontSize * 1.25);
    label.isBold = true;
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    label.node.getComponent(UITransform)?.setContentSize(width, height);
    label.node.setPosition(x, y, 1);
    label.node.active = true;
}

function configurePsdButton(node: Node) {
    const button = node.getComponent(Button) || node.addComponent(Button);
    button.target = node;
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.96;
    button.duration = 0.08;
}

function layoutPsdNode(node: Node, x: number, y: number, width: number, height: number, scale: number) {
    node.getComponent(UITransform)?.setContentSize(width, height);
    node.setPosition(x * scale, y * scale, node.position.z);
    node.setScale(scale, scale, node.scale.z);
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

function loadLoginTextures(done: (error: Error | null, art?: LoginTextures) => void) {
    const paths = RESOURCE_PATHS.loginUi;
    const entries: Array<[keyof LoginTextures, string]> = [
        ['background', paths.background],
        ['logo', paths.logo],
        ['primaryButton', paths.primaryButton],
        ['primaryArrow', paths.primaryArrow],
        ['onlineButton', paths.onlineButton],
        ['onlineIcon', paths.onlineIcon],
    ];
    const art = {} as LoginTextures;
    let remaining = entries.length;
    let settled = false;
    for (const [key, path] of entries) {
        resources.load(path, Texture2D, (error, texture) => {
            if (settled) {
                return;
            }
            if (error || !texture) {
                settled = true;
                done(new Error(`Failed to load ${path}: ${error?.message ?? 'missing SpriteFrame'}`));
                return;
            }
            art[key] = texture;
            remaining--;
            if (remaining === 0) {
                settled = true;
                done(null, art);
            }
        });
    }
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
    startButton.on(Node.EventType.TOUCH_END, callbacks.onStart);

    // The former online entry is now only a template for debug buttons. The
    // production friend-room action lives on the prepare-race screen.
    const roomButton = requireNode(startScreen, 'ModelDebugButton');
    roomButton.name = 'LegacyOnlineButton';

    // Auxiliary entries use the same artwork and press state as the current online
    // button. Scene-effect preview is available in every runtime; model debug stays
    // editor-only. Keep them in a separate bottom-right stack so they never move or
    // rebuild the production login actions.
    const bottomRightButtons: Node[] = [];
    if (EDITOR) {
        const modelDebug = cloneLoginSecondaryButton(roomButton, 'ModelDebugButton', '模型调试', callbacks.onModelDebug);
        bottomRightButtons.push(modelDebug);
    }
    const sceneEffectPreview = cloneLoginSecondaryButton(roomButton, 'UnderwaterDebugButton', '场景效果预览', callbacks.onUnderwaterDebug);
    bottomRightButtons.push(sceneEffectPreview);
    layoutBottomRightDebugButtons(bottomRightButtons);
    roomButton.active = false;
}

function cloneLoginSecondaryButton(template: Node, name: string, text: string, onClick: () => void): Node {
    const button = instantiate(template);
    button.name = name;
    button.active = true;
    button.setParent(template.parent);
    configurePsdButton(button);

    const label = button.getChildByName('Label')?.getComponent(Label);
    if (label) {
        stylePsdLabel(label, text, 20, uiColor(0, 29, 65), 125, 34, 0, -0.5);
    }
    const onlineIcon = button.getChildByName('OnlineIcon');
    if (onlineIcon?.active) {
        onlineIcon.active = false;
    }
    button.on(Node.EventType.TOUCH_END, onClick);
    return button;
}

function layoutBottomRightDebugButtons(buttons: Node[]) {
    const visibleSize = view.getVisibleSize();
    const safeArea = sys.getSafeAreaRect(false);
    const rightInset = Math.max(0, visibleSize.width - safeArea.x - safeArea.width);
    const bottomInset = Math.max(0, safeArea.y);
    const margin = 16;
    const gap = 10;
    let bottom = -visibleSize.height / 2 + bottomInset + margin;

    for (let index = buttons.length - 1; index >= 0; index--) {
        const button = buttons[index];
        const transform = button.getComponent(UITransform)!;
        const scaledWidth = transform.contentSize.width * button.scale.x;
        const scaledHeight = transform.contentSize.height * button.scale.y;
        button.setPosition(
            visibleSize.width / 2 - rightInset - margin - scaledWidth / 2,
            bottom + scaledHeight / 2,
            button.position.z,
        );
        bottom += scaledHeight + gap;
    }
}
