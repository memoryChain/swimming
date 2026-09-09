import { Color, Material, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { RIVER_BRAWL_BALANCE } from '../core/RiverBrawlBalance';
import { RaceCourseLayout } from './RaceCourseLayout';

// The physical 50m course geometry must go, otherwise it intersects the river
// after the swimmers pass its original finish. Only the dynamic start blocks
// remain as a launch landmark; the deck and poolside props would read as a
// truncated 50m venue beside an otherwise open river.
const HIDDEN_VENUE_PREFIXES = [
    'pool_edge_batch',
    'lane_float_rope',
    'lane_floor_line',
    'lane_t_end',
    'pool_inner_wall',
    'pool_tile_grout',
    'venue_rectangular_ground',
    'poolsideprops_merged',
    'bleacher',
    'cornerstands',
    'standstructure',
    'standarchitecture',
    'olympicpanels',
    'ceiling',
    'award_podium',
    'scoreboard',
    'spectator_',
];

export function decorateRiverBrawlVenue(pool: Node, course: RaceCourseLayout, raceDistance: number): void {
    hideVenueScenery(pool);
    const startX = course.poolStartX;
    const finishX = course.distanceToWorldX(raceDistance)
        + course.direction * RIVER_BRAWL_BALANCE.venueEndPadding;
    stretchToWorldRange(findNode(pool, 'PoolWaterSurface'), startX, finishX);
    stretchToWorldRange(findNode(pool, 'pool_floor'), startX, finishX);
    buildFinishMarker(pool, course, raceDistance);
}

function hideVenueScenery(root: Node): void {
    visit(root, (node) => {
        const name = node.name.toLowerCase();
        if (HIDDEN_VENUE_PREFIXES.some((prefix) => name.startsWith(prefix)) && node.active) {
            node.active = false;
        }
    });
}

function stretchToWorldRange(node: Node | null, firstX: number, lastX: number): void {
    if (!node?.isValid) return;
    const bounds = worldBounds(node);
    if (!bounds || bounds.length <= 0.001) return;
    const targetMinX = Math.min(firstX, lastX);
    const targetMaxX = Math.max(firstX, lastX);
    const ratio = (targetMaxX - targetMinX) / bounds.length;
    const pivot = node.worldPosition;
    const scale = node.worldScale;
    node.setWorldScale(scale.x * ratio, scale.y, scale.z);
    const alignedPivotX = targetMinX + (pivot.x - bounds.minX) * ratio;
    node.setWorldPosition(alignedPivotX, pivot.y, pivot.z);
}

function buildFinishMarker(pool: Node, course: RaceCourseLayout, raceDistance: number): void {
    const marker = new Node('RiverBrawlFinishMarker');
    marker.setParent(pool);
    marker.setWorldPosition(
        course.distanceToWorldX(raceDistance),
        course.waterY + 0.035,
        0,
    );
    const renderer = marker.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(primitives.box({
        width: 0.16,
        height: 0.05,
        length: course.poolWidth,
    }));
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit' });
    material.setProperty('mainColor', new Color(255, 224, 92, 255));
    renderer.setMaterial(material, 0);
}

function findNode(root: Node, name: string): Node | null {
    if (root.name.toLowerCase() === name.toLowerCase()) return root;
    for (const child of root.children) {
        const found = findNode(child, name);
        if (found) return found;
    }
    return null;
}

function visit(root: Node, callback: (node: Node) => void): void {
    callback(root);
    for (const child of root.children) visit(child, callback);
}

function worldBounds(node: Node): { minX: number; length: number } | null {
    const renderer = node.getComponent(MeshRenderer);
    const model = (renderer as unknown as {
        model?: { worldBounds?: { center?: Vec3; halfExtents?: Vec3 } };
    })?.model;
    const halfExtents = model?.worldBounds?.halfExtents;
    return halfExtents ? {
        minX: model!.worldBounds!.center.x - halfExtents.x,
        length: halfExtents.x * 2,
    } : null;
}
