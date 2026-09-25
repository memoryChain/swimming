// 仅替换 Logo 和进度条的静态布局，保留 Cocos 原有加载及资源释放流程。
function updateVertexBuffer() {
    const scale = Math.min(canvas.width / 1280, canvas.height / 720);
    const x = 28 * scale * 2 / canvas.width;
    const y = 157 * scale * 2 / canvas.height;
    const w = 608 * scale / canvas.width;
    const h = 262 * scale / canvas.height;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        x + w, y - h, 1, 1, x + w, y + h, 1, 0,
        x - w, y - h, 0, 1, x - w, y + h, 0, 0,
    ]), gl.STATIC_DRAW);
}

function initProgressVertexBuffer() {
    const scale = Math.min(canvas.width / 1280, canvas.height / 720);
    const w = 352 * scale / canvas.width;
    const h = 8 * scale / canvas.height;
    const y = -264 * scale * 2 / canvas.height;
    vertexBufferProgress = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBufferProgress);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        w, y - h, 1, w, y + h, 1, -w, y - h, 0, -w, y + h, 0,
    ]), gl.STATIC_DRAW);
}
