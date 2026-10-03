// 从交付 GLB 读取实际几何，用于验证表现层，不以造型脚本替代交付文件。
const fs = require('node:fs');
const assert = require('node:assert/strict');
function readGlbGeometry(file) {
    const data = fs.readFileSync(file);
    assert.equal(data.readUInt32LE(0), 0x46546c67);
    assert.equal(data.readUInt32LE(4), 2);
    assert.equal(data.readUInt32LE(8), data.length);
    const size = data.readUInt32LE(12);
    const document = JSON.parse(data.subarray(20,20+size));
    const binary = data.subarray(28+size);
    const components = {SCALAR:1, VEC3:3, VEC4:4};
    function accessor(index) {
        const a=document.accessors[index], v=document.bufferViews[a.bufferView];
        const bytes={5126:4,5123:2,5121:1}[a.componentType], count=components[a.type];
        const start=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||bytes*count, output=[];
        for(let i=0;i<a.count;i++)for(let j=0;j<count;j++){
            const at=start+i*stride+j*bytes;
            const value=a.componentType===5126?binary.readFloatLE(at):a.componentType===5123?binary.readUInt16LE(at):binary.readUInt8(at);
            output.push(a.normalized?value/(a.componentType===5123?65535:255):value);
        }
        return output;
    }
    const primitive=document.meshes[0].primitives[0];
    return {document, geometry:{positions:accessor(primitive.attributes.POSITION),
        colors:accessor(primitive.attributes.COLOR_0),indices:accessor(primitive.indices)}};
}
module.exports={readGlbGeometry};
