# SpeedSwimming Code Refactor TDB

## 1. Background

The current project already proves the core race loop: countdown, player/AI strokes, swimmer movement, basic camera, runtime pool setup, HUD, and finish result. The next planned features will expand in several directions:

- Different pool scenes and venue variations.
- Audience generation and richer stadium atmosphere.
- Replaceable swimmer character models, skins, rigs, and animations.
- More advanced race camera logic, including shot selection and dynamic FOV.
- Pre-race dive/start sequence.
- Post-race ranking presentation, results ceremony, and podium flow.
- More UI screens and race phase specific UI.

The current code can still ship a prototype, but future work will become expensive unless responsibilities are separated now.

## 2. Current Pain Points

### 2.1 `GameManager` Is Doing Too Much

`assets/scripts/core/GameManager.ts` currently owns:

- Runtime scene construction.
- Pool loading and fallback pool generation.
- Light/stadium generation.
- Swimmer spawning and AI profile creation.
- UI construction.
- Race state transitions.
- Input event wiring.
- Camera modes and broadcast shot sequencing.
- Model debug mode.
- Debug panel and speed bar drawing.

This makes every new feature touch `GameManager`, creating high merge conflict risk and making behavior hard to test.

### 2.2 `Swimmer` Mixes Simulation, Input Metrics, Animation, and Effects

`assets/scripts/entity/Swimmer.ts` currently owns:

- Race lifecycle state.
- Distance/speed/fatigue.
- Stroke input history and sync/effort scoring.
- Speed physics.
- Calls into `RhythmEvaluator`.
- 2D placeholder pose animation.
- 3D model bone posing fallback.
- `CartoonSwimmerRig` animation triggers.
- Splash effect triggering.
- Finish ragdoll tween.

This creates tight coupling between race rules and presentation. Replacing character models or changing physics would require editing the same class.

### 2.3 `CartoonSwimmerRig` Combines Several Subsystems

`assets/scripts/entity/CartoonSwimmerRig.ts` currently owns:

- Model prefab loading.
- Bone discovery.
- Material generation and texture painting.
- Outline shell configuration.
- Freestyle pose playback/manual posing.
- Splash mesh creation and update.
- Pre-race standing pose.
- Model debug mode.

This makes it difficult to support multiple model types. A future imported rig, stylized rig, or simple fallback rig should not inherit the whole current implementation.

### 2.4 Race Flow Is Too Flat

`RaceManager` currently has `READY`, `COUNTDOWN`, `RACING`, `FINISHED`. Planned features need more phases:

- Intro/loading.
- On-blocks ready.
- Dive/start animation.
- Race active.
- Finish touch.
- Ranking calculation.
- Results UI.
- Podium/ceremony.
- Return/retry.

The current flat flow will force special cases into `GameManager`, `Swimmer`, and UI.

## 3. Design Goals

1. Keep current gameplay behavior stable during refactor.
2. Separate simulation from rendering and presentation.
3. Make scene/pool/player/camera/UI systems replaceable by data/config.
4. Keep Cocos `Component` classes thin where possible.
5. Prefer small orchestration classes over one central god object.
6. Make future features land in obvious modules.
7. Avoid over-engineering: use simple TypeScript classes and Cocos components first.

## 4. Proposed High-Level Architecture

```text
GameBootstrap
  -> GameFlowController
      -> RaceFlowController
      -> VenueManager
      -> CompetitorManager
      -> CameraDirector
      -> UIFlowController
      -> InputRouter

Race domain
  -> RaceStateMachine
  -> RaceSession
  -> RaceRules
  -> RaceResultService
  -> RaceParticipant

Swimmer domain
  -> SwimmerEntity
  -> SwimmerMotor
  -> StrokeMetrics
  -> SwimPhysicsModel
  -> SwimmerPresentation

Character presentation
  -> CharacterRig
  -> CharacterModelLoader
  -> CharacterSkinApplier
  -> FreestylePoseController
  -> SplashEmitter
  -> CharacterDebugController

Venue
  -> PoolSceneLoader
  -> PoolDefinition
  -> LaneLayout
  -> AudienceSpawner
  -> VenueLightingController
  -> WaterSurfaceBinder

Camera
  -> RaceCameraDirector
  -> CameraRig
  -> CameraShot
  -> BroadcastShotSequencer
  -> FovController

UI
  -> ScreenRouter
  -> StartScreenView
  -> RaceHudView
  -> CountdownView
  -> ResultsView
  -> PodiumView
```

