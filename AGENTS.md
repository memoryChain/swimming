# Agent Notes

## Communication

- Prefer replying in Chinese (中文) in conversations with the user, unless the user writes in another language or asks otherwise.

## Project Context

- This is a Cocos Creator 3.8.8 project for a lightweight 3D swimming rhythm game.
- The target runtime is WeChat Mini Game, so keep package size, draw calls, mesh count, shader/effect count, and runtime allocations conservative.
- The active game entry is `assets/scripts/core/GameManager.ts`. It should stay mostly as orchestration; put detailed behavior into `app`, `swimmer`, `camera`, `ui`, `venue`, `competitor`, or `character` modules.
- Runtime resources should stay under `assets/resources`. Keep resource paths centralized in `assets/scripts/core/ResourcePaths.ts` instead of scattering string paths through loaders.

## Race HUD / UI Performance (WeChat Mini Game, especially iOS)

Race-time UI runs alongside 3D rendering and networking on iOS JavaScriptCore, so treat every HUD update as a hot path. New or changed race UI must follow these rules:

- **Never assign `Label.string` every frame.** Cocos may rebuild label geometry/atlases even when the text looks unchanged. Cache the displayed value and assign only when it changes. Quantize continuous values to what is actually visible (for example integer energy/heart rate, whole-percent progress, 0.1m distance). Decorative/readout text that does not need frame accuracy should normally refresh at no more than 10Hz and still compare the final string before assignment.
- **Never call `Graphics.clear()` + redraw every render frame for ordinary HUD.** `Graphics` rebuilds geometry. Build static shapes once; for dynamic bars cache the last physical pixel width and color/state, and redraw only when either changes. Complex decorative animation should use a pooled sprite/material when practical; if runtime `Graphics` is necessary, quantize it and cap redraw sampling to about 30Hz or lower.
- **Hidden/debug UI must have zero race-frame work.** Check `root.active`/the feature flag before formatting strings, building signatures, projecting world positions, clearing Graphics, or allocating scratch data. Debug-only UI must return immediately in normal production races.
- **Write Cocos properties only on change.** Before assigning `Node.active`, `Label.color`, `Sprite.color`/`spriteFrame`, `UITransform.contentSize`, or other state that dirties UI/render data, compare against a cached/current value. Starting a Tween is also a state transition: trigger it on the state edge, never by repeatedly calling the same setter from `update()`.
- **Avoid allocations in race UI update paths.** Do not create `Color`, `Vec2/3/4`, arrays, objects, closures, `map/filter` results, or formatted strings every frame. Reuse module constants, instance scratch vectors, and stable arrays/buffers. Event-only UI (countdown ticks, results, button presses) may allocate modestly.
- **Screen-following labels and decorative overlays do not need render-rate simulation.** Reuse projection vectors/buffers, avoid per-frame sorting or `setSiblingIndex`, quantize HUD positions to pixels where acceptable, and normally update at 30Hz. Gameplay/world movement can remain at render rate; this rule is for HUD presentation.
- **Keep state update and presentation frequency separate.** Gameplay, timers, and synchronized values may update every simulation step, while the HUD consumes cached/quantized snapshots at a lower rate. UI throttling must never throttle gameplay or network state itself.
- Before finishing race UI work, audit every call reachable from `GameManager.update()` for `Label.string`, `Graphics.clear`, `Node.active`, transform writes, Tween starts, and temporary allocations. Validate the result on a real iOS WeChat Mini Game build when the change is visually or structurally significant.

## General UI Lifecycle And State Updates

Prefab-authored UI and code-generated UI (`Node` + `UITransform` + `Button` + `Label`/`Sprite`/`Graphics`) follow the same lifecycle rules. Basic control-state changes must be local and must not rebuild unrelated UI or 3D content.

