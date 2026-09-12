import { _decorator, Component } from 'cc';
import { getRaceDistance, isRaceSteeringEnabled } from '../core/GameBalance';
import { StrokeType } from '../core/GameConstants';
import { MOTION_TUNING, STROKE_QUALITY_TUNING } from '../core/InputTuning';
import { DOLPHIN_JUMP } from '../core/DolphinJumpConfig';
import { abilityValue } from '../core/CharacterAbilityConfig';
import { CONDITION_BALANCE } from '../core/ConditionBalance';
import { AI_STROKE_TUNING, AI_DOLPHIN_TUNING } from '../competitor/CompetitorConfig';
import { AI_CHARACTER_STRATEGIES, intelligenceForDifficulty } from '../competitor/AiRaceConfig';
import { AiRaceObservation, AiRacePlanner } from '../competitor/AiRacePlanner';
import { AIRaceObserver } from '../competitor/AIRaceObserver';
import { PlayerCharacterId } from '../app/PlayerCharacterConfig';
import { AiConditionModel } from '../condition/AiConditionModel';
import { randomFloat, randomGaussian, randomRange } from '../core/SharedRNG';
import { scaledDelta } from '../core/TimeScale';
import { Swimmer } from './Swimmer';

const { ccclass, property } = _decorator;
type AiStrokePhase = 'gap' | 'press' | 'stroke';

// 角色策略只生成合法输入；运动、资源与判定始终由玩家共用模型结算。
@ccclass('AISwimmerController')
export class AISwimmerController extends Component {
    @property(Swimmer) public swimmer: Swimmer = null;
    @property({ range: [0, 1, 0.01] }) public difficulty = 0.5;
    public characterId: PlayerCharacterId = 'cartonSwimmer6';
    public level = 1;
    public energyTotal = 140;
    public raceObserver: AIRaceObserver | null = null;
    public condition: AiConditionModel | null = null;
    public remoteDriven = false;
    public onDolphinJumpStarted: (() => void) | null = null;
    public onObservedPressChanged: ((side: StrokeType, pressed: boolean) => void) | null = null;
    isInputPressed(side: StrokeType): boolean {
        return this._active && ((this._phase !== 'gap' && this._side === side) || (this._primed && this._primedSide === side));
    }
    private clearObservedPress() {
        this.onObservedPressChanged?.(StrokeType.LEFT, false);
        this.onObservedPressChanged?.(StrokeType.RIGHT, false);
    }
    readonly planner = new AiRacePlanner();
    private _active = false;
    private _phase: AiStrokePhase = 'gap';
    private _side = StrokeType.LEFT;
    private _nextSide = StrokeType.LEFT;
    private _kickSide = StrokeType.LEFT;
    private _timer = 0;
    private _heldSeconds = 0;
    private _target = 0.375;
    private _primed = false;
    private _primedSeconds = 0;
    private _primedSide = StrokeType.LEFT;
    private _decisionClock = 0;
    private _kickClock = 0;
    private _strokeDistance = 0;
    private _strokeEnergy = 0;
    private _lastStrokeStart = -10;
    private _clock = 0;
    private _targetZ: number | null = null;
    private _safeMinZ: number | null = null;
    private _safeMaxZ: number | null = null;
    private _safeWarning = false;
    private _safeAware = false;
    private _wasLocked = false;
    private _swimSeconds = 0;
    private _kickSeconds = 0;
    private _jumps = 0;
    private _decisions = 0;
    private readonly _observation: AiRaceObservation = {
        distance: 0, raceDistance: 200, wallDistance: 50, energy: 140, energyTotal: 140,
        heartRate: 80, speed: 0, infiniteStamina: false, supportsDolphin: true,
        dolphinReady: false, dolphinCost: 5, dolphinRange: 8, dolphinStrain: 25,
        minDolphinSpace: 3, kickDive: false, nearbyThreat: false, closeRace: false,
        strokeCostPerMeter: 0.7,
    };