## 5. Target Directory Layout

```text
assets/scripts/
  app/
    GameBootstrap.ts
    GameContext.ts
    GameFlowController.ts

  config/
    RaceConfig.ts
    VenueConfig.ts
    CompetitorConfig.ts
    CameraConfig.ts

  race/
    RaceFlowController.ts
    RaceStateMachine.ts
    RaceSession.ts
    RaceRules.ts
    RaceResultService.ts
    RaceTypes.ts

  swimmer/
    SwimmerEntity.ts
    SwimmerMotor.ts
    StrokeMetrics.ts
    SwimPhysicsModel.ts
    SwimmerPresentation.ts
    SwimmerTypes.ts

  ai/
    AISwimmerController.ts
    AIStrokeStrategy.ts
    AIProfile.ts

  character/
    CharacterRig.ts
    CartoonCharacterRig.ts
    CharacterModelLoader.ts
    CharacterSkinApplier.ts
    FreestylePoseController.ts
    SplashEmitter.ts
    CharacterDebugController.ts

  venue/
    VenueManager.ts
    PoolSceneLoader.ts
    PoolFallbackBuilder.ts
    LaneLayout.ts
    AudienceSpawner.ts
    VenueLightingController.ts
    WaterSurfaceBinder.ts

  camera/
    RaceCameraDirector.ts
    CameraRig.ts
    CameraShot.ts
    BroadcastShotSequencer.ts
    FovController.ts

  input/
    InputRouter.ts
    StrokeInputSource.ts

  ui/
    UIFlowController.ts
    ScreenRouter.ts
    RaceHudView.ts
    StartScreenView.ts
    CountdownView.ts
    ResultsView.ts
    PodiumView.ts

  shared/
    MathUtils.ts
    NodeUtils.ts
    EventBus.ts
```

The exact filenames can be adjusted during implementation, but the dependency direction should remain stable:

```text
app -> race / venue / swimmer / camera / ui / input
race -> swimmer types only
swimmer -> character presentation interfaces only
character -> Cocos rendering/model details
venue -> Cocos scene/prefab details
camera -> Cocos camera details
ui -> Cocos UI details
```

## 6. Core Module Design

### 6.1 App Layer

`GameBootstrap`

- Replaces most of `GameManager.onLoad`.
- Finds/creates root nodes.
- Creates `GameContext`.
- Installs managers.
- Starts the initial flow.

`GameContext`

- Stores shared runtime references:
  - `worldRoot`
  - `canvasRoot`
  - `cameraNode`
  - `raceSession`
  - `competitors`
  - config objects

`GameFlowController`

- High-level orchestration only.
- Does not build meshes, animate rigs, calculate physics, or draw UI directly.
- Handles transitions such as start game, restart, enter model debug, exit model debug.

### 6.2 Race Layer

`RaceStateMachine`

Recommended states:

```ts
export enum RacePhase {
    Boot = 'boot',
    Ready = 'ready',
    Intro = 'intro',
    Countdown = 'countdown',
    Dive = 'dive',
    Racing = 'racing',
    Finish = 'finish',
    Results = 'results',
    Podium = 'podium',
}
```

`RaceFlowController`

- Owns countdown timing.
- Starts dive/start sequence later.
- Starts active race only after the start phase completes.
- Emits race phase changes.
- Calls `RaceResultService` when competitors finish.

`RaceSession`

- Holds race timer, distance, participants, current phase, and finish records.
- No Cocos node manipulation.

`RaceParticipant`

- Data object around a swimmer:
  - lane
  - display name
  - is player
  - current distance
  - finish time
  - rank

`RaceResultService`

- Calculates ranks for 2 or 8 swimmers.
- Later supports DNF, penalties, replay stats, split times.

