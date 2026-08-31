import test from 'node:test';
import assert from 'node:assert/strict';

import BackendContract from '../assets/scripts/backend/IBackend.ts';

const { shouldAdoptRaceDoubleRewardProfile, writeJsonOrThrow } = BackendContract;

test('storage failure propagates so settlement persistence can retry', () => {
    let attempts = 0;
    let stored = '';
    const storage = {
        setItem(_key, value) {
            attempts++;
            if (attempts === 1) {
                throw new Error('quota exceeded');
            }
            stored = value;
        },
    };

    assert.throws(
        () => writeJsonOrThrow(storage, 'profile', { coins: 10 }),
        /quota exceeded/,
    );
    assert.doesNotThrow(() => writeJsonOrThrow(storage, 'profile', { coins: 10 }));
    assert.equal(attempts, 2);
    assert.equal(stored, '{"coins":10}');
});

test('a rejected double-reward claim cannot roll back the live profile', () => {
    assert.equal(shouldAdoptRaceDoubleRewardProfile({ ok: false }), false);
    assert.equal(shouldAdoptRaceDoubleRewardProfile({ ok: true }), true);
});
