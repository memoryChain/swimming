// 导出实际运行时蒙皮后的几何，供后台 Blender 检查；不是引擎截图。
const fs = require('node:fs');
const path = require('node:path');
const { createRig, Node, Vec3, Mat4, root, SWIMMER_MODEL_FILES } = require('../tests/helpers/character-contact-harness.cjs');
const rows = [];
for (const file of SWIMMER_MODEL_FILES) {
    const rig = createRig(file), frame = new Node();
    rig.wrapper.parent = frame; frame.children.push(rig.wrapper);
    rig.wrapper.setRotationFromEuler(35, 90, 0);
    rig.pose.applyEntertainmentKnockoutPose(1.8, 1, rig.wrapper);
    const data = fs.readFileSync(path.join(root, 'assets/race/models', file));
    const size = data.readUInt32LE(12), gltf = JSON.parse(data.subarray(20,20+size)), bin = data.subarray(28+size);
    const indices = index => {
        const a=gltf.accessors[index], b=gltf.bufferViews[a.bufferView];
        const bytes={5121:1,5123:2,5125:4}[a.componentType], read={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE'}[a.componentType];
        return Array.from({length:a.count},(_,i)=>bin[read]((b.byteOffset||0)+(a.byteOffset||0)+i*bytes));
    };
    const meshes=[];
    for (const renderer of rig.renderers) {
        const bones=renderer.skeleton.joints.map(p=>rig.wrapper.getChildByPath(p));
        const matrices=bones.map((b,i)=>Mat4.multiply(new Mat4(),b.worldMatrix,renderer.skeleton.bindposes[i]));
        for(let p=0;p<renderer.mesh.struct.primitives.length;p++) {
            const vertices=[], point=new Vec3(), world=new Vec3();
            const pos=renderer.mesh.readAttribute(p,'POSITION'), joints=renderer.mesh.readAttribute(p,'JOINTS_0'), weights=renderer.mesh.readAttribute(p,'WEIGHTS_0');
            for(let v=0;v<pos.length/3;v++) {
                world.set(0,0,0);
                for(let k=0;k<4;k++) {
                    point.set(pos[v*3],pos[v*3+1],pos[v*3+2]);
                    Vec3.transformMat4(point,point,matrices[joints[v*4+k]]);
                    Vec3.scaleAndAdd(world,world,point,weights[v*4+k]);
                }
                vertices.push([world.x,-world.z,world.y]);
            }
            meshes.push({vertices,indices:indices(renderer.mesh.struct.primitives[p].indices)});
        }
    }
    const ring=rig.pose.recoveryFloat;
    rows.push({file,meshes,ring:{position:[ring.position.x,-ring.position.z,ring.position.y],radius:ring.radius}});
}
fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
fs.writeFileSync(path.join(root,'.cache/recovery-float-review.json'),JSON.stringify(rows));
console.log(`已导出 ${rows.length} 个真实蒙皮角色。`);
