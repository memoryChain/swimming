/* 仅用于独立浏览器中的海豚跳视觉预览；刷新页面恢复，不进入运行时资源。 */
window.installDolphinSplashPreview = (splash, engine) => {
    const point = new engine.Vec3();
    const sourcePoint = new engine.Vec3();
    const original = splash.triggerBigSurfaceBurst;
    const events = [];
    function constant(curve, value) { curve.mode = curve.constructor.Mode.Constant; curve.constant = value; }
    function range(curve, min, max) {
        curve.mode = curve.constructor.Mode.TwoConstants;
        curve.constantMin = min; curve.constantMax = max;
    }
    splash.triggerBigSurfaceBurst = function (scale) {
        if (this._culled || !this._particleEffectsEnabled) return;
        // 当前真实起落事件分别传入 2.6 和 3.2，仅在预览中借此区分。
        const landing = scale > 3;
        const direction = this._state.movementDirection >= 0 ? 1 : -1;
        this._options.getBoneWorldPosition(landing ? 'Head' : 'Body', sourcePoint);
        sourcePoint.y = this._waterY + 0.1;
        events.push({phase: landing ? '落水' : '破水', position: {...sourcePoint}});
        this.node.active = true;
        for (const emitter of this._particleEmitters) {
            if (emitter.role !== 'hand') continue;
            const side = emitter.side === 'left' ? -1 : 1;
            const sheet = emitter.visual === 'plume';
            if (sheet && emitter.side === 'right') continue;
            point.set(sourcePoint);
            point.x += direction * (landing ? 0.05 : -0.35);
            point.z += sheet ? 0 : side * (landing ? 0.30 : 0.25);
            emitter.node.setWorldPosition(point);
            const yaw = Math.atan2(direction * (landing ? 0.3 : 0.8), -side * direction) * 180 / Math.PI;
            emitter.node.setRotationFromEuler(sheet ? 90 : (landing ? 54 : 40), sheet ? 0 : yaw, 0);
            const system = emitter.system;
            range(system.startLifetime, sheet ? 0.52 : 0.30, sheet ? 0.64 : 0.45);
            range(system.startSpeed, sheet ? 0.15 : 1.8, sheet ? 0.28 : 2.7);
            constant(system.gravityModifier, sheet ? 0 : 0.85);
            range(system.startSizeX, sheet ? (landing ? 1.8 : 1.55) : 0.12, sheet ? (landing ? 2.1 : 1.8) : 0.20);
            range(system.startSizeY, sheet ? (landing ? 0.9 : 0.82) : 0.12, sheet ? 1.15 : 0.20);
            range(system.startSizeZ, sheet ? 1 : 0.12, sheet ? 1.3 : 0.20);
            system.shapeModule.angle = sheet ? 8 : 24;
            system.shapeModule.radius = sheet ? 0.04 : 0.09;
            system.play();
            system.emit(sheet ? 1 : 6, 0);
            if (!sheet) {
                range(system.startSizeX, 0.05, 0.085);
                range(system.startSizeY, 0.05, 0.085);
                range(system.startSizeZ, 0.05, 0.085);
                range(system.startLifetime, 0.20, 0.32);
                system.emit(3, 0);
            }
            emitter.sprayTime = emitter.sprayRate = emitter.sprayCarry = 0;
            emitter.keepAlive = 0.64;
            emitter.cooldown = 0.3;
        }
        for (const part of this._parts) {
            if (!part.node.name.includes('HandRipple')) continue;
            if (part.node.name.includes('Right')) { part.rippleTime = 0; continue; }
            part.frozenWorldPosition.set(sourcePoint);
            part.frozenWorldPosition.y = this._waterY + part.basePosition.y;
            part.rippleTime = 0.45;
            this.keepHandRippleFrozen(part);
        }
    };
    return {events, restore() {splash.triggerBigSurfaceBurst = original;}};
};
