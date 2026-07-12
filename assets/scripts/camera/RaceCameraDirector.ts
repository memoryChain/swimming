import { Camera, Node, Vec3 } from 'cc';
import { COUNTDOWN_SECONDS, getRaceDistance } from '../core/GameBalance';
import { DEFAULT_RACE_COURSE_LAYOUT, RaceCourseLayout } from '../venue/RaceCourseLayout';

const PRE_RACE_HERO_SECONDS = 2.2;
const PRE_RACE_RIVALS_SECONDS = 2.8;
const PRE_RACE_RETURN_SECONDS = 0.75;
const PRE_COUNTDOWN_CAMERA_SECONDS = PRE_RACE_HERO_SECONDS + PRE_RACE_RIVALS_SECONDS + PRE_RACE_RETURN_SECONDS;
const MIN_BROADCAST_VIEW_SECONDS = 4.2;
const BROADCAST_SHOT_SECONDS = 6.2;
const DIVE_SIDE_MIN_SECONDS = 0.58;
const DIVE_SIDE_MAX_SECONDS = 1.55;
const DIVE_UNDERWATER_MIN_SECONDS = 1.15;
const COUNTDOWN_ATHLETE_TARGET_X_OFFSET = 0;
const COUNTDOWN_ATHLETE_TARGET_Y_OFFSET = 1.25;
const DIVE_ENTRY_WATER_Y_THRESHOLD = 0.16;
const SWIM_SIDE_TARGET_X_OFFSET = 1.55;
const SWIM_SIDE_CAMERA_DISTANCE = 10.5;
const SWIM_SIDE_CAMERA_HEIGHT = 1.7;
const SWIM_SIDE_FOV = 27;
const SWIM_ANGLE_VIEW_FRONT_RANK = 3;
const SWIM_ANGLE_VIEW_BACK_RANK_FROM_END = 3;
export const RACE_CAMERA_TUNING = {
    // Remaining distance at which the sprint chase camera gives way to the
    // existing finish-line top view.
    finishTopViewDistance: 8,
    // Close third-person sprint view, above and behind the player's upper body.
    sprintBackDistance: 1.1,
    sprintHeight: 0.52,
    sprintLookAhead: 0.8,
    sprintFov: 58,
};

export enum RaceCameraMode {
    Broadcast = 0,
    Top = 1,
    Sprint = 2,
}

export type RaceCameraModeOption = {
    mode: RaceCameraMode;
    key: string;
    label: string;
};

// Single source of truth for HUD cycling order. Removing an obsolete camera is
// intentionally just a list edit; enum numeric order is not used for cycling.
export const RACE_CAMERA_MODE_OPTIONS: readonly RaceCameraModeOption[] = [
    { mode: RaceCameraMode.Broadcast, key: 'auto', label: '自动转播' },
    { mode: RaceCameraMode.Top, key: 'top', label: '俯视' },
    { mode: RaceCameraMode.Sprint, key: 'sprint', label: '冲刺视角' },
];

export type RaceCameraSnapshot = {
    playerX: number;
    playerY: number;
    playerUpperBodyWorldPosition?: Vec3;
    playerDistance: number;
    playerUnderwater: boolean;
    closestAiDistanceGap: number;
    playerPlacement: number;
    racerCount: number;
    raceActive: boolean;
    countdownActive: boolean;
    sprintActive: boolean;
};

export class RaceCameraDirector {
    private readonly _cameraPos = new Vec3(-6, 4.7, 10.5);
    private readonly _cameraTarget = new Vec3(8, 0.25, 0);
    private _cameraNode: Node = null;
    private _mode = RaceCameraMode.Broadcast;
    private _broadcastShotTimer = 0;
    private _broadcastShotIndex = 0;
    private _broadcastShotSequence: number[] = [];
    private _broadcastShotSequenceCursor = 0;
    private _broadcastDuelTimer = 0;
    private _broadcastDuelCooldown = 0;
    private _broadcastDuelShotIndex = 1;
    private _broadcastCameraFov = 36;
    private _broadcastDesiredFov = 36;
    private _broadcastCountdownElapsed = 0;
    private _broadcastRaceElapsed = 0;
    private _diveShotElapsed = -1;
    private _diveSurfaceRestoreSeconds = 0;
    private _topViewActive = false;
    private _underwaterViewActive = false;
    private _preCountdownElapsed = 0;
    private _preCountdownActive = false;
    private _preCountdownReady = false;
    private _preCountdownLaneZs: number[] = [];
    private _preCountdownShotIndex = -1;
    private _awardsCenter: Vec3 | null = null;

