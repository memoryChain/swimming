const { createImportedMeshHarness } = require('./imported-mesh-harness.cjs');

function createGeyserPresentationHarness(count = 10, waterY = 0.055, sourceFile) {
    const h = createImportedMeshHarness('geyser');
    const rules = h.loadModule('entertainment/GeyserBrawlRules');
    const { GeyserBrawlPresentation } = sourceFile ? h.load(sourceFile) : h.loadModule('entertainment/GeyserBrawlPresentation');
    const visual = new GeyserBrawlPresentation(h.root, 0, count, h.assets, waterY);
    return { ...h, visual, rules };
}
module.exports = { createGeyserPresentationHarness };
