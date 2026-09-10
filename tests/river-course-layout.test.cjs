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