    constructor(private readonly _playerLaneZ: number, private readonly _courseLayout: RaceCourseLayout = DEFAULT_RACE_COURSE_LAYOUT) {
        this._cameraTarget.set(8, 0.25, _playerLaneZ);
        this.pickBroadcastShotSequence();
    }

    bindCamera(cameraNode: Node) {
        this._cameraNode = cameraNode;
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget);
        this.applyFov();
    }

    cycleMode(): string {
        const currentIndex = RACE_CAMERA_MODE_OPTIONS.findIndex((option) => option.mode === this._mode);
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % RACE_CAMERA_MODE_OPTIONS.length;
        return this.selectMode(RACE_CAMERA_MODE_OPTIONS[nextIndex].mode);
    }

    selectMode(mode: RaceCameraMode): string {
        this._mode = mode;
        this._topViewActive = this._mode === RaceCameraMode.Top;
        this._underwaterViewActive = false;
        if (this._mode === RaceCameraMode.Broadcast) {
            this.resetBroadcastDirector();
        }
        this.applyFov();
        return this.currentModeName;
    }

    resetToBroadcast() {
        this._awardsCenter = null;
        this.selectMode(RaceCameraMode.Broadcast);
        this.resetBroadcastCamera();
    }

    resetCountdownTimers() {
        this._broadcastCountdownElapsed = 0;
        this._broadcastRaceElapsed = 0;
        this._broadcastShotTimer = 0;
        this._diveShotElapsed = -1;
        this._diveSurfaceRestoreSeconds = 0;
        this._underwaterViewActive = false;
    }

    startPreCountdownOrbit(laneZs: number[] = []) {
        this._mode = RaceCameraMode.Broadcast;
        this._topViewActive = false;
        this._awardsCenter = null;
        this._preCountdownElapsed = 0;
        this._preCountdownActive = true;
        this._preCountdownReady = false;
        this.updatePreCountdownRacerLanes(laneZs);
        this._preCountdownShotIndex = -1;
        this._broadcastCountdownElapsed = 0;
        this._broadcastRaceElapsed = 0;
        this._diveShotElapsed = -1;
        this._diveSurfaceRestoreSeconds = 0;
        this._underwaterViewActive = false;
        this._broadcastCameraFov = 52;
        this._broadcastDesiredFov = 52;
        this.resetBroadcastCamera();
    }

    updatePreCountdownRacerLanes(laneZs: number[]) {
        this._preCountdownLaneZs = laneZs
            .filter((laneZ) => Number.isFinite(laneZ))
            .filter((laneZ) => Math.abs(laneZ - this._playerLaneZ) > 0.001)
            .sort((a, b) => a - b);
    }

    startAwardsPresentation(center: Vec3) {
        this._mode = RaceCameraMode.Broadcast;
        this._topViewActive = false;
        this._underwaterViewActive = false;
        this._preCountdownActive = false;
        this._preCountdownReady = false;
        this._awardsCenter = center.clone();
        this._broadcastCameraFov = 38;
        this._broadcastDesiredFov = 38;
        this.applyFov();
    }

    consumePreCountdownReady(): boolean {
        if (!this._preCountdownReady) {
            return false;
        }
        this._preCountdownReady = false;
        return true;
    }

    resetRaceTimers() {
        this._broadcastRaceElapsed = 0;
        this._broadcastShotTimer = 0;
    }

    startDiveShot() {
        this._diveShotElapsed = 0;
        this._diveSurfaceRestoreSeconds = 0;
        this._underwaterViewActive = false;
        this._broadcastRaceElapsed = 0;
        this._broadcastShotTimer = 0;
    }

    update(dt: number, snapshot: RaceCameraSnapshot) {
        if (!this._cameraNode) {
            return;
        }
        if (this._mode === RaceCameraMode.Sprint) {
            this._topViewActive = false;
            this._underwaterViewActive = false;
            this.updateSprintCamera(snapshot);
            return;
        }
        if (this._mode === RaceCameraMode.Broadcast) {
            this.updateBroadcastCamera(dt, snapshot);
            return;
        }
        this.updateTopCamera(snapshot);
    }

    applyFov() {
        const camera = this._cameraNode?.getComponent(Camera);
        if (!camera) {
            return;
        }
        let baseFov = 36;
        if (this._mode === RaceCameraMode.Broadcast) {
            baseFov = this._broadcastCameraFov;
        } else if (this._mode === RaceCameraMode.Top) {
            baseFov = 44;
        } else if (this._mode === RaceCameraMode.Sprint) {
            baseFov = RACE_CAMERA_TUNING.sprintFov;
        }
        camera.fov = Math.max(18, baseFov);
    }

    resetBroadcastCamera() {
        const platform = this._courseLayout.platformStandingPosition(this._playerLaneZ);
        this._cameraTarget.set(countdownAthleteTargetX(platform.x), countdownAthleteTargetY(platform.y), this._playerLaneZ);
        this._cameraPos.set(platform.x + 8.57 * this._courseLayout.direction, 3.15, this._playerLaneZ + 0.8);
        this.applyFov();
        if (this._cameraNode) {
            this._cameraNode.setPosition(this._cameraPos);
            this._cameraNode.lookAt(this._cameraTarget);
        }
    }

    private updateBroadcastCamera(dt: number, snapshot: RaceCameraSnapshot) {
        const playerX = snapshot.playerX;
        const playerY = snapshot.playerY;
        const playerDistance = snapshot.playerDistance;
        const raceDistance = getRaceDistance();
        const direction = this._courseLayout.directionAtDistance(playerDistance);
        const raceRatio = Math.max(0, Math.min(1, playerDistance / raceDistance));
        const raceActive = snapshot.raceActive;
        const countdownActive = snapshot.countdownActive;
        if (this._preCountdownActive) {
            this._preCountdownElapsed += dt;
        }
        if (countdownActive) {
            this._broadcastCountdownElapsed += dt;
        }
        if (this._diveShotElapsed >= 0) {
            this._diveShotElapsed += dt;
        }
        this._diveSurfaceRestoreSeconds = Math.max(0, this._diveSurfaceRestoreSeconds - dt);
        if (raceActive) {
            this._broadcastRaceElapsed += dt;
        }

        const closeDuel = false;
        this._broadcastDuelTimer = Math.max(0, this._broadcastDuelTimer - dt);
        this._broadcastDuelCooldown = Math.max(0, this._broadcastDuelCooldown - dt);
        const minViewSeconds = MIN_BROADCAST_VIEW_SECONDS;
        if (closeDuel && this._broadcastShotTimer >= minViewSeconds && this._broadcastDuelTimer <= 0 && this._broadcastDuelCooldown <= 0) {
            this._broadcastDuelTimer = 4.4;
            this._broadcastDuelCooldown = 7.4;
            this._broadcastShotTimer = 0;
            this._broadcastDuelShotIndex = (this._broadcastDuelShotIndex + 1) % 2;
        }

        let desiredPos: Vec3;
        let desiredTarget: Vec3;
        let fixedTopView = false;
        let underwaterView = false;
        let hardCameraCut = false;
        const wasUnderwaterView = this._underwaterViewActive;
        if (this._awardsCenter) {
            // Aim to the right of the temporary podium so the winners occupy the
            // left half of the screen and leave room for the result panel.
            desiredTarget = new Vec3(this._awardsCenter.x + 2.35, this._awardsCenter.y + 1.05, this._awardsCenter.z);
            desiredPos = new Vec3(desiredTarget.x, desiredTarget.y + 2.35, desiredTarget.z + 9.4);
            this._broadcastDesiredFov = 38;
        } else if (this._preCountdownActive) {
            const elapsed = this._preCountdownElapsed;
            let showcaseLaneZ = this._playerLaneZ;
            let shotIndex = 0;
            if (elapsed >= PRE_RACE_HERO_SECONDS && elapsed < PRE_RACE_HERO_SECONDS + PRE_RACE_RIVALS_SECONDS && this._preCountdownLaneZs.length > 0) {
                const rivalProgress = clamp((elapsed - PRE_RACE_HERO_SECONDS) / PRE_RACE_RIVALS_SECONDS, 0, 0.9999);
                const rivalIndex = Math.min(
                    this._preCountdownLaneZs.length - 1,
                    Math.floor(rivalProgress * this._preCountdownLaneZs.length),
                );
                showcaseLaneZ = this._preCountdownLaneZs[rivalIndex];
                shotIndex = rivalIndex + 1;
            } else if (elapsed >= PRE_RACE_HERO_SECONDS + PRE_RACE_RIVALS_SECONDS) {
                shotIndex = this._preCountdownLaneZs.length + 1;
            }
            hardCameraCut = shotIndex !== this._preCountdownShotIndex;
            this._preCountdownShotIndex = shotIndex;
            const target = new Vec3(countdownAthleteTargetX(playerX), countdownAthleteTargetY(playerY), showcaseLaneZ);
            desiredTarget = target;
            const rivalShot = shotIndex > 0 && shotIndex <= this._preCountdownLaneZs.length;
            desiredPos = rivalShot
                ? new Vec3(target.x + 4.75 * direction, target.y + 0.85, target.z + (shotIndex % 2 === 0 ? 2.2 : -2.2))
                : countdownFrontCameraPosition(target, direction, 1);
            this._broadcastDesiredFov = rivalShot ? 37 : shotIndex === 0 ? 34 : 40;
            if (elapsed >= PRE_COUNTDOWN_CAMERA_SECONDS) {
                this._preCountdownActive = false;
                this._preCountdownReady = true;
            }
        } else if (!raceActive && !countdownActive) {
            const platform = this._courseLayout.platformStandingPosition(this._playerLaneZ);
            desiredTarget = new Vec3(countdownAthleteTargetX(platform.x), countdownAthleteTargetY(platform.y), this._playerLaneZ);
            desiredPos = new Vec3(platform.x + 8.57 * this._courseLayout.direction, 3.15, this._playerLaneZ + 0.8);
            this._broadcastDesiredFov = 52;
        } else if (countdownActive && this._diveShotElapsed < 0) {
            const ratio = smoothStep(clamp(this._broadcastCountdownElapsed / Math.max(0.1, COUNTDOWN_SECONDS), 0, 1));
            const frontTarget = new Vec3(countdownAthleteTargetX(playerX), countdownAthleteTargetY(playerY), this._playerLaneZ);
            const frontPos = countdownFrontCameraPosition(frontTarget, direction, 1);
            const sideTarget = diveSideTarget(playerX, playerY, this._playerLaneZ, direction);
            const sidePos = diveSideCameraPos(playerX, playerY, this._playerLaneZ, direction);
            desiredTarget = lerpVec3(frontTarget, sideTarget, ratio);
            desiredPos = lerpVec3(frontPos, sidePos, ratio);
            this._broadcastDesiredFov = lerp(42, 36, ratio);
        } else if (this.shouldHoldDiveSideShot(snapshot)) {
            desiredTarget = diveSideTarget(playerX, playerY, this._playerLaneZ, direction);
            desiredPos = diveSideCameraPos(playerX, playerY, this._playerLaneZ, direction);
            this._broadcastDesiredFov = 36;
        } else if (this.shouldHoldUnderwaterDiveShot(snapshot)) {
            desiredTarget = underwaterDiveTarget(playerX, playerY, this._playerLaneZ, direction);
            desiredPos = underwaterDiveCameraPos(playerX, playerY, this._playerLaneZ, direction);
            this._broadcastDesiredFov = 43;
            underwaterView = true;
        } else if (snapshot.sprintActive
            && raceDistance - playerDistance <= RACE_CAMERA_TUNING.finishTopViewDistance) {
            this.finishDiveShotIfNeeded();
            const courseEndDistance = this._courseLayout.currentCourseEndDistance(playerDistance, raceDistance);
            const finishDirection = this._courseLayout.finishDirectionAtDistance(courseEndDistance);
            const finishAnchorX = this._courseLayout.distanceToWorldX(courseEndDistance) - 7.5 * finishDirection;
            const playerFollowX = playerX + 3.4 * finishDirection;
            const targetX = playerFollowX * 0.65 + finishAnchorX * 0.35;
            desiredTarget = new Vec3(targetX, 0.18, 0);
            desiredPos = new Vec3(desiredTarget.x, 22.5, 0);
            this._broadcastDesiredFov = 46;
            fixedTopView = true;
        } else if (snapshot.sprintActive) {
            this.finishDiveShotIfNeeded();
            const sprintView = sprintCameraView(snapshot, direction);
            desiredPos = sprintView.position;
            desiredTarget = sprintView.target;
            this._broadcastDesiredFov = RACE_CAMERA_TUNING.sprintFov;
        } else if (this._broadcastDuelTimer > 0) {
            this.finishDiveShotIfNeeded();
            if (this._broadcastDuelShotIndex === 0) {
                desiredPos = new Vec3(playerX - 4.1 * direction, 2.05, this._playerLaneZ + 3.5);
                desiredTarget = surfaceUpperBodyTarget(snapshot, direction, 1.85);
            } else {
                desiredTarget = surfaceUpperBodyTarget(snapshot, direction, 0.9);
                desiredPos = new Vec3(desiredTarget.x, 1.95, this._playerLaneZ + 4.4);
            }
            this._broadcastDesiredFov = 28;
        } else {
            this.finishDiveShotIfNeeded();
            const view = swimRaceView(snapshot);
            desiredTarget = surfaceUpperBodyTarget(snapshot, direction, view.targetXOffset);
            desiredPos = new Vec3(
                desiredTarget.x + view.cameraXOffset * direction,
                view.height,
                this._playerLaneZ + view.zOffset,
            );
            this._broadcastDesiredFov = view.fov;
        }

        this._topViewActive = fixedTopView;
        this._underwaterViewActive = underwaterView;
        if (wasUnderwaterView && !underwaterView) {
            this._cameraPos.set(desiredPos);
            this._cameraTarget.set(desiredTarget);
            this._broadcastCameraFov = this._broadcastDesiredFov;
            this.applyCameraTransform(fixedTopView ? new Vec3(0, 0, -1) : undefined);
            this.applyFov();
            return;
        }

        if (fixedTopView) {
            this._cameraPos.set(desiredPos);
            this._cameraTarget.set(desiredTarget);
            this._broadcastCameraFov = this._broadcastDesiredFov;
            this.applyCameraTransform(new Vec3(0, 0, -1));
            this.applyFov();
            return;
        }

        if (hardCameraCut) {
            this._cameraPos.set(desiredPos);
            this._cameraTarget.set(desiredTarget);
            this._broadcastCameraFov = this._broadcastDesiredFov;
            this.applyCameraTransform();
            this.applyFov();
            return;
        }

        const smoothSpeed = this._diveShotElapsed >= 0 ? 4.6 : this._diveSurfaceRestoreSeconds > 0 ? 10.5 : raceActive ? 12.5 : 5.8;
        const smooth = cameraBlend(dt, smoothSpeed);
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, smooth);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, desiredTarget, smooth);
        this._broadcastCameraFov += (this._broadcastDesiredFov - this._broadcastCameraFov) * smooth;
        this.applyCameraTransform();
        this.applyFov();
    }

    private readonly _shotDesiredPos = new Vec3();
    private readonly _shotDesiredTarget = new Vec3();

    private applyBroadcastShot(playerX: number) {
        const direction = 1;
        const shot = this._broadcastShotIndex;
        if (shot === 0) {
            this._shotDesiredTarget.set(surfaceUpperBodyTarget({ playerX, playerY: 0, playerDistance: 0, playerUnderwater: false, closestAiDistanceGap: 0, playerPlacement: 0, racerCount: 0, raceActive: true, countdownActive: false, sprintActive: false }, direction, 3.2));
            this._shotDesiredPos.set(this._shotDesiredTarget.x, 1.55, this._playerLaneZ + 9.2);
            this._broadcastDesiredFov = 33;
        } else if (shot === 1) {
            this._shotDesiredPos.set(playerX - 7.2, 2.75, this._playerLaneZ + 3.3);
            this._shotDesiredTarget.set(surfaceUpperBodyTarget({ playerX, playerY: 0, playerDistance: 0, playerUnderwater: false, closestAiDistanceGap: 0, playerPlacement: 0, racerCount: 0, raceActive: true, countdownActive: false, sprintActive: false }, direction, 3.6));
            this._broadcastDesiredFov = 34;
        } else if (shot === 2) {
            this._shotDesiredPos.set(playerX - 5.7, 4.25, this._playerLaneZ + 11.8);
            this._shotDesiredTarget.set(surfaceUpperBodyTarget({ playerX, playerY: 0, playerDistance: 0, playerUnderwater: false, closestAiDistanceGap: 0, playerPlacement: 0, racerCount: 0, raceActive: true, countdownActive: false, sprintActive: false }, direction, 5.0));
            this._broadcastDesiredFov = 36;
        } else if (shot === 3) {
            this._shotDesiredPos.set(playerX - 3.9, 2.35, this._playerLaneZ + 7.6);
            this._shotDesiredTarget.set(surfaceUpperBodyTarget({ playerX, playerY: 0, playerDistance: 0, playerUnderwater: false, closestAiDistanceGap: 0, playerPlacement: 0, racerCount: 0, raceActive: true, countdownActive: false, sprintActive: false }, direction, 2.0));
            this._broadcastDesiredFov = 33;
        }
    }

    private updateTopCamera(snapshot: RaceCameraSnapshot) {
        const playerX = snapshot.playerX;
        this._topViewActive = true;
        this._underwaterViewActive = false;
        // Strict pool-orthogonal top view: camera is directly above the target,
        // and -Z is locked as screen-up so world-X lanes are horizontal.
        this._cameraTarget.set(playerX, 0.18, 0);
        this._cameraPos.set(this._cameraTarget.x, 17.5, this._cameraTarget.z);
        this.applyCameraTransform(new Vec3(0, 0, -1));
        this.applyFov();
    }

    private updateSprintCamera(snapshot: RaceCameraSnapshot) {
        const direction = this._courseLayout.directionAtDistance(snapshot.playerDistance);
        const view = sprintCameraView(snapshot, direction);
        Vec3.lerp(this._cameraPos, this._cameraPos, view.position, 0.18);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, view.target, 0.18);
        this.applyCameraTransform();
        this.applyFov();
    }

    private shouldHoldDiveSideShot(snapshot: RaceCameraSnapshot): boolean {
        if (this._diveShotElapsed < 0) {
            return false;
        }
        if (this._diveShotElapsed < DIVE_SIDE_MIN_SECONDS) {
            return true;
        }
        const waterY = this._courseLayout.waterY;
        return snapshot.playerY > waterY - DIVE_ENTRY_WATER_Y_THRESHOLD && this._diveShotElapsed < DIVE_SIDE_MAX_SECONDS;
    }

    private shouldHoldUnderwaterDiveShot(snapshot: RaceCameraSnapshot): boolean {
        if (this._diveShotElapsed < 0 || this.shouldHoldDiveSideShot(snapshot)) {
            return false;
        }
        if (this._diveShotElapsed < DIVE_SIDE_MIN_SECONDS + DIVE_UNDERWATER_MIN_SECONDS) {
            return true;
        }
        return snapshot.playerUnderwater;
    }

    private finishDiveShotIfNeeded() {
        if (this._diveShotElapsed >= 0) {
            this._diveShotElapsed = -1;
            this._diveSurfaceRestoreSeconds = 1.05;
        }
    }

    private applyCameraTransform(up?: Vec3) {
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget, up);
    }

    private resetBroadcastDirector() {
        this._broadcastShotTimer = 0;
        this._broadcastDuelTimer = 0;
        this._broadcastDuelCooldown = 0;
        this._broadcastDuelShotIndex = 1;
        this._broadcastCameraFov = 52;
        this._broadcastDesiredFov = 52;
        this._broadcastCountdownElapsed = 0;
        this._broadcastRaceElapsed = 0;
        this._diveShotElapsed = -1;
        this._diveSurfaceRestoreSeconds = 0;
        this._topViewActive = false;
        this._underwaterViewActive = false;
        this._preCountdownElapsed = 0;
        this._preCountdownActive = false;
        this._preCountdownReady = false;
        this.pickBroadcastShotSequence();
    }

    private pickBroadcastShotSequence() {
        const sequences = [
            [0, 1, 2, 3],
            [0, 2, 1, 3],
            [2, 0, 3, 1],
            [0, 1, 3, 2],
        ];
        this._broadcastShotSequence = sequences[Math.floor(Math.random() * sequences.length)].slice();
        this._broadcastShotSequenceCursor = 0;
        this._broadcastShotIndex = this._broadcastShotSequence[0];
    }

    private advanceBroadcastShot() {
        if (this._broadcastShotSequence.length === 0) {
            this.pickBroadcastShotSequence();
            return;
        }
        this._broadcastShotSequenceCursor++;
        if (this._broadcastShotSequenceCursor >= this._broadcastShotSequence.length) {
            this.pickBroadcastShotSequence();
            return;
        }
        this._broadcastShotIndex = this._broadcastShotSequence[this._broadcastShotSequenceCursor];
    }

    private currentBroadcastShotSeconds(): number {
        return BROADCAST_SHOT_SECONDS;
    }

    get currentModeName(): string {
        return RACE_CAMERA_MODE_OPTIONS.find((option) => option.mode === this._mode)?.label ?? '未知';
    }

    get mode(): RaceCameraMode {
        return this._mode;
    }

    get topViewActive(): boolean {
        return this._topViewActive;
    }

    get underwaterViewActive(): boolean {
        return this._underwaterViewActive;
    }
}

