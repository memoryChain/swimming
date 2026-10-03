'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const { auditUiAtlases, assertUiAtlasPolicy, assertBuiltUiAtlases, syncUiAtlasExports } = require('../scripts/ui-atlas-policy.cjs');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function barrierHarness() {
    const hooks = new Set(), covers = [];
    class Cover {
        constructor(login, presentation) { this.login = login; this.presentation = presentation; covers.push(this); }
        setLoading() {} setResourceProgress() {}
        setRetry(retry) { this.retry = retry; }
        dispose() { this.disposed = true; }
    }
    const exports = {};
    new Function('require', 'exports', compile('assets/scripts/ui/UiAssetBarrier.ts'))(id => id === 'cc' ? {
        Director: { EVENT_AFTER_DRAW: 'draw' }, director: { on: (_e, fn) => hooks.add(fn), off: (_e, fn) => hooks.delete(fn) },
    } : { StartupLoadingCover: Cover }, exports);
    return { ...exports, covers, frame() { for (const fn of Array.from(hooks)) fn(); } };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function imageHarness(preview = false) {
    const h = barrierHarness(), requests = [];
    class Texture2D { isValid = true; addRef() { this.retained = true; } }
    class SpriteFrame { isValid = true; }
    class SpriteAtlas { isValid = true; frames = {}; addRef() { this.retained = true; } getSpriteFrame(key) { return this.frames[key] || null; } }
    const exports = {};
    new Function('require', 'exports', compile('assets/scripts/ui/AvatarUiAssets.ts'))(id => {
        if (id === 'cc') return { Texture2D, SpriteFrame, SpriteAtlas };
        if (id === 'cc/env') return { EDITOR: false, PREVIEW: preview };
        if (id.endsWith('IdentityConfig')) return { AVATARS: [{ id: 'fixed' }] };
        if (id.endsWith('ResourcePaths')) return { RESOURCE_PATHS: { uiAtlases: { 'race-hud': 'ui/race-hud/atlas' }, avatarPickerUi: { avatars: [] } } };
        if (id.endsWith('RaceBundleLoader')) return { loadRaceAsset(path, type, done) { requests.push({ path, type, done }); } };
        if (id.endsWith('RaceLoading')) return { trackRaceAsset: callback => callback };
        return h;
    }, exports);
    return { ...h, ...exports, requests, SpriteAtlas, SpriteFrame };
}

test('同图集多子图只有一个资源请求，热缓存同步取帧并保留子图坐标', () => {
    const h = imageHarness(), frames = [], scope = new h.UiAssetBarrier();
    scope.run(() => {
        h.loadAvatarUiSpriteFrame('ui/race-hud/heart/spriteFrame', frame => frames.push(frame));
        h.loadAvatarUiSpriteFrame('ui/race-hud/hand/spriteFrame', frame => frames.push(frame));
    });
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].type, h.SpriteAtlas);
    const atlas = new h.SpriteAtlas();
    atlas.frames.heart = Object.assign(new h.SpriteFrame(), { rect: { x: 87, y: 135, width: 26, height: 22 } });
    atlas.frames.hand = new h.SpriteFrame();
    h.requests[0].done(null, atlas);
    assert.equal(scope.pending, 0); assert.equal(atlas.retained, true);
    assert.equal(frames[0].rect.x, 87); assert.equal(frames[0].packable, false);
    let sync = false;
    h.loadAvatarUiSpriteFrame('ui/race-hud/heart/spriteFrame', frame => { sync = true; assert.equal(frame, frames[0]); });
    assert.equal(sync, true); assert.equal(h.requests.length, 1);
});

test('图集失败通知所有订阅并允许整组重试，生产包缺子图不退回散图请求', () => {
    const h = imageHarness(), frames = [];
    for (const key of ['heart', 'hand']) h.loadAvatarUiSpriteFrame(`ui/race-hud/${key}/spriteFrame`, frame => frames.push(frame));
    h.requests[0].done(new Error('断网'));
    assert.deepEqual(frames, [null, null]);
    h.loadAvatarUiSpriteFrame('ui/race-hud/heart/spriteFrame', frame => frames.push(frame));
    assert.equal(h.requests.length, 2);
    h.requests[1].done(null, new h.SpriteAtlas());
    assert.equal(frames.at(-1), null); assert.equal(h.requests.length, 2);
});

