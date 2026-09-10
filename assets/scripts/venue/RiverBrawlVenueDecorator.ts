import { Color, Material, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { RaceCourseLayout } from './RaceCourseLayout';
import { buildRiverBrawlEnvironment } from './RiverBrawlEnvironment';

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
    buildRiverBrawlEnvironment(pool, course, raceDistance);
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

function buildFinishMarker(pool: Node, course: RaceCourseLayout, raceDistance: number): void {
    const marker = new Node('RiverBrawlFinishMarker');
    marker.setParent(pool);
    course.coursePosition(raceDistance, 0, course.waterY + 0.035, _finishPosition);
    marker.setWorldPosition(_finishPosition);
    marker.setWorldRotationFromEuler(0, course.courseYawDegrees(raceDistance, 0), 0);
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

function visit(root: Node, callback: (node: Node) => void): void {
    callback(root);
    for (const child of root.children) visit(child, callback);
}

const _finishPosition = new Vec3();
