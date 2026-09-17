# 兴奋剂药剂视觉方向

`stimulant-potion-style-reference-v1.png` 是 2026-09-17 确认的 Blender 建模风格参考，不是运行时纹理。

建模时保留以下核心特征：

- 粗大、易辨认的低多边形药剂瓶轮廓；
- 荧光绿色外壳、橙红色能量核心、深蓝色瓶盖；
- 正面使用白色闪电立体标志，不烘焙文字；
- 使用少量纯色材质，不依赖高分辨率纹理或真实玻璃效果；
- 以比赛跟随镜头中的远距离辨识度为优先，不照搬参考图中的泳池背景；
- 目标约 100～300 个三角面，适合微信小游戏运行时。

## 结构与比例

- 主体由扁厚多边形绿色外框和内嵌橙红核心组成；
- 短瓶颈分别与瓶身、瓶盖保持明确重叠，不留下悬空间隙；
- 深蓝色瓶盖采用 8 边截面；
- 正反两面都放置凸出的白色闪电，保证旋转到背面仍可辨认；
- 全部部件合并为一个网格，使用一个材质和顶点颜色。

## 重建与导出

建模源文件和运行时 GLTF 均由 `build_stimulant_potion.py` 确定性生成。Windows 示例：

```powershell
& "F:\blender\Blender 5.2.0\5.2\python\bin\python.exe" scripts/run-blender.py `
  --blender "F:\blender\Blender 5.2.0\blender.exe" -- `
  --python art/stimulant-potion/build_stimulant_potion.py
```

脚本保存 `StimulantPotion.blend`，并导出到
`assets/race/items/StimulantBottle.gltf`。运行时资源继续使用原有 `.meta`。
