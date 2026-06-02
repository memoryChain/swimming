import { Camera, Node, Vec3 } from 'cc';
import { COUNTDOWN_SECONDS, RACE_DISTANCE } from '../core/GameConstants';

const MIN_BROADCAST_VIEW_SECONDS = 4.2;
const BROADCAST_SHOT_SECONDS = 6.2;
const FIRST_PERSON_SHOT_SECONDS = 6.8;
const FIRST_PERSON_MIN_SECONDS = 5.8;

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
    playerDistance: number;
    closestAiDistanceGap: number;
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
        if (this._mode === RaceCameraMode.Broadcast) {
            this.resetBroadcastDirector();
        }
        this.applyFov();
        return this.currentModeName;
    }

    toggleFreeMode(): string {
        this._mode = this._mode === RaceCameraMode.Free ? RaceCameraMode.Broadcast : RaceCameraMode.Free;
        this._freeDragging = false;
        if (this._mode === RaceCameraMode.Broadcast) {
            this.resetBroadcastDirector();
        }
        this.applyFov();
        return this.currentModeName;
    }

    resetToBroadcast() {
        this._mode = RaceCameraMode.Broadcast;
        this._freeDragging = false;
        this.resetBroadcastDirector();
        this.resetBroadcastCamera();
    }

    resetCountdownTimers() {
        this._broadcastCountdownElapsed = 0;
        this._broadcastRaceElapsed = 0;
        this._broadcastShotTimer = 0;
    }

    resetRaceTimers() {
        this._broadcastRaceElapsed = 0;
        this._broadcastShotTimer = 0;
    }

    update(dt: number, snapshot: RaceCameraSnapshot) {
        if (!this._cameraNode) {
            return;
        }
        if (this._mode === RaceCameraMode.Free) {
            this.updateFreeCamera(snapshot);
            return;
        }
        if (this._mode === RaceCameraMode.FirstPerson) {
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
        this._cameraTarget.set(0.2, 0.78, 0);
        this._cameraPos.set(5.8, 1.65, 0);
        this.applyFov();
        if (this._cameraNode) {
            this._cameraNode.setPosition(this._cameraPos);
            this._cameraNode.lookAt(this._cameraTarget);
        }
    }

    private updateBroadcastCamera(dt: number, snapshot: RaceCameraSnapshot) {
        const playerX = snapshot.playerX;
        const playerDistance = snapshot.playerDistance;
        const raceRatio = Math.max(0, Math.min(1, playerDistance / RACE_DISTANCE));
        const raceActive = snapshot.raceActive;
        const countdownActive = snapshot.countdownActive;
        if (countdownActive) {
            this._broadcastCountdownElapsed += dt;
        }
        if (raceActive) {
            this._broadcastRaceElapsed += dt;
            if (this._broadcastRaceElapsed > 1.2) {
                this._broadcastShotTimer += dt;
            }
            if (this._broadcastShotTimer > this.currentBroadcastShotSeconds()) {
                this._broadcastShotTimer = 0;
                this.advanceBroadcastShot();
            }
        }

        const closeDuel = raceActive && raceRatio > 0.12 && raceRatio < 0.82 && snapshot.closestAiDistanceGap < 3.2;
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
        if (!raceActive && !countdownActive) {
            desiredTarget = new Vec3(0.2, 0.78, 0);
            desiredPos = new Vec3(5.8, 1.65, 0);
            this._broadcastDesiredFov = 42;
        } else if (countdownActive) {
            const sideTarget = new Vec3(0.2, 0.44, this._playerLaneZ);
            const sidePos = new Vec3(sideTarget.x, 1.65, this._playerLaneZ + 9.8);
            const frontTarget = new Vec3(0.2, 0.78, 0);
            const frontPos = new Vec3(5.8, 1.65, 0);
            const moveStart = 1;
            const moveDuration = Math.max(0.1, COUNTDOWN_SECONDS - 2);
            const ratio = smoothStep(clamp((this._broadcastCountdownElapsed - moveStart) / moveDuration, 0, 1));
            desiredTarget = new Vec3();
            desiredPos = new Vec3();
            Vec3.lerp(desiredTarget, frontTarget, sideTarget, ratio);
            Vec3.lerp(desiredPos, frontPos, sidePos, ratio);
            this._broadcastDesiredFov = 32 + (42 - 32) * (1 - ratio);
        } else if (this._broadcastRaceElapsed < 1.2) {
            desiredTarget = new Vec3(playerX + 0.6, 0.44, this._playerLaneZ);
            desiredPos = new Vec3(desiredTarget.x, 1.65, this._playerLaneZ + 9.8);
            this._broadcastDesiredFov = 32;
        } else if (playerDistance >= RACE_DISTANCE - 8) {
            const finishAnchorX = RACE_DISTANCE - 7.5;
            const playerFollowX = playerX + 3.4;
            const targetX = playerFollowX * 0.65 + finishAnchorX * 0.35;
            desiredTarget = new Vec3(targetX, 0.18, 0);
            desiredPos = new Vec3(desiredTarget.x, 22.5, 0);
            this._broadcastDesiredFov = 46;
            fixedTopView = true;
        } else if (!raceActive || raceRatio < 0.06) {
            desiredPos = new Vec3(playerX - 5.7, 4.25, this._playerLaneZ + 11.8);
            desiredTarget = new Vec3(playerX + 5.0, 0.36, this._playerLaneZ + 0.1);
            this._broadcastDesiredFov = 36;
        } else if (raceRatio < 0.18) {
            desiredTarget = new Vec3(playerX + 1.2, 0.44, this._playerLaneZ);
            desiredPos = new Vec3(desiredTarget.x, 1.65, this._playerLaneZ + 9.8);
            this._broadcastDesiredFov = 32;
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
            this.applyBroadcastShot(playerX);
            desiredPos = this._shotDesiredPos;
            desiredTarget = this._shotDesiredTarget;
        }

        if (fixedTopView) {
            this._cameraPos.set(desiredPos);
            this._cameraTarget.set(desiredTarget);
            this._broadcastCameraFov = this._broadcastDesiredFov;
            this._cameraNode.setPosition(this._cameraPos);
            this._cameraNode.lookAt(this._cameraTarget, new Vec3(0, 0, -1));
            this.applyFov();
            return;
        }

        const smooth = raceActive ? cameraBlend(dt, this._broadcastDuelTimer > 0 ? 4.4 : 2.7) : cameraBlend(dt, 5.8);
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
            desiredTarget = new Vec3(playerX + 3.0, 0.42, this._playerLaneZ);
            desiredPos = new Vec3(desiredTarget.x, 1.6, this._playerLaneZ + 9.6);
        } else if (this._mode === RaceCameraMode.Chase) {
            desiredPos = new Vec3(playerX - 7.2, 2.55, this._playerLaneZ + 2.9);
            desiredTarget = new Vec3(playerX + 3.6, 0.42, this._playerLaneZ);
        } else {
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

function firstPersonCameraPos(playerX: number, playerLaneZ: number): Vec3 {
    return new Vec3(playerX + 0.95, 0.74, playerLaneZ + 0.08);
}
