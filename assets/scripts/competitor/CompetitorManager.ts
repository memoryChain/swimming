import { Node } from 'cc';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { LaneLayout } from '../venue/LaneLayout';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { defaultSwimmerColorVariant, SWIMMER_COLOR_VARIANTS } from '../core/ResourcePaths';
import { getRaceDifficultyConfig } from '../core/GameBalance';
import { PLAYER_SKIN_TONES } from '../app/PlayerCharacterConfig';
import { DEFAULT_AI_PROFILES, getAiPersonality, shuffledAiCompetitorNames } from './CompetitorConfig';
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

// Options for building AI opponents. Used by the 100m AI-debug 1v1 mode to spawn
// a single opponent in one lane with a chosen difficulty.
export type AiBuildOptions = {
    soloLane?: number;
    difficultyOverride?: number;
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

    buildAi(group: Node, options?: AiBuildOptions): Omit<CompetitorSet, 'playerSwimmer'> {
        const aiControllers: AISwimmerController[] = [];
        const aiSwimmers: Swimmer[] = [];
        let primaryAiController: AISwimmerController | null = null;
        const playerColorVariantId = defaultSwimmerColorVariant().id;
        const aiColorVariantIds = shuffledAiColorVariantIds(playerColorVariantId);
        const aiSkinColors = shuffledAiSkinColors();
        const aiNames = shuffledAiCompetitorNames();
        let aiNameIndex = 0;
        let aiColorIndex = 0;
        let aiSkinIndex = 0;

        for (let lane = 0; lane < this._options.laneLayout.laneCount; lane++) {
            if (lane === this._options.playerLaneIndex) {
                continue;
            }
            // Solo mode (100m AI debug): build only the one opponent lane.
            if (options?.soloLane !== undefined && lane !== options.soloLane) {
                continue;
            }
            const swimmer = this._factory.create(group, {
                name: `AISwimmerLane${lane + 1}`,
                x: this._options.courseLayout.startX,
                y: this._options.courseLayout.swimY,
                z: this._options.laneLayout.centerZ(lane),
                isAI: true,
                colorVariantId: aiColorVariantIds[aiColorIndex++ % aiColorVariantIds.length],
                skinColor: aiSkinColors[aiSkinIndex++ % aiSkinColors.length],
                displayName: aiNames[aiNameIndex++ % aiNames.length],
            });
            swimmer.configureCourse(this._options.courseLayout);
            const profile = DEFAULT_AI_PROFILES[lane % DEFAULT_AI_PROFILES.length];
            const controller = swimmer.node.addComponent(AISwimmerController);
            controller.swimmer = swimmer;
            controller.difficulty = options?.difficultyOverride ?? scaledRaceDifficulty(profile.difficulty);
            controller.bpmOffset = profile.bpmOffset;
            controller.divePower = profile.divePower;
            controller.diveReaction = profile.diveReaction;
            controller.personality = getAiPersonality(profile.personalityId);
            aiSwimmers.push(swimmer);
            aiControllers.push(controller);
            if (lane === this._options.primaryAiLaneIndex || options?.soloLane !== undefined) {
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
        const playerColorVariantId = defaultSwimmerColorVariant().id;
        const aiColorVariantIds = shuffledAiColorVariantIds(playerColorVariantId);
        const aiSkinColors = shuffledAiSkinColors();
        const aiNames = shuffledAiCompetitorNames();
        let aiNameIndex = 0;
        let aiColorIndex = 0;
        let aiSkinIndex = 0;

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
                skinColor: aiSkinColors[aiSkinIndex++ % aiSkinColors.length],
                displayName: aiNames[aiNameIndex++ % aiNames.length],
            });
            swimmer.configureCourse(this._options.courseLayout);
            const profile = DEFAULT_AI_PROFILES[lane % DEFAULT_AI_PROFILES.length];
            const controller = swimmer.node.addComponent(AISwimmerController);
            controller.swimmer = swimmer;
            controller.difficulty = scaledRaceDifficulty(profile.difficulty);
            controller.bpmOffset = profile.bpmOffset;
            controller.divePower = profile.divePower;
            controller.diveReaction = profile.diveReaction;
            controller.personality = getAiPersonality(profile.personalityId);
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
            colorVariantId: defaultSwimmerColorVariant().id,
            displayName: 'YOU',
        });
        swimmer.configureCourse(this._options.courseLayout);
        return swimmer;
    }
}

function scaledRaceDifficulty(baseDifficulty: number): number {
    const scale = getRaceDifficultyConfig().aiDifficultyScale;
    return Math.max(0, Math.min(1, baseDifficulty * scale));
}

function shuffledAiColorVariantIds(playerVariantId: string): string[] {
    const ids = SWIMMER_COLOR_VARIANTS
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

function shuffledAiSkinColors(): Array<readonly [number, number, number]> {
    const colors = PLAYER_SKIN_TONES.map((tone) => tone.color);
    for (let i = colors.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const value = colors[i];
        colors[i] = colors[j];
        colors[j] = value;
    }
    return colors;
}

function makeWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = parent.layer;
    return node;
}
