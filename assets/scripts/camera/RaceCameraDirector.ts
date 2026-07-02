import { Camera, Node, Vec3 } from 'cc';
import { COUNTDOWN_SECONDS, getRaceDistance } from '../core/GameBalance';
import { DEFAULT_RACE_COURSE_LAYOUT, RaceCourseLayout } from '../venue/RaceCourseLayout';

const PRE_COUNTDOWN_CAMERA_SECONDS = 2.35;
const MIN_BROADCAST_VIEW_SECONDS = 4.2;
const BROADCAST_SHOT_SECONDS = 6.2;
const FIRST_PERSON_SHOT_SECONDS = 6.8;
const FIRST_PERSON_MIN_SECONDS = 5.8;
const DIVE_SIDE_MIN_SECONDS = 0.58;
const DIVE_SIDE_MAX_SECONDS = 1.55;
const DIVE_UNDERWATER_MIN_SECONDS = 1.15;
const DIVE_UNDERWATER_MAX_DISTANCE = 8.9;
const COUNTDOWN_ATHLETE_TARGET_X_OFFSET = 0;
const COUNTDOWN_ATHLETE_TARGET_Y_OFFSET = 1.25;
const DIVE_ENTRY_WATER_Y_THRESHOLD = 0.16;
const DIVE_SURFACE_Y_THRESHOLD = 0.06;
const SWIM_SIDE_TARGET_X_OFFSET = 1.55;
const SWIM_SIDE_CAMERA_DISTANCE = 11.2;
const SWIM_SIDE_CAMERA_HEIGHT = 1.7;
const SWIM_SIDE_FOV = 35;
const SURFACE_HEAD_FORWARD_BONUS = 1.15;
const SURFACE_HEAD_TARGET_Y = 0.72;
const SURFACE_HEAD_TARGET_Z_OFFSET = -0.06;
const SWIM_ANGLE_VIEW_FRONT_RANK = 3;
const SWIM_ANGLE_VIEW_BACK_RANK_FROM_END = 3;
const TOP_VIEW_COURSE_END_DISTANCE = 8;

export enum RaceCameraMode {
    Broadcast = 0,
    Side = 1,
    Chase = 2,
    Top = 3,
    FirstPerson = 4,
    Free = 5,
}

export const RACE_CAMERA_MODE_NAMES = ['AUTO', 'SIDE', 'CHASE', 'TOP', 'FIRST', 'FREE'];

export type RaceCameraSnapshot = {
    playerX: number;
    playerY: number;
    playerDistance: number;
    closestAiDistanceGap: number;
    playerPlacement: number;
    racerCount: number;
    raceActive: boolean;
    countdownActive: boolean;
};

