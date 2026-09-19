const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/core/RaceManager.ts'), 'utf8');
const GameState = Object.fromEntries(['READY','COUNTDOWN','DIVING','GLIDING','RACING','FINISHED','AWARDS'].map(x => [x,x]));
function fixture(dev = true) {
    class Component { unscheduleAllCallbacks() { this.cancelled = true; } }
    const noopDecorator = () => () => {};
    const imports = {
        cc: { Component, _decorator: { ccclass: noopDecorator, property: (...args) => args.length > 1 ? undefined : () => {} } },
        'cc/env': { DEV: dev },
        './GameConstants': { GameState },
        './GameBalance': { getRaceDistance: () => 100, COUNTDOWN_SECONDS: 3 },
        './TimeScale': { scaledDelta: x => x },
        '../entity/Swimmer': { Swimmer: class {} },
        '../venue/VenueConfig': { DEFAULT_POOL_DEFINITION: {} },
        '../venue/LaneLayout': { laneNumberForZ: () => 1 },
    };
    const m = { exports: {} };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    } }).outputText, { require: id => imports[id] || {}, module: m, exports: m.exports });
    const race = new m.exports.RaceManager();
    const swimmers = Array.from({length: 8}, (_, i) => ({ swimmerName: `选手${i}`, distance: i * 10,
        node: { active: true, position: { z: i } }, stopRace() { this.stopped = true; } }));
    race.playerSwimmer = swimmers[0]; race.aiSwimmer = swimmers[1]; race.aiSwimmers = swimmers.slice(1);
    const results = []; race.onRaceFinished = (...args) => results.push(args);
    return { race, swimmers, results };
}
test('倒计时、跳水、滑行、游泳均可指定所有名次；正常结算仅触发一次', () => {
    for (const state of ['COUNTDOWN','DIVING','GLIDING','RACING']) for (let rank = 1; rank <= 8; rank++) {
        const {race, swimmers, results} = fixture(); race.startRace(); race._state = state;
        race._finishTimes.set(swimmers[1], 0.5); race._aiFinishTimes.set(swimmers[1], 0.5);
        race._eliminated.add(swimmers[0]); race._quit.add(swimmers[0]);
        assert.equal(race.debugFinishWithPlacement(rank), true);
        assert.equal(race.state, GameState.FINISHED); assert.equal(results.length, 1);
        const [win, time, , summary] = results[0];
        assert.equal(win, rank === 1); assert.ok(time > 0); assert.equal(summary.placement, rank);
        assert.equal(summary.racerCount, 8); assert.equal(summary.leaderboard[rank - 1].isPlayer, true);
        assert.ok(summary.leaderboard.every(row => row.finished && row.time > 0));
        assert.equal(new Set(summary.leaderboard.map(row => row.time)).size, 8);
        assert.ok(swimmers.every(swimmer => swimmer.stopped)); assert.equal(race.cancelled, true);
        assert.equal(race.debugFinishWithPlacement(rank), false); race.stepSimulation(1);
        assert.equal(results.length, 1);
    }
});
test('非开发环境、赛前、赛后及无效名次不能改写成绩；重开清除调试结果', () => {
    const {race, results} = fixture();
    assert.equal(race.debugFinishWithPlacement(1), false); race.startRace();
    for (const rank of [0, 9, -1, NaN, Infinity, 1.5]) assert.equal(race.debugFinishWithPlacement(rank), false);
    assert.equal(results.length, 0);
    assert.equal(race.debugFinishWithPlacement(8), true); race.startRace();
    assert.equal(race._finishTimes.size, 0); assert.equal(race._playerFinished, false);
    assert.equal(race.debugFinishWithPlacement(1), true); assert.equal(results.length, 2);
    const prod = fixture(false); prod.race.startRace();
    assert.equal(prod.race.debugFinishWithPlacement(1), false); assert.equal(prod.results.length, 0);
});