type SwimRaceView = {
    targetXOffset: number;
    cameraXOffset: number;
    zOffset: number;
    height: number;
    fov: number;
};

function swimRaceView(snapshot: RaceCameraSnapshot): SwimRaceView {
    if (snapshot.racerCount > 0 && snapshot.playerPlacement === snapshot.racerCount) {
        return {
            targetXOffset: 0,
            cameraXOffset: 0,
            zOffset: SWIM_SIDE_CAMERA_DISTANCE,
            height: SWIM_SIDE_CAMERA_HEIGHT,
            fov: SWIM_SIDE_FOV,
        };
    }
    if (snapshot.playerPlacement === 1) {
        return {
            targetXOffset: 0,
            cameraXOffset: 0,
            zOffset: SWIM_SIDE_CAMERA_DISTANCE,
            height: SWIM_SIDE_CAMERA_HEIGHT,
            fov: SWIM_SIDE_FOV,
        };
    }
    if (snapshot.playerPlacement > 0 && snapshot.playerPlacement <= SWIM_ANGLE_VIEW_FRONT_RANK) {
        return {
            targetXOffset: 0,
            cameraXOffset: 0,
            zOffset: SWIM_SIDE_CAMERA_DISTANCE,
            height: SWIM_SIDE_CAMERA_HEIGHT,
            fov: SWIM_SIDE_FOV,
        };
    }
    if (snapshot.racerCount > 0 && snapshot.playerPlacement >= Math.max(1, snapshot.racerCount - SWIM_ANGLE_VIEW_BACK_RANK_FROM_END + 1)) {
        return {
            targetXOffset: 0,
            cameraXOffset: 0,
            zOffset: SWIM_SIDE_CAMERA_DISTANCE,
            height: SWIM_SIDE_CAMERA_HEIGHT,
            fov: SWIM_SIDE_FOV,
        };
    }
    return {
        targetXOffset: 0,
        cameraXOffset: 0,
        zOffset: SWIM_SIDE_CAMERA_DISTANCE,
        height: SWIM_SIDE_CAMERA_HEIGHT,
        fov: SWIM_SIDE_FOV,
    };
}

