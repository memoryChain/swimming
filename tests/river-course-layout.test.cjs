const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./helpers/cocos-math-harness.cjs');

const definition = {
    id: 'test',
    laneCount: 8,
    laneWidth: 2.625,
    raceDistance: 50,
    startX: 0,
    finishX: 50,
};

const harness = createHarness({
    '../core/GameBalance': {
        DIVE_BALANCE: { platformNodeOffset: { x: -1.07, y: 0.25, z: 0 } },
    },
    './VenueConfig': {
        DEFAULT_POOL_DEFINITION: definition,
    },
});
const { RaceCourseLayout } = harness.load(path.join(harness.root, 'assets/scripts/venue/RaceCourseLayout.ts'));

test('straight course is monotonic and does not expose internal turns', () => {
    const course = new RaceCourseLayout(definition);
    assert.ok(Math.abs(course.distanceToWorldX(0) - 2.8) < 1e-9);
    assert.ok(Math.abs(course.distanceToWorldX(50) - 47.2) < 1e-9);
    assert.equal(course.directionAtDistance(75), -1);
    assert.equal(course.nextInternalTurnDistance(0, 200), 50);

    course.setTravelMode('straight');
    assert.ok(Math.abs(course.distanceToWorldX(0) - 2.8) < 1e-9);
    assert.ok(Math.abs(course.distanceToWorldX(50) - 52.8) < 1e-9);
    assert.ok(Math.abs(course.distanceToWorldX(200) - 202.8) < 1e-9);
    assert.ok(Math.abs(course.distanceToWorldX(400) - 402.8) < 1e-9);
    assert.equal(course.directionAtDistance(150), 1);
    assert.equal(course.currentCourseEndDistance(20, 400), 400);
    assert.equal(course.nextInternalTurnDistance(20, 400), null);
    assert.equal(course.clampSwimWorldX(180), 180);
    assert.equal(course.openSides, true);
    assert.equal(course.finishHasWall, false);

    course.resetToDefinition(definition);
    assert.equal(course.travelMode, 'laps');
    assert.equal(course.nextInternalTurnDistance(20, 200), 50);
});

test('river course keeps straight ends and maps lateral offsets onto each bend', () => {
    const course = new RaceCourseLayout(definition);
    course.configureRiverCourse(400, {
        startStraight: 70,
        finishStraight: 70,
        curveCount: 2,
        headingDegrees: 20.5,
        sampleSpacing: 1,
    });
    const frame = {};
    course.sampleCourseFrame(35, frame);
    assert.ok(Math.abs(frame.tangentZ) < 1e-6);
    course.sampleCourseFrame(102.5, frame);
    assert.ok(frame.tangentZ > 0.3);
    assert.ok(frame.curvature === 0 || Number.isFinite(frame.curvature));
    const lightweightDirection = { x: 0, y: 99, z: 0 };
    assert.doesNotThrow(() => course.courseWorldDirection(102.5, 0, lightweightDirection));
    assert.ok(lightweightDirection.x > 0.9);
    assert.ok(lightweightDirection.z > 0.3);
    assert.equal(lightweightDirection.y, 0);
    const lightweightNormal = { x: 0, y: 99, z: 0 };
    assert.doesNotThrow(() => course.courseWorldNormal(102.5, lightweightNormal));
    assert.equal(lightweightNormal.y, 0);
    assert.ok(Math.abs(lightweightDirection.x * lightweightNormal.x
        + lightweightDirection.z * lightweightNormal.z) < 1e-5);
    const centre = course.coursePosition(102.5, 0, 0, new harness.Vec3());
    const outside = course.coursePosition(102.5, 2, 0, new harness.Vec3());
    const lateral = course.worldLateralAtDistance(102.5, outside.x, outside.z);
    assert.ok(Math.abs(lateral - 2) < 1e-4);
    assert.ok(Math.hypot(outside.x - centre.x, outside.z - centre.z) > 1.99);
    course.sampleCourseFrame(365, frame);
    assert.ok(Math.abs(frame.tangentZ) < 1e-6);
    assert.equal(course.nextInternalTurnDistance(200, 400), null);
    assert.equal(course.openSides, true);
    assert.equal(course.finishHasWall, false);
    assert.equal(course.isCurvedRiver, true);
});

test('river centre line advances without folding back or approaching a distant segment', () => {
    const course = new RaceCourseLayout(definition);
    course.configureRiverCourse(400, {
        startStraight: 70,
        finishStraight: 70,
        curveCount: 2,
        headingDegrees: 20.5,
        sampleSpacing: 1,
    });
    const frame = {};
    const points = [];
    let previousX = Number.NEGATIVE_INFINITY;
    let maxAbsZ = 0;
    let maxAbsCurvature = 0;
    for (let distance = 0; distance <= 400; distance += 5) {
        course.sampleCourseFrame(distance, frame);
        assert.ok(frame.x > previousX);
        previousX = frame.x;
        maxAbsZ = Math.max(maxAbsZ, Math.abs(frame.z));
        maxAbsCurvature = Math.max(maxAbsCurvature, Math.abs(frame.curvature));
        points.push({ distance, x: frame.x, z: frame.z });
    }
    assert.ok(maxAbsZ < 18);
    assert.ok(maxAbsCurvature < 1 / 55);
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            if (points[j].distance - points[i].distance < 30) continue;
            assert.ok(Math.hypot(points[j].x - points[i].x, points[j].z - points[i].z) > 20);
        }
    }
});

test('zero curve amplitude is position-compatible with the former straight river', () => {
    const straight = new RaceCourseLayout(definition);
    straight.setTravelMode('straight');
    const river = new RaceCourseLayout(definition);
    river.configureRiverCourse(400, {
        startStraight: 70,
        finishStraight: 70,
        curveCount: 2,
        headingDegrees: 0,
        sampleSpacing: 1,
    });
    const frame = {};
    for (let distance = 0; distance <= 408; distance += 17) {
        river.sampleCourseFrame(distance, frame);
        assert.ok(Math.abs(frame.x - straight.distanceToWorldX(distance)) < 1e-4);
        assert.ok(Math.abs(frame.z) < 1e-6);
        assert.ok(Math.abs(frame.tangentX - 1) < 1e-6);
        assert.ok(Math.abs(frame.normalZ - 1) < 1e-6);
    }
});