    get intelligence() { return intelligenceForDifficulty(this.difficulty); }
    get divePower(): number { const s = this.intelligence; return (s.chargeMin + s.chargeMax) * 0.5; }
    sampleDivePower(): number { const s = this.intelligence; return randomRange(s.chargeMin, s.chargeMax); }

    configure(characterId: PlayerCharacterId, level: number, difficulty: number, energyTotal: number) {
        this.stopSwimming();
        this.characterId = characterId;
        this.level = level;
        this.difficulty = difficulty;
        this.energyTotal = energyTotal;
        this.condition?.configureEnergyTotal(energyTotal);
        this.condition?.setInfiniteStamina(this.swimmer.motor.ability.infiniteStamina);
    }

    bindCondition(condition: AiConditionModel) {
        this.condition = condition;
        condition.configureEnergyTotal(this.energyTotal);
        condition.setInfiniteStamina(this.swimmer.motor.ability.infiniteStamina);
    }

    setLaneLockdownSafeZRange(minZ: number | null, maxZ: number | null, warning: boolean) {
        const valid = minZ !== null && maxZ !== null && Number.isFinite(minZ) && Number.isFinite(maxZ);
        const min = valid ? Math.min(minZ, maxZ) : null;
        const max = valid ? Math.max(minZ, maxZ) : null;
        if (min !== this._safeMinZ || max !== this._safeMaxZ) this._safeAware = false;
        this._safeMinZ = min; this._safeMaxZ = max; this._safeWarning = warning;
    }

    startSwimming() {
        if (this.remoteDriven || this._active) return;
        this.clearObservedPress();
        this._active = true;
        this._phase = 'gap';
        this._primed = false;
        this._primedSeconds = 0;
        this._side = this._nextSide = this._kickSide = StrokeType.LEFT;
        this._clock = this._decisionClock = this._kickClock = this._heldSeconds = 0;
        this._swimSeconds = this._kickSeconds = this._jumps = this._decisions = 0;
        this._lastStrokeStart = -10;
        this._wasLocked = false;
        this._safeAware = false;
        this._targetZ = null;
        this._observation.strokeCostPerMeter = 0.7;
        this.planner.reset();
        this._timer = this.intelligence.id === 'extreme' ? 0
            : randomRange(AI_STROKE_TUNING.startDelayMin, AI_STROKE_TUNING.startDelayMax);
    }

    stopSwimming() {
        this.clearObservedPress();
        if (!this.remoteDriven && this._phase === 'stroke') this.swimmer?.handleStrokeHeld(this._side, false);
        this._active = false;
        this._primed = false;
        this._phase = 'gap';
    }

    update(dt: number) {
        if (this.swimmer?.netFixedStep) return;
        this.stepSimulation(scaledDelta(dt));
    }

    stepSimulation(dt: number) {
        if (this.remoteDriven || !this._active || !this.swimmer?.node.active
            || !this.swimmer.isRacing || !(dt > 0) || !Number.isFinite(dt)) return;
        this._clock += dt;
        const body = this.swimmer;
        // 折返与跳跃会清除动作。恢复后丢弃旧按住状态，不能残留一只手或沿用旧预算采样。
        if (body.isFlipTurning || body.isDolphinJumpActive || !body.canUseArmStroke) {
            if (!this._wasLocked) this.clearObservedPress();
            this._phase = 'gap'; this._primed = false; this._timer = 0; this._wasLocked = true;
            if (!body.isFlipTurning && !body.isDolphinJumpActive) this.kick(dt);
            return;
        }
        if (this._wasLocked) {
            this._wasLocked = false;
            this._decisionClock = this.intelligence.decisionSeconds;
        }
        this._decisionClock += dt;
        if (this._decisionClock >= this.intelligence.decisionSeconds || this._decisions === 0) {
            this.observe();
            this.planner.decide(this._observation, AI_CHARACTER_STRATEGIES[this.characterId], this.intelligence, this._decisionClock);
            this._decisionClock = 0;
            this._decisions++;
        }
        // 已经开始的一划正常松手后再换策略，避免为了恢复心率反复制造早松失误。
        if (this._phase === 'stroke') { this.updateStroke(dt); return; }
        if (this._phase === 'press') { this.promotePress(dt); return; }
        const kicking = this.planner.action === 'recover' || this.planner.action === 'save' || this.planner.action === 'evade';
        if (this.planner.wantsJump && AI_DOLPHIN_TUNING.enabled && !body.isUnderwater && body.tryDolphinJump()) {
            this._jumps++;
            this.planner.wantsJump = false;
            this.onDolphinJumpStarted?.();
            return;
        }
        if (kicking) {
            this._kickSeconds += dt;
            // 严重偏航时允许正常付费划水回正；资源规划随后补偿这个开销。
            if (isRaceSteeringEnabled() && Math.abs(body.steeringHeadingRatio) > 0.35
                && this.condition?.energy > 0 && this._clock - this._lastStrokeStart > 1.5) {
                this._nextSide = body.correctiveStrokeSide();
                this.beginPress();
            } else this.kick(dt);
            return;
        }
        this._timer -= dt;
        if (this._timer <= 0) this.beginPress();
    }

