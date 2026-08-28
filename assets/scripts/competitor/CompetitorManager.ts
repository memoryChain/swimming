import { Color, Node } from 'cc';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { LaneLayout } from '../venue/LaneLayout';
import { RaceCourseLayout } from '../venue/RaceCourseLayout';
import { defaultSwimmerColorVariant, SWIMMER_COLOR_VARIANTS } from '../core/ResourcePaths';
import { getRaceDifficultyConfig } from '../core/GameBalance';
import { shuffleInPlace } from '../core/SharedRNG';
import { PlayerData } from '../backend/PlayerData';
import { PLAYER_SKIN_TONES } from '../app/PlayerCharacterConfig';
import { AICompetitorProfile, buildRandomizedAiRoster, getAiPersonality } from './CompetitorConfig';
import { randomAiModelVariantId, SwimmerFactory } from './SwimmerFactory';
import { getDolphinJumpProfile } from '../core/DolphinJumpConfig';

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
        const playerSwimmer = this.createPlayer(group);
        const ai = this.populateAiLanes(group);

        return {
            playerSwimmer,
            primaryAiController: ai.primaryAiController,
            aiControllers: ai.aiControllers,
            aiSwimmers: ai.aiSwimmers,
        };
    }

    buildPlayer(root: Node): { group: Node; playerSwimmer: Swimmer } {
        const group = makeWorldNode('Swimmers3D', root);
        const playerSwimmer = this.createPlayer(group);
        return { group, playerSwimmer };
    }

    buildAi(group: Node, options?: AiBuildOptions): Omit<CompetitorSet, 'playerSwimmer'> {
        return this.populateAiLanes(group, options);
    }

    // Re-roll the roster onto already-spawned AI swimmers. Each lane is handed a
    // fresh difficulty profile, matching name, and a re-randomized look (model +
    // suit color + skin tone), so tapping "再来一次" reshuffles the opponents, their
    // appearance, and their lane positions without rebuilding the scene.
    reassignAiRoster(
        aiSwimmers: Swimmer[],
        aiControllers: AISwimmerController[],
        difficultyOverride?: number,
    ) {
        const count = Math.min(aiSwimmers.length, aiControllers.length);
        const roster = buildRandomizedAiRoster(count);
        const colorVariantIds = shuffledAiColorVariantIds(defaultSwimmerColorVariant().id);
        const skinColors = shuffledAiSkinColors();
        for (let i = 0; i < count; i++) {
            const entry = roster[i];
            aiSwimmers[i].swimmerName = entry.name;
            this.applyProfile(aiControllers[i], aiSwimmers[i], entry.profile, difficultyOverride);
            this.reassignAppearance(
                aiSwimmers[i],
                colorVariantIds[i % colorVariantIds.length],
                skinColors[i % skinColors.length],
            );
        }
    }

    private reassignAppearance(
        swimmer: Swimmer,
        colorVariantId: string,
        skinColor: readonly [number, number, number],
    ) {
        const rig = swimmer.cartoonRig;
        if (!rig) {
            return;
        }
        rig.setModelVariant(randomAiModelVariantId());
        rig.setColorVariant(colorVariantId);
        rig.setColorOverride({ skin: new Color(skinColor[0], skinColor[1], skinColor[2]) });
    }

    private populateAiLanes(group: Node, options?: AiBuildOptions): Omit<CompetitorSet, 'playerSwimmer'> {
        const aiControllers: AISwimmerController[] = [];
        const aiSwimmers: Swimmer[] = [];
        let primaryAiController: AISwimmerController | null = null;
        const aiLanes = this.aiLaneIndices(options?.soloLane);
        const roster = buildRandomizedAiRoster(aiLanes.length);
        const playerColorVariantId = defaultSwimmerColorVariant().id;
        const aiColorVariantIds = shuffledAiColorVariantIds(playerColorVariantId);
        const aiSkinColors = shuffledAiSkinColors();

        aiLanes.forEach((lane, index) => {
            const entry = roster[index];
            const swimmer = this._factory.create(group, {
                name: `AISwimmerLane${lane + 1}`,
                x: this._options.courseLayout.startX,
                y: this._options.courseLayout.swimY,
                z: this._options.laneLayout.centerZ(lane),
                isAI: true,
                colorVariantId: aiColorVariantIds[index % aiColorVariantIds.length],
                skinColor: aiSkinColors[index % aiSkinColors.length],
                displayName: entry.name,
            });
            swimmer.configureCourse(this._options.courseLayout);
            const controller = swimmer.node.addComponent(AISwimmerController);
            this.applyProfile(controller, swimmer, entry.profile, options?.difficultyOverride);
            aiSwimmers.push(swimmer);
            aiControllers.push(controller);
            if (lane === this._options.primaryAiLaneIndex || options?.soloLane !== undefined) {
                primaryAiController = controller;
            }
        });

        return {
            primaryAiController,
            aiControllers,
            aiSwimmers,
        };
    }

    private aiLaneIndices(soloLane?: number): number[] {
        const lanes: number[] = [];
        for (let lane = 0; lane < this._options.laneLayout.laneCount; lane++) {
            if (lane === this._options.playerLaneIndex) {
                continue;
            }
            // Solo mode (100m AI debug): build only the one opponent lane.
            if (soloLane !== undefined && lane !== soloLane) {
                continue;
            }
            lanes.push(lane);
        }
        return lanes;
    }

    private applyProfile(
        controller: AISwimmerController,
        swimmer: Swimmer,
        profile: AICompetitorProfile,
        difficultyOverride?: number,
    ) {
        controller.swimmer = swimmer;
        controller.difficulty = difficultyOverride ?? scaledRaceDifficulty(profile.difficulty);
        controller.bpmOffset = profile.bpmOffset;
        controller.divePower = profile.divePower;
        controller.diveReaction = profile.diveReaction;
        controller.personality = getAiPersonality(profile.personalityId);
        swimmer.motor.setWeight(profile.weight ?? 1);
        swimmer.setEnergyGainAptitude(profile.energyGain ?? 80);
        swimmer.setDolphinJumpProfile(
            profile.dolphinProfileId ? getDolphinJumpProfile(profile.dolphinProfileId) : null,
        );
    }

    private createPlayer(group: Node): Swimmer {
        const swimmer = this._factory.create(group, {
            name: 'PlayerSwimmer3D',
            x: this._options.courseLayout.startX,
            y: this._options.courseLayout.swimY,
            z: this._options.laneLayout.centerZ(this._options.playerLaneIndex),
            isAI: false,
            colorVariantId: defaultSwimmerColorVariant().id,
            displayName: PlayerData.nickName,
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
    return shuffleInPlace(ids);
}

function shuffledAiSkinColors(): Array<readonly [number, number, number]> {
    const colors = PLAYER_SKIN_TONES.map((tone) => tone.color);
    return shuffleInPlace(colors);
}

function makeWorldNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = parent.layer;
    return node;
}