export class RaceCameraDirector {
    private readonly _cameraPos = new Vec3(-6, 4.7, 10.5);
    private readonly _cameraTarget = new Vec3(8, 0.25, 0);
    private _cameraNode: Node = null;
    private _mode = RaceCameraMode.Broadcast;
    private _freeDragging = false;
    private _freeYaw = Math.PI / 2;
    private _freePitch = 0.32;
    private _freeDistance = 10.5;
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
        this._mode = (this._mode + 1) % RACE_CAMERA_MODE_NAMES.length;
        this._freeDragging = false;
        this._topViewActive = this._mode === RaceCameraMode.Top;
        if (this._mode === RaceCameraMode.Broadcast) {
            this.resetBroadcastDirector();
        }
        this.applyFov();
        return this.currentModeName;
    }

    toggleFreeMode(): string {
        this._mode = this._mode === RaceCameraMode.Free ? RaceCameraMode.Broadcast : RaceCameraMode.Free;
        this._freeDragging = false;
        this._topViewActive = false;
        if (this._mode === RaceCameraMode.Broadcast) {
            this.resetBroadcastDirector();
        }
        this.applyFov();
        return this.currentModeName;
    }

    resetToBroadcast() {
        this._mode = RaceCameraMode.Broadcast;
        this._freeDragging = false;
        this._topViewActive = false;
        this.resetBroadcastDirector();
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

    startPreCountdownOrbit() {
        this._mode = RaceCameraMode.Broadcast;
        this._freeDragging = false;
        this._topViewActive = false;
        this._preCountdownElapsed = 0;
        this._preCountdownActive = true;
        this._preCountdownReady = false;
        this._broadcastCountdownElapsed = 0;
        this._broadcastRaceElapsed = 0;
        this._diveShotElapsed = -1;
        this._diveSurfaceRestoreSeconds = 0;
        this._underwaterViewActive = false;
        this._broadcastCameraFov = 52;
        this._broadcastDesiredFov = 52;
        this.resetBroadcastCamera();
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
        if (this._mode === RaceCameraMode.Free) {
            this._topViewActive = false;
            this._underwaterViewActive = false;
            this.updateFreeCamera(snapshot);
            return;
        }
        if (this._mode === RaceCameraMode.FirstPerson) {
            this._topViewActive = false;
            this._underwaterViewActive = false;
            this.updateFirstPersonCamera(snapshot);
            return;
        }
        if (this._mode === RaceCameraMode.Broadcast) {
            this.updateBroadcastCamera(dt, snapshot);
            return;
        }
        this.updatePresetCamera(snapshot);
    }

    startFreeDrag() {
        if (this._mode === RaceCameraMode.Free) {
            this._freeDragging = true;
        }
    }

    stopFreeDrag() {
        this._freeDragging = false;
    }

    dragFreeCamera(deltaX: number, deltaY: number) {
        if (!this._freeDragging || this._mode !== RaceCameraMode.Free) {
            return;
        }
        this._freeYaw -= deltaX * 0.006;
        this._freePitch += deltaY * 0.0045;
        this._freePitch = clamp(this._freePitch, -0.15, 1.22);
    }

    zoomFreeCamera(scrollY: number) {
        if (this._mode !== RaceCameraMode.Free) {
            return;
        }
        this._freeDistance = clamp(this._freeDistance - scrollY * 0.006, 3.2, 22);
    }

    applyFov() {
        const camera = this._cameraNode?.getComponent(Camera);
        if (!camera) {
            return;
        }
        const baseFov = this._mode === RaceCameraMode.Broadcast
            ? this._broadcastCameraFov
            : this._mode === RaceCameraMode.Top
                ? 44
                : this._mode === RaceCameraMode.FirstPerson
                    ? 62
                    : this._mode === RaceCameraMode.Free ? 38 : 36;
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
        const minViewSeconds = this._broadcastShotIndex === 4 ? FIRST_PERSON_MIN_SECONDS : MIN_BROADCAST_VIEW_SECONDS;
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
        const wasUnderwaterView = this._underwaterViewActive;
        if (this._preCountdownActive) {
            const ratio = smoothStep(clamp(this._preCountdownElapsed / PRE_COUNTDOWN_CAMERA_SECONDS, 0, 1));
            const target = new Vec3(countdownAthleteTargetX(playerX), countdownAthleteTargetY(playerY), this._playerLaneZ);
            desiredTarget = target;
            desiredPos = countdownFrontCameraPosition(target, direction, ratio);
            this._broadcastDesiredFov = lerp(52, 42, ratio);
            if (ratio >= 1) {
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
        } else if (raceDistance - playerDistance <= TOP_VIEW_COURSE_END_DISTANCE) {
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
        } else if (this._broadcastDuelTimer > 0) {
            this.finishDiveShotIfNeeded();
            if (this._broadcastDuelShotIndex === 0) {
                desiredPos = new Vec3(playerX - 4.1 * direction, 2.05, this._playerLaneZ + 3.5);
                desiredTarget = surfaceHeadTarget(playerX, this._playerLaneZ, direction, 1.85);
            } else {
                desiredTarget = surfaceHeadTarget(playerX, this._playerLaneZ, direction, 0.9);
                desiredPos = new Vec3(desiredTarget.x, 1.95, this._playerLaneZ + 4.4);
            }
            this._broadcastDesiredFov = 28;
        } else {
            this.finishDiveShotIfNeeded();
            const view = swimRaceView(snapshot);
            desiredTarget = surfaceHeadTarget(playerX, this._playerLaneZ, direction, view.targetXOffset);
            desiredPos = new Vec3(
                playerX + view.cameraXOffset * direction,
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

        const smoothSpeed = this._diveShotElapsed >= 0 ? 4.6 : this._diveSurfaceRestoreSeconds > 0 ? 10.5 : raceActive ? 2.7 : 5.8;
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
            this._shotDesiredTarget.set(surfaceHeadTarget(playerX, this._playerLaneZ, direction, 3.2));
            this._shotDesiredPos.set(this._shotDesiredTarget.x, 1.55, this._playerLaneZ + 9.2);
            this._broadcastDesiredFov = 33;
        } else if (shot === 1) {
            this._shotDesiredPos.set(playerX - 7.2, 2.75, this._playerLaneZ + 3.3);
            this._shotDesiredTarget.set(surfaceHeadTarget(playerX, this._playerLaneZ, direction, 3.6));
            this._broadcastDesiredFov = 34;
        } else if (shot === 2) {
            this._shotDesiredPos.set(playerX - 5.7, 4.25, this._playerLaneZ + 11.8);
            this._shotDesiredTarget.set(surfaceHeadTarget(playerX, this._playerLaneZ, direction, 5.0));
            this._broadcastDesiredFov = 36;
        } else if (shot === 3) {
            this._shotDesiredPos.set(playerX - 3.9, 2.35, this._playerLaneZ + 7.6);
            this._shotDesiredTarget.set(surfaceHeadTarget(playerX, this._playerLaneZ, direction, 2.0));
            this._broadcastDesiredFov = 33;
        } else if (shot === 4) {
            this._shotDesiredPos.set(firstPersonCameraPos(playerX, this._playerLaneZ, direction));
            this._shotDesiredTarget.set(playerX + 9.0, 0.58, this._playerLaneZ);
            this._broadcastDesiredFov = 62;
        }
    }

    private updatePresetCamera(snapshot: RaceCameraSnapshot) {
        const playerX = snapshot.playerX;
        const direction = this._courseLayout.directionAtDistance(snapshot.playerDistance);
        let desiredPos: Vec3;
        let desiredTarget: Vec3;
        if (this._mode === RaceCameraMode.Side) {
            this._topViewActive = false;
            this._underwaterViewActive = false;
            desiredTarget = surfaceHeadTarget(playerX, this._playerLaneZ, direction, SWIM_SIDE_TARGET_X_OFFSET);
            desiredPos = new Vec3(desiredTarget.x, SWIM_SIDE_CAMERA_HEIGHT, this._playerLaneZ + SWIM_SIDE_CAMERA_DISTANCE);
        } else if (this._mode === RaceCameraMode.Chase) {
            this._topViewActive = false;
            this._underwaterViewActive = false;
            desiredPos = new Vec3(playerX - 7.2 * direction, 2.55, this._playerLaneZ + 2.9);
            desiredTarget = surfaceHeadTarget(playerX, this._playerLaneZ, direction, 3.6);
        } else {
            this._topViewActive = true;
            this._underwaterViewActive = false;
            desiredPos = new Vec3(playerX + 1.8 * direction, 17.5, this._playerLaneZ + 0.1);
            desiredTarget = surfaceHeadTarget(playerX, this._playerLaneZ, direction, 2.6);
        }
        const smooth = snapshot.raceActive ? 0.1 : 0.2;
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, smooth);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, desiredTarget, smooth);
        this.applyCameraTransform();
        this.applyFov();
    }

    private updateFirstPersonCamera(snapshot: RaceCameraSnapshot) {
        const playerX = snapshot.playerX;
        const direction = this._courseLayout.directionAtDistance(snapshot.playerDistance);
        const desiredPos = firstPersonCameraPos(playerX, this._playerLaneZ, direction);
        const desiredTarget = new Vec3(playerX + 9.0 * direction, 0.58, this._playerLaneZ);
        this._cameraPos.set(desiredPos);
        this._cameraTarget.set(desiredTarget);
        this._underwaterViewActive = false;
        this.applyCameraTransform();
        this.applyFov();
    }

    private updateFreeCamera(snapshot: RaceCameraSnapshot) {
        const playerX = snapshot.playerX;
        const direction = this._courseLayout.directionAtDistance(snapshot.playerDistance);
        const target = new Vec3(playerX + 1.2 * direction, 0.55, this._playerLaneZ);
        const cosPitch = Math.cos(this._freePitch);
        const desiredPos = new Vec3(
            target.x + Math.cos(this._freeYaw) * cosPitch * this._freeDistance,
            target.y + Math.sin(this._freePitch) * this._freeDistance,
            target.z + Math.sin(this._freeYaw) * cosPitch * this._freeDistance,
        );
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, 0.18);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, target, 0.18);
        this._underwaterViewActive = false;
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
        if (snapshot.playerDistance >= DIVE_UNDERWATER_MAX_DISTANCE) {
            return false;
        }
        return snapshot.playerY < this._courseLayout.swimY - DIVE_SURFACE_Y_THRESHOLD;
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
            [4, 0, 1, 2, 3],
            [0, 4, 2, 1, 3],
            [2, 0, 4, 3, 1],
            [0, 1, 3, 4, 2],
            [4, 2, 0, 3, 1],
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
        return this._broadcastShotIndex === 4 ? FIRST_PERSON_SHOT_SECONDS : BROADCAST_SHOT_SECONDS;
    }

    get currentModeName(): string {
        return RACE_CAMERA_MODE_NAMES[this._mode];
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
            targetXOffset: 8.0,
            cameraXOffset: -6.8,
            zOffset: 0,
            height: 4.8,
            fov: 46,
        };
    }
    if (snapshot.playerPlacement === 1) {
        return {
            targetXOffset: 0.75,
            cameraXOffset: 12.8,
            zOffset: 17.6,
            height: 2.85,
            fov: 48,
        };
    }
    if (snapshot.playerPlacement > 0 && snapshot.playerPlacement <= SWIM_ANGLE_VIEW_FRONT_RANK) {
        return {
            targetXOffset: 0.85,
            cameraXOffset: 6.6,
            zOffset: 13.8,
            height: 2.0,
            fov: 42,
        };
    }
    if (snapshot.racerCount > 0 && snapshot.playerPlacement >= Math.max(1, snapshot.racerCount - SWIM_ANGLE_VIEW_BACK_RANK_FROM_END + 1)) {
        return {
            targetXOffset: 2.35,
            cameraXOffset: -4.6,
            zOffset: 13.6,
            height: 2.05,
            fov: 42,
        };
    }
    return {
        targetXOffset: SWIM_SIDE_TARGET_X_OFFSET,
        cameraXOffset: SWIM_SIDE_TARGET_X_OFFSET,
        zOffset: SWIM_SIDE_CAMERA_DISTANCE,
        height: SWIM_SIDE_CAMERA_HEIGHT,
        fov: SWIM_SIDE_FOV,
    };
}

function surfaceHeadTarget(playerX: number, playerLaneZ: number, direction: number, forwardOffset: number): Vec3 {
    return new Vec3(
        playerX + (forwardOffset + SURFACE_HEAD_FORWARD_BONUS) * direction,
        SURFACE_HEAD_TARGET_Y,
        playerLaneZ + SURFACE_HEAD_TARGET_Z_OFFSET,
    );
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

function firstPersonCameraPos(playerX: number, playerLaneZ: number, direction = 1): Vec3 {
    return new Vec3(playerX + 0.95 * direction, 0.74, playerLaneZ + 0.04);
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
