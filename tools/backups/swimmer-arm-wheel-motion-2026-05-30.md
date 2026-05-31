# Swimmer Arm Wheel Motion Backup - 2026-05-30

This backs up the current accepted arm motion in `assets/scripts/entity/CartoonSwimmerRig.ts`.

Intent:
- Straight-arm wheel style motion.
- Arms rotate in vertical side planes.
- Left and right arms are half a cycle apart.
- Lower body kick is not part of this backup.

Required temp fields:

```ts
private readonly _tmpDirection = new Vec3();
private readonly _tmpWorldDirection = new Vec3();
private readonly _tmpParentDirection = new Vec3();
private readonly _tmpBaseDirection = new Vec3();
private readonly _tmpDeltaRotation = new Quat();
private readonly _tmpRootWorldRotation = new Quat();
private readonly _tmpParentWorldRotation = new Quat();
private readonly _tmpInverseParentWorldRotation = new Quat();
```

Accepted `applyArm`:

```ts
private applyArm(shoulder: Node, arm: Node, foreArm: Node, hand: Node, cycle: number, power: number) {
    if (!arm || !foreArm) {
        return;
    }

    const normalized = positiveMod(-cycle, Math.PI * 2) / (Math.PI * 2);
    const side = arm === this._leftArm ? 1 : -1;
    const wheel = -normalized * Math.PI * 2;
    const c = Math.cos(wheel);
    const s = Math.sin(wheel);
    const armPower = 0.92 + Math.min(2, Math.max(0.8, power)) * 0.08;

    const shoulderLift = (-1 - 2 * c) * armPower;
    const shoulderOpen = side * 6 * armPower;
    const shoulderRoll = side * 2 * armPower;
    const elbowStraight = (-6 + 2 * c) * armPower;
    const handNeutral = -2 * c * armPower;
    const sideClearance = 0.58;

    this.applyBoneOffset(shoulder, shoulderLift, shoulderOpen, shoulderRoll);
    this._tmpDirection.set(side * sideClearance, c, s);
    Vec3.normalize(this._tmpDirection, this._tmpDirection);
    this.applyBoneDirectionFromRoot(arm, foreArm, this._tmpDirection);
    this.applyBoneOffset(foreArm, elbowStraight, side * 3 * armPower, side * 2 * armPower);
    this.applyBoneOffset(hand, handNeutral, side * 2 * armPower, side * 1.5 * armPower);
}
```

Accepted `armReachSignal`:

```ts
private armReachSignal(cycle: number): number {
    const leftReach = Math.cos(positiveMod(-cycle, Math.PI * 2));
    const rightReach = Math.cos(positiveMod(-(cycle + Math.PI), Math.PI * 2));
    return (leftReach - rightReach) * 0.5;
}
```

Required direction helpers:

```ts
private applyBoneDirection(bone: Node, child: Node, directionInParent: Vec3) {
    if (!bone || !child) {
        return;
    }
    const base = this._boneBaseRotation.get(bone);
    if (!base) {
        return;
    }

    Vec3.copy(this._tmpBaseDirection, child.position);
    if (this._tmpBaseDirection.lengthSqr() <= 0.000001) {
        return;
    }
    Vec3.normalize(this._tmpBaseDirection, this._tmpBaseDirection);
    Vec3.transformQuat(this._tmpBaseDirection, this._tmpBaseDirection, base);
    Vec3.normalize(this._tmpBaseDirection, this._tmpBaseDirection);
    Quat.rotationTo(this._tmpDeltaRotation, this._tmpBaseDirection, directionInParent);
    Quat.multiply(this._tmpResultRotation, this._tmpDeltaRotation, base);
    bone.setRotation(this._tmpResultRotation);
}

private applyBoneDirectionFromRoot(bone: Node, child: Node, directionInRoot: Vec3) {
    if (!this.root || !bone?.parent) {
        return;
    }

    this.root.getWorldRotation(this._tmpRootWorldRotation);
    bone.parent.getWorldRotation(this._tmpParentWorldRotation);
    Vec3.transformQuat(this._tmpWorldDirection, directionInRoot, this._tmpRootWorldRotation);
    Quat.invert(this._tmpInverseParentWorldRotation, this._tmpParentWorldRotation);
    Vec3.transformQuat(this._tmpParentDirection, this._tmpWorldDirection, this._tmpInverseParentWorldRotation);
    Vec3.normalize(this._tmpParentDirection, this._tmpParentDirection);
    this.applyBoneDirection(bone, child, this._tmpParentDirection);
}
```
