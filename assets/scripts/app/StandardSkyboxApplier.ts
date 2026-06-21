import { Camera, Color, Node, resources, Texture2D, TextureCube } from 'cc';
import { DEFAULT_SKYBOX_VARIANT, SKYBOX_VARIANTS, SkyboxFaceName, SkyboxVariant } from '../core/ResourcePaths';

const SKYBOX_FACE_NAMES: SkyboxFaceName[] = [
    'right',
    'left',
    'top',
    'bottom',
    'front',
    'back',
];

export class StandardSkyboxApplier {
    private readonly _textureCubeCache = new Map<string, TextureCube>();
    private _sceneRoot: Node | null = null;
    private _camera: Camera | null = null;
    private _debug: ((message: string) => void) | undefined;
    private _currentVariantId = '';
    private _applyRevision = 0;

    bind(sceneRoot: Node, camera: Camera, debug?: (message: string) => void) {
        this._sceneRoot = sceneRoot;
        this._camera = camera;
        this._debug = debug;
    }

    applyDefault() {
        this.apply(DEFAULT_SKYBOX_VARIANT.id);
    }

    disable(clearColor?: Color) {
        this._applyRevision += 1;
        const skybox = this._sceneRoot?.scene?.globals?.skybox;
        if (skybox) {
            skybox.enabled = false;
        }
        if (this._camera) {
            this._camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            if (clearColor) {
                this._camera.clearColor = clearColor;
            }
        }
        this._currentVariantId = '';
    }

    apply(variantId: string) {
        const sceneRoot = this._sceneRoot;
        const camera = this._camera;
        const debug = this._debug;
        if (!sceneRoot || !camera) {
            logSkybox(debug, `skybox apply skipped; applier not bound variant=${variantId}`);
            return;
        }
        const variant = findSkyboxVariant(variantId) ?? DEFAULT_SKYBOX_VARIANT;
        const skybox = sceneRoot.scene?.globals?.skybox;
        logSkybox(debug, `skybox apply start variant=${variant.label} camera=${camera.node?.name ?? 'unknown'} clear=${camera.clearFlags}`);
        if (!skybox) {
            logSkybox(debug, 'skybox globals unavailable; keeping solid camera clear');
            return;
        }
        const applyRevision = ++this._applyRevision;

        const cachedCube = this._textureCubeCache.get(variant.id);
        if (cachedCube) {
            skybox.envmap = cachedCube;
            skybox.enabled = true;
            camera.clearFlags = Camera.ClearFlag.SKYBOX;
            this._currentVariantId = variant.id;
            logSkybox(debug, `standard skybox applied from cache: ${variant.label} clear=${camera.clearFlags} enabled=${skybox.enabled}`);
            return;
        }

        loadSkyboxFaceTextures(variant, (textures, error) => {
            if (applyRevision !== this._applyRevision) {
                logSkybox(debug, `skybox load ignored for stale variant=${variant.label}`);
                return;
            }
            if (error || !textures) {
                console.warn(`[SpeedSwimming] failed to load ${variant.label} skybox`, error);
                logSkybox(debug, `skybox texture load failed; keeping solid camera clear error=${formatError(error)}`);
                return;
            }

            if (!camera.node?.isValid) {
                return;
            }

            try {
                const textureCube = TextureCube.fromTexture2DArray(textures);
                textureCube.name = `${variant.id}Skybox`;
                this._textureCubeCache.set(variant.id, textureCube);
                skybox.envmap = textureCube;
                skybox.enabled = true;
                camera.clearFlags = Camera.ClearFlag.SKYBOX;
                this._currentVariantId = variant.id;
                logSkybox(debug, `standard skybox applied: ${variant.label} faces=${textures.length} clear=${camera.clearFlags} enabled=${skybox.enabled}`);
            } catch (cubeError) {
                console.warn(`[SpeedSwimming] failed to create ${variant.label} TextureCube`, cubeError);
                logSkybox(debug, `texture cube create failed; keeping solid camera clear error=${formatError(cubeError)}`);
            }
        });
    }

    get currentVariantId(): string {
        return this._currentVariantId || DEFAULT_SKYBOX_VARIANT.id;
    }
}

function loadSkyboxFaceTextures(variant: SkyboxVariant, done: (textures: Texture2D[] | null, error: Error | null) => void) {
    const paths = variant.paths;
    const textures: Texture2D[] = [];
    let pending = SKYBOX_FACE_NAMES.length;
    let failed = false;

    for (const faceName of SKYBOX_FACE_NAMES) {
        const faceIndex = TextureCube.FaceIndex[faceName];
        loadSkyboxFaceTexture(paths[faceName], (err, texture, loadedPath) => {
            if (failed) {
                return;
            }

            if (err || !texture) {
                failed = true;
                done(null, err || new Error(`missing skybox face texture: ${faceName}`));
                return;
            }

            textures[faceIndex] = texture;
            console.log(`[SpeedSwimming] skybox face loaded variant=${variant.label} ${faceName} index=${faceIndex} path=${loadedPath} size=${texture.width}x${texture.height}`);
            pending -= 1;
            if (pending === 0) {
                done(textures, null);
            }
        });
    }
}

function loadSkyboxFaceTexture(path: string, done: (err: Error | null, texture: Texture2D | null, loadedPath: string) => void) {
    const fallbackPath = path.endsWith('/texture') ? path.slice(0, -'/texture'.length) : `${path}/texture`;
    resources.load(path, Texture2D, (err, texture) => {
        if (!err && texture) {
            done(null, texture, path);
            return;
        }

        console.warn(`[SpeedSwimming] skybox face load failed path=${path}`, err);
        resources.load(fallbackPath, Texture2D, (fallbackErr, fallbackTexture) => {
            if (!fallbackErr && fallbackTexture) {
                console.log(`[SpeedSwimming] skybox face loaded with fallback path=${fallbackPath}`);
                done(null, fallbackTexture, fallbackPath);
                return;
            }

            console.warn(`[SpeedSwimming] skybox face fallback load failed path=${fallbackPath}`, fallbackErr);
            done(
                new Error(`skybox face load failed path=${path} error=${formatError(err)} fallback=${fallbackPath} fallbackError=${formatError(fallbackErr)}`),
                null,
                path,
            );
        });
    });
}

function findSkyboxVariant(id: string): SkyboxVariant | null {
    return SKYBOX_VARIANTS.find((variant) => variant.id === id) ?? null;
}

function logSkybox(debug: ((message: string) => void) | undefined, message: string) {
    const line = `skybox: ${message}`;
    console.log(`[SpeedSwimming] ${line}`);
    debug?.(line);
}

function formatError(error: unknown): string {
    if (!error) {
        return 'unknown';
    }
    if (error instanceof Error) {
        return error.message;
    }
    return `${error}`;
}
