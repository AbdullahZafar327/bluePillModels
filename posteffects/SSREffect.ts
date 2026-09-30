//@ts-nocheck

import {
    Matrix4,
    Uniform,
} from "three"

import {
    BlendFunction,
    Effect,
    EffectAttribute,
} from "postprocessing"

const fragmentShader = /* glsl */ `
    uniform sampler2D normalBuffer;

    uniform float opacity;
    uniform float maxDistance;
    uniform float thickness;
    uniform mat4 cameraProjectionMatrix;
    uniform mat4 cameraInverseProjectionMatrix;

    #ifndef MAX_STEP
        #define MAX_STEP 64
    #endif

    #ifndef DISTANCE_ATTENUATION
        #define DISTANCE_ATTENUATION
    #endif

    #ifndef FRESNEL
        #define FRESNEL
    #endif

    float pointToLineDistance(vec3 x0, vec3 x1, vec3 x2) {

        float denominator = length(x2 - x1);

        if (denominator <= 0.000001) return 0.0;

        return length(cross(x0 - x1, x0 - x2)) / denominator;

    }

    float pointPlaneDistance(
        vec3 point,
        vec3 planePoint,
        vec3 planeNormal
    ) {

        float a = planeNormal.x;
        float b = planeNormal.y;
        float c = planeNormal.z;

        float x0 = point.x;
        float y0 = point.y;
        float z0 = point.z;

        float x = planePoint.x;
        float y = planePoint.y;
        float z = planePoint.z;

        float d = -(a * x + b * y + c * z);

        return a * x0 + b * y0 + c * z0 + d;

    }

    vec3 getViewPosition(
        const in vec2 uv,
        const in float depthValue,
        const in float clipW
    ) {

        vec4 clipPosition = vec4(
            (vec3(uv, depthValue) - 0.5) * 2.0,
            1.0
        );

        clipPosition *= clipW;

        return (cameraInverseProjectionMatrix * clipPosition).xyz;

    }

    vec3 getViewNormal(const in vec2 uv) {

        return unpackRGBToNormal(
            texture2D(normalBuffer, uv).xyz
        );

    }

    vec2 viewPositionToXY(vec3 viewPosition) {

        vec4 clip =
            cameraProjectionMatrix *
            vec4(viewPosition, 1.0);

        vec2 xy = clip.xy / clip.w;

        xy = (xy + 1.0) * 0.5;

        return xy * resolution;

    }

    void mainImage(
        const in vec4 inputColor,
        const in vec2 uv,
        const in float depth,
        out vec4 outputColor
    ) {

        outputColor = inputColor;

        if (depth >= 0.999999) return;

        float viewZ = getViewZ(depth);

        if (-viewZ >= cameraFar) return;

        float clipW =
            cameraProjectionMatrix[2][3] * viewZ +
            cameraProjectionMatrix[3][3];

        vec3 viewPosition = getViewPosition(
            uv,
            depth,
            clipW
        );

        vec3 viewNormal = getViewNormal(uv);

        #ifdef PERSPECTIVE_CAMERA

            vec3 viewIncidentDir =
                normalize(viewPosition);

            vec3 viewReflectDir =
                reflect(
                    viewIncidentDir,
                    viewNormal
                );

        #else

            vec3 viewIncidentDir =
                vec3(0.0, 0.0, -1.0);

            vec3 viewReflectDir =
                reflect(
                    viewIncidentDir,
                    viewNormal
                );

        #endif

        float ndv = max(
            dot(-viewIncidentDir, viewNormal),
            0.001
        );

        float maxReflectRayLen =
            maxDistance / ndv;

        vec3 d1ViewPosition =
            viewPosition +
            viewReflectDir *
            maxReflectRayLen;

        #ifdef PERSPECTIVE_CAMERA

            if (d1ViewPosition.z > -cameraNear) {

                float denominator =
                    viewReflectDir.z;

                if (abs(denominator) > 0.000001) {

                    float t =
                        (-cameraNear - viewPosition.z) /
                        denominator;

                    if (t > 0.0) {

                        d1ViewPosition =
                            viewPosition +
                            viewReflectDir * t;

                    }

                }

            }

        #endif

        vec2 d0 = gl_FragCoord.xy;

        vec2 d1 =
            viewPositionToXY(
                d1ViewPosition
            );

        float xLen =
            d1.x - d0.x;

        float yLen =
            d1.y - d0.y;

        float totalStep =
            max(
                abs(xLen),
                abs(yLen)
            );

        if (totalStep < 1.0) return;

        float xSpan =
            xLen / totalStep;

        float ySpan =
            yLen / totalStep;

        float sStep =
            1.0 / totalStep;

        float s = sStep;

        for (
            float i = 1.0;
            i < float(MAX_STEP);
            i++
        ) {

            if (i >= totalStep) break;

            vec2 xy = vec2(
                d0.x + i * xSpan,
                d0.y + i * ySpan
            );

            if (
                xy.x < 0.0 ||
                xy.x > resolution.x ||
                xy.y < 0.0 ||
                xy.y > resolution.y
            ) {

                break;

            }

            vec2 sampleUv =
                xy / resolution;

            float sampleDepth =
                readDepth(sampleUv);

            if (sampleDepth >= 0.999999) {

                s += sStep;

                continue;

            }

            float sampleViewZ =
                getViewZ(sampleDepth);

            if (-sampleViewZ >= cameraFar) {

                s += sStep;

                continue;

            }

            float sampleClipW =
                cameraProjectionMatrix[2][3] *
                sampleViewZ +
                cameraProjectionMatrix[3][3];

            vec3 sampleViewPosition =
                getViewPosition(
                    sampleUv,
                    sampleDepth,
                    sampleClipW
                );

            #ifdef PERSPECTIVE_CAMERA

                float recipViewZ =
                    1.0 / viewPosition.z;

                float reflectRayZ =
                    1.0 /
                    (
                        recipViewZ +
                        s *
                        (
                            1.0 /
                            d1ViewPosition.z -
                            recipViewZ
                        )
                    );

            #else

                float reflectRayZ =
                    viewPosition.z +
                    s *
                    (
                        d1ViewPosition.z -
                        viewPosition.z
                    );

            #endif

            if (reflectRayZ <= sampleViewZ) {

                #ifdef INFINITE_THICK

                    bool hit = true;

                #else

                    float away =
                        pointToLineDistance(
                            sampleViewPosition,
                            viewPosition,
                            d1ViewPosition
                        );

                    vec2 neighbor =
                        xy +
                        vec2(1.0, 0.0);

                    vec2 neighborUv =
                        neighbor / resolution;

                    float neighborDepth =
                        readDepth(neighborUv);

                    float neighborClipW =
                        cameraProjectionMatrix[2][3] *
                        sampleViewZ +
                        cameraProjectionMatrix[3][3];

                    vec3 neighborViewPosition =
                        getViewPosition(
                            neighborUv,
                            neighborDepth,
                            neighborClipW
                        );

                    float minThickness =
                        (
                            neighborViewPosition.x -
                            sampleViewPosition.x
                        ) * 3.0;

                    float tk =
                        max(
                            minThickness,
                            thickness
                        );

                    bool hit =
                        away <= tk;

                #endif

                if (hit) {

                    vec3 hitNormal =
                        getViewNormal(
                            sampleUv
                        );

                    if (
                        dot(
                            viewReflectDir,
                            hitNormal
                        ) >= 0.0
                    ) {

                        break;

                    }

                    float distance =
                        pointPlaneDistance(
                            sampleViewPosition,
                            viewPosition,
                            viewNormal
                        );

                    if (distance > maxDistance) {

                        break;

                    }

                    float reflectionOpacity =
                        opacity;

                    #ifdef DISTANCE_ATTENUATION

                        float ratio =
                            1.0 -
                            clamp(
                                distance /
                                maxDistance,
                                0.0,
                                1.0
                            );

                        reflectionOpacity *=
                            ratio * ratio;

                    #endif

                    #ifdef FRESNEL

                        float fresnelCoefficient =
                            (
                                dot(
                                    viewIncidentDir,
                                    viewReflectDir
                                ) + 1.0
                            ) * 0.5;

                        reflectionOpacity *=
                            fresnelCoefficient;

                    #endif

                    vec4 reflectionColor =
                        texture2D(
                            inputBuffer,
                            sampleUv
                        );

                    float reflectionMix =
                        clamp(
                            reflectionOpacity,
                            0.0,
                            1.0
                        );

                    outputColor =
                        vec4(
                            mix(
                                inputColor.rgb,
                                reflectionColor.rgb,
                                reflectionMix
                            ),
                            inputColor.a
                        );

                    return;

                }

            }

            s += sStep;

        }

    }
`

