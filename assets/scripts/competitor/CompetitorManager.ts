import { Node } from 'cc';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { LaneLayout } from '../venue/LaneLayout';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { SWIMMER_0621_2_COLOR_VARIANTS } from '../core/ResourcePaths';
import { DEFAULT_AI_PROFILES, shuffledAiCompetitorNames } from './CompetitorConfig';
import { SwimmerFactory } from './SwimmerFactory';

export type CompetitorBuildOptions = {
    laneLayout: LaneLayout;
    courseLayout: RaceCourseLayout;
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
        const competitors = this.buildPlayerAndAi(group);

        return {
            playerSwimmer: competitors.playerSwimmer,
            primaryAiController: competitors.primaryAiController,
            aiControllers: competitors.aiControllers,
            aiSwimmers: competitors.aiSwimmers,
        };
    }

    buildPlayer(root: Node): { group: Node; playerSwimmer: Swimmer } {
        const group = makeWorldNode('Swimmers3D', root);
        const playerSwimmer = this.createPlayer(group);
        return { group, playerSwimmer };
    }

    buildAi(group: Node): Omit<CompetitorSet, 'playerSwimmer'> {
        const aiControllers: AISwimmerController[] = [];
        const aiSwimmers: Swimmer[] = [];
        let primaryAiController: AISwimmerController | null = null;
        const playerColorVariantId = 'original';
        const aiColorVariantIds = shuffledAiColorVariantIds(playerColorVariantId);
        const aiNames = shuffledAiCompetitorNames();
        let aiNameIndex = 0;
        let aiColorIndex = 0;

        for (let lane = 0; lane < this._options.laneLayout.laneCount; lane++) {
            if (lane === this._options.playerLaneIndex) {
                continue;
            }
            const swimmer = this._factory.create(group, {
                name: `AISwimmerLane${lane + 1}`,
                x: this._options.courseLayout.startX,
                y: this._options.courseLayout.swimY,
                z: this._options.laneLayout.centerZ(lane),
                isAI: true,
                colorVariantId: aiColorVariantIds[aiColorIndex++ % aiColorVariantIds.length],
                displayName: aiNames[aiNameIndex++ % aiNames.length],
            });
            swimmer.configureCourse(this._options.courseLayout);
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
            primaryAiController,
            aiControllers,
            aiSwimmers,
        };
    }

    private buildPlayerAndAi(group: Node): CompetitorSet {
        const aiControllers: AISwimmerController[] = [];
        const aiSwimmers: Swimmer[] = [];
        let primaryAiController: AISwimmerController | null = null;
        const playerSwimmer = this.createPlayer(group);
        const playerColorVariantId = 'original';
        const aiColorVariantIds = shuffledAiColorVariantIds(playerColorVariantId);
        const aiNames = shuffledAiCompetitorNames();
        let aiNameIndex = 0;
        let aiColorIndex = 0;

        for (let lane = 0; lane < this._options.laneLayout.laneCount; lane++) {
            if (lane === this._options.playerLaneIndex) {
                continue;
            }
            const swimmer = this._factory.create(group, {
                name: `AISwimmerLane${lane + 1}`,
                x: this._options.courseLayout.startX,
                y: this._options.courseLayout.swimY,
                z: this._options.laneLayout.centerZ(lane),
                isAI: true,
                colorVariantId: aiColorVariantIds[aiColorIndex++ % aiColorVariantIds.length],
                displayName: aiNames[aiNameIndex++ % aiNames.length],
            });
            swimmer.configureCourse(this._options.courseLayout);
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

    private createPlayer(group: Node): Swimmer {
        const swimmer = this._factory.create(group, {
            name: 'PlayerSwimmer3D',
            x: this._options.courseLayout.startX,
            y: this._options.courseLayout.swimY,
            z: this._options.laneLayout.centerZ(this._options.playerLaneIndex),
            isAI: false,
            colorVariantId: 'original',
            displayName: 'YOU',
        });
        swimmer.configureCourse(this._options.courseLayout);
        return swimmer;
    }
}

function shuffledAiColorVariantIds(playerVariantId: string): string[] {
    const ids = SWIMMER_0621_2_COLOR_VARIANTS
        .map((variant) => variant.id)
        .filter((id) => id !== playerVariantId);
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const value = ids[i];
        ids[i] = ids[j];
        ids[j] = value;
    }
    return ids;
}

function makeWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = parent.layer;
    return node;
}
