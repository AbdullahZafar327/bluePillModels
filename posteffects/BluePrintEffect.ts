//@ts-nocheck
import * as THREE from "three"

import {
    BlendFunction,
    Effect,
    EffectAttribute,
} from "postprocessing"

const FRAG = `
    uniform sampler2D tNormal;
    uniform vec3 uBg;
    uniform vec3 uFill;
    uniform vec3 uLine;
    uniform float uMix;        // 0 = normal render, 1 = full blueprint
    uniform float uWidth;      // line width in px
    uniform float uNormalThr;
    uniform float uDepthThr;
    uniform float uFillAmount;
    uniform float uInvert;     // 1 = light surfaces become dark blue

    void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec2 o = texelSize * uWidth;

        // Roberts cross on normals (creases + silhouettes vs background)
        vec3 n00 = texture2D(tNormal, uv + vec2(-o.x, -o.y)).rgb;
        vec3 n11 = texture2D(tNormal, uv + vec2( o.x,  o.y)).rgb;
        vec3 n01 = texture2D(tNormal, uv + vec2(-o.x,  o.y)).rgb;
        vec3 n10 = texture2D(tNormal, uv + vec2( o.x, -o.y)).rgb;
        float en = length(n00 - n11) + length(n01 - n10);

        // Roberts cross on depth (same-normal objects in front of each other)
        float d00 = readDepth(uv + vec2(-o.x, -o.y));
        float d11 = readDepth(uv + vec2( o.x,  o.y));
        float d01 = readDepth(uv + vec2(-o.x,  o.y));
        float d10 = readDepth(uv + vec2( o.x, -o.y));
        float ed = abs(d00 - d11) + abs(d01 - d10);

        float e = max(
            smoothstep(uNormalThr, uNormalThr * 2.0, en),
            smoothstep(uDepthThr, uDepthThr * 2.0, ed)
        );

        // duotone fill from the lit image
        float lum = dot(inputColor.rgb, vec3(0.299, 0.587, 0.114));
        float k = mix(lum, 1.0 - lum, uInvert);
        vec3 base = mix(uBg, uFill, clamp(k * uFillAmount, 0.0, 1.0));

        vec3 bp = mix(base, uLine, e);
        outputColor = vec4(mix(inputColor.rgb, bp, uMix), inputColor.a);
    }
`

export class BlueprintEffect extends Effect {
    constructor({
        normalTexture,
        bg = "#0a3a8c",
        fill = "#2f6fd6",
        line = "#9fe8ff",
        mix = 0,
        width = 1.2,
        normalThreshold = 0.35,
        depthThreshold = 0.0015,
        fillAmount = 1.0,
        invert = 1,
    } = {}) {
        super("BlueprintEffect", FRAG, {
            blendFunction: BlendFunction.NORMAL,
            attributes: EffectAttribute.DEPTH,
            uniforms: new Map([
                ["tNormal", new THREE.Uniform(normalTexture)],
                ["uBg", new THREE.Uniform(new THREE.Color(bg))],
                ["uFill", new THREE.Uniform(new THREE.Color(fill))],
                ["uLine", new THREE.Uniform(new THREE.Color(line))],
                ["uMix", new THREE.Uniform(mix)],
                ["uWidth", new THREE.Uniform(width)],
                ["uNormalThr", new THREE.Uniform(normalThreshold)],
                ["uDepthThr", new THREE.Uniform(depthThreshold)],
                ["uFillAmount", new THREE.Uniform(fillAmount)],
                ["uInvert", new THREE.Uniform(invert)],
            ]),
        })
    }

    get mix() { return this.uniforms.get("uMix").value }
    set mix(v) { this.uniforms.get("uMix").value = v }
}