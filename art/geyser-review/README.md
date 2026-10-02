# 海底喷泉动效审查

从正式 `GeyserBrawlPresentation.ts` 采样固定网格、顶点色和 30Hz 变换，生成独立浏览器审查页。没有另造一套展示用喷泉，也不启动或截图 Creator。

生成：

```powershell
npx.cmd --yes --package typescript@5.4.5 -c "node art/geyser-review/build-review.cjs"
```

打开 `.cache/geyser-review/review.html`，可暂停、拖动时间，并切换已提交喷泉／当前小口／大小同场／十口混排，以及头胸、腹髋、腿、左右侧和轻擦六种受力代理。大小对照使用同一水位和错峰规则，十口阵列消费正式大小分配函数；受力从正式 `GeyserReactionModel` 和 `ForcedLaunchModel` 采样，导出 `reaction-samples.json`。输出和审查图片放在缓存中，不进入游戏包。

`capture-review.cjs` 仅连接已打开的本地独立审查页，从画布导出八段时序图 `sequence.png` 和新旧／部位受力对照 `body-reactions.png`。默认地址为 `http://127.0.0.1:8769/review.html`，也可显式传入本次服务器地址：

```powershell
node art/geyser-review/capture-review.cjs http://127.0.0.1:50118/review.html
```

端口按实际服务替换，只接受 `127.0.0.1` 的 `review.html`。CDP 使用项目现有独立浏览器端口 18800；脚本不会启动浏览器，也不会访问其他页面。旧版网格取生成时的 Git `HEAD`，随提交变化，不代表永久冻结的历史基线。

此页使用简化水面、池底和三色方块身体。它只验证喷涌节奏及受力方向，不模拟真实骨骼、接触水花或肢体滞后，不能验证正式水面折射、透明排序、角色遮挡或微信设备帧耗。规则、当前预算和实际验证范围统一维护在 `docs/海底喷泉玩法与落地计划.zh.md`。