    private observe() {
        const b = this.swimmer, s = this._observation, ability = b.motor.ability;
        s.distance = b.distance;
        s.raceDistance = getRaceDistance();
        const nextWall = b.courseLayout.nextInternalTurnDistance(s.distance, s.raceDistance);
        s.wallDistance = Math.max(0, (nextWall ?? s.raceDistance) - s.distance - DOLPHIN_JUMP.endMargin);
        s.energy = this.condition?.energy ?? this.energyTotal;
        s.energyTotal = this.energyTotal;
        s.heartRate = b.heartRate; s.speed = b.currentSpeed;
        s.infiniteStamina = ability.infiniteStamina;
        s.supportsDolphin = ability.allowsDolphin;
        s.dolphinReady = b.ultimate.canAffordDolphin;
        s.dolphinCost = DOLPHIN_JUMP.staminaCost * (ability.id === 'frogHop' ? abilityValue('frogDolphinCost', 0, 2) : 1);
        const launch = DOLPHIN_JUMP.launchSpeed * b.motor.burstLaunchSpeedScale
            * (ability.id === 'frogHop' ? abilityValue('frogDolphinSpeed', 0.1, 2) : 1);
        const angle = DOLPHIN_JUMP.launchAngleDegrees * Math.PI / 180;
        // 只估计完整空间，不修改实际抛物线；落水段另留当前速度的保守余量。
        s.dolphinRange = launch * launch * Math.sin(2 * angle) / Math.max(0.1, DOLPHIN_JUMP.gravity)
            + Math.max(1, s.speed) * (DOLPHIN_JUMP.dipSeconds + DOLPHIN_JUMP.landingHoldSeconds);
        s.dolphinStrain = DOLPHIN_JUMP.strainHr;
        s.minDolphinSpace = DOLPHIN_JUMP.minAvailableDistance;
        s.kickDive = ability.id === 'kickDive';
        const nearby = isRaceSteeringEnabled() ? this.raceObserver?.nearestPhysicalOpponent(b, 4, 2.2) : null;
        s.nearbyThreat = !!nearby && (nearby.weight >= b.weight || s.kickDive);
        s.closeRace = this.raceObserver?.hasCloseCompetitor(b, 3) ?? false;
        this._targetZ = null;
        if (nearby && this.intelligence.discipline >= 0.8) {
            const style = AI_CHARACTER_STRATEGIES[this.characterId];
            const z = b.node.position.z, otherZ = nearby.node.position.z;
            if (style.contest && s.energy > this.planner.sprintReserve && Math.abs(nearby.distance - b.distance) <= 2) {
                this._targetZ = otherZ;
            } else if (style.avoidContact && !s.kickDive) {
                const halfWidth = b.courseLayout.poolWidth * 0.5;
                const direction = z === otherZ ? (z > 0 ? -1 : 1) : Math.sign(z - otherZ);
                this._targetZ = clamp(otherZ + direction * 1.5, -halfWidth + 0.8, halfWidth - 0.8);
            }
        }
    }

