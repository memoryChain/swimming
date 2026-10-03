import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import IdentityConfig from '../assets/scripts/backend/IdentityConfig.ts';
import Resources from '../assets/scripts/core/ResourcePaths.ts';

const { AVATARS } = IdentityConfig;
const { RESOURCE_PATHS } = Resources;

const LEGACY_IDS = ['aqua', 'coral', 'lime', 'gold', 'violet', 'rose', 'teal', 'sky'];

function pngInfo(resourcePath) {
    const relative = resourcePath.replace(/\/(texture|spriteFrame)$/, '');
    const file = resolve('assets/race', `${relative}.png`);
    const bytes = readFileSync(file);
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG', file);
    return {
        file,
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
        colorType: bytes[25],
    };
}

test('avatar picker keeps persisted ids stable and exposes ten art slots', () => {
    assert.deepEqual(AVATARS.slice(0, LEGACY_IDS.length).map((entry) => entry.id), LEGACY_IDS);
    assert.equal(AVATARS.length, 10);
    assert.equal(RESOURCE_PATHS.avatarPickerUi.avatars.length, AVATARS.length);
});

// 已确认的街头头像设计使用 256×256，见 docs/开发记录/界面接入/头像设计与裁切接入说明.zh.md。
test('头像选择资源保持已确认的 256×256 RGBA PNG 格式', () => {
    for (const path of RESOURCE_PATHS.avatarPickerUi.avatars) {
        const info = pngInfo(path);
        assert.equal(info.width, 256, info.file);
        assert.equal(info.height, 256, info.file);
        assert.equal(info.colorType, 6, `${info.file} must be RGBA`);
    }
});

test('all authored avatar picker UI slices retain an alpha channel', () => {
    const ui = RESOURCE_PATHS.avatarPickerUi;
    const paths = [
        ui.panel,
        ui.avatarBase,
        ui.selectedRing,
        ui.selectedCheck,
        ui.nicknameRow,
        ui.nicknameField,
        ui.refreshIcon,
        ui.cancelButton,
        ui.confirmButton,
    ];
    for (const path of paths) {
        const info = pngInfo(path);
        assert.equal(info.colorType, 6, `${info.file} must be RGBA`);
    }
});
