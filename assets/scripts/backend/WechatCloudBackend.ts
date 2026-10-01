import { sys } from 'cc';
import type { PlayerCharacterSelection } from '../app/PlayerCharacterConfig';
import type { CareerCommand, CareerResult } from '../progression/CareerRules';
import { CLOUD_PROTOCOL, CloudRequest, CloudResponse } from './CloudProtocol';
import type { AdRewardResult, IBackend, IdentityPatch, LevelSpendResult } from './IBackend';
import { PLAYER_PROFILE_SCHEMA, PlayerProfile } from './PlayerProfile';
import { WECHAT_CLOUD_CONFIG } from './WechatCloudConfig';

declare const wx: any;

/** 明确拒绝与网络结果不确定分开，后者保留原请求 ID 供下一次恢复。 */
export class CloudBackendError extends Error {
    constructor(readonly code: string, message: string, readonly definitive = false) { super(message); }
}

export class WechatCloudBackend implements IBackend {
    readonly name = 'wechat-cloud';
    private initialized = false;
    private playerId = '';
    private _uid: number | undefined;
    get uid(): number | undefined { return this._uid; }
    private revision = 0;
    private writerId = '';
    private lastProfile: PlayerProfile | null = null;
    private recovered: { request: CloudRequest; result: any } | null = null;
    private tutorialCompletedLocally = false;
    private tutorialSync: Promise<void> | null = null;
    private tutorialRetryAt = 0;
    private readonly prefix = `swimming.cloud.${WECHAT_CLOUD_CONFIG.environmentId}`;

    private initialize(): void {
        if (this.initialized) return;
        if (!WECHAT_CLOUD_CONFIG.environmentId) throw new CloudBackendError('NOT_CONFIGURED', '云存档尚未配置');
        if (typeof wx === 'undefined' || !wx.cloud?.init || !wx.cloud?.callFunction) {
            throw new CloudBackendError('UNSUPPORTED', '当前微信版本不支持云存档');
        }
        const key = `${this.prefix}.writer`;
        this.writerId = sys.localStorage.getItem(key) || this.newId();
        sys.localStorage.setItem(key, this.writerId);
        wx.cloud.init({ env: WECHAT_CLOUD_CONFIG.environmentId });
        this.initialized = true;
    }

    private newId(): string {
        // 只用于请求去重，不参与玩法随机数。
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    }

    private request(action: string, data: any): CloudRequest {
        return { protocol: CLOUD_PROTOCOL.version, rulesVersion: CLOUD_PROTOCOL.rulesVersion,
            action, data, writerId: this.writerId };
    }