    private kick(dt: number) {
        this._kickClock -= dt;
        if (this._kickClock > 0) return;
        // 短按不提升为手臂，踢腿推进仍受 Motor 的真实频率上限约束。
        this.onObservedPressChanged?.(this._kickSide, true);
        this.swimmer.handleKickStroke(this._kickSide);
        this.onObservedPressChanged?.(this._kickSide, false);
        this._kickSide = opposite(this._kickSide);
        this._kickClock = 1 / Math.max(1, this.intelligence.kickHz);
    }

    private beginPress() {
        const body = this.swimmer;
        const side = this.pickSide();
        if (!body.canAcceptStroke(side)) { this._timer = 0; return; }
        this._side = side;
        this._heldSeconds = 0;
        this._phase = 'press';
        // 玩家按下同样先踢腿，超过分类时长才转成长按；未确认短按不触发潜航能力。
        this.onObservedPressChanged?.(side, true);
        body.handleKickStroke(side, false);
    }

    private promotePress(dt: number) {
        this._heldSeconds += dt;
        const threshold = Math.max(0, STROKE_QUALITY_TUNING.minHoldSeconds);
        if (this._heldSeconds + 1e-8 < threshold || !this.swimmer.canAcceptStroke(this._side)) return;
        this.swimmer.handleStrokeHeld(this._side, true, threshold);
        this.swimmer.handleStroke(this._side);
        this._lastStrokeStart = this._clock;
        this._strokeDistance = this.swimmer.distance;
        this._strokeEnergy = this.condition?.energy ?? this.energyTotal;
        const center = (STROKE_QUALITY_TUNING.perfectStart + STROKE_QUALITY_TUNING.perfectEnd) * 0.5;
        const skill = this.intelligence;
        const sigma = skill.timingSigma * (AI_STROKE_TUNING.timingSigmaLow / 0.12);
        this._target = clamp(center + (sigma > 0 ? randomGaussian() * sigma : 0), 0.05,
            Math.min(AI_STROKE_TUNING.maxReleaseProgress, STROKE_QUALITY_TUNING.armStrokeTimeoutProgress - 0.01));
        this._phase = 'stroke';
    }

