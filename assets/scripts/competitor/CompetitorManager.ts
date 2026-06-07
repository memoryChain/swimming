import { Node } from 'cc';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { LaneLayout } from '../venue/LaneLayout';
import { DEFAULT_AI_PROFILES, randomPlayerVisualProfile, shuffledAiVisualProfiles } from './CompetitorConfig';
import { SwimmerFactory } from './SwimmerFactory';

export type CompetitorBuildOptions = {
    laneLayout: LaneLayout;
    playerLaneIndex: number;
    primaryAiLaneIndex: number;
    debug?: (message: string) => void;
};

export type CompetitorSet = {
    playerSwimmer: Swimmer;
    primaryAiController: AISwimmerController | null;
    aiControllers: AISwimmerController[];
    aiSwimmers: Swimmer[];
};

export class CompetitorManager {
    private readonly _factory: SwimmerFactory;

    constructor(private readonly _options: CompetitorBuildOptions) {
        this._factory = new SwimmerFactory(_options.debug);
    }

    build(root: Node): CompetitorSet {
        const group = makeWorldNode('Swimmers3D', root);
        const aiControllers: AISwimmerController[] = [];
        const aiSwimmers: Swimmer[] = [];
        let playerSwimmer: Swimmer = null;
        let primaryAiController: AISwimmerController | null = null;
        const aiVisuals = shuffledAiVisualProfiles();
        let aiVisualIndex = 0;

        for (let lane = 0; lane < this._options.laneLayout.laneCount; lane++) {
            const isPlayer = lane === this._options.playerLaneIndex;
            const visual = isPlayer
                ? randomPlayerVisualProfile()
                : aiVisuals[aiVisualIndex++ % aiVisuals.length];
            const swimmer = this._factory.create(group, {
                name: isPlayer ? 'PlayerSwimmer3D' : `AISwimmerLane${lane + 1}`,
                x: 0,
                z: this._options.laneLayout.centerZ(lane),
                isAI: !isPlayer,
                suitColor: visual.suitColor,
                capColor: visual.capColor,
            });
            if (isPlayer) {
                playerSwimmer = swimmer;
                continue;
            }

            const profile = DEFAULT_AI_PROFILES[lane % DEFAULT_AI_PROFILES.length];
            const controller = swimmer.node.addComponent(AISwimmerController);
            controller.swimmer = swimmer;
            controller.difficulty = profile.difficulty;
            controller.bpmOffset = profile.bpmOffset;
            controller.divePower = profile.divePower;
            controller.diveReaction = profile.diveReaction;
            swimmer.aiPower = profile.power;
            swimmer.aiMaxSpeedScale = profile.maxSpeed;
            aiSwimmers.push(swimmer);
            aiControllers.push(controller);
            if (lane === this._options.primaryAiLaneIndex) {
                primaryAiController = controller;
            }
        }

        return {
            playerSwimmer,
            primaryAiController,
            aiControllers,
            aiSwimmers,
        };
    }
}

function makeWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = parent.layer;
    return node;
}
