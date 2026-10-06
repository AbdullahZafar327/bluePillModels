//@ts-nocheck
import { Effect, EffectAttribute, BlendFunction } from "postprocessing"
import { Uniform , Color, Vector4 } from "three"

const FRAG = `
    uniform sampler2D tNormal;
    uniform vec3 uPaper;
    uniform vec3 uInk;
    uniform vec4 uThr;        // luminance thresholds for the 4 layers
    uniform float uMix;       // 0 = normal render, 1 = full hatching
    uniform float uSpacing;   // px between lines
    uniform float uThickness; // line width in px
    uniform float uWobble;    // hand-drawn jitter in px
    uniform float uContrast;
    uniform float uTint;      // how much scene colour bleeds into the paper
    uniform float uEdge;      // outline strength
    uniform float uWidth;     // outline width in px
    uniform float uNormalThr;
    uniform float uDepthThr;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
        );
    }

    // anti-aliased line mask, 1 on the line, 0 between lines
    float hatch(vec2 p, float angle, float spacing, float thick) {
        float c = cos(angle);
        float s = sin(angle);
        float d = dot(p, vec2(-s, c)) / spacing;
        float px = min(fract(d), 1.0 - fract(d)) * spacing;
        return 1.0 - smoothstep(thick * 0.5 - 0.5, thick * 0.5 + 0.5, px);
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec2 p = uv * resolution;

        // hand-drawn wobble
        p += (vec2(vnoise(p * 0.02), vnoise(p * 0.02 + 17.3)) - 0.5) * uWobble;

        // luminance (input is linear) → perceptual → contrast
        float lum = dot(max(inputColor.rgb, 0.0), vec3(0.299, 0.587, 0.114));
        lum = pow(clamp(lum, 0.0, 1.0), 1.0 / 2.2);
        lum = clamp((lum - 0.5) * uContrast + 0.5, 0.0, 1.0);

        // darker areas get slightly fatter lines
        float thick = uThickness * (0.8 + 0.6 * (1.0 - lum));

        float h1 = hatch(p,  0.785398, uSpacing,        thick) * (1.0 - smoothstep(uThr.x - 0.05, uThr.x + 0.05, lum));
        float h2 = hatch(p, -0.785398, uSpacing,        thick) * (1.0 - smoothstep(uThr.y - 0.05, uThr.y + 0.05, lum));
        float h3 = hatch(p,  0.0,      uSpacing * 1.15, thick) * (1.0 - smoothstep(uThr.z - 0.05, uThr.z + 0.05, lum));
        float h4 = hatch(p,  1.570796, uSpacing * 1.15, thick) * (1.0 - smoothstep(uThr.w - 0.05, uThr.w + 0.05, lum));
        float ink = max(max(h1, h2), max(h3, h4));

        // pen outline from normals + depth (Roberts cross)
        vec2 o = texelSize * uWidth;
        vec3 n00 = texture2D(tNormal, uv + vec2(-o.x, -o.y)).rgb;
        vec3 n11 = texture2D(tNormal, uv + vec2( o.x,  o.y)).rgb;
        vec3 n01 = texture2D(tNormal, uv + vec2(-o.x,  o.y)).rgb;
        vec3 n10 = texture2D(tNormal, uv + vec2( o.x, -o.y)).rgb;
        float en = length(n00 - n11) + length(n01 - n10);

        float d00 = readDepth(uv + vec2(-o.x, -o.y));
        float d11 = readDepth(uv + vec2( o.x,  o.y));
        float d01 = readDepth(uv + vec2(-o.x,  o.y));
        float d10 = readDepth(uv + vec2( o.x, -o.y));
        float ed = abs(d00 - d11) + abs(d01 - d10);

        float e = max(
            smoothstep(uNormalThr, uNormalThr * 2.0, en),
            smoothstep(uDepthThr, uDepthThr * 2.0, ed)
        );
        ink = max(ink, e * uEdge);

        // paper, optionally tinted by the scene's own colours
        vec3 tinted = uPaper * pow(clamp(inputColor.rgb, 0.0, 1.0), vec3(1.0 / 2.2));
        vec3 paper = mix(uPaper, tinted, uTint);

        vec3 result = mix(paper, uInk, ink);
        outputColor = vec4(mix(inputColor.rgb, result, uMix), inputColor.a);
    }
`

export class CrosshatchEffect extends Effect {
    constructor({
        normalTexture,
        paper = "#f4efe4",
        ink = "#1a1a24",
        thresholds = [0.85, 0.65, 0.45, 0.25],
        mix = 0,
        spacing = 7,
        thickness = 1.3,
        wobble = 2.5,
        contrast = 1.25,
        tint = 0.25,
        edge = 1.0,
        width = 1.2,
        normalThreshold = 0.35,
        depthThreshold = 0.0015,
    } = {}) {
        super("CrosshatchEffect", FRAG, {
            blendFunction: BlendFunction.NORMAL,
            attributes: EffectAttribute.DEPTH,
            uniforms: new Map([
                ["tNormal", new Uniform(normalTexture)],
                ["uPaper", new Uniform(new Color(paper))],
                ["uInk", new Uniform(new Color(ink))],
                ["uThr", new Uniform(new Vector4(...thresholds))],
                ["uMix", new Uniform(mix)],
                ["uSpacing", new Uniform(spacing)],
                ["uThickness", new Uniform(thickness)],
                ["uWobble", new Uniform(wobble)],
                ["uContrast", new Uniform(contrast)],
                ["uTint", new Uniform(tint)],
                ["uEdge", new Uniform(edge)],
                ["uWidth", new Uniform(width)],
                ["uNormalThr", new Uniform(normalThreshold)],
                ["uDepthThr", new Uniform(depthThreshold)],
            ]),
        })
    }

    get mix() { return this.uniforms.get("uMix").value }
    set mix(v) { this.uniforms.get("uMix").value = v }
}