    private async call(request: CloudRequest): Promise<CloudResponse> {
        return new Promise((resolve, reject) => {
            let done = false;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                reject(new CloudBackendError('TIMEOUT', '存档连接超时，请重试'));
            }, WECHAT_CLOUD_CONFIG.timeoutMs);
            const finish = (error: unknown, response?: CloudResponse) => {
                if (done) return;
                done = true; clearTimeout(timer);
                if (error) reject(error); else resolve(response!);
            };
            try {
                wx.cloud.callFunction({ name: WECHAT_CLOUD_CONFIG.functionName,
                    config: { env: WECHAT_CLOUD_CONFIG.environmentId }, data: request,
                    success: (res: { result?: CloudResponse }) => {
                        const r = res.result;
                        if (!r || typeof r.ok !== 'boolean') {
                            finish(new CloudBackendError('BAD_RESPONSE', '存档响应异常，请重试')); return;
                        }
                        finish(null, r);
                    },
                    fail: () => finish(new CloudBackendError('NETWORK', '存档连接失败，请重试')),
                });
            } catch (error) { finish(error); }
        });
    }

    private accept(response: CloudResponse): void {
        if (response.ok && !response.profile) throw new CloudBackendError('BAD_PROFILE', '存档响应异常，请重试');
        if (!response.profile) return;
        if (!response.playerId || !Number.isSafeInteger(response.revision) || response.revision! < 0
            || response.profile.schema !== PLAYER_PROFILE_SCHEMA) {
            throw new CloudBackendError('BAD_PROFILE', '存档版本不兼容，请更新游戏');
        }
        if (this.playerId && this.playerId !== response.playerId) {
            throw new CloudBackendError('ACCOUNT_CHANGED', '账号已变化，请重新进入游戏');
        }
        if (response.uid !== undefined && (!Number.isSafeInteger(response.uid) || response.uid < 10000
            || (this._uid !== undefined && this._uid !== response.uid))) {
            throw new CloudBackendError('BAD_PROFILE', '玩家编号异常，请重新进入游戏');
        }
        // 后台教学补传与前台读写可并发；迟到的旧响应不能倒退版本或覆盖新存档。
        if (this.lastProfile && response.revision! < this.revision) return;
        this._uid = response.uid ?? this._uid;
        this.playerId = response.playerId; this.revision = response.revision!;
        this.lastProfile = response.profile;
        if (response.profile.tutorialCompleted === true) this.rememberTutorialCompletion();
        else if (!this.tutorialCompletedLocally) {
            try { this.tutorialCompletedLocally = sys.localStorage.getItem(this.tutorialKey) === '1'; }
            catch { /* 本次会话仍可在完成教学时记录。 */ }
        }
        // 缓存仅用于诊断备份，不在身份验证或云端读取失败时冒充成功。
        try { sys.localStorage.setItem(`${this.prefix}.${this.playerId}.cache`, JSON.stringify(response)); }
        catch { /* 云端已提交；备份失败不能把本次成功变成重试发奖。 */ }
    }

    private get outboxKey(): string { return `${this.prefix}.${this.playerId}.pending`; }
    private get tutorialKey(): string { return `${this.prefix}.${this.playerId}.tutorial-completed`; }
    private get tutorialOutboxKey(): string { return `${this.prefix}.${this.playerId}.tutorial-pending`; }

    private rememberTutorialCompletion(): void {
        this.tutorialCompletedLocally = true;
        try { sys.localStorage.setItem(this.tutorialKey, '1'); }
        catch { console.warn('[CloudTutorial] LOCAL_STORAGE：教学完成状态暂存于本次会话'); }
    }

    private currentProfile(): PlayerProfile {
        const profile = this.lastProfile!;
        return this.tutorialCompletedLocally && profile.tutorialCompleted !== true
            ? { ...profile, tutorialCompleted: true } : profile;
    }

    private async sendPending(request: CloudRequest, mayRebaseSettlement = true): Promise<any> {
        const before = this.lastProfile;
        let response: CloudResponse | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
            try { response = await this.call(request); break; }
            catch (error) { if (attempt === 1) throw error; }
        }
        this.accept(response!);
        if (response!.code === 'CONFLICT' && mayRebaseSettlement && before?.tutorialCompleted === false
            && response!.profile?.tutorialCompleted === true
            && JSON.stringify({ ...before, tutorialCompleted: true }) === JSON.stringify(response!.profile)) {
            // 唯一变化是并发补传的教学标记；原业务输入仍适用，经济/赛事变化不走此分支。
            const rebased = { ...request, expectedRevision: this.revision };
            sys.localStorage.setItem(this.outboxKey, JSON.stringify(rebased));
            return this.sendPending(rebased, false);
        }
        if (response!.code === 'CONFLICT' && request.action === 'career' && request.data.type === 'settle'
            && this.lastProfile?.career.pending?.id === request.data.ticketId) {
            // 另一设备只修改头像等字段时，仍结算同一云端赛事，不丢掉合法比赛奖励。
            const rebased = { ...request, expectedRevision: this.revision };
            sys.localStorage.setItem(this.outboxKey, JSON.stringify(rebased));
            if (mayRebaseSettlement) return this.sendPending(rebased, false);
            throw new CloudBackendError('CONFLICT', '存档正在更新，稍后自动重试结算');
        }
        // INTERNAL 等服务端故障也可能处于未知提交状态，不能丢失幂等令牌。
        if (!response!.ok && response!.code === 'INTERNAL') {
            throw new CloudBackendError('INTERNAL', response!.message || '存档服务暂不可用');
        }
        sys.localStorage.removeItem(this.outboxKey);
        if (!response!.ok) {
            throw new CloudBackendError(response!.code || 'REJECTED', response!.message || '存档操作失败', true);
        }
        return { ...response!.result, profile: this.currentProfile() };
    }

    private pending(): CloudRequest | null {
        const raw = sys.localStorage.getItem(this.outboxKey);
        if (!raw) return null;
        try { return JSON.parse(raw); }
        catch { throw new CloudBackendError('LOCAL_PENDING', '本地待保存记录异常，请联系客服'); }
    }

    async loadProfile(): Promise<PlayerProfile> {
        this.initialize();
        const response = await this.call(this.request('load', {}));
        this.accept(response);
        if (!response.ok) throw new CloudBackendError(response.code || 'LOAD', response.message || '存档加载失败', true);
        if (!this.lastProfile) throw new CloudBackendError('BAD_PROFILE', '存档响应异常，请重试');
        const pending = this.pending();
        if (pending?.action === 'tutorialComplete') {
            // 升级前已完成教学但保存失败的记录，移出经济 outbox，避免继续卡住登录/开赛。
            this.rememberTutorialCompletion();
            try {
                sys.localStorage.setItem(this.tutorialOutboxKey, JSON.stringify(pending));
                sys.localStorage.removeItem(this.outboxKey);
            } catch { console.warn('[CloudTutorial] LOCAL_STORAGE：保留旧教学待同步记录'); }
        } else if (pending) {
            try { this.recovered = { request: pending, result: await this.sendPending(pending) }; }
            catch (error) {
                // 已明确拒绝的旧请求不能阻塞账号永远登录；保留当前云端真值。
                if (!(error instanceof CloudBackendError) || !error.definitive) throw error;
            }
        }
        void this.syncTutorialCompletion(true);
        return this.currentProfile();
    }

    private async mutate(action: string, data: any): Promise<any> {
        this.initialize();
        if (!this.playerId) await this.loadProfile();
        if (this.recovered) {
            const recovered = this.recovered; this.recovered = null;
            if (recovered.request.action === action && JSON.stringify(recovered.request.data) === JSON.stringify(data)) {
                return { ...recovered.result, profile: this.currentProfile() };
            }
        }
        const prior = this.pending();
        if (prior && prior.action !== 'tutorialComplete') {
            const result = await this.sendPending(prior);
            if (prior.action === action && JSON.stringify(prior.data) === JSON.stringify(data)) return result;
        }
        const request = { ...this.request(action, data), requestId: this.newId(), expectedRevision: this.revision };
        // 先持久化，再发送。写入失败时不发请求，避免重启后重复扣币。
        sys.localStorage.setItem(this.outboxKey, JSON.stringify(request));
        const result = await this.sendPending(request);
        // 成功业务请求证明服务已恢复；补传不加入前台事务队列，也不延迟导航。
        void this.syncTutorialCompletion(true);
        return result;
    }

    async completeTutorial(): Promise<PlayerProfile> {
        this.initialize();
        if (!this.playerId) await this.loadProfile();
        this.rememberTutorialCompletion();
        void this.syncTutorialCompletion();
        return this.currentProfile();
    }

    /** 只补传单调的完成标记，失败保留本地状态，绝不阻塞玩家流程。 */
    syncTutorialCompletion(retryNow = false): Promise<void> {
        if (this.tutorialSync) return this.tutorialSync;
        if (!this.playerId || !this.tutorialCompletedLocally || (!retryNow && Date.now() < this.tutorialRetryAt)) return Promise.resolve();
        if (this.lastProfile?.tutorialCompleted === true) {
            try { sys.localStorage.removeItem(this.tutorialOutboxKey); } catch { /* 已由云端确认。 */ }
            return Promise.resolve();
        }
        this.tutorialSync = this.sendTutorialCompletion().catch(error => {
            this.tutorialRetryAt = Date.now() + 30000;
            // 不输出档案或账号 ID；明确显示云端错误码便于真机定位。
            console.warn('[CloudTutorial] 教学进度已保存在本地，稍后补传',
                error instanceof CloudBackendError ? error.code : 'LOCAL_STORAGE');
        }).then(() => { this.tutorialSync = null; });
        return this.tutorialSync;
    }

    private async sendTutorialCompletion(): Promise<void> {
        const foreground = this.pending();
        if (foreground && foreground.action !== 'tutorialComplete') return;
        this.rememberTutorialCompletion();
        let request: CloudRequest | null;
        const saved = sys.localStorage.getItem(this.tutorialOutboxKey);
        try { request = saved ? JSON.parse(saved) : foreground; } catch { request = null; }
        if (!request || request.action !== 'tutorialComplete' || Object.keys(request.data ?? {}).length !== 0
            || request.protocol !== CLOUD_PROTOCOL.version || request.rulesVersion !== CLOUD_PROTOCOL.rulesVersion) {
            request = { ...this.request('tutorialComplete', {}), requestId: this.newId(), expectedRevision: this.revision };
        }
        for (let attempt = 0; attempt < 2; attempt++) {
            try { sys.localStorage.setItem(this.tutorialOutboxKey, JSON.stringify(request)); }
            catch { /* 仅写入 true，无奖励/扣费；本地空间不足仍可安全重试云端。 */ }
            let response: CloudResponse;
            try { response = await this.call(request); }
            catch (error) { if (attempt === 0) continue; throw error; }
            this.accept(response);
            if (response.ok && this.lastProfile?.tutorialCompleted === true) {
                sys.localStorage.removeItem(this.tutorialOutboxKey);
                if (this.pending()?.action === 'tutorialComplete') sys.localStorage.removeItem(this.outboxKey);
                this.tutorialRetryAt = 0;
                return;
            }
            if (response.code === 'CONFLICT' && attempt === 0) {
                request = { ...request, expectedRevision: this.revision };
                continue;
            }
            throw new CloudBackendError(response.code || 'BAD_TUTORIAL', response.message || '教学进度尚未同步');
        }
    }

    executeCareer(command: CareerCommand): Promise<CareerResult> { return this.mutate('career', command); }
    spendCoinsForLevel(characterId: string, requestedLevels: number): Promise<LevelSpendResult> {
        return this.mutate('level', { characterId, requestedLevels });
    }
    async saveIdentity(identity: IdentityPatch): Promise<PlayerProfile> { return (await this.mutate('identity', identity)).profile; }
    async saveCharacterAppearance(appearance: PlayerCharacterSelection): Promise<PlayerProfile> {
        return (await this.mutate('appearance', appearance)).profile;
    }
    async saveCharacterSelection(selection: PlayerCharacterSelection): Promise<PlayerProfile> {
        return (await this.mutate('selection', selection)).profile;
    }
    async grantAdReward(): Promise<AdRewardResult> {
        // 广告入口目前未启用；缺少可信广告凭据时不可凭客户端完成回调发币。
        return { ok: false, granted: 0, reason: 'error', profile: await this.loadProfile() };
    }
    async grantDebugCoins(_amount: number): Promise<PlayerProfile> {
        throw new CloudBackendError('FORBIDDEN', '云存档请通过管理后台调整金币', true);
    }
    async saveProfile(_profile: PlayerProfile): Promise<PlayerProfile> {
        throw new CloudBackendError('FORBIDDEN', '云存档不支持整档覆盖', true);
    }
}
