# Agent Notes

## Project Context

- This is a Cocos Creator 3.8.8 project for a lightweight 3D swimming rhythm game.
- The target runtime is WeChat Mini Game, so keep package size, draw calls, mesh count, shader/effect count, and runtime allocations conservative.
- The active game entry is `assets/scripts/core/GameManager.ts`. It should stay mostly as orchestration; put detailed behavior into `app`, `swimmer`, `camera`, `ui`, `venue`, `competitor`, or `character` modules.
- Runtime resources should stay under `assets/resources`. Keep resource paths centralized in `assets/scripts/core/ResourcePaths.ts` instead of scattering string paths through loaders.

## Mobile Input

- The current mobile race input is full-screen tap/hold. `InputRouter` automatically alternates `LEFT` and `RIGHT` strokes for game logic.
- Do not reintroduce visible left/right touch zones unless the user explicitly asks. Touch hit areas should remain invisible.
- Keyboard `A` / `D` still maps to explicit left/right strokes for editor/debug workflows.

## Tuning

- Debug model is the main tuning surface. Its parameter definitions and persistence logic live in `assets/scripts/core/TuningDebugControls.ts`.
- Saved tuning is plain JSON at `assets/resources/config/tuning.json`; game startup loads it through `GameManager.onLoad()` before runtime systems are created.
- If a gameplay feel parameter is added, expose it through the tuning panel when it affects race feel, and make sure saved tuning can override the default.
- Stable tuning ids should use explicit English keys such as `speed.strokeBaseAccel` or `motion.animationSpeedScale`.
- `MOTION_TUNING.animationSpeedScale` is shared by race mode and debug model.

## Gameplay Module Boundaries

- Core balance values belong in `assets/scripts/core/GameBalance.ts`, `assets/scripts/core/InputTuning.ts`, or a similarly focused config file.
- `SwimmerMotor` and `SwimPhysicsModel` own movement, stroke queues, stability rewards, acceleration, drag, and speed.
- `RaceCameraDirector` owns race camera behavior. Pass it compact race snapshots; do not make it query game objects directly.
- `RaceManager` owns countdown, dive-to-race transition, race timing, progress, finish, and placement callbacks.
- AI behavior/config should stay in `entity/AISwimmerController.ts` and `competitor/CompetitorConfig.ts`, not in player input code.

## Venue And Assets

- The low-poly venue asset is generated from Blender tooling in `tools/`, especially `tools/build-lowpoly-pool.py`, and exported to `assets/resources/pool/LowPolyPool.glb`.
- Prefer low-poly meshes, batched runtime meshes, unlit/simple materials, and small textures for WeChat Mini Game.
- Do not place `.blend`, preview images, backup files, or other source-only assets under `assets/`; keep them in `tools/` unless the user explicitly wants them shipped.
- Top-view camera logic may hide ceiling nodes. If adding ceiling pieces, include `ceiling` in relevant node names so this behavior can continue to work.

## Blender MCP

- Blender MCP may be used for inspecting and editing Blender scenes/assets, especially low-poly venue work under `tools/`.
- Before large Blender edits, save the `.blend` file or confirm the intended source file with the user.
- Keep generated geometry suitable for WeChat Mini Game: low face count, few materials, small textures, and merged/static batches where practical.
- Do not enable or rely on PolyHaven/Hyper3D assets unless the user explicitly asks. External assets can easily add excessive texture size, material count, or geometry.
- Exported runtime assets should go to `assets/resources`, while Blender source files and previews should remain in `tools/`.

## Checks After Code Changes

After modifying TypeScript/Cocos runtime code, run:

```powershell
npx.cmd --yes --package typescript tsc --noEmit --ignoreDeprecations 6.0 --skipLibCheck
```

This is the lightweight compile/type check used during development in this project. It does not build the Cocos project or export platform packages.

## Git And Local Files

- The worktree may contain user/editor generated files. Do not revert unrelated changes.
- Current untracked tool artifacts such as `tools/LowPolyPool.blend1` and `tools/lowpoly_pool_preview.png` should not be staged unless the user explicitly asks.
- When committing, stage only relevant project changes and mention if push fails because of local proxy/network issues.
