import { assetManager, director, gfx, Texture2D } from 'cc';

const MAX_ASTC_SAMPLES = 6;

type TextureFormatSummary = {
    textureCount: number;
    gpuReadyCount: number;
    gpuAstcCount: number;
    nativeAstcCount: number;
    gpuFormats: Map<string, number>;
    astcSamples: string[];
};

/**
 * One-shot runtime proof of the texture format selected by Cocos and uploaded
 * to the GPU. Keep this out of update(): enumerating the asset cache is only
 * appropriate as an explicit startup diagnostic.
 */
export function logTextureFormatDiagnostics() {
    const device = director.root?.device;
    const astcFeatures = device?.getFormatFeatures(gfx.Format.ASTC_RGBA_4X4)
        ?? gfx.FormatFeatureBit.NONE;
    const deviceAstc = (astcFeatures & gfx.FormatFeatureBit.SAMPLED_TEXTURE) !== 0;
    const summary: TextureFormatSummary = {
        textureCount: 0,
        gpuReadyCount: 0,
        gpuAstcCount: 0,
        nativeAstcCount: 0,
        gpuFormats: new Map<string, number>(),
        astcSamples: [],
    };

    assetManager.assets.forEach((asset) => {
        if (!(asset instanceof Texture2D)) {
            return;
        }
        summary.textureCount += 1;

        const image = asset.image;
        const nativeUrl = image?.nativeUrl ?? '';
        const selectedAstc = nativeUrl.toLowerCase().endsWith('.astc');
        if (selectedAstc) {
            summary.nativeAstcCount += 1;
        }

        const gpuTexture = asset.getGFXTexture();
        if (!gpuTexture) {
            return;
        }
        summary.gpuReadyCount += 1;
        const formatName = gfx.Format[gpuTexture.format] ?? `Format(${gpuTexture.format})`;
        summary.gpuFormats.set(formatName, (summary.gpuFormats.get(formatName) ?? 0) + 1);
        if (!isAstcFormat(gpuTexture.format)) {
            return;
        }

        summary.gpuAstcCount += 1;
        if (summary.astcSamples.length < MAX_ASTC_SAMPLES) {
            summary.astcSamples.push(
                `${asset.name || image?.name || '(unnamed)'}=${formatName} native=${nativeUrl || '(empty)'}`,
            );
        }
    });

    const formatSummary = [...summary.gpuFormats.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([format, count]) => `${format}:${count}`)
        .join(', ');
    console.log(
        `[TextureAudit] deviceASTC=${deviceAstc} sampled=${Boolean(astcFeatures & gfx.FormatFeatureBit.SAMPLED_TEXTURE)} `
        + `linearFilter=${Boolean(astcFeatures & gfx.FormatFeatureBit.LINEAR_FILTER)}`,
    );
    console.log(
        `[TextureAudit] loadedTexture2D=${summary.textureCount} gpuReady=${summary.gpuReadyCount} `
        + `selectedNativeASTC=${summary.nativeAstcCount} gpuASTC=${summary.gpuAstcCount} formats=[${formatSummary}]`,
    );
    if (summary.astcSamples.length > 0) {
        console.log(`[TextureAudit] ASTC samples: ${summary.astcSamples.join(' | ')}`);
    } else {
        console.warn(
            '[TextureAudit] No loaded Texture2D is using ASTC on the GPU. '
            + 'This is expected in browser preview, but not on an ASTC-capable mobile device build.',
        );
    }
}

function isAstcFormat(format: gfx.Format): boolean {
    return (format >= gfx.Format.ASTC_RGBA_4X4 && format <= gfx.Format.ASTC_RGBA_12X12)
        || (format >= gfx.Format.ASTC_SRGBA_4X4 && format <= gfx.Format.ASTC_SRGBA_12X12);
}
