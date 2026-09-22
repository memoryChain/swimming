// 导出共享全景原图；原样复制，不改像素、色彩信息或已有Creator元数据。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.resolve(root, process.argv[2] || 'art/shared-lobby-scene/panorama-source.png');
const target = path.join(root, 'assets/race/ui/lobby-b/background.png');
if (!fs.existsSync(source)) throw new Error('缺少全景源图，请按 docs/大厅角色共享场景.zh.md 恢复源图后导出');
const png = fs.readFileSync(source);
if (png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || png.readUInt32BE(16) !== 2115 || png.readUInt32BE(20) !== 743 || png[25] !== 2) {
    throw new Error('全景图必须为2115×743的RGB PNG；改变构图或尺寸时须同步更新场景布局参数');
}
if (!fs.existsSync(target + '.meta')) throw new Error('缺少原背景.meta，拒绝丢失已有资源身份');
if (source !== target) fs.copyFileSync(source, target);
console.log('已导出大厅与角色共享全景背景，保留原.meta；待Creator导入后运行textures:fix及textures:check。');