### 6.3 Swimmer Layer

`SwimmerEntity`

- Cocos component attached to each swimmer root.
- Thin facade.
- Owns references to:
  - `SwimmerMotor`
  - `StrokeMetrics`
  - `SwimmerPresentation`
- Public API:
  - `prepareForRace(startPose)`
  - `startRace()`
  - `stopRace()`
  - `applyStroke(type, rhythmResult)`
  - `setPhase(phase)`
  - `snapshot`

`StrokeMetrics`

- Extracted from current `Swimmer` input-rate logic.
- Tracks arm/kick input windows.
- Calculates effort and sync score.
- Does not know about Cocos nodes.

`SwimPhysicsModel`

- Extracted from current `updateSpeedPhysics`.
- Pure model:
  - input: current speed, distance, fatigue, effort, sync, AI profile, rhythm bonus
  - output: next speed, next fatigue
- Easier to tune and test.

`SwimmerMotor`

- Owns current speed, distance, fatigue, phase clocks.
- Calls `StrokeMetrics` and `SwimPhysicsModel`.
- Moves the swimmer node through a small adapter method.

`SwimmerPresentation`

- Bridges simulation to visual systems.
- Sends normalized animation data:
  - arm cycle
  - kick cycle
  - body phase
  - speed ratio
  - stroke impulse
  - race phase

This lets future models ignore internal physics details.

### 6.4 Character Layer

`CharacterRig` interface:

```ts
export interface CharacterRig {
    load(options: CharacterLoadOptions): void;
    setRacePhase(phase: RacePhase): void;
    setSwimmingActive(active: boolean): void;
    applyFreestylePose(pose: SwimPoseFrame): void;
    triggerStroke(type: StrokeType, quality: StrokeQuality): void;
    triggerSplash(scale: number): void;
    resetPose(): void;
}
```

`CartoonCharacterRig`

- Keeps the current cartoon rig behavior, but split internally:
  - `CharacterModelLoader`: load prefab and bind bones.
  - `CharacterSkinApplier`: material/texture/outline.
  - `FreestylePoseController`: bone pose sampling and animation state speed.
  - `SplashEmitter`: splash nodes/materials/update.
  - `CharacterDebugController`: model debug only.

Future model replacement path:

- A new imported rig implements `CharacterRig`.
- A simple placeholder rig implements `CharacterRig`.
- `SwimmerEntity` does not care which rig is used.

### 6.5 Venue Layer

`VenueManager`

- Owns current venue lifecycle.
- Loads a `PoolDefinition`.
- Calls pool loader, water binder, lighting, lane layout, and audience spawner.

`PoolDefinition`

```ts
export type PoolDefinition = {
    id: string;
    prefabPath?: string;
    laneCount: number;
    laneWidth: number;
    raceDistance: number;
    startX: number;
    finishX: number;
    playerLaneIndex: number;
    waterMaterialPath?: string;
    audienceProfile?: string;
};
```

`PoolSceneLoader`

- Loads `pool/PoolScene` or another configured pool prefab.
- Does only prefab loading and basic attach.

`PoolFallbackBuilder`

- Keeps current procedural fallback pool/stadium generation.
- Is only used if prefab load fails or in dev mode.

`LaneLayout`

- Calculates lane center positions.
- Removes lane math from `GameManager`.

`AudienceSpawner`

- Later creates audience props/characters from a venue profile.
- Should not affect race simulation.

`WaterSurfaceBinder`

- Finds/activates water nodes and applies water material.
- Owns the current `configureLoadedPool` behavior.

### 6.6 Camera Layer

`RaceCameraDirector`

- Owns race camera mode and shot sequencing.
- Receives read-only race snapshots.
- Outputs camera rig target:
  - position
  - look target
  - fov
  - blend speed

`CameraRig`

- Applies camera position/lookAt/FOV to the Cocos camera.
- Also handles free-camera input deltas.

`CameraShot`

```ts
export type CameraShot = {
    id: string;
    minDuration: number;
    maxDuration?: number;
    getPose(snapshot: RaceCameraSnapshot): CameraPose;
};
```

