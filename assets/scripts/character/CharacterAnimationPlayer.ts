import { SkeletalAnimation } from 'cc';

const FREESTYLE_CLIP_NAME = 'FreestyleFull';

export class CharacterAnimationPlayer {
    private _animation: SkeletalAnimation | null = null;

    bind(animation: SkeletalAnimation | null) {
        this._animation = animation;
        if (this._animation) {
            this._animation.useBakedAnimation = false;
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

    stop() {
        this._animation?.stop();
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
        return this._animation.clips.find((item) => item?.name === FREESTYLE_CLIP_NAME)
            || this._animation.defaultClip
            || this._animation.clips[0]
            || null;
    }
}
