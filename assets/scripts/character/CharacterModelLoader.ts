import { Component, Node, Prefab, SkinnedMeshRenderer } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

export type SwimmerPrefabLoadResult = {
    prefab: Prefab;
    path: string;
};

export function loadPrefabFromCandidates(
    candidates: readonly string[],
    done: (err: Error | null, result: SwimmerPrefabLoadResult | null) => void,
) {
    const failedAttempts: string[] = [];
    const tryPath = (index: number) => {
        if (index >= candidates.length) {
            const details = failedAttempts.length > 0 ? `; ${failedAttempts.join(' | ')}` : '';
            done(new Error(`prefab not imported yet; candidates=${candidates.join(', ')}${details}`), null);
            return;
        }
        const path = candidates[index];
        loadRaceAsset(path, Prefab, (err, prefab) => {
            if (!err && prefab) {
                done(null, { prefab, path });
                return;
            }
            failedAttempts.push(`${path}: ${err?.message ?? 'Prefab asset missing'}`);
            tryPath(index + 1);
        });
    };
    tryPath(0);
}

export function loadSwimmerPrefab(
    done: (err: Error | null, result: SwimmerPrefabLoadResult | null) => void,
    candidates = RESOURCE_PATHS.swimmerPrefabCandidates,
) {
    loadPrefabFromCandidates(candidates, done);
}

export function findNode(root: Node, name: string): Node | null {
    if (root.name === name) {
        return root;
    }
    for (const child of root.children) {
        const found = findNode(child, name);
        if (found) {
            return found;
        }
    }
    return null;
}

export function findComponentRecursive<T extends Component>(root: Node, type: new (...args: any[]) => T): T | null {
    const component = root.getComponent(type);
    if (component) {
        return component;
    }
    for (const child of root.children) {
        const found = findComponentRecursive(child, type);
        if (found) {
            return found;
        }
    }
    return null;
}

export function collectComponentsRecursive<T extends Component>(root: Node, type: new (...args: any[]) => T, out: T[]) {
    const component = root.getComponent(type);
    if (component) {
        out.push(component);
    }
    for (const child of root.children) {
        collectComponentsRecursive(child, type, out);
    }
}

export function setLayerRecursive(root: Node, layer: number) {
    root.layer = layer;
    for (const child of root.children) {
        setLayerRecursive(child, layer);
    }
}

export function isInsideNodeNamed(node: Node, name: string): boolean {
    for (let current: Node | null = node; current; current = current.parent) {
        if (current.name === name) {
            return true;
        }
    }
    return false;
}

export type SwimmerSkinnedRendererOptions = {
    useBakedAnimation?: boolean;
};

export function configureSwimmerSkinnedRenderers(model: Node, options: SwimmerSkinnedRendererOptions = {}): SkinnedMeshRenderer[] {
    const renderers: SkinnedMeshRenderer[] = [];
    collectComponentsRecursive(model, SkinnedMeshRenderer, renderers);
    const skinnedRenderers = renderers.filter((renderer) => !isInsideNodeNamed(renderer.node, 'CharacterOutlineShell'));
    const useBakedAnimation = options.useBakedAnimation === true;
    for (const renderer of skinnedRenderers) {
        renderer.skinningRoot = model;
        renderer.setUseBakedAnimation(useBakedAnimation, true);
        if (!useBakedAnimation) {
            renderer.uploadAnimation(null);
        }
    }
    return skinnedRenderers;
}

export function pruneNullComponentsRecursive(root: Node): number {
    let removed = pruneNullComponents(root);
    for (const child of root.children) {
        removed += pruneNullComponentsRecursive(child);
    }
    return removed;
}

export function pruneNullComponentsInParentChain(node: Node | null): number {
    let removed = 0;
    for (let current = node; current; current = current.parent) {
        removed += pruneNullComponents(current);
    }
    return removed;
}

export function pruneNullComponents(node: Node): number {
    const internals = node as unknown as { _components?: unknown[] };
    const components = internals._components;
    if (!Array.isArray(components)) {
        return 0;
    }

    const compacted = components.filter(Boolean);
    const removed = components.length - compacted.length;
    if (removed > 0) {
        internals._components = compacted;
    }
    return removed;
}
