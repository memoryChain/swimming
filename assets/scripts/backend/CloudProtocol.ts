/** 客户端与云函数共同编译；经济规则变更时递增 rulesVersion 并同步部署。 */
export const CLOUD_PROTOCOL = { version: 1, rulesVersion: 2 } as const;

export interface CloudRequest {
    protocol: number;
    rulesVersion: number;
    action: string;
    data: any;
    writerId: string;
    requestId?: string;
    expectedRevision?: number;
}

export interface CloudResponse {
    ok: boolean;
    code?: string;
    message?: string;
    playerId?: string;
    uid?: number;
    revision?: number;
    profile?: import('./PlayerProfile').PlayerProfile;
    /** 独立全局配置，只在读档时下发，不属于玩家存档。 */
    featureFlags?: { tutorialEnabled: boolean };
    result?: any;
}
