/** 薄漏斗水膜提供收窄轮廓，独立螺旋水带提供流动；共用一个预建网格。 */
export const WHIRLPOOL_SURFACE_OFFSET = 0.037;

export function buildWhirlpoolFunnelGeometry(coreRadius: number, superVariant: boolean) {
    const depth = superVariant ? 1.75 : 1.35;
    const arms = superVariant ? 4 : 3;
    const turns = superVariant ? 3.4 : 3.0;
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
    const colors: number[] = [], indices: number[] = [];
    // 各条水带彼此独立，中间没有连接面；范围用于离线验证旧轮廓和开敞结构。
    const strips: { kind: string; start: number; count: number }[] = [];
    function vertex(x: number, y: number, z: number, u: number, v: number, r: number, g: number, b: number, a: number) {
        positions.push(x,y,z); normals.push(0,1,0); uvs.push(u,v); colors.push(r,g,b,a);
    }
    function join(base: number, segments: number) {
        for(let i=0;i<segments;i++) {
            const a=base+i*2;
            indices.push(a,a+2,a+1,a+1,a+2,a+3);
        }
    }
    function waterStrip(arm: number) {
        const start = positions.length/3;
        const segments = superVariant ? 28 : 24;
        for(let i=0;i<=segments;i++) {
            const t=i/segments;
            // 沿用旧版半径、收束曲线、旋转圈数和深度，补面不能改变中心轨迹。
            const radius=coreRadius*(0.84-t*t*(3-2*t)*0.70);
            const angle=arm/arms*Math.PI*2+t*Math.PI*turns;
            const y=-0.06-depth*t;
            const halfWidth=coreRadius*(0.042-t*0.014);
            const alpha=(0.08+Math.sin(Math.PI*t)*0.36)*(1-t*0.30);
            for(let side=0;side<2;side++) {
                const offset=(side*2-1)*halfWidth;
                vertex(Math.cos(angle)*(radius+offset),y+offset*0.12,Math.sin(angle)*(radius+offset),
                    side,t*2.0+arm*0.37,0.28,0.56,0.69,alpha);
            }
        }
        join(start,segments);
        strips.push({kind:'underwater',start,count:(segments+1)*2});
    }
    // 先画低对比水膜，后画清晰水线。不是叠回完整实体壳：每圈保留真实缺口，
    // 顶底和左右均渐隐，不封底、不写深度，不需要新增 renderer 或水面孔口。
    const membraneRadii = [1.08,0.93,0.77,0.58,0.39,0.24,0.14];
    const membraneDepths = [0,0.09,0.23,0.42,0.64,0.84,1];
    const arcSegments = 8;
    const sectorAngle = Math.PI*2/arms;
    for(let sector=0;sector<arms;sector++) {
        const start=positions.length/3;
        for(let ring=0;ring<membraneRadii.length;ring++) {
            const t=membraneDepths[ring];
            const radius=coreRadius*membraneRadii[ring];
            for(let segment=0;segment<=arcSegments;segment++) {
                const u=segment/arcSegments;
                const angle=sectorAngle*(sector+u*0.78)+t*Math.PI*1.10;
                // 烘焙克制的侧向明暗来读出坡面，不使用金属高光或深色实体中心。
                const light=0.82+0.18*Math.cos(angle-0.6);
                const edge=Math.sin(Math.PI*u);
                const alpha=0.30*Math.sin(Math.PI*t)*edge;
                vertex(Math.cos(angle)*radius,-WHIRLPOOL_SURFACE_OFFSET-depth*t,Math.sin(angle)*radius,
                    u,4+t*2+sector*0.37,
                    (0.05+0.16*(1-t))*light,(0.16+0.24*(1-t))*light,(0.29+0.25*(1-t))*light,alpha);
            }
        }
        for(let ring=0;ring<membraneRadii.length-1;ring++) {
            for(let segment=0;segment<arcSegments;segment++) {
                const a=start+ring*(arcSegments+1)+segment;
                const b=a+arcSegments+1;
                indices.push(a,b,a+1,a+1,b,b+1);
            }
        }
        strips.push({kind:'membrane',start,count:membraneRadii.length*(arcSegments+1)});
    }
    // 仅保留很淡的水面中心色，恢复旧读性；不挖水面、不封住水下空间。
    const diskStart=positions.length/3;
    vertex(0,-WHIRLPOOL_SURFACE_OFFSET,0,0.5,-1,0.025,0.075,0.13,0.18);
    for(let i=0;i<=24;i++) {
        const a=i/24*Math.PI*2;
        vertex(Math.cos(a)*coreRadius*0.90,-WHIRLPOOL_SURFACE_OFFSET,Math.sin(a)*coreRadius*0.90,
            0.5,-1,0.025,0.075,0.13,0);
        if(i<24)indices.push(diskStart,diskStart+i+1,diskStart+i+2);
    }
    for(let arm=0;arm<arms;arm++) {
        const start=positions.length/3, segments=12;
        for(let i=0;i<=segments;i++) {
            const t=i/segments, radius=coreRadius*(0.10+t*0.78);
            const angle=arm/arms*Math.PI*2+t*Math.PI*0.92;
            const halfWidth=coreRadius*(0.028+t*0.020);
            for(let side=0;side<2;side++) {
                const r=radius+(side*2-1)*halfWidth;
                vertex(Math.cos(angle)*r,-WHIRLPOOL_SURFACE_OFFSET+0.001,Math.sin(angle)*r,
                    side,t+arm*0.37,0.30,0.58,0.70,(0.36+0.12*(1-t))*Math.sin(Math.PI*t));
            }
        }
        join(start,segments);strips.push({kind:'surface',start,count:(segments+1)*2});
        waterStrip(arm);
    }
    // 水面边界只用断续短弧，没有高出水面的翻卷浪脊。
    const dashes=superVariant?14:10;
    for(let dash=0;dash<dashes;dash++) {
        const start=positions.length/3;
        for(let i=0;i<=3;i++) {
            const t=i/3, angle=dash/dashes*Math.PI*2+t*0.23;
            for(let side=0;side<2;side++) {
                const r=coreRadius*(1.08+(side*2-1)*0.025);
                vertex(Math.cos(angle)*r,-WHIRLPOOL_SURFACE_OFFSET+0.001,Math.sin(angle)*r,
                    side,t+dash*0.11,0.40,0.67,0.77,Math.sin(Math.PI*t)*0.28);
            }
        }
        join(start,3);
    }
    return {positions,normals,uvs,colors,indices,strips,radius:coreRadius*1.15,
        minY:-depth-0.09,maxY:-WHIRLPOOL_SURFACE_OFFSET+0.002};
}
