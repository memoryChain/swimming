// 微信构建仅去除重复字段和恒定旋转；还原发生在资源加载时，不进入逐帧姿态计算。
// 原始 JSON 同样可读，编辑器预览和已缓存的旧资源继续使用原有格式。
export function decodeSampledMotion(value: unknown): unknown {
    if (!value || typeof value !== 'object' || !('$motion' in value)) return value;
    const { $motion, samples, ...metadata } = value as Record<string, any>;
    if (!$motion || $motion.version !== 1
        || !validNames($motion.fields) || $motion.fields.indexOf('rotations') < 0
        || !validNames($motion.bones) || !$motion.constants || typeof $motion.constants !== 'object'
        || !Array.isArray(samples) || samples.length === 0) {
        throw new Error('Invalid sampled motion storage header');
    }
    const fields = $motion.fields as string[];
    const bones = $motion.bones as string[];
    const constants = $motion.constants as Record<string, number[]>;
    for (const bone of Object.keys(constants)) {
        if (bones.indexOf(bone) < 0 || !finiteTuple(constants[bone], 4)) {
            throw new Error('Invalid constant sampled rotation');
        }
    }
    const rotationIndex = fields.indexOf('rotations');
    const rotationWidth = (bones.length - Object.keys(constants).length) * 4;
    const restored = samples.map((row: unknown) => {
        if (!Array.isArray(row) || row.length !== fields.length
            || !finiteTuple(row[rotationIndex], rotationWidth)) {
            throw new Error('Invalid sampled motion storage row');
        }
        const sample: Record<string, unknown> = {};
        for (let i = 0; i < fields.length; i++) sample[fields[i]] = row[i];
        const rotations: Record<string, number[]> = {};
        let offset = 0;
        for (const bone of bones) {
            // 每帧保留独立四元数数组，避免共享常量引入跨帧修改。
            if (Object.prototype.hasOwnProperty.call(constants, bone)) {
                rotations[bone] = constants[bone].slice();
            } else {
                rotations[bone] = row[rotationIndex].slice(offset, offset + 4);
                offset += 4;
            }
        }
        sample.rotations = rotations;
        return sample;
    });
    return { ...metadata, samples: restored };
}

function validNames(value: unknown): value is string[] {
    return Array.isArray(value) && value.length > 0
        && value.every((name) => typeof name === 'string'
            && name !== '__proto__' && name !== 'constructor' && name !== 'prototype')
        && new Set(value).size === value.length;
}

function finiteTuple(value: unknown, length: number): value is number[] {
    return Array.isArray(value) && value.length === length
        && value.every((number) => typeof number === 'number' && Number.isFinite(number));
}
