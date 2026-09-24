// 首屏使用的路径独立成小表；完整 ResourcePaths 复用此表，不能反向依赖业务包。
export const STARTUP_RESOURCES = {
    codeBundle: 'gameplay',
    fontBundle: 'startup-ui',
    font: 'ShuiMasterUI-Startup',
    loginUi: {
        background: 'ui/paddle-master-login-v8/background/texture',
        logo: 'ui/paddle-master-login-v8/logo/texture',
        primaryButton: 'ui/paddle-master-login-v8/primary-button/texture',
        primaryArrow: 'ui/paddle-master-login-v8/primary-arrow/texture',
        onlineButton: 'ui/paddle-master-login-v8/online-button/texture',
    },
    music: {
        bundle: 'music', login: 'login_ripples', race: 'race_current', result: 'result_sunlit_podium',
        strokeSfx: ['sfx/stroke_water_01'],
    },
} as const;