`BroadcastShotSequencer`

- Owns random/weighted shot order.
- Later can use race drama:
  - close distance gap
  - finish approach
  - player falling behind
  - start/dive
  - post-finish celebration

`FovController`

- Smooths dynamic FOV.
- Keeps FOV logic out of shot math.

### 6.7 UI Layer

`UIFlowController`

- Listens to race phase and result events.
- Shows/hides screens.

`ScreenRouter`

- Activates one or more screen roots.
- Avoids direct UI active toggles from race/app classes.

Views:

- `StartScreenView`
- `RaceHudView`
- `CountdownView`
- `ResultsView`
- `PodiumView`
- `DebugPanelView`
- `ModelDebugHudView`

The current `UIController` can be split gradually. `RaceHudView` should own speed/progress/rating/timer. Result and countdown should become separate views.

### 6.8 Input Layer

`InputRouter`

- Replaces stringly-typed `node.emit('arm-stroke')` from gameplay code.
- Converts keyboard/mouse/touch into typed commands:

```ts
export type GameCommand =
    | { type: 'stroke'; stroke: StrokeType }
    | { type: 'primaryAction' }
    | { type: 'toggleDebug' }
    | { type: 'cycleCamera' }
    | { type: 'toggleFreeCamera' };
```

Gameplay should consume commands through callbacks or a small typed event bus.

## 7. Event Design

Use a small typed event bus or explicit callbacks. Avoid broad Cocos node string events for cross-system gameplay.

Recommended events:

```ts
RacePhaseChanged
CountdownTick
RaceStarted
StrokeSubmitted
StrokeRated
ParticipantProgressChanged
ParticipantFinished
RaceFinished
CameraModeChanged
ScreenRequested
```

Guideline:

- Cocos node events are fine for local UI button interaction.
- Typed events/callbacks should be used between app/race/swimmer/camera/ui systems.

## 8. Data-Driven Config

Start with TypeScript config objects. Move to JSON assets later if designer editing is needed.

Suggested configs:

- `RaceConfig`: distance, countdown, target BPM, speed constants.
- `VenueConfig`: pool prefab path, lane count, water material, audience profile.
- `CompetitorConfig`: name, lane, AI profile, model/skin.
- `CameraConfig`: available modes, shot durations, FOV ranges.
- `CharacterConfig`: prefab path, rig type, material profile.

This avoids hard-coded values like lane count, pool prefab path, AI profiles, camera durations, and player lane index living inside `GameManager`.

## 9. Refactor Migration Plan

### Phase 1: Extract Pure Swimmer Logic

Goal: reduce `Swimmer.ts` without changing visuals.

Tasks:

- Create `StrokeMetrics`.
- Create `SwimPhysicsModel`.
- Create `SwimmerMotor`.
- Keep `Swimmer` as facade attached to node.
- Preserve current public API: `startRace`, `stopRace`, `handleStroke`, `reset`, `currentSpeed`, `distance`, `isRacing`.

Expected result:

- Race tuning no longer requires editing animation/bone code.
- Unit-like tests become possible for speed and stroke metrics.

### Phase 2: Split Character Rig Internals

Goal: make model replacement possible.

Tasks:

- Define `CharacterRig` interface.
- Rename current `CartoonSwimmerRig` conceptually to `CartoonCharacterRig`.
- Extract loading/binding to `CharacterModelLoader`.
- Extract materials to `CharacterSkinApplier`.
- Extract splash to `SplashEmitter`.
- Extract debug mode to `CharacterDebugController`.

Expected result:

- New character models can be added by implementing or adapting `CharacterRig`.
- `Swimmer` no longer needs direct model bone references.

### Phase 3: Split GameManager Scene Construction

Goal: make `GameManager` become bootstrapping/orchestration only.

Tasks:

- Create `VenueManager`.
- Move pool prefab loading to `PoolSceneLoader`.
- Move fallback mesh generation to `PoolFallbackBuilder`.
- Move light generation to `VenueLightingController`.
- Move lane math to `LaneLayout`.
- Move swimmer creation to `CompetitorManager` or `SwimmerFactory`.
- Move UI construction to `UIFlowController` or view builders.

