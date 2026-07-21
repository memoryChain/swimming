import { Camera, Node, Vec3 } from 'cc';
import { COUNTDOWN_SECONDS, getRaceDistance } from '../core/GameBalance';
import { DEFAULT_RACE_COURSE_LAYOUT, RaceCourseLayout } from '../venue/RaceCourseLayout';

// Pre-race showcase (state PRECOUNTDOWN) splits into two stages:
//   Stage 1 (overview): a wide establishing shot framing all lanes while the
//     roster info panel is displayed.
//   Stage 2 (orbit): a single continuous shot that starts nearly top-down over
//     the racers, then rotates a full circle around them while descending into a
//     low three-quarter angle, before a smooth hand-off to the countdown /
//     dive-prep view. It never stops on an individual swimmer.
const PRE_RACE_OVERVIEW_SECONDS = 3.0;
// Duration of the whole descend-and-orbit sweep.
const PRE_RACE_ORBIT_SECONDS = 4.0;
const PRE_RACE_OVERVIEW_FOV = 46;
// Overview shot: elevated 3/4 angle from behind-and-to-the-side of the blocks,
// looking down the lanes so all eight lanes read on screen.
const PRE_RACE_OVERVIEW_TARGET_AHEAD = 0.32; // fraction of course length ahead of the start edge
const PRE_RACE_OVERVIEW_TARGET_Y = 1.1;
const PRE_RACE_OVERVIEW_BACK = 6.0;   // camera pulled back behind the blocks (kept inside the near hall wall at X=-8)
const PRE_RACE_OVERVIEW_HEIGHT = 8.2; // elevated
const PRE_RACE_OVERVIEW_SIDE = 4.5;   // pushed off to one pool side (kept inside the grandstand which starts ~7m off-center)
// Orbit shot: a spiral from a near top-down view down to a low front angle,
// circling the standing racers once. Distances are measured from the centre of
// the standing group (mid-lane, just in front of the blocks).
const PRE_RACE_ORBIT_SWEEP = Math.PI * 2; // one full revolution, ending on the athletes' front side
const PRE_RACE_ORBIT_CENTER_AHEAD = 0.4;  // shift the look-at point slightly toward the pool
const PRE_RACE_ORBIT_TARGET_Y = 1.0;
const PRE_RACE_ORBIT_START_HEIGHT = 12.5; // high, reads as a top-down opening
const PRE_RACE_ORBIT_END_HEIGHT = 2.6;    // low three-quarter angle
const PRE_RACE_ORBIT_START_RADIUS = 9.5;  // pulled back over the pool so the water reads in the opening shot
const PRE_RACE_ORBIT_END_RADIUS = 7.5;    // pulled out for the closing angle
const PRE_RACE_ORBIT_START_FOV = 44;
const PRE_RACE_ORBIT_END_FOV = 36;