function surfaceUpperBodyTarget(snapshot: RaceCameraSnapshot, direction: number, forwardOffset: number): Vec3 {
    void direction;
    void forwardOffset;
    if (snapshot.playerUpperBodyWorldPosition) {
        return snapshot.playerUpperBodyWorldPosition.clone();
    }
    return new Vec3(snapshot.playerX, snapshot.playerY + 0.54, 0);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function cameraBlend(dt: number, speed: number): number {
    if (dt <= 0) {
        return 0.1;
    }
    return clamp(1 - Math.exp(-dt * speed), 0.035, 0.28);
}

function smoothStep(value: number): number {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * clamp(t, 0, 1);
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
    const ratio = clamp(t, 0, 1);
    return new Vec3(
        lerp(a.x, b.x, ratio),
        lerp(a.y, b.y, ratio),
        lerp(a.z, b.z, ratio),
    );
}

function sprintCameraView(snapshot: RaceCameraSnapshot, direction: number): { position: Vec3; target: Vec3 } {
    // This anchor is sampled from the rig's torso/spine chain (blended slightly
    // toward the head), not from the swimmer root at the hips/feet.
    const upperBody = snapshot.playerUpperBodyWorldPosition?.clone()
        ?? new Vec3(snapshot.playerX, snapshot.playerY + 0.54, 0);
    return {
        position: new Vec3(
            upperBody.x - RACE_CAMERA_TUNING.sprintBackDistance * direction,
            upperBody.y + RACE_CAMERA_TUNING.sprintHeight,
            upperBody.z,
        ),
        target: new Vec3(
            upperBody.x + RACE_CAMERA_TUNING.sprintLookAhead * direction,
            upperBody.y + 0.08,
            upperBody.z,
        ),
    };
}

function diveSideTarget(playerX: number, playerY: number, playerLaneZ: number, direction = 1): Vec3 {
    return new Vec3(
        playerX + 0.95 * direction,
        Math.max(playerY + 0.42, 0.55),
        playerLaneZ - 0.18,
    );
}

function diveSideCameraPos(playerX: number, playerY: number, playerLaneZ: number, direction = 1): Vec3 {
    return new Vec3(
        playerX + 0.65 * direction,
        Math.max(playerY + 0.34, 1.2),
        playerLaneZ + 6.7,
    );
}

function underwaterDiveTarget(playerX: number, playerY: number, playerLaneZ: number, direction = 1): Vec3 {
    return new Vec3(
        playerX + 1.05 * direction,
        Math.max(playerY + 0.32, -0.08),
        playerLaneZ - 0.15,
    );
}

function underwaterDiveCameraPos(playerX: number, playerY: number, playerLaneZ: number, direction = 1): Vec3 {
    return new Vec3(
        playerX + 4.25 * direction,
        Math.min(playerY + 0.44, 0.08),
        playerLaneZ + 4.65,
    );
}

function countdownFrontCameraPosition(target: Vec3, direction: number, ratio: number): Vec3 {
    const t = clamp(ratio, 0, 1);
    return new Vec3(
        target.x + lerp(8.4, 5.65, t) * direction,
        lerp(3.15, 2.45, t),
        target.z + lerp(0.12, 0.85, t),
    );
}

function countdownAthleteTargetY(playerY: number): number {
    return playerY + COUNTDOWN_ATHLETE_TARGET_Y_OFFSET;
}

function countdownAthleteTargetX(playerX: number): number {
    return playerX + COUNTDOWN_ATHLETE_TARGET_X_OFFSET;
}
