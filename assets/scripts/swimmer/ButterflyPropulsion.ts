/** 蝶泳独立推进预算。累计曲线跨帧消费，末帧不会多支付；无引擎依赖或逐帧分配。 */
export class ButterflyPropulsion {
    private elapsed = 0;
    private duration = 1;
    private budget = 0;

    get active(): boolean { return this.elapsed < this.duration && this.budget > 0; }
    get impulseBudget(): number { return this.budget; }

    start(impulse: number, seconds: number) {
        this.elapsed = 0;
        this.duration = Number.isFinite(seconds) ? Math.max(0.001, seconds) : 1;
        this.budget = Number.isFinite(impulse) ? Math.max(0, impulse) : 0;
    }

    reset() { this.elapsed = 0; this.duration = 1; this.budget = 0; }

    consume(dt: number): number {
        if (!this.active || !Number.isFinite(dt) || dt <= 0) return 0;
        const before = this.elapsed / this.duration;
        this.elapsed = Math.min(this.duration, this.elapsed + dt);
        return this.budget * (this.cumulative(this.elapsed / this.duration) - this.cumulative(before)) / dt;
    }

    private cumulative(x: number): number {
        // 导数 12x(1-x)^2：起止为零，前三分之一达到峰值，随后平滑收力。
        return x * x * (6 + x * (-8 + 3 * x));
    }
}
