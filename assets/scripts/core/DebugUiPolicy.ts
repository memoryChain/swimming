import { WECHAT } from 'cc/env';

// 微信小游戏的所有构建（含调试构建和开发者工具）都关闭调试入口。
// 其他平台保留原有 DEV / EDITOR 条件，本地预览仍可调试。
export const DEBUG_UI_ENABLED = !WECHAT;