export class SSREffect extends Effect {

    constructor({
        normalBuffer = null,
        opacity = 0.5,
        maxDistance = 18.0,
        thickness = 0.018,
        maxSteps = 64,
        distanceAttenuation = true,
        fresnel = true,
        infiniteThickness = false,
        blendFunction = BlendFunction.NORMAL,
    } = {}) {

        super("SSREffect", fragmentShader, {

            blendFunction,

            attributes:
                EffectAttribute.DEPTH,

            defines: new Map([

                [
                    "MAX_STEP",
                    String(
                        Math.max(
                            1,
                            Math.floor(maxSteps)
                        )
                    ),
                ],

                ...(distanceAttenuation
                    ? [["DISTANCE_ATTENUATION", "1"]]
                    : []),

                ...(fresnel
                    ? [["FRESNEL", "1"]]
                    : []),

                ...(infiniteThickness
                    ? [["INFINITE_THICK", "1"]]
                    : []),

            ]),

            uniforms: new Map([

                [
                    "normalBuffer",
                    new Uniform(normalBuffer),
                ],

                [
                    "opacity",
                    new Uniform(opacity),
                ],

                [
                    "maxDistance",
                    new Uniform(maxDistance),
                ],

                [
                    "thickness",
                    new Uniform(thickness),
                ],

                [
                    "cameraProjectionMatrix",
                    new Uniform(
                        new Matrix4()
                    ),
                ],

                [
                    "cameraInverseProjectionMatrix",
                    new Uniform(
                        new Matrix4()
                    ),
                ],

            ]),

        })

        this.camera = null
    }

