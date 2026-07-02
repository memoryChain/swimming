import { AnimationClip, SkeletalAnimation } from 'cc';
import { ANIMATION_CLIPS } from '../core/ResourcePaths';

export class CharacterAnimationPlayer {
    private _animation: SkeletalAnimation | null = null;

    bind(animation: SkeletalAnimation | null, useBakedAnimation = false) {
        this._animation = animation;
        if (this._animation) {
            this._animation.useBakedAnimation = useBakedAnimation;
        }
    }

    ensureAnimation(animation: SkeletalAnimation | null, useBakedAnimation = false) {
        if (this._animation || !animation) {
            return;
        }
        this.bind(animation, useBakedAnimation);
    }

    setUseBakedAnimation(useBakedAnimation: boolean) {
        if (!this._animation) {
            return;
        }
        this._animation.useBakedAnimation = useBakedAnimation;
    }

    addClip(clip: AnimationClip | null) {
        if (!this._animation || !clip) {
            return;
        }
        if (!this._animation.clips.some((item) => item?.name === clip.name)) {
            this._animation.clips = [...this._animation.clips, clip];
        }
        if (!this._animation.defaultClip) {
            this._animation.defaultClip = clip;
        }
    }

    playFreestyle(): boolean {
        if (!this._animation) {
            return false;
        }
        const clip = this.freestyleClip;
        if (!clip) {
            console.warn('[SpeedSwimming] freestyle animation missing clip');
            return false;
        }
        this._animation.enabled = true;
        this._animation.defaultClip = clip;
        this._animation.play(clip.name);
        const state = this._animation.getState(clip.name);
        if (state) {
            state.repeatCount = Infinity;
            state.speed = 1;
        }
        console.log(`[SpeedSwimming] playing freestyle clip=${clip.name}`);
        return true;
    }

    playClip(name: string, loop = true, speed = 1): boolean {
        if (!this._animation) {
            return false;
        }
        const clip = this._animation.clips.find((item) => item?.name === name)
            || this._animation.clips.find((item) => item?.name?.startsWith(name));
        if (!clip) {
            return false;
        }
        return this.playResolvedClip(clip.name, loop, speed);
    }

    playFirstClip(loop = true, speed = 1): boolean {
        if (!this._animation) {
            return false;
        }
        const clip = this._animation.defaultClip || this._animation.clips.find(Boolean);
        if (!clip) {
            console.warn('[SpeedSwimming] animation missing clip');
            return false;
        }
        return this.playResolvedClip(clip.name, loop, speed);
    }

    stop() {
        this._animation?.stop();
    }

    setSpeed(speed: number) {
        if (!this._animation) {
            return;
        }
        for (const clip of this._animation.clips) {
            if (!clip) {
                continue;
            }
            const state = this._animation.getState(clip.name);
            if (state) {
                state.speed = speed;
            }
        }
    }

    disable() {
        if (!this._animation) {
            return;
        }
        this._animation.stop();
        this._animation.enabled = false;
    }

    getFreestyleState() {
        if (!this._animation) {
            return null;
        }
        const clip = this.freestyleClip;
        return clip ? this._animation.getState(clip.name) : null;
    }

    getStateSummary(): string {
        if (!this._animation) {
            return 'animation=missing';
        }
        const clips = this._animation.clips.filter(Boolean);
        const stateParts = clips.map((clip) => {
            const state = this._animation!.getState(clip.name);
            if (!state) {
                return `${clip.name}:state=missing`;
            }
            const raw = state as unknown as {
                time?: number;
                duration?: number;
                speed?: number;
                isPlaying?: boolean;
                isMotionless?: boolean;
            };
            const time = typeof raw.time === 'number' ? raw.time.toFixed(2) : '-';
            const duration = typeof raw.duration === 'number' ? raw.duration.toFixed(2) : '-';
            const speed = typeof raw.speed === 'number' ? raw.speed.toFixed(2) : '-';
            const playing = typeof raw.isPlaying === 'boolean' ? raw.isPlaying : '-';
            const motionless = typeof raw.isMotionless === 'boolean' ? raw.isMotionless : '-';
            return `${clip.name}:t=${time}/${duration} speed=${speed} playing=${playing} motionless=${motionless}`;
        });
        return `animation=ok enabled=${this._animation.enabled} baked=${this._animation.useBakedAnimation} default=${this._animation.defaultClip?.name ?? '-'} clips=${this.clipNames} states=[${stateParts.join('; ')}]`;
    }

    get hasAnimation(): boolean {
        return !!this._animation;
    }

    get clipNames(): string {
        if (!this._animation) {
            return 'none';
        }
        return this._animation.clips.map((clip) => clip?.name || '-').join('|') || 'empty';
    }

    private get freestyleClip() {
        if (!this._animation) {
            return null;
        }
        return this._animation.clips.find((item) => item?.name === ANIMATION_CLIPS.freestyle)
            || this._animation.defaultClip
            || this._animation.clips[0]
            || null;
    }

    private playResolvedClip(name: string, loop: boolean, speed: number): boolean {
        if (!this._animation) {
            return false;
        }
        this._animation.enabled = true;
        this._animation.play(name);
        const state = this._animation.getState(name);
        if (state) {
            state.repeatCount = loop ? Infinity : 1;
            state.speed = speed;
            const raw = state as unknown as { sample?: () => void };
            raw.sample?.();
        }
        console.log(`[SpeedSwimming] playing animation clip=${name} loop=${loop} speed=${speed.toFixed(2)}`);
        return true;
    }
}
