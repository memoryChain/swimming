import { Camera, Node, Vec3 } from 'cc';
import { COUNTDOWN_SECONDS, DIVE_BALANCE, RACE_DISTANCE } from '../core/GameBalance';

const PRE_COUNTDOWN_CAMERA_SECONDS = 2.35;
const MIN_BROADCAST_VIEW_SECONDS = 4.2;
const BROADCAST_SHOT_SECONDS = 6.2;
const FIRST_PERSON_SHOT_SECONDS = 6.8;
const FIRST_PERSON_MIN_SECONDS = 5.8;
const DIVE_FIRST_PERSON_SECONDS = 2.45;
const DIVE_SIDE_TRANSITION_SECONDS = 1.65;
const COUNTDOWN_ATHLETE_TARGET_X_OFFSET = 0;
const COUNTDOWN_ATHLETE_TARGET_Y_OFFSET = 1.25;
const SWIM_SIDE_TARGET_X_OFFSET = 1.55;
const SWIM_SIDE_CAMERA_DISTANCE = 11.2;
const SWIM_SIDE_CAMERA_HEIGHT = 1.7;
const SWIM_SIDE_FOV = 35;
const SWIM_ANGLE_VIEW_FRONT_RANK = 3;
const SWIM_ANGLE_VIEW_BACK_RANK_FROM_END = 3;

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
    private _topViewActive = false;
    private _preCountdownElapsed = 0;
    private _preCountdownActive = false;
    private _preCountdownReady = false;

    constructor(private readonly _playerLaneZ: number) {
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
        this._broadcastCameraFov = 42;
        this._broadcastDesiredFov = 42;
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
        this._broadcastRaceElapsed = 0;
        this._broadcastShotTimer = 0;
    }

    update(dt: number, snapshot: RaceCameraSnapshot) {
        if (!this._cameraNode) {
            return;
        }
        if (this._mode === RaceCameraMode.Free) {
            this._topViewActive = false;
            this.updateFreeCamera(snapshot);
            return;
        }
        if (this._mode === RaceCameraMode.FirstPerson) {
            this._topViewActive = false;
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
        camera.fov = this._mode === RaceCameraMode.Broadcast
            ? this._broadcastCameraFov
            : this._mode === RaceCameraMode.Top
                ? 44
                : this._mode === RaceCameraMode.FirstPerson
                    ? 62
                    : this._mode === RaceCameraMode.Free ? 38 : 36;
    }

    resetBroadcastCamera() {
        this._cameraTarget.set(countdownAthleteTargetX(DIVE_BALANCE.platformNodeOffset.x), countdownAthleteTargetY(DIVE_BALANCE.platformNodeOffset.y), this._playerLaneZ);
        this._cameraPos.set(4.8, 2.1, this._playerLaneZ);
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
        const raceRatio = Math.max(0, Math.min(1, playerDistance / RACE_DISTANCE));
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
        if (this._preCountdownActive) {
            const ratio = smoothStep(clamp(this._preCountdownElapsed / PRE_COUNTDOWN_CAMERA_SECONDS, 0, 1));
            const target = new Vec3(countdownAthleteTargetX(playerX), countdownAthleteTargetY(playerY), this._playerLaneZ);
            desiredTarget = target;
            desiredPos = countdownOrbitCameraPosition(target, ratio);
            this._broadcastDesiredFov = lerp(42, 34, ratio);
            if (ratio >= 1) {
                this._preCountdownActive = false;
                this._preCountdownReady = true;
            }
        } else if (!raceActive && !countdownActive) {
            desiredTarget = new Vec3(countdownAthleteTargetX(DIVE_BALANCE.platformNodeOffset.x), countdownAthleteTargetY(DIVE_BALANCE.platformNodeOffset.y), this._playerLaneZ);
            desiredPos = new Vec3(4.8, 2.1, this._playerLaneZ);
            this._broadcastDesiredFov = 42;
        } else if (this._diveShotElapsed >= 0 && this._diveShotElapsed < DIVE_FIRST_PERSON_SECONDS) {
            desiredPos = firstPersonCameraPos(playerX, this._playerLaneZ);
            desiredTarget = new Vec3(RACE_DISTANCE + 4, 0.58, this._playerLaneZ);
            this._broadcastDesiredFov = 64;
        } else if (this._diveShotElapsed >= 0 && this._diveShotElapsed < DIVE_FIRST_PERSON_SECONDS + DIVE_SIDE_TRANSITION_SECONDS) {
            const ratio = smoothStep((this._diveShotElapsed - DIVE_FIRST_PERSON_SECONDS) / DIVE_SIDE_TRANSITION_SECONDS);
            const radius = lerp(2.2, SWIM_SIDE_CAMERA_DISTANCE, ratio);
            const angle = lerp(Math.PI, Math.PI / 2, ratio);
            const targetX = playerX + lerp(0.8, SWIM_SIDE_TARGET_X_OFFSET, ratio);
            desiredTarget = new Vec3(targetX, lerp(0.58, 0.42, ratio), this._playerLaneZ);
            desiredPos = new Vec3(
                desiredTarget.x + Math.cos(angle) * radius,
                lerp(1.1, SWIM_SIDE_CAMERA_HEIGHT, ratio),
                this._playerLaneZ + Math.sin(angle) * radius,
            );
            this._broadcastDesiredFov = lerp(58, SWIM_SIDE_FOV, ratio);
        } else if (countdownActive && this._diveShotElapsed < 0) {
            const target = new Vec3(countdownAthleteTargetX(playerX), countdownAthleteTargetY(playerY), this._playerLaneZ);
            const ratio = smoothStep(clamp(this._broadcastCountdownElapsed / Math.max(0.1, COUNTDOWN_SECONDS), 0, 1));
            desiredTarget = target;
            desiredPos = countdownOrbitCameraPosition(target, 1);
            desiredPos.x += lerp(0, -0.45, ratio);
            desiredPos.y += lerp(0, 0.18, ratio);
            desiredPos = new Vec3(
                desiredPos.x,
                desiredPos.y,
                desiredPos.z,
            );
            this._broadcastDesiredFov = 34;
        } else if (playerDistance >= RACE_DISTANCE - 8) {
            const finishAnchorX = RACE_DISTANCE - 7.5;
            const playerFollowX = playerX + 3.4;
            const targetX = playerFollowX * 0.65 + finishAnchorX * 0.35;
            desiredTarget = new Vec3(targetX, 0.18, 0);
            desiredPos = new Vec3(desiredTarget.x, 22.5, 0);
            this._broadcastDesiredFov = 46;
            fixedTopView = true;
        } else if (this._broadcastDuelTimer > 0) {
            if (this._broadcastDuelShotIndex === 0) {
                desiredPos = new Vec3(playerX - 4.1, 2.05, this._playerLaneZ + 3.5);
                desiredTarget = new Vec3(playerX + 1.85, 0.62, this._playerLaneZ);
            } else {
                desiredTarget = new Vec3(playerX + 0.9, 0.62, this._playerLaneZ);
                desiredPos = new Vec3(desiredTarget.x, 1.95, this._playerLaneZ + 4.4);
            }
            this._broadcastDesiredFov = 28;
        } else {
            const view = swimRaceView(snapshot);
            desiredTarget = new Vec3(playerX + view.targetXOffset, 0.42, this._playerLaneZ);
            desiredPos = new Vec3(
                playerX + view.cameraXOffset,
                view.height,
                this._playerLaneZ + view.zOffset,
            );
            this._broadcastDesiredFov = view.fov;
        }

        this._topViewActive = fixedTopView;
        if (fixedTopView) {
            this._cameraPos.set(desiredPos);
            this._cameraTarget.set(desiredTarget);
            this._broadcastCameraFov = this._broadcastDesiredFov;
            this._cameraNode.setPosition(this._cameraPos);
            this._cameraNode.lookAt(this._cameraTarget, new Vec3(0, 0, -1));
            this.applyFov();
            return;
        }

        const smoothSpeed = this._diveShotElapsed >= DIVE_FIRST_PERSON_SECONDS ? 3.2 : raceActive ? 2.7 : 5.8;
        const smooth = cameraBlend(dt, smoothSpeed);
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, smooth);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, desiredTarget, smooth);
        this._broadcastCameraFov += (this._broadcastDesiredFov - this._broadcastCameraFov) * smooth;
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget);
        this.applyFov();
    }

    private readonly _shotDesiredPos = new Vec3();
    private readonly _shotDesiredTarget = new Vec3();

    private applyBroadcastShot(playerX: number) {
        const shot = this._broadcastShotIndex;
        if (shot === 0) {
            this._shotDesiredTarget.set(playerX + 3.2, 0.42, this._playerLaneZ);
            this._shotDesiredPos.set(this._shotDesiredTarget.x, 1.55, this._playerLaneZ + 9.2);
            this._broadcastDesiredFov = 33;
        } else if (shot === 1) {
            this._shotDesiredPos.set(playerX - 7.2, 2.75, this._playerLaneZ + 3.3);
            this._shotDesiredTarget.set(playerX + 3.6, 0.48, this._playerLaneZ);
            this._broadcastDesiredFov = 34;
        } else if (shot === 2) {
            this._shotDesiredPos.set(playerX - 5.7, 4.25, this._playerLaneZ + 11.8);
            this._shotDesiredTarget.set(playerX + 5.0, 0.36, this._playerLaneZ + 0.1);
            this._broadcastDesiredFov = 36;
        } else if (shot === 3) {
            this._shotDesiredPos.set(playerX - 3.9, 2.35, this._playerLaneZ + 7.6);
            this._shotDesiredTarget.set(playerX + 2.0, 0.48, this._playerLaneZ);
            this._broadcastDesiredFov = 33;
        } else if (shot === 4) {
            this._shotDesiredPos.set(firstPersonCameraPos(playerX, this._playerLaneZ));
            this._shotDesiredTarget.set(playerX + 9.0, 0.58, this._playerLaneZ);
            this._broadcastDesiredFov = 62;
        }
    }

    private updatePresetCamera(snapshot: RaceCameraSnapshot) {
        const playerX = snapshot.playerX;
        let desiredPos: Vec3;
        let desiredTarget: Vec3;
        if (this._mode === RaceCameraMode.Side) {
            this._topViewActive = false;
            desiredTarget = new Vec3(playerX + SWIM_SIDE_TARGET_X_OFFSET, 0.42, this._playerLaneZ);
            desiredPos = new Vec3(desiredTarget.x, SWIM_SIDE_CAMERA_HEIGHT, this._playerLaneZ + SWIM_SIDE_CAMERA_DISTANCE);
        } else if (this._mode === RaceCameraMode.Chase) {
            this._topViewActive = false;
            desiredPos = new Vec3(playerX - 7.2, 2.55, this._playerLaneZ + 2.9);
            desiredTarget = new Vec3(playerX + 3.6, 0.42, this._playerLaneZ);
        } else {
            this._topViewActive = true;
            desiredPos = new Vec3(playerX + 1.8, 17.5, this._playerLaneZ + 0.1);
            desiredTarget = new Vec3(playerX + 2.6, 0.12, this._playerLaneZ);
        }
        const smooth = snapshot.raceActive ? 0.1 : 0.2;
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, smooth);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, desiredTarget, smooth);
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget);
        this.applyFov();
    }

    private updateFirstPersonCamera(snapshot: RaceCameraSnapshot) {
        const playerX = snapshot.playerX;
        const desiredPos = firstPersonCameraPos(playerX, this._playerLaneZ);
        const desiredTarget = new Vec3(playerX + 9.0, 0.58, this._playerLaneZ);
        this._cameraPos.set(desiredPos);
        this._cameraTarget.set(desiredTarget);
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget);
        this.applyFov();
    }

    private updateFreeCamera(snapshot: RaceCameraSnapshot) {
        const playerX = snapshot.playerX;
        const target = new Vec3(playerX + 1.2, 0.55, this._playerLaneZ);
        const cosPitch = Math.cos(this._freePitch);
        const desiredPos = new Vec3(
            target.x + Math.cos(this._freeYaw) * cosPitch * this._freeDistance,
            target.y + Math.sin(this._freePitch) * this._freeDistance,
            target.z + Math.sin(this._freeYaw) * cosPitch * this._freeDistance,
        );
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, 0.18);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, target, 0.18);
        this._cameraNode.setPosition(this._cameraPos);
        this._cameraNode.lookAt(this._cameraTarget);
        this.applyFov();
    }

    private resetBroadcastDirector() {
        this._broadcastShotTimer = 0;
        this._broadcastDuelTimer = 0;
        this._broadcastDuelCooldown = 0;
        this._broadcastDuelShotIndex = 1;
        this._broadcastCameraFov = 42;
        this._broadcastDesiredFov = 42;
        this._broadcastCountdownElapsed = 0;
        this._broadcastRaceElapsed = 0;
        this._diveShotElapsed = -1;
        this._topViewActive = false;
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
}

type SwimRaceView = {
    targetXOffset: number;
    cameraXOffset: number;
    zOffset: number;
    height: number;
    fov: number;
};

function swimRaceView(snapshot: RaceCameraSnapshot): SwimRaceView {
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

function firstPersonCameraPos(playerX: number, playerLaneZ: number): Vec3 {
    return new Vec3(playerX + 0.95, 0.74, playerLaneZ + 0.04);
}

function countdownOrbitCameraPosition(target: Vec3, ratio: number): Vec3 {
    const t = clamp(ratio, 0, 1);
    const angle = Math.PI * t;
    const radius = lerp(6.2, 3.65, t);
    const height = lerp(2.15, 1.95, t);
    return new Vec3(
        target.x + Math.cos(angle) * radius,
        height,
        target.z + Math.sin(angle) * radius * 0.16,
    );
}

function countdownAthleteTargetY(playerY: number): number {
    return playerY + COUNTDOWN_ATHLETE_TARGET_Y_OFFSET;
}

function countdownAthleteTargetX(playerX: number): number {
    return playerX + COUNTDOWN_ATHLETE_TARGET_X_OFFSET;
}