- **Build stable UI hierarchy once.** Create nodes, components, labels, hit areas, and event listeners when the screen/panel is mounted. Keep references to controls that will change. Do not destroy and recreate a screen merely to refresh selection styling.
- **A selection/toggle/tab change updates only affected controls.** Cache the previous state and update the old and new controls only (for example background tint, label color, checkmark visibility, or `Button.interactable`). Clicking the already-selected option must be a no-op.
- **Never route a small state change through a broad `show*`, `refresh`, `reset`, or `rebuild*` method.** A difficulty button must not rebuild character cards, stats, shadows, listeners, or the character preview. Split APIs by scope, such as `buildScreen()`, `updateDifficultySelection()`, `updateCharacterStats()`, and `rebuildCharacterPreview()`.
- **Do not make a generic `refresh()` destructive by default.** If a method destroys nodes, reloads assets, recreates a model/rig, restarts an animation, or rebinds events, its name and call sites must make that scope explicit. Prefer identity/version checks before any resource-level refresh.
- **Keep 3D previews independent from 2D control state.** Rebuild a character preview only when its model identity or required asset actually changes. Difficulty, tab selection, sort/filter choices, button focus, or unrelated profile text must not restart the preview action, reset rotation, reload materials, or recreate its shadow capture.
- **Bind listeners once.** State refreshes must not stack duplicate callbacks. If structural rebuild is genuinely required, destroy/unbind the old owner as one explicit lifecycle operation before creating the replacement.
- **Write Cocos properties only on state edges.** Compare cached/current values before assigning `Node.active`, `Label.string/color`, `Sprite.color/spriteFrame`, `Button.interactable`, or layout properties. Do not start the same Tween repeatedly.
- **For simple visual state, mutate presentation instead of replacing nodes.** Prefer sprite tint/material state where suitable. Event-only `Graphics.clear()` + redraw is acceptable for a small control when its state changes, but never rebuild the control hierarchy and never redraw it every frame.
- **A data/profile change does not automatically justify a whole-screen rebuild.** Update the specific labels, counters, enabled states, or cards whose input changed. Structural rebuild is reserved for an actual change in hierarchy/card count/layout schema and should be commented with the reason.
- Before finishing UI work, repeatedly toggle every option and verify: node/component counts stay stable, callbacks fire once, selected-state visuals are correct, scroll/rotation/focus are preserved, active animations remain continuous, and memory does not grow. For previews, explicitly test that unrelated UI changes do not reload the model or restart its action.

## Mobile Input

- The current mobile race input is full-screen tap/hold. The invisible left and right screen halves map directly to `LEFT` and `RIGHT` strokes.
- Do not add automatic left/right stroke alternation; the player chooses the stroke side by touch position.
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
- `SwimmerMotor` and `SwimPhysicsModel` own movement, stroke queues, strokeQuality rewards, acceleration, drag, and speed.
- `RaceCameraDirector` owns race camera behavior. Pass it compact race snapshots; do not make it query game objects directly.
- `RaceManager` owns countdown, dive-to-race transition, race timing, progress, finish, and placement callbacks.
- AI behavior/config should stay in `entity/AISwimmerController.ts` and `competitor/CompetitorConfig.ts`, not in player input code.

## Multiplayer / Online Sync (consider for EVERY feature)

The game has a WeChat networked race mode (host-authoritative "predict + correct" hybrid, keep-alive session). **Any new gameplay/UI/economy feature must be evaluated for its multiplayer impact.** Before finishing a feature, ask: "what happens to this in a networked race, and does it stay in sync across devices?"

