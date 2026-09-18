const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('设置弹窗使用主HUD相机，并在完整退场后恢复大厅3D预览', () => {
    const manager = fs.readFileSync(path.join(root, 'assets/scripts/app/LoginManager.ts'), 'utf8');
    const settings = fs.readFileSync(path.join(root, 'assets/scripts/ui/SettingsPanel.ts'), 'utf8');
    const prepare = fs.readFileSync(path.join(root, 'assets/scripts/ui/PrepareRaceFlow.ts'), 'utf8');

    assert.match(manager, /new SettingsPanel\(\(presented\) => \{[\s\S]*?setModalOverlayActive\(presented\)/);
    assert.match(manager, /_settingsPanel\.build\([\s\S]*?UILayer\.Hud/);
    assert.doesNotMatch(manager, /const popup = getUILayer\(this\._canvasNode, UILayer\.Popup\);[\s\S]{0,260}new SettingsPanel/);

    assert.match(settings, /setPresented\(true\);[\s\S]*?_motion\?\.show\(\)/);
    assert.match(settings, /_motion\?\.hide\(\(\) => this\.setPresented\(false\)\)/);
    assert.match(prepare, /setModalOverlayActive\(active: boolean\)[\s\S]*?setRenderingEnabled\([\s\S]*?!active/);
    assert.match(prepare, /visible && !this\._eventPageActive && !this\._modalOverlayActive/);
    const preview = fs.readFileSync(path.join(root, 'assets/scripts/app/PrepareRaceCharacterPreview.ts'), 'utf8');
    assert.match(preview, /setRenderingEnabled\(enabled: boolean\)[\s\S]*?camera\.enabled = enabled/);
});

test('头像弹窗与设置共用主HUD遮罩方案，并保留身份保存协议', () => {
    const manager = fs.readFileSync(path.join(root, 'assets/scripts/app/LoginManager.ts'), 'utf8');
    const identity = fs.readFileSync(path.join(root, 'assets/scripts/ui/IdentityEditPanel.ts'), 'utf8');

    assert.match(manager, /new IdentityEditPanel\(\(presented\) => \{[\s\S]*?setModalOverlayActive\(presented\)/);
    assert.match(manager, /_identityEditPanel\.build\([\s\S]*?UILayer\.Hud/);
    assert.doesNotMatch(manager, /const popup = getUILayer\(this\._canvasNode, UILayer\.Popup\);[\s\S]{0,320}new IdentityEditPanel/);
    assert.match(identity, /fitFullScreenSolidCover\(dim, designWidth, designHeight\)/);
    assert.match(identity, /setPresented\(true\);[\s\S]*?_motion\?\.show\(\)/);
    assert.match(identity, /_motion\?\.hide\(\(\) => this\.setPresented\(false\)\)/);
    assert.match(identity, /PlayerData\.setIdentity\(patch\)/);
});

test('设置音量仍为预览、取消恢复、确认一次保存', () => {
    const panel = fs.readFileSync(path.join(root, 'assets/scripts/ui/SettingsPanel.ts'), 'utf8');
    const manager = fs.readFileSync(path.join(root, 'assets/scripts/app/SettingsManager.ts'), 'utf8');

    assert.match(panel, /SettingsManager\.previewMusicVolume\(volume\)/);
    assert.match(panel, /SettingsManager\.previewSfxVolume\(volume\)/);
    assert.match(panel, /restorePreview\(\)[\s\S]*?previewMusicVolume\(this\._initialMusic\)/);
    assert.match(panel, /SettingsManager\.setVolumes\(this\._draftMusic, this\._draftSfx\)/);
    assert.match(manager, /Confirm persists both values as one settings update/);
});