export type PreRacePhase = 'none' | 'overview' | 'orbit';
// Awards free-look orbit: the camera moves along a front-facing arc around the
// podium and the player can drag to rotate / wheel to zoom. When left idle it
// sweeps back and forth slowly for a ceremony feel.
const AWARDS_TARGET_Y = 1.2;          // aim a bit above the podium top so the winners sit centred
// Aim to the camera-right of the podium so the winners occupy the left side of
// the frame. The offset rotates with the orbit to preserve that composition.
const AWARDS_TARGET_SCREEN_RIGHT_OFFSET = 2.0;
const AWARDS_DEFAULT_DISTANCE = 8.5;
const AWARDS_MIN_DISTANCE = 3.5;
// The ceremony may zoom in, but never pull farther back than its opening shot.
const AWARDS_MAX_DISTANCE = AWARDS_DEFAULT_DISTANCE;
const AWARDS_DEFAULT_YAW = 0;         // start beyond the podium (+X), looking back toward the pool
// Keep both automatic motion and free dragging on the athletes' front side.
// 72 degrees gives a strong three-quarter view without reaching a rear angle.
const AWARDS_MIN_YAW = -Math.PI * 0.4;
const AWARDS_MAX_YAW = Math.PI * 0.4;
const AWARDS_MIN_PITCH = 0.02;        // stay just above horizontal so the camera never dips under the floor
const AWARDS_DEFAULT_PITCH = AWARDS_MIN_PITCH;
const AWARDS_MAX_PITCH = 1.3;
const AWARDS_AUTO_ROTATE_SPEED = 0.16; // rad/s idle drift
const AWARDS_AUTO_ROTATE_IDLE = 1.5;   // seconds of no input before the idle drift resumes
const AWARDS_YAW_DRAG_SCALE = 0.008;
const AWARDS_PITCH_DRAG_SCALE = 0.006;
const AWARDS_ZOOM_SCALE = 0.006;
// Spectator free-look follows an active swimmer from behind. Its yaw is relative
// to the swimmer's race direction, so flip turns automatically move the camera
// to the new trailing side without discarding the player's orbit adjustment.
const SPECTATOR_TARGET_Y = 0.72;
const SPECTATOR_LOOK_AHEAD = 0.9;
const SPECTATOR_DEFAULT_DISTANCE = 6.5;
const SPECTATOR_MIN_DISTANCE = 2.8;
const SPECTATOR_MAX_DISTANCE = 12.0;
const SPECTATOR_DEFAULT_PITCH = 0.24;
const SPECTATOR_MIN_PITCH = 0.06;
const SPECTATOR_MAX_PITCH = 1.1;
const SPECTATOR_MIN_YAW = -Math.PI * 0.42;
const SPECTATOR_MAX_YAW = Math.PI * 0.42;
const SPECTATOR_YAW_DRAG_SCALE = 0.008;
const SPECTATOR_PITCH_DRAG_SCALE = 0.006;
const SPECTATOR_ZOOM_SCALE = 0.008;
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
// Finish top-down view. Widened so the full 8-lane pool (Z from ~-10.5 to
// +10.5) stays in frame from the fixed 22.5m camera height; the previous 46
// clipped lanes 1 and 8 off the top and bottom of the screen.
const FINISH_TOP_FOV = 56;
const SWIM_ANGLE_VIEW_FRONT_RANK = 3;
const SWIM_ANGLE_VIEW_BACK_RANK_FROM_END = 3;
export const RACE_CAMERA_TUNING = {
    // Remaining distance at which the sprint chase camera gives way to the
    // existing finish-line top view.
    finishTopViewDistance: 5,
    // Close third-person sprint view, above and behind the player's upper body.
    sprintBackDistance: 1.1,
    // Extra pullback while the player is chaining kick-only taps. A promoted arm
    // stroke immediately removes this offset and restores sprintBackDistance.
    sprintKickPullbackDistance: 1.4,
    sprintKickPullbackMinCadenceHz: 2.5,
    sprintHeight: 0.52,
    sprintLookAhead: 0.8,
    sprintFov: 58,
    // Sprint chase follow smoothing (per second, dt-based). Forward/height track
    // tightly; the LATERAL (Z) follow is deliberately slower so the swimmer
    // visibly slides sideways in frame when steering, then the camera eases
    // across to catch up. Lower lateral = more visible weave / more lag.
    sprintFollowSpeed: 14,
    sprintLateralFollowSpeed: 3.2,
    // Underwater side/rear view held from flip entry through the complete
    // post-turn underwater descent, hold, and ascent.
    flipTurnBackDistance: 2.8,
    flipTurnSideDistance: 2.6,
    flipTurnBelowDistance: 0.42,
    flipTurnFov: 48,
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
    playerSpeed?: number;
    playerUpperBodyWorldPosition?: Vec3;
    playerDistance: number;
    // Radians away from the current lane direction. Used by the sprint chase so
    // it follows the swimmer's actual travel direction while steering.
    playerHeading?: number;
    // Kick cadence stays at zero until a second tap establishes a rhythm. The
    // sprint camera uses it only while no arm stroke is active, so long presses
    // restore the normal close chase framing as soon as they become strokes.
    playerKickCadenceHz?: number;
    playerArmStrokeActive?: boolean;
    playerUnderwater: boolean;
    closestAiDistanceGap: number;
    playerPlacement: number;
    racerCount: number;
    raceActive: boolean;
    countdownActive: boolean;
    sprintActive: boolean;
    playerFlipTurnCameraActive?: boolean;
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
    // When true this director drives the venue jumbotron feed camera. Both the
    // main broadcast camera and this feed use the classic side-tracking race
    // views outside the actual sprint phase.
    private _feedMode = false;
    private _underwaterViewActive = false;
    private _flipTurnViewActive = false;
    private _flipTurnViewDirection = 1;
    private _preCountdownElapsed = 0;
    private _preCountdownActive = false;
    private _preCountdownReady = false;
    private _preCountdownLaneZs: number[] = [];
    private _preCountdownShotIndex = -1;
    private _preRacePhase: PreRacePhase = 'none';
    private _awardsCenter: Vec3 | null = null;
    private _awardsYaw = AWARDS_DEFAULT_YAW;
    private _awardsPitch = AWARDS_DEFAULT_PITCH;
    private _awardsDistance = AWARDS_DEFAULT_DISTANCE;
    private _awardsIdleSeconds = 0;
    private _awardsAutoRotateDirection = 1;
    private _spectatorFreeLookActive = false;
    private _spectatorCenter: Vec3 | null = null;
    private _spectatorDirection = 1;
    private _spectatorYaw = 0;
    private _spectatorPitch = SPECTATOR_DEFAULT_PITCH;
    private _spectatorDistance = SPECTATOR_DEFAULT_DISTANCE;

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

    setFeedMode(enabled: boolean) {
        this._feedMode = enabled;
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
        this._spectatorFreeLookActive = false;
        this._spectatorCenter = null;
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
        this._flipTurnViewActive = false;
    }

    startPreCountdownOrbit(laneZs: number[] = []) {
        this._mode = RaceCameraMode.Broadcast;
        this._topViewActive = false;
        this._awardsCenter = null;
        this._spectatorFreeLookActive = false;
        this._spectatorCenter = null;
        this._preCountdownElapsed = 0;
        this._preCountdownActive = true;
        this._preCountdownReady = false;
        this._preRacePhase = 'overview';
        this.updatePreCountdownRacerLanes(laneZs);
        // Sentinel so the first overview frame hard-cuts into the establishing
        // shot instead of blending from the reset broadcast pose.
        this._preCountdownShotIndex = -999;
        this._broadcastCountdownElapsed = 0;
        this._broadcastRaceElapsed = 0;
        this._diveShotElapsed = -1;
        this._diveSurfaceRestoreSeconds = 0;
        this._underwaterViewActive = false;
        this._flipTurnViewActive = false;
        this._broadcastCameraFov = 52;
        this._broadcastDesiredFov = 52;
        this.resetBroadcastCamera();
    }

    updatePreCountdownRacerLanes(laneZs: number[]) {
        // Keep every lane (including the player) sorted by Z so the close-up sweep
        // visits them in lane order (lane 1 -> lane 8).
        this._preCountdownLaneZs = laneZs
            .filter((laneZ) => Number.isFinite(laneZ))
            .sort((a, b) => a - b);
    }

    // Stop the showcase immediately without setting the normal completion flag.
    // The next camera update sees COUNTDOWN and blends from the current showcase
    // framing into the existing dive-prep/countdown shot.
    skipPreCountdownShowcase(): boolean {
        if (!this._preCountdownActive) {
            return false;
        }
        this._preCountdownActive = false;
        this._preCountdownReady = false;
        this._preRacePhase = 'none';
        this._preCountdownShotIndex = -1;
        return true;
    }

    startAwardsPresentation(center: Vec3) {
        this._mode = RaceCameraMode.Broadcast;
        this._topViewActive = false;
        this._underwaterViewActive = false;
        this._flipTurnViewActive = false;
        this._preCountdownActive = false;
        this._preCountdownReady = false;
        this._spectatorFreeLookActive = false;
        this._spectatorCenter = null;
        this._awardsCenter = center.clone();
        this._awardsYaw = AWARDS_DEFAULT_YAW;
        this._awardsPitch = AWARDS_DEFAULT_PITCH;
        this._awardsDistance = AWARDS_DEFAULT_DISTANCE;
        this._awardsIdleSeconds = 0;
        this._awardsAutoRotateDirection = 1;
        this._broadcastCameraFov = 38;
        this._broadcastDesiredFov = 38;
        this.applyFov();
    }

    startSpectatorFreeLook(center: Vec3, direction: number) {
        this._mode = RaceCameraMode.Broadcast;
        this._topViewActive = false;
        this._underwaterViewActive = false;
        this._flipTurnViewActive = false;
        this._awardsCenter = null;
        this._spectatorFreeLookActive = true;
        this._spectatorCenter = center.clone();
        this._spectatorDirection = direction >= 0 ? 1 : -1;
        this._spectatorYaw = 0;
        this._spectatorPitch = SPECTATOR_DEFAULT_PITCH;
        this._spectatorDistance = SPECTATOR_DEFAULT_DISTANCE;
        this._broadcastCameraFov = 44;
        this._broadcastDesiredFov = 44;
        this.applyFov();
    }

    updateSpectatorFreeLookTarget(center: Vec3, direction: number) {
        if (this._spectatorFreeLookActive && this._spectatorCenter) {
            this._spectatorCenter.set(center);
            this._spectatorDirection = direction >= 0 ? 1 : -1;
        }
    }

    stopSpectatorFreeLook() {
        if (!this._spectatorFreeLookActive) {
            return;
        }
        this._spectatorFreeLookActive = false;
        this._spectatorCenter = null;
        this.resetBroadcastCamera();
    }

    get spectatorFreeLookActive(): boolean {
        return this._spectatorFreeLookActive;
    }

    // True while the awards ceremony free-look is active (podium centre is set).
    isAwardsFreeLookActive(): boolean {
        return !!this._awardsCenter;
    }

    isFreeLookActive(): boolean {
        return this.isAwardsFreeLookActive() || this._spectatorFreeLookActive;
    }

    // Drag to orbit the awards camera around the podium. deltaX/deltaY are raw pointer
    // deltas (pixels); positive deltaX rotates the view, positive deltaY tilts it up.
    orbitAwardsCamera(deltaX: number, deltaY: number) {
        if (!this._awardsCenter) {
            return;
        }
        this._awardsYaw = clamp(
            this._awardsYaw - deltaX * AWARDS_YAW_DRAG_SCALE,
            AWARDS_MIN_YAW,
            AWARDS_MAX_YAW,
        );
        if (this._awardsYaw <= AWARDS_MIN_YAW) {
            this._awardsAutoRotateDirection = 1;
        } else if (this._awardsYaw >= AWARDS_MAX_YAW) {
            this._awardsAutoRotateDirection = -1;
        }
        this._awardsPitch = clamp(this._awardsPitch + deltaY * AWARDS_PITCH_DRAG_SCALE, AWARDS_MIN_PITCH, AWARDS_MAX_PITCH);
        this._awardsIdleSeconds = 0;
    }

    // Wheel / pinch to zoom the awards camera. Positive scroll pulls the camera in.
    zoomAwardsCamera(scroll: number) {
        if (!this._awardsCenter) {
            return;
        }
        this._awardsDistance = clamp(this._awardsDistance - scroll * AWARDS_ZOOM_SCALE, AWARDS_MIN_DISTANCE, AWARDS_MAX_DISTANCE);
        this._awardsIdleSeconds = 0;
    }

    orbitSpectatorCamera(deltaX: number, deltaY: number) {
        if (!this._spectatorFreeLookActive) {
            return;
        }
        this._spectatorYaw = clamp(
            this._spectatorYaw - deltaX * SPECTATOR_YAW_DRAG_SCALE,
            SPECTATOR_MIN_YAW,
            SPECTATOR_MAX_YAW,
        );
        this._spectatorPitch = clamp(
            this._spectatorPitch + deltaY * SPECTATOR_PITCH_DRAG_SCALE,
            SPECTATOR_MIN_PITCH,
            SPECTATOR_MAX_PITCH,
        );
    }

    zoomSpectatorCamera(scroll: number) {
        if (!this._spectatorFreeLookActive) {
            return;
        }
        this._spectatorDistance = clamp(
            this._spectatorDistance - scroll * SPECTATOR_ZOOM_SCALE,
            SPECTATOR_MIN_DISTANCE,
            SPECTATOR_MAX_DISTANCE,
        );
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
        this._flipTurnViewActive = false;
        this._broadcastRaceElapsed = 0;
        this._broadcastShotTimer = 0;
    }

    update(dt: number, snapshot: RaceCameraSnapshot) {
        if (!this._cameraNode) {
            return;
        }
        // Once the awards ceremony is armed it overrides every in-race view. This
        // matters when the race force-finishes on the straggler countdown while a
        // swimmer is still underwater / mid flip-turn: without this the snapshot's
        // playerFlipTurnCameraActive would keep the camera stuck underwater.
        if (this._awardsCenter) {
            this._flipTurnViewActive = false;
            this._underwaterViewActive = false;
            this._topViewActive = false;
            this.updateBroadcastCamera(dt, snapshot);
            return;
        }
        if (this._spectatorFreeLookActive && this._spectatorCenter) {
            this._flipTurnViewActive = false;
            this._underwaterViewActive = false;
            this._topViewActive = false;
            this.updateSpectatorCamera(dt);
            return;
        }
        const flipTurnViewRequested = !!snapshot.playerFlipTurnCameraActive && !this._feedMode;
        if (flipTurnViewRequested) {
            const enteringFlipTurnView = !this._flipTurnViewActive;
            if (enteringFlipTurnView) {
                // Capture the incoming direction before logical distance reaches
                // the wall and changes to the next course direction.
                this._flipTurnViewDirection = this._courseLayout.directionAtDistance(snapshot.playerDistance);
            }
            this._flipTurnViewActive = true;
            this.updateFlipTurnCamera(dt, snapshot, enteringFlipTurnView);
            return;
        }
        const leavingFlipTurnView = this._flipTurnViewActive;
        this._flipTurnViewActive = false;
        if (this._mode === RaceCameraMode.Sprint) {
            if (this.shouldUseFinishTopView(snapshot)) {
                this.updateFinishTopCamera(snapshot);
                return;
            }
            this._topViewActive = false;
            this._underwaterViewActive = false;
            this.updateSprintCamera(dt, snapshot, leavingFlipTurnView);
            return;
        }
        if (this._mode === RaceCameraMode.Broadcast) {
            this.updateBroadcastCamera(dt, snapshot);
            return;
        }
        this.updateTopCamera(snapshot);
    }

    private updateSpectatorCamera(dt: number) {
        const center = this._spectatorCenter;
        if (!center) {
            return;
        }
        const cosPitch = Math.cos(this._spectatorPitch);
        const horizontalDistance = cosPitch * this._spectatorDistance;
        const targetY = center.y + SPECTATOR_TARGET_Y;
        const desiredTarget = new Vec3(
            center.x + this._spectatorDirection * SPECTATOR_LOOK_AHEAD,
            targetY,
            center.z,
        );
        const desiredPos = new Vec3(
            center.x - this._spectatorDirection * Math.cos(this._spectatorYaw) * horizontalDistance,
            targetY + Math.sin(this._spectatorPitch) * this._spectatorDistance,
            center.z + Math.sin(this._spectatorYaw) * horizontalDistance,
        );
        const smooth = cameraBlend(dt, 10.5);
        Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, smooth);
        Vec3.lerp(this._cameraTarget, this._cameraTarget, desiredTarget, smooth);
        this._broadcastCameraFov += (44 - this._broadcastCameraFov) * smooth;
        this._broadcastDesiredFov = 44;
        this.applyCameraTransform();
        this.applyFov();
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
        if (this._topViewActive && this._mode !== RaceCameraMode.Top) {
            baseFov = FINISH_TOP_FOV;
        }
        if (this._flipTurnViewActive) {
            baseFov = RACE_CAMERA_TUNING.flipTurnFov;
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

    // Wide establishing shot for pre-race stage 1: elevated 3/4 angle from behind
    // and to one side of the blocks, framing all lanes down the pool.
    private preRaceOverviewShot(): { position: Vec3; target: Vec3 } {
        const direction = this._courseLayout.direction;
        const targetX = this._courseLayout.poolStartX + direction * this._courseLayout.courseLength * PRE_RACE_OVERVIEW_TARGET_AHEAD;
        const target = new Vec3(targetX, this._courseLayout.waterY + PRE_RACE_OVERVIEW_TARGET_Y, 0);
        const position = new Vec3(
            this._courseLayout.platformX - direction * PRE_RACE_OVERVIEW_BACK,
            PRE_RACE_OVERVIEW_HEIGHT,
            this._courseLayout.poolWidth * 0.5 + PRE_RACE_OVERVIEW_SIDE,
        );
        return { position, target };
    }

    // Continuous descend-and-orbit shot for pre-race stage 2. As progress goes
    // 0 -> 1 the camera spirals from a near top-down view down to a low front
    // three-quarter angle, circling the standing racers once and always aiming at
    // the centre of the group. `progress` is the raw 0..1 stage progress; easing
    // is applied internally so the motion accelerates and settles smoothly.
    private preRaceOrbitShot(progress: number, laneZs: number[], direction: number): { position: Vec3; target: Vec3; fov: number } {
        const eased = smoothStep(clamp(progress, 0, 1));
        const midLaneZ = laneZs.length > 0 ? laneZs[(laneZs.length - 1) >> 1] : this._playerLaneZ;
        const stand = this._courseLayout.platformStandingPosition(midLaneZ);
        const centerZ = laneZs.length > 0
            ? laneZs.reduce((sum, z) => sum + z, 0) / laneZs.length
            : this._playerLaneZ;
        const center = new Vec3(
            stand.x + direction * PRE_RACE_ORBIT_CENTER_AHEAD,
            stand.y + PRE_RACE_ORBIT_TARGET_Y,
            centerZ,
        );
        // Rotate a full turn, ending at yaw 0 (camera on the athletes' front /
        // down-pool side) so the hand-off to the countdown front view is short.
        const yaw = lerp(-PRE_RACE_ORBIT_SWEEP, 0, eased);
        const radius = lerp(PRE_RACE_ORBIT_START_RADIUS, PRE_RACE_ORBIT_END_RADIUS, eased);
        const height = lerp(PRE_RACE_ORBIT_START_HEIGHT, PRE_RACE_ORBIT_END_HEIGHT, eased);
        const position = new Vec3(
            center.x + direction * Math.cos(yaw) * radius,
            center.y + height,
            center.z + Math.sin(yaw) * radius,
        );
        const fov = lerp(PRE_RACE_ORBIT_START_FOV, PRE_RACE_ORBIT_END_FOV, eased);
        return { position, target: center, fov };
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
            // Free-look ceremony arc: the camera stays in front of the winners. The player
            // drags to rotate and wheels/pinches to zoom (see orbit/zoomAwardsCamera). When
            // left idle it sweeps between the two side limits instead of circling behind.
            this._awardsIdleSeconds += dt;
            if (this._awardsIdleSeconds > AWARDS_AUTO_ROTATE_IDLE) {
                this._awardsYaw += AWARDS_AUTO_ROTATE_SPEED * this._awardsAutoRotateDirection * dt;
                if (this._awardsYaw >= AWARDS_MAX_YAW) {
                    this._awardsYaw = AWARDS_MAX_YAW;
                    this._awardsAutoRotateDirection = -1;
                } else if (this._awardsYaw <= AWARDS_MIN_YAW) {
                    this._awardsYaw = AWARDS_MIN_YAW;
                    this._awardsAutoRotateDirection = 1;
                }
            }
            const center = this._awardsCenter;
            const cosPitch = Math.cos(this._awardsPitch);
            const targetY = center.y + AWARDS_TARGET_Y;
            desiredTarget = new Vec3(
                center.x + Math.sin(this._awardsYaw) * AWARDS_TARGET_SCREEN_RIGHT_OFFSET,
                targetY,
                center.z - Math.cos(this._awardsYaw) * AWARDS_TARGET_SCREEN_RIGHT_OFFSET,
            );
            desiredPos = new Vec3(
                center.x + Math.cos(this._awardsYaw) * cosPitch * this._awardsDistance,
                targetY + Math.sin(this._awardsPitch) * this._awardsDistance,
                center.z + Math.sin(this._awardsYaw) * cosPitch * this._awardsDistance,
            );
            this._broadcastDesiredFov = 38;
        } else if (this._preCountdownActive) {
            const elapsed = this._preCountdownElapsed;
            const lanes = this._preCountdownLaneZs;
            let shotIndex: number;
            if (elapsed < PRE_RACE_OVERVIEW_SECONDS) {
                // Stage 1: wide establishing shot behind the roster info panel.
                shotIndex = -1;
                this._preRacePhase = 'overview';
                const overview = this.preRaceOverviewShot();
                desiredTarget = overview.target;
                desiredPos = overview.position;
                this._broadcastDesiredFov = PRE_RACE_OVERVIEW_FOV;
            } else if (elapsed < PRE_RACE_OVERVIEW_SECONDS + PRE_RACE_ORBIT_SECONDS) {
                // Stage 2: one continuous descend-and-orbit shot around the racers.
                // The camera spirals from near top-down to a low front angle and
                // never stops on an individual swimmer.
                this._preRacePhase = 'orbit';
                shotIndex = 0;
                const progress = clamp((elapsed - PRE_RACE_OVERVIEW_SECONDS) / PRE_RACE_ORBIT_SECONDS, 0, 1);
                const shot = this.preRaceOrbitShot(progress, lanes, direction);
                desiredTarget = shot.target;
                desiredPos = shot.position;
                this._broadcastDesiredFov = shot.fov;
            } else {
                // Stage 2 done: ease into the countdown / dive-prep front view with
                // a quick smooth blend (no hard cut) and hand off to the race start.
                shotIndex = 1;
                this._preRacePhase = 'none';
                this._preCountdownActive = false;
                this._preCountdownReady = true;
                const frontTarget = new Vec3(countdownAthleteTargetX(playerX), countdownAthleteTargetY(playerY), this._playerLaneZ);
                desiredTarget = frontTarget;
                desiredPos = countdownFrontCameraPosition(frontTarget, direction, 1);
                this._broadcastDesiredFov = 40;
            }
            // Hard-cut into the establishing overview and into the start of the
            // orbit; the orbit itself is one continuous shot and the final hand-off
            // stays a smooth blend.
            const enteringNewShot = shotIndex !== this._preCountdownShotIndex;
            hardCameraCut = enteringNewShot && this._preRacePhase !== 'none';
            this._preCountdownShotIndex = shotIndex;
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
        } else if (this.shouldUseFinishTopView(snapshot)) {
            // Both the main broadcast camera and the venue feed settle into the
            // finish-line top view for the final approach to the wall.
            this.finishDiveShotIfNeeded();
            const finishView = this.finishTopCameraView(snapshot);
            desiredTarget = finishView.target;
            desiredPos = finishView.position;
            this._broadcastDesiredFov = FINISH_TOP_FOV;
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

    private shouldUseFinishTopView(snapshot: RaceCameraSnapshot): boolean {
        return snapshot.sprintActive
            && getRaceDistance() - snapshot.playerDistance <= RACE_CAMERA_TUNING.finishTopViewDistance;
    }

    private finishTopCameraView(snapshot: RaceCameraSnapshot): { position: Vec3; target: Vec3 } {
        const raceDistance = getRaceDistance();
        const courseEndDistance = this._courseLayout.currentCourseEndDistance(snapshot.playerDistance, raceDistance);
        const finishDirection = this._courseLayout.finishDirectionAtDistance(courseEndDistance);
        const finishAnchorX = this._courseLayout.distanceToWorldX(courseEndDistance) - 7.5 * finishDirection;
        const playerFollowX = snapshot.playerX + 3.4 * finishDirection;
        const targetX = playerFollowX * 0.65 + finishAnchorX * 0.35;
        const target = new Vec3(targetX, 0.18, 0);
        return {
            position: new Vec3(target.x, 22.5, 0),
            target,
        };
    }

    private updateFinishTopCamera(snapshot: RaceCameraSnapshot) {
        const view = this.finishTopCameraView(snapshot);
        this._cameraPos.set(view.position);
        this._cameraTarget.set(view.target);
        this._topViewActive = true;
        this._underwaterViewActive = false;
        this.applyCameraTransform(new Vec3(0, 0, -1));
        this.applyFov();
    }

    private updateSprintCamera(dt: number, snapshot: RaceCameraSnapshot, immediate = false) {
        const direction = this._courseLayout.directionAtDistance(snapshot.playerDistance);
        const view = sprintCameraView(snapshot, direction);
        if (immediate) {
            this._cameraPos.set(view.position);
            this._cameraTarget.set(view.target);
        } else {
            // Forward/height track tightly; lateral (Z) lags so the swimmer's
            // steering weave reads on screen instead of staying dead-centre.
            const follow = cameraBlend(dt, RACE_CAMERA_TUNING.sprintFollowSpeed);
            const lateral = clamp(1 - Math.exp(-Math.max(0, dt) * RACE_CAMERA_TUNING.sprintLateralFollowSpeed), 0.01, 0.5);
            this._cameraPos.x += (view.position.x - this._cameraPos.x) * follow;
            this._cameraPos.y += (view.position.y - this._cameraPos.y) * follow;
            this._cameraPos.z += (view.position.z - this._cameraPos.z) * lateral;
            this._cameraTarget.x += (view.target.x - this._cameraTarget.x) * follow;
            this._cameraTarget.y += (view.target.y - this._cameraTarget.y) * follow;
            this._cameraTarget.z += (view.target.z - this._cameraTarget.z) * lateral;
        }
        this.applyCameraTransform();
        this.applyFov();
    }

    private updateFlipTurnCamera(dt: number, snapshot: RaceCameraSnapshot, immediate: boolean) {
        const upperBody = snapshot.playerUpperBodyWorldPosition?.clone()
            ?? new Vec3(snapshot.playerX, snapshot.playerY, this._playerLaneZ);
        const edgeMargin = 0.35;
        const poolMinX = Math.min(this._courseLayout.poolStartX, this._courseLayout.poolFinishX) + edgeMargin;
        const poolMaxX = Math.max(this._courseLayout.poolStartX, this._courseLayout.poolFinishX) - edgeMargin;
        const poolHalfWidth = Math.max(edgeMargin + 0.1, this._courseLayout.poolWidth * 0.5);
        const poolMinZ = -poolHalfWidth + edgeMargin;
        const poolMaxZ = poolHalfWidth - edgeMargin;
        const target = new Vec3(
            clamp(upperBody.x, poolMinX, poolMaxX),
            Math.min(upperBody.y, this._courseLayout.waterY - 0.08),
            clamp(upperBody.z, poolMinZ, poolMaxZ),
        );
        const desiredPos = new Vec3(
            clamp(
                target.x - Math.max(0.1, RACE_CAMERA_TUNING.flipTurnBackDistance) * this._flipTurnViewDirection,
                poolMinX,
                poolMaxX,
            ),
            clamp(
                target.y - Math.max(0.1, RACE_CAMERA_TUNING.flipTurnBelowDistance),
                this._courseLayout.waterY - 1.2,
                this._courseLayout.waterY - 0.25,
            ),
            clamp(
                target.z + Math.max(0.1, RACE_CAMERA_TUNING.flipTurnSideDistance),
                poolMinZ,
                poolMaxZ,
            ),
        );
        if (immediate) {
            this._cameraPos.set(desiredPos);
            this._cameraTarget.set(target);
        } else {
            const smooth = cameraBlend(dt, 10.5);
            Vec3.lerp(this._cameraPos, this._cameraPos, desiredPos, smooth);
            Vec3.lerp(this._cameraTarget, this._cameraTarget, target, smooth);
        }
        this._topViewActive = false;
        this._underwaterViewActive = true;
        this._broadcastCameraFov += (RACE_CAMERA_TUNING.flipTurnFov - this._broadcastCameraFov)
            * (immediate ? 1 : cameraBlend(dt, 10.5));
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
        this._flipTurnViewActive = false;
        this._preCountdownElapsed = 0;
        this._preCountdownActive = false;
        this._preCountdownReady = false;
        this._preRacePhase = 'none';
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

    // Which pre-race showcase stage the broadcast camera is currently in. Drives
    // the roster info panel (shown only during 'overview').
    get preRacePhase(): PreRacePhase {
        return this._preRacePhase;
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
    const heading = snapshot.playerHeading ?? 0;
    // Heading is relative to the current pool-leg direction. Lateral movement
    // always uses world Z, while the along-lane component flips after a turn.
    const movementX = direction * Math.cos(heading);
    const movementZ = Math.sin(heading);
    const continuousKickActive = !snapshot.playerArmStrokeActive
        && (snapshot.playerKickCadenceHz ?? 0) >= RACE_CAMERA_TUNING.sprintKickPullbackMinCadenceHz;
    const backDistance = RACE_CAMERA_TUNING.sprintBackDistance
        + (continuousKickActive ? RACE_CAMERA_TUNING.sprintKickPullbackDistance : 0);
    return {
        position: new Vec3(
            upperBody.x - backDistance * movementX,
            upperBody.y + RACE_CAMERA_TUNING.sprintHeight,
            upperBody.z - backDistance * movementZ,
        ),
        target: new Vec3(
            upperBody.x + RACE_CAMERA_TUNING.sprintLookAhead * movementX,
            upperBody.y + 0.08,
            upperBody.z + RACE_CAMERA_TUNING.sprintLookAhead * movementZ,
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