    get normalBuffer() {

        return this.uniforms
            .get("normalBuffer")
            .value

    }

    set normalBuffer(value) {

        this.uniforms
            .get("normalBuffer")
            .value = value

    }

    get opacity() {

        return this.uniforms
            .get("opacity")
            .value

    }

    set opacity(value) {

        this.uniforms
            .get("opacity")
            .value = value

    }

    get maxDistance() {

        return this.uniforms
            .get("maxDistance")
            .value

    }

    set maxDistance(value) {

        this.uniforms
            .get("maxDistance")
            .value = value

    }

    get thickness() {

        return this.uniforms
            .get("thickness")
            .value

    }

    set thickness(value) {

        this.uniforms
            .get("thickness")
            .value = value

    }

    get maxSteps() {

        return Number(
            this.defines.get("MAX_STEP")
        )

    }

    set maxSteps(value) {

        const next =
            String(
                Math.max(
                    1,
                    Math.floor(value)
                )
            )

        if (
            this.defines.get("MAX_STEP") === next
        ) {

            return

        }

        this.defines.set(
            "MAX_STEP",
            next
        )

        this.setChanged()

    }

    get distanceAttenuation() {

        return this.defines.has(
            "DISTANCE_ATTENUATION"
        )

    }

    set distanceAttenuation(value) {

        const enabled =
            this.defines.has(
                "DISTANCE_ATTENUATION"
            )

        if (
            enabled === !!value
        ) {

            return

        }

        if (value) {

            this.defines.set(
                "DISTANCE_ATTENUATION",
                "1"
            )

        } else {

            this.defines.delete(
                "DISTANCE_ATTENUATION"
            )

        }

        this.setChanged()

    }

    get fresnel() {

        return this.defines.has(
            "FRESNEL"
        )

    }

    set fresnel(value) {

        const enabled =
            this.defines.has("FRESNEL")

        if (
            enabled === !!value
        ) {

            return

        }

        if (value) {

            this.defines.set(
                "FRESNEL",
                "1"
            )

        } else {

            this.defines.delete(
                "FRESNEL"
            )

        }

        this.setChanged()

    }

    get infiniteThickness() {

        return this.defines.has(
            "INFINITE_THICK"
        )

    }

    set infiniteThickness(value) {

        const enabled =
            this.defines.has(
                "INFINITE_THICK"
            )

        if (
            enabled === !!value
        ) {

            return

        }

        if (value) {

            this.defines.set(
                "INFINITE_THICK",
                "1"
            )

        } else {

            this.defines.delete(
                "INFINITE_THICK"
            )

        }

        this.setChanged()

    }

    set mainCamera(value) {

        this.camera = value

    }

    update() {

        const camera = this.camera

        if (!camera) return

        camera.updateMatrixWorld?.()
        camera.updateProjectionMatrix?.()

        const projection =
            this.uniforms
                .get("cameraProjectionMatrix")
                .value

        const inverse =
            this.uniforms
                .get("cameraInverseProjectionMatrix")
                .value

        projection.copy(
            camera.projectionMatrix
        )

        inverse.copy(
            camera.projectionMatrix
        )

        inverse.invert()

    }

}