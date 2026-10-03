const path = require('node:path');
const { createFixedMeshHarness } = require('./fixed-mesh-harness.cjs');
const { readGlbGeometry } = require('./glb-geometry.cjs');

function createImportedMeshHarness(group) {
    let loadOverride = null;
    const requests = [], prefabs = new Map();
    const h = createFixedMeshHarness({ '../core/RaceBundleLoader': { loadRaceAsset(assetPath, type, done) {
        requests.push(assetPath);
        if (loadOverride) loadOverride(assetPath, type, done);
        else done(null, prefabs.get(assetPath));
    } } });
    const paths = h.loadModule('core/ResourcePaths').RESOURCE_PATHS[group];
    const assets = {};
    for (const [part, assetPath] of Object.entries(paths)) {
        const name = assetPath.split('/').pop();
        assets[part] = new h.cc.Mesh(readGlbGeometry(path.resolve(__dirname, '../../assets/race/items', name + '.glb')).geometry);
        prefabs.set(assetPath, { data: { isValid: true, position: new h.Vec3(), rotation: new h.Quat(),
            scale: new h.Vec3(1,1,1), children: [], getComponentsInChildren() { return [{ mesh: assets[part] }]; } } });
    }
    h.cc.utils.createMesh = () => { throw new Error('已转换的特效不能在运行时创建网格'); };
    return { ...h, assets, requests, prefabs, setLoadOverride(value) { loadOverride = value; } };
}
module.exports = { createImportedMeshHarness };
