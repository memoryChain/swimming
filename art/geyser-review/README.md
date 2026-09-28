# 海底喷泉动效审查

从正式 `GeyserBrawlPresentation.ts` 采样固定网格、顶点色和 30Hz 变换，生成独立浏览器审查页。没有另造一套展示用喷泉，也不启动或截图 Creator。

生成：

```powershell
npx.cmd --yes --package typescript@5.4.5 -c "node art/geyser-review/build-review.cjs"
```

打开 `.cache/geyser-review/review.html`，可暂停、拖动时间，并切换单口过程／十口阵列。输出和审查图片放在缓存中，不进入游戏包。

`capture-review.cjs` 仅连接已打开的 `http://127.0.0.1:8769/review.html` 独立审查页，从画布导出八段时序图 `.cache/geyser-review/sequence.png`。CDP 使用项目现有独立浏览器端口 18800；脚本不会启动浏览器，也不会访问其他页面。

此页使用简化水面和池底，不能验证正式水面折射、透明排序、角色遮挡或微信设备帧耗。规则、当前预算和实际验证范围统一维护在 `docs/海底喷泉玩法与落地计划.zh.md`。