Expected result:

- Adding a new pool scene does not touch race/camera/UI code.
- Audience spawning has a natural home.

### Phase 4: Introduce Race Flow Phases

Goal: prepare for dive, finish presentation, podium.

Tasks:

- Replace direct `GameState` use with richer `RacePhase`.
- Keep compatibility mapping for existing UI during migration.
- Add phase hooks:
  - `onReady`
  - `onCountdown`
  - `onDive`
  - `onRacing`
  - `onFinish`
  - `onResults`
  - `onPodium`

Expected result:

- Start/dive/result/podium can be added without patching random branches in `GameManager`.

### Phase 5: Extract Camera Director

Goal: isolate broadcast/shot/FOV complexity.

Tasks:

- Move `RaceCameraMode` and camera update methods to `RaceCameraDirector`.
- Move lookAt/FOV application to `CameraRig`.
- Move shot sequence to `BroadcastShotSequencer`.
- Convert per-frame camera update to consume a `RaceCameraSnapshot`.

Expected result:

- Dynamic FOV and complex camera shots can evolve independently.
- Debug/free camera behavior is contained.

### Phase 6: Split UI by Screens

Goal: support more UI states without growing one controller.

Tasks:

- Split countdown, HUD, result, start, debug into separate view components.
- Add `ScreenRouter`.
- Let `UIFlowController` react to typed race events.

Expected result:

- Podium/result/ranking UI can be added as new screens.
- Race logic does not directly toggle UI nodes.

## 10. Compatibility Strategy

During the refactor, keep these public APIs stable until their callers move:

- `Swimmer.startRace()`
- `Swimmer.stopRace()`
- `Swimmer.reset()`
- `Swimmer.handleStroke(type)`
- `Swimmer.currentSpeed`
- `Swimmer.distance`
- `AISwimmerController.startSwimming()`
- `AISwimmerController.stopSwimming()`
- `UIController.updateTimer/updateProgress/updateSpeed/showRating/showCountdown/showResult/resetAll`

This allows staged commits without breaking the playable loop.

## 11. Risks and Mitigation

### Risk: Cocos Scene References Break During Class Moves

Mitigation:

- Avoid renaming existing `ccclass` components in the first extraction phase.
- Introduce new pure classes first.
- Rename Cocos components only after scene bindings are verified.

### Risk: Behavior Changes During Physics Extraction

Mitigation:

- Copy formulas exactly first.
- Add simple console comparison or dev-only assertions for speed/distance over a fixed input script.
- Tune only after extraction is complete.

### Risk: Rig Extraction Becomes Too Large

Mitigation:

- Keep `CartoonSwimmerRig` as the outer component initially.
- Extract private helper classes one at a time.
- Only introduce a second rig after the interface is proven.

### Risk: Too Many Abstractions Too Early

Mitigation:

- Interfaces only where at least two implementations are expected soon:
  - character rig
  - camera shot
  - pool loader/fallback
- Use concrete classes elsewhere.

## 12. Suggested First Implementation Slice

The best first slice is:

1. Add `swimmer/StrokeMetrics.ts`.
2. Add `swimmer/SwimPhysicsModel.ts`.
3. Add `swimmer/SwimmerMotor.ts`.
4. Update `Swimmer.ts` to delegate metrics and speed calculation.
5. Do not touch `GameManager` yet.

This gives immediate coupling reduction with the smallest runtime risk.

## 13. Definition of Done for the Refactor

The refactor is successful when:

- `GameManager` no longer contains pool construction, camera shot math, swimmer physics, or UI screen internals.
- `Swimmer` no longer contains raw speed formulas, input window calculations, manual bone fallback code, or splash implementation details.
- `CartoonSwimmerRig` is either split or wrapped behind `CharacterRig`.
- Race phases can represent countdown, dive, racing, finish, results, and podium without ad hoc flags.
- A new pool prefab can be selected by config.
- A new character model can be selected by config.
- A new camera shot can be added without editing race logic.
- A new UI screen can subscribe to race events without modifying swimmer or camera code.