    private updateStroke(dt: number) {
        this._swimSeconds += dt;
        this._heldSeconds += dt;
        const b = this.swimmer;
        const progress = b.aiActiveStrokeProgress(this._side);
        const maxHold = Math.max(AI_STROKE_TUNING.maxHoldSeconds,
            b.actionCycleSeconds / Math.max(0.01, MOTION_TUNING.heldMotionSpeedScale) + STROKE_QUALITY_TUNING.minHoldSeconds);
        if (this._primed) this._primedSeconds += dt;
        // 测试极限：前一划结束前短暂按下另一侧，重叠的是分类等待，不跳过等待本身。
        // 预按时间短于分类门槛，因此不会暗中抑制应已开始的另一只手臂。
        const threshold = Math.max(0, STROKE_QUALITY_TUNING.minHoldSeconds);
        const remainingHold = Math.max(0, this._target - progress) * b.actionCycleSeconds
            / Math.max(0.01, MOTION_TUNING.heldMotionSpeedScale);
        if (!this._primed && this.intelligence.id === 'extreme' && progress >= 0 && progress < this._target
            && remainingHold <= threshold * 0.5 && threshold > dt * 2
            && Math.abs(b.steeringHeadingRatio) < 0.12 && this._targetZ === null && this._safeMinZ === null
            && !this.planner.wantsJump && (this.planner.action === 'swim' || this.planner.action === 'sprint')) {
            this._primedSide = opposite(this._side);
            if (b.canAcceptStroke(this._primedSide)) {
                this.onObservedPressChanged?.(this._primedSide, true);
                b.handleKickStroke(this._primedSide, false);
                this._primed = true; this._primedSeconds = 0;
            }
        }
        if (progress >= 0 && progress < this._target && this._heldSeconds < maxHold) return;
        this.onObservedPressChanged?.(this._side, false);
        if (progress >= 0) b.handleStrokeHeld(this._side, false);
        const distance = b.distance - this._strokeDistance;
        const energy = this.condition?.energy ?? this.energyTotal;
        // 仅普通划水样本估算每米成本，跳跃与折返被阶段锁排除。至少一划成本，避开结算时序偏差。
        if (distance > 0.1 && !b.isUnderwater) {
            const cost = Math.max(CONDITION_BALANCE.energy.drainPerStroke, this._strokeEnergy - energy);
            const sample = clamp(cost / Math.max(0.3, distance + b.currentSpeed * (this.intelligence.gap + STROKE_QUALITY_TUNING.minHoldSeconds)), 0.25, 2.5);
            this._observation.strokeCostPerMeter += (sample - this._observation.strokeCostPerMeter) * 0.12;
        }
        this._nextSide = opposite(this._side);
        const skill = this.intelligence;
        this._timer = skill.gap * (AI_STROKE_TUNING.gapSecondsSlow / 0.22)
            * (skill.id === 'extreme' ? 1 : 1 + randomRange(-AI_STROKE_TUNING.gapJitter, AI_STROKE_TUNING.gapJitter));
        if (b.motor.ability.id === 'breathControl' && this.planner.action !== 'sprint') {
            const untilNext = 1 / abilityValue('coachMaxStrokeHz', 0.1, 5) - (this._clock - this._lastStrokeStart) - STROKE_QUALITY_TUNING.minHoldSeconds;
            this._timer = Math.max(this._timer, untilNext);
        }
        this._phase = 'gap';
        if (this._primed && (this.planner.wantsJump || (this.planner.action !== 'swim' && this.planner.action !== 'sprint'))) {
            this.onObservedPressChanged?.(this._primedSide, false);
            if (this._primedSeconds < threshold) b.confirmKickStroke();
            this._primed = false;
        }
        if (this._primed) {
            // 已按下的键完整经过分类时长，下一步继续提升；左右都遵循玩家动作占用检查。
            this._phase = 'press';
            this._side = this._primedSide;
            this._heldSeconds = this._primedSeconds;
            this._primed = false;
        }
    }

    private pickSide(): StrokeType {
        const b = this.swimmer;
        if (!isRaceSteeringEnabled()) return this._nextSide;
        const discipline = this.intelligence.discipline;
        let targetZ = this._targetZ;
        if (this._safeMinZ !== null && this._safeMaxZ !== null) {
            if (!this._safeAware) this._safeAware = randomFloat() < discipline * (this._safeWarning ? 1 : 0.5);
            if (this._safeAware) targetZ = clamp(b.node.position.z, this._safeMinZ + 0.22, this._safeMaxZ - 0.22);
        }
        if (Math.abs(b.steeringHeadingRatio) > 0.18) {
            return randomFloat() < discipline ? b.correctiveStrokeSide() : this._nextSide;
        }
        if (targetZ !== null && Math.abs(targetZ - b.node.position.z) > 0.3) {
            const sign = targetZ > b.node.position.z ? 1 : -1;
            return sign === (b.raceDirection >= 0 ? 1 : -1) ? StrokeType.LEFT : StrokeType.RIGHT;
        }
        return randomFloat() < (1 - discipline) * 0.08 ? this._side : this._nextSide;
    }

    // 仅测试或显式调试调用时生成对象，正式比赛帧无日志和诊断分配。
    debugSnapshot() {
        return { characterId: this.characterId, level: this.level, intelligence: this.intelligence.id,
            action: this.planner.action, reason: this.planner.reason, desiredEnergy: this.planner.desiredEnergy,
            sprintReserve: this.planner.sprintReserve, energy: this.condition?.energy ?? this.energyTotal,
            heartRate: this.swimmer?.heartRate ?? 80, decisions: this._decisions,
            swimSeconds: this._swimSeconds, kickSeconds: this._kickSeconds, jumps: this._jumps };
    }
}

function opposite(side: StrokeType): StrokeType { return side === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
