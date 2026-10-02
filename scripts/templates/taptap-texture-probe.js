'use strict';

// 仅供 TapTap 开发包：页面进入后有限读回，不挂比赛帧循环。
function stats(bytes) {
    var strong = 0, max = 0, hash = 2166136261;
    for (var i = 3; i < bytes.length; i += 4) {
        var a = bytes[i];
        if (a >= 128) strong++;
        if (a > max) max = a;
        hash = Math.imul(hash ^ a, 16777619) >>> 0;
    }
    return { strongAlpha: strong, maxAlpha: max, alphaHash: hash };
}

function readGpu(gl, native, width, height) {
    if (!gl || !native || !native.glTexture || native.glTarget !== gl.TEXTURE_2D
        || native.glFormat !== gl.RGBA || native.glType !== gl.UNSIGNED_BYTE) return { status: 'unsupported' };
    var previous = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    var framebuffer = gl.createFramebuffer();
    if (!framebuffer) return { status: 'no-framebuffer' };
    try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, native.glTexture, 0);
        var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) return { status: 'incomplete', code: status };
        var bytes = new Uint8Array(width * height * 4);
        // 如果宿主 readPixels 未实际写回，不能把默认零数组误判成空纹理。
        bytes.fill(37);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        var changed = false;
        for (var i = 0; i < bytes.length; i++) if (bytes[i] !== 37) { changed = true; break; }
        return changed ? { status: 'read', pixels: stats(bytes) } : { status: 'unwritten' };
    } finally {
        // 不改变引擎缓存，恢复实际绑定；异常路径也必须恢复并释放临时 FBO。
        gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
        gl.deleteFramebuffer(framebuffer);
    }
}

function presentation(label) {
    var node = label.node, rd = label.renderData, frame = label.ttfSpriteFrame;
    var vb = rd && rd.chunk && rd.chunk.vb;
    var color = label.color, material = label.getRenderMaterial && label.getRenderMaterial(0);
    return {
        enabled: label.enabledInHierarchy, opacity: node._uiProps && node._uiProps.opacity,
        color: color && [color.r, color.g, color.b, color.a],
        position: node.worldPosition && [node.worldPosition.x, node.worldPosition.y, node.worldPosition.z],
        scale: node.worldScale && [node.worldScale.x, node.worldScale.y, node.worldScale.z],
        vertices: rd && rd.vertexCount, indices: rd && rd.indexCount,
        // Cocos vfmtPosUvColor 的首顶点，含位置、UV、RGBA；不输出正文或昵称。
        firstVertex: vb ? Array.prototype.slice.call(vb, 0, 9) : null,
        frameMatches: !!(rd && rd.frame === frame),
        material: material && material.effectName, materialHash: material && material.hash,
        uv: frame && frame.uv ? Array.prototype.slice.call(frame.uv, 0, 8) : null
    };
}

exports.create = function (cc, options) {
    options = options || {};
    var done = new WeakMap();
    return function inspect(root, entry) {
        if (!root.isValid || !root.activeInHierarchy || entry > 3 || done.get(root) === entry) return;
        done.set(root, entry);
        var count = 0, remaining = 2000000;
        var device = cc.director && cc.director.root && cc.director.root.device;
        var gl = device && device.gl;
        function visit(node) {
            if (!node.activeInHierarchy || count >= 24) return;
            var label = node.getComponent(cc.Label);
            if (label && label.string) {
                var record = { entry: entry, index: count++, node: node.name };
                try {
                    record.presentation = presentation(label);
                    var data = label.assemblerData, canvas = data && data.canvas, context = data && data.context;
                    var frame = label.ttfSpriteFrame, texture = frame && frame.texture;
                    var gpu = texture && texture.getGFXTexture && texture.getGFXTexture();
                    var native = gpu && gpu.gpuTexture;
                    var w = canvas && canvas.width, h = canvas && canvas.height;
                    if (!w || !h || w * h > 512000 || w * h > remaining) record.status = 'pixel-budget';
                    else if (label.cacheMode !== 0 || !context || !texture || texture.width !== w || texture.height !== h)
                        record.status = 'unsupported-layout';
                    else {
                        remaining -= w * h;
                        var pixels = context.getImageData(0, 0, w, h).data;
                        if (!pixels || pixels.length !== w * h * 4) throw Error('画布像素长度不符');
                        record.size = [w, h];
                        record.cpu = stats(pixels);
                        record.gpuBefore = readGpu(gl, native, w, h);
                        var before = record.gpuBefore;
                        // 不把一般颜色/翻转差异判为丢失。只有明确有字形且 GPU 几乎全透明才试验补传。
                        var blank = before.status === 'read' && before.pixels.maxAlpha <= 1 && record.cpu.strongAlpha >= 16;
                        record.status = blank ? 'gpu-empty-with-cpu-ink' : 'observed';
                        if (blank && options.repairConfirmedBlank === true) {
                            texture.uploadData(new Uint8Array(pixels));
                            record.gpuAfter = readGpu(gl, native, w, h);
                            record.repair = record.gpuAfter.status === 'read'
                                && record.gpuAfter.pixels.alphaHash === record.cpu.alphaHash ? 'alpha-match' : 'unconfirmed';
                        }
                    }
                } catch (error) { record.error = String(error); }
                console.log('[TapTexture] ' + JSON.stringify(record));
            }
            for (var i = 0; i < node.children.length; i++) visit(node.children[i]);
        }
        visit(root);
    };
};
exports.stats = stats;
exports.readGpu = readGpu;