- **Read `docs/平台能力/realtime-multiplayer-notes.zh.md` section 8 (「实战：当前实现的架构与踩坑」) before touching anything sync-related.** It has the real architecture, the WeChat hard-facts list, and every pitfall we hit on device.
- **Single-player must stay unchanged.** All net logic is gated on the net session (`GameManager._netSession` / `consumeNetRaceSession()` non-null). Put multiplayer branches behind that gate; single-player takes the original path with zero behaviour change and no extra per-frame cost.
- **Anything that affects race OUTCOME must be deterministic across devices**: route it through `SharedRNG` (never `Math.random()` for outcome-affecting randomness), and reseed from the host seed. Pure-visual randomness (splash, confetti) may stay `Math.random()`.
- **Cross-engine floats diverge** (iOS JavaScriptCore vs Android V8), so strict lockstep is impossible. New per-swimmer visible state (position, lateral, heading, pose, speed-gated poses, etc.) that can drift must be either host-authoritative-corrected or derived from synced authoritative values — not from the remote copy's local sim alone. See the tread-water pose fix (`NetSnapshotEntry.speed` → `applyNetPoseSpeed`) as the pattern.
- **Do NOT call `endGame` for a rematch.** WeChat rooms are strictly one-game (endGame → room dead, second startGame fails 4014 / fake ok). Rematch reuses the keep-alive session (`RoomFlow._reconnect` direct-enter). Do not "fix" this back to endGame.
- **New sync data goes on the right channel**: reliable/needed → the lock-step frame channel (piggyback on `uploadFrame`); best-effort/tolerable-loss → `broadcastInRoom`. Keep wire formats compact (quantized ints) in `net/NetRace*.ts`.
- **Never add per-frame or per-broadcast `console.log` on the hot net path** (vConsole makes each log very expensive). Gate debug logging behind a flag, like `NET_FRAME_LOG` / `NET_RACE_DEBUG_HUD`.
- Talk to the net layer only through `net/INetRoom.ts` (never `wx.getGameServerManager()` directly), same as the platform abstraction.

## Venue And Assets

- The low-poly venue asset is generated from Blender tooling in `tools/`, especially `tools/build-lowpoly-pool.py`, and exported to `assets/resources/pool/LowPolyPool.glb`.
- Prefer low-poly meshes, batched runtime meshes, unlit/simple materials, and small textures for WeChat Mini Game.
- Do not place `.blend`, preview images, backup files, or other source-only assets under `assets/`; keep them in `tools/` unless the user explicitly wants them shipped.
- Top-view camera logic may hide ceiling nodes. If adding ceiling pieces, include `ceiling` in relevant node names so this behavior can continue to work.

## Blender MCP

- Blender MCP may be used for inspecting and editing Blender scenes/assets, especially low-poly venue work under `tools/`.
- For any model sampling, retargeting, rig inspection, animation baking, GLB export, or Blender scene/asset modification, try Blender MCP first. Do not repeatedly search for or invoke a local `blender.exe` unless Blender MCP is unavailable or explicitly unsuitable.
- Before large Blender edits, save the `.blend` file or confirm the intended source file with the user.
- Keep generated geometry suitable for WeChat Mini Game: low face count, few materials, small textures, and merged/static batches where practical.
- Do not enable or rely on PolyHaven/Hyper3D assets unless the user explicitly asks. External assets can easily add excessive texture size, material count, or geometry.
- Exported runtime assets should go to `assets/resources`, while Blender source files and previews should remain in `tools/`.

## Checks After Code Changes

After modifying TypeScript/Cocos runtime code, run:

```powershell
npx.cmd --yes --package typescript@5.4.5 tsc --noEmit --ignoreDeprecations 5.0 --skipLibCheck
```

This is the lightweight compile/type check used during development in this project. It does not build the Cocos project or export platform packages.

Pin `typescript@5.4.5`: the project's `tsconfig.json` uses `moduleResolution=node10`, which newer TypeScript (5.5+) removed, so an unpinned `npx typescript` fails with `TS5108` before it type-checks. TypeScript 5.4.x also only accepts `--ignoreDeprecations 5.0` (not `6.0`).

## Git And Local Files

- The worktree may contain user/editor generated files. Do not revert unrelated changes.
- Current untracked tool artifacts such as `tools/LowPolyPool.blend1` and `tools/lowpoly_pool_preview.png` should not be staged unless the user explicitly asks.
- When committing, stage only relevant project changes and mention if push fails because of local proxy/network issues.