test('Creator 预览原帧恢复动态合批，构建图集帧继续禁止二次合图', () => {
    const h = imageHarness(true), frames = [];
    h.loadAvatarUiSpriteFrame('ui/race-hud/heart/spriteFrame', frame => frames.push(frame));
    h.requests[0].done(null, new h.SpriteAtlas());
    assert.equal(h.requests[1].type, h.SpriteFrame);
    const original = Object.assign(new h.SpriteFrame(), { packable: false, rect: { x: 0, y: 0, width: 76, height: 76 } });
    h.requests[1].done(null, original);
    assert.equal(frames[0], original); assert.equal(original.packable, true);
    h.loadAvatarUiSpriteFrame('ui/race-hud/heart/spriteFrame', frame => frames.push(frame));
    assert.equal(h.requests.length, 2); assert.equal(frames[1], original);

    const built = imageHarness(true), atlas = new built.SpriteAtlas();
    atlas.frames.heart = Object.assign(new built.SpriteFrame(), { packable: true });
    built.loadAvatarUiSpriteFrame('ui/race-hud/heart/spriteFrame', () => {});
    built.requests[0].done(null, atlas);
    assert.equal(atlas.frames.heart.packable, false); assert.equal(built.requests.length, 1);
});

test('肖像局部裁切覆盖预览冷帧、已动态合图热帧及构建帧，真实引擎恢复原纹理后不偏移', () => {
    const source = ts.createSourceFile('flow.ts', fs.readFileSync('assets/scripts/ui/PrepareRaceFlow.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const makeRegion = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'makeRaceTextureRegionSprite');
    const config = JSON.parse(fs.readFileSync('temp/tsconfig.cocos.json', 'utf8'));
    const engine = process.env.COCOS_ENGINE_ROOT || path.resolve(config.compilerOptions.paths['db://internal/*'][0], '../../..');
    const frameSource = ts.createSourceFile('frame.ts', fs.readFileSync(path.join(engine, 'cocos/2d/assets/sprite-frame.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const reset = frameSource.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'SpriteFrame')
        .members.find(n => n.name?.getText(frameSource) === '_resetDynamicAtlasFrame');
    const ResetFrame = vm.runInNewContext(ts.transpileModule(`class ResetFrame { ${reset.getText(frameSource)} }; ResetFrame`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText);
    class Rect { constructor(x,y,width,height){Object.assign(this,{x,y,width,height});} }
    class Size { constructor(width,height){Object.assign(this,{width,height});} }
    class Frame extends ResetFrame {
        isValid=true;
        get rect(){return this._rect;} set rect(value){this._rect=value;}
        get texture(){return this._texture;} get original(){return this._original;}
        _calculateUV(){this.updated=true;}
        clone(){const f=new Frame();f._texture=this._texture;f._rect=new Rect(...Object.values(this._rect));f._original=this._original?{...this._original}:null;f.packable=this.packable;return f;}
        destroy(){this.isValid=false;}
    }
    class Transform { setContentSize(){} }
    class Sprite { static SizeMode={CUSTOM:1};isValid=true; }
    for(const mode of ['冷帧','动态热帧','构建帧']){
        const frame=new Frame(),originalTexture={},atlasTexture={};
        frame._texture=mode==='冷帧'?originalTexture:atlasTexture;
        frame._rect=new Rect(mode==='冷帧'?0:142,mode==='冷帧'?0:280,320,320);
        frame._original=mode==='动态热帧'?{_texture:originalTexture,_x:0,_y:0}:null;
        frame.packable=mode!=='构建帧';
        let destroy;
        const sprite=new Sprite(),node={isValid:true,getComponent:()=>new Transform(),setPosition(){},addComponent:()=>sprite,once:(_e,fn)=>destroy=fn};
        const make=vm.runInNewContext(ts.transpileModule(`${makeRegion.getText(source)}; makeRaceTextureRegionSprite`,{
            compilerOptions:{target:ts.ScriptTarget.ES2020},
        }).outputText,{Sprite,Rect,Size,UITransform:Transform,Node:{EventType:{NODE_DESTROYED:'destroy'}},makeUiNode:()=>node,loadAvatarUiSpriteFrame:(_p,done)=>done(frame)});
        make('肖像',{},'路径',new Rect(0,4,320,312),160,156,0,17,0);
        const own=sprite.spriteFrame;
        assert.notEqual(own,frame);assert.equal(own.rect.y,frame.rect.y+4);
        assert.equal(own.originalSize.height,312);assert.equal(own.packable,frame.packable);
        if(mode==='动态热帧'){
            assert.equal(frame.original._y,0,'共享源帧不能被修改');
            own._resetDynamicAtlasFrame();assert.equal(own.texture,originalTexture);
            assert.equal(own.rect.x,0);assert.equal(own.rect.y,4);assert.equal(own.rect.height,312);
        }
        destroy();assert.equal(own.isValid,false);assert.equal(frame.isValid,true);
    }
});

test('页面冷加载等待所有图片、嵌套绑定和两个提交帧，重复点击不叠加任务', async () => {
    const h = barrierHarness(), gate = new h.UiPageLoadGate();
    let complete, nested, mounts = 0, enters = 0;
    const prepare = done => complete = done;
    gate.open(prepare, () => { mounts++; nested = h.trackUiCallback(() => {}); }, () => true, () => enters++);
    gate.open(prepare, () => mounts++);
    assert.equal(h.covers.length, 1); assert.equal(mounts, 0);
    assert.equal(h.covers[0].presentation, 'transparent');
    complete(null); h.frame(); h.frame(); await flush();
    assert.equal(enters, 0); assert.equal(mounts, 1);
    nested(); h.frame(); await flush(); assert.equal(enters, 0);
    h.frame(); await flush(); assert.equal(enters, 1); assert.equal(h.covers[0].disposed, true);
});

test('热缓存直接显示不创建遮罩；失败可重试，取消后的旧回调不挂载页面', async () => {
    const h = barrierHarness(), gate = new h.UiPageLoadGate(); let mounts = 0, complete;
    gate.open(done => done(null), () => mounts++);
    assert.equal(mounts, 1); assert.equal(h.covers.length, 0);
    gate.open(done => complete = done, () => mounts++);
    complete(new Error('断网')); h.frame(); await flush();
    assert.equal(mounts, 1); assert.equal(typeof h.covers[0].retry, 'function');
    h.covers[0].retry(); complete(null); h.frame(); h.frame(); await flush();
    assert.equal(mounts, 2);
    assert.equal(h.covers.length, 1); assert.equal(h.covers[0].presentation, 'transparent');
    assert.equal(h.covers[0].disposed, true);
    gate.open(done => complete = done, () => mounts++); const late = complete;
    gate.cancel(); late(null); h.frame(); await flush(); assert.equal(mounts, 2);
});

test('全部源图保留迁移身份，图集配置禁止旋转、误删动态子图与原纹理重复打包', () => {
    const result = auditUiAtlases();
    assert.equal(result.groups.length, 12); assert.equal(result.images, 179);
    assert.deepEqual(result.issues, []);
    if (result.pendingImport.length) assert.throws(() => assertUiAtlasPolicy(), /等待 Creator/);
    else assertUiAtlasPolicy();
});

test('比赛状态底图位于文字之前，避免逐控件交错切换纹理', () => {
    const source = fs.readFileSync('assets/scripts/ui/RaceHudStatusView.ts', 'utf8');
    assert.ok(source.indexOf("makeUiNode('StatusArtwork'") < source.indexOf("this.label(readouts, 'SpeedTitle'"));
    assert.ok(source.includes("this.sprite(readoutArt, 'EnergyBase'"));
    assert.ok(source.indexOf("this.sprite(this.top, 'ProgressTrack'") < source.indexOf("this.distance = this.label(this.top"));
});

test('首次导入的自动裁切圆环必须修复并重新导入；仅改 trimType 或遗留 offset 都不能通过审计', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-ui-atlas-trim-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directory = path.join(root, 'assets/race/ui/race-hud');
    fs.mkdirSync(directory, { recursive: true }); fs.mkdirSync(path.join(root, 'config')); fs.mkdirSync(path.join(root, 'scripts'));
    const spec = JSON.parse(fs.readFileSync('config/ui-atlases.json', 'utf8')).groups['race-hud'];
    fs.writeFileSync(path.join(root, 'config/ui-atlases.json'), JSON.stringify({ groups: { 'race-hud': spec }, assets: {} }));
    for (const file of ['atlas.pac', 'atlas.pac.meta', 'status-ring.png', 'status-ring.png.meta']) fs.copyFileSync(path.join('assets/race/ui/race-hud', file), path.join(directory, file));
    syncUiAtlasExports(root);
    const metaFile = path.join(directory, 'status-ring.png.meta'), meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const frame = Object.values(meta.subMetas).find(sub => sub.importer === 'sprite-frame').userData;
    Object.assign(frame, { trimType: 'auto', width: 76, height: 64, rawWidth: 76, rawHeight: 76, offsetX: 0, offsetY: 6, trimX: 0, trimY: 0 });
    const save = () => fs.writeFileSync(metaFile, JSON.stringify(meta));
    save(); assert.throws(() => assertUiAtlasPolicy(root), /trimType/);
    const result = auditUiAtlases(root, { fix: true });
    assert.equal(result.changed, 1); assert.equal(result.pendingImport.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(metaFile, 'utf8')).subMetas.f9941.userData.height, 64, '修复不能编造 Creator 导入几何');
    assert.throws(() => assertUiAtlasPolicy(root), /等待 Creator 重新导入/);
    Object.assign(frame, { trimType: 'none', height: 76 }); save();
    assert.throws(() => assertUiAtlasPolicy(root), /偏移未更新/);
    frame.offsetY = 0; save(); assertUiAtlasPolicy(root);
});

test('构建必须包含全部可加载图集，拒绝遗漏图集、源图重复打包和混杂旧配置', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swimming-ui-atlas-build-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'config')); fs.mkdirSync(path.join(root, 'out/subpackages/ui'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config/ui-atlases.json'), JSON.stringify({ groups: { common: { atlas: 'ui/common/atlas' } } }));
    const file = path.join(root, 'out/subpackages/ui/config.a123.json');
    const bundle = { types: ['cc.SpriteAtlas', 'cc.Texture2D', 'cc.SpriteFrame', 'cc.ImageAsset'],
        paths: { 0: ['common/atlas', 0], 1: ['common/avatar-base/spriteFrame', 2] } };
    const save = () => fs.writeFileSync(file, JSON.stringify(bundle));
    save(); assert.deepEqual(assertBuiltUiAtlases(root, path.join(root, 'out')), { groups: 1 });
    delete bundle.paths[0]; save(); assert.throws(() => assertBuiltUiAtlases(root, path.join(root, 'out')), /缺少可加载图集/);
    bundle.paths[0] = ['common/atlas', 0];
    for (const info of [['common/avatar-base/texture', 1], ['common/avatar-base', 3]]) {
        bundle.paths[2] = info; save(); assert.throws(() => assertBuiltUiAtlases(root, path.join(root, 'out')), /源散图纹理/);
    }
    delete bundle.paths[2]; save(); fs.copyFileSync(file, path.join(path.dirname(file), 'config.old.json'));
    assert.throws(() => assertBuiltUiAtlases(root, path.join(root, 'out')), /唯一/);
});

test('PS 导出映射由清单同步且幂等，194 张迁移资源路径完整；废弃素材不会复活', () => {
    assert.equal(syncUiAtlasExports(), false);
    const config = JSON.parse(fs.readFileSync('config/ui-atlases.json', 'utf8'));
    const source = fs.readFileSync('scripts/ui-atlas-export-paths.jsx', 'utf8');
    const context = vm.createContext({}); vm.runInContext(source, context);
    assert.equal(Object.keys(context.UI_ATLAS_EXPORT_PATHS).length, 194);
    for (const [oldPath, asset] of Object.entries(config.assets)) assert.equal(context.UI_ATLAS_EXPORT_PATHS[oldPath], asset.path);
    assert.equal(context.uiAtlasExportFile('.', 'career-v1', 'cup'), null);
    for (const file of fs.readdirSync('scripts').filter(name => /^export-.*\.jsx$/.test(name))) {
        new vm.Script(fs.readFileSync(path.join('scripts', file), 'utf8').replace(/^#.*$/gm, ''), { filename: file });
    }
});


test('Windows 换行的 PS 导出清单内容相同时不误报过期，也不触发重写', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'swimming-atlas-line-ending-'));
    try {
        fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'scripts'));
        const config={assets:{'old/icon.png':{path:'common/icon.png'}},groups:{}};
        fs.writeFileSync(path.join(root,'config/ui-atlases.json'),JSON.stringify(config));
        syncUiAtlasExports(root);
        const file=path.join(root,'scripts/ui-atlas-export-paths.jsx');
        const crlf=fs.readFileSync(file,'utf8').replace(/\n/g,'\r\n');fs.writeFileSync(file,crlf);
        assert.equal(syncUiAtlasExports(root),false);
        assert.equal(auditUiAtlases(root).issues.some(issue=>issue.includes('PS 导出路径已过期')),false);
        assert.equal(fs.readFileSync(file,'utf8'),crlf);
        fs.writeFileSync(file,crlf.replace('common/icon.png','common/old.png'));
        assert.ok(auditUiAtlases(root).issues.some(issue=>issue.includes('PS 导出路径已过期')));
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});
