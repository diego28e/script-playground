// The voice conversation's orb (docs/voice.md): a glowing sphere drawn by a WebGL shader, which turns faster and
// ripples with the voice it is given: the learner's while they speak, the tutor's while it reads aloud. Its shader is
// the voice-powered orb the platform's designs use (an `ogl` React component), rewritten for plain WebGL here, since
// the lab's extension has no React and needs no library for one triangle. Without WebGL, a CSS sphere stands in.

export type OrbState = 'connecting' | 'listening' | 'thinking' | 'speaking';

const VERTEX = `
precision highp float;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
uniform float iTime;
uniform vec3 iResolution;
uniform float hue;
uniform float hover;
uniform float rot;
uniform float hoverIntensity;
uniform float dim;
varying vec2 vUv;

vec3 rgb2yiq(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312)));
}
vec3 yiq2rgb(vec3 c) {
  return vec3(c.x + 0.956 * c.y + 0.621 * c.z, c.x - 0.272 * c.y - 0.647 * c.z, c.x - 1.106 * c.y + 1.703 * c.z);
}
vec3 adjustHue(vec3 color, float hueDeg) {
  float hueRad = hueDeg * 3.14159265 / 180.0;
  vec3 yiq = rgb2yiq(color);
  float cosA = cos(hueRad);
  float sinA = sin(hueRad);
  return yiq2rgb(vec3(yiq.x, yiq.y * cosA - yiq.z * sinA, yiq.y * sinA + yiq.z * cosA));
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
}
float snoise3(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - K1);
  vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  vec4 n = h * h * h * h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
  return dot(vec4(31.316), n);
}
vec4 extractAlpha(vec3 colorIn) {
  float a = max(max(colorIn.r, colorIn.g), colorIn.b);
  return vec4(colorIn.rgb / (a + 1e-5), a);
}
const vec3 baseColor1 = vec3(0.611765, 0.262745, 0.996078);
const vec3 baseColor2 = vec3(0.298039, 0.760784, 0.913725);
const vec3 baseColor3 = vec3(0.062745, 0.078431, 0.600000);
const float innerRadius = 0.6;
const float noiseScale = 0.65;
float light1(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * attenuation); }
float light2(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * dist * attenuation); }

vec4 draw(vec2 uv) {
  vec3 color1 = adjustHue(baseColor1, hue);
  vec3 color2 = adjustHue(baseColor2, hue);
  vec3 color3 = adjustHue(baseColor3, hue);
  float ang = atan(uv.y, uv.x);
  float len = length(uv);
  float invLen = len > 0.0 ? 1.0 / len : 0.0;
  float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
  float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
  float d0 = distance(uv, (r0 * invLen) * uv);
  float v0 = light1(1.0, 10.0, d0);
  v0 *= smoothstep(r0 * 1.05, r0, len);
  float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;
  float a = iTime * -1.0;
  vec2 pos = vec2(cos(a), sin(a)) * r0;
  float d = distance(uv, pos);
  float v1 = light2(1.5, 5.0, d);
  v1 *= light1(1.0, 50.0, d0);
  float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
  float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);
  vec3 col = mix(color1, color2, cl);
  col = mix(color3, col, v0);
  col = (col + v1) * v2 * v3;
  col = clamp(col, 0.0, 1.0);
  return extractAlpha(col);
}

void main() {
  vec2 fragCoord = vUv * iResolution.xy;
  vec2 center = iResolution.xy * 0.5;
  float size = min(iResolution.x, iResolution.y);
  vec2 uv = (fragCoord - center) / size * 2.0;
  float s = sin(rot);
  float c = cos(rot);
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
  uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);
  vec4 col = draw(uv);
  col.a *= dim;
  gl_FragColor = vec4(col.rgb * col.a, col.a);
}
`;

/** Per state: the colours' turn on the wheel, and how bright. Listening is the design's own violet and cyan. */
const LOOK: Record<OrbState, { hue: number; dim: number }> = {
  connecting: { hue: 0, dim: 0.45 },
  listening: { hue: 0, dim: 1 },
  thinking: { hue: 0, dim: 0.65 },
  speaking: { hue: -55, dim: 1 },
};

export class Orb {
  readonly node = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private frame = 0;
  private state: OrbState = 'connecting';
  private level = 0;
  private rotation = 0;
  private hue = 0;
  private dim = LOOK.connecting.dim;
  private last = 0;
  private readonly resize = new ResizeObserver(() => this.fit());
  // Reduced motion: the orb still answers the voice, but turns slowly and barely ripples.
  private readonly motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 1;

  /** `level` is read every frame: how loud the voice the orb follows is, 0..1. */
  constructor(private readonly voiceLevel: () => number) {
    this.node.className = 'jp-AcademiaTutor-orb';
    this.node.dataset.state = this.state;
    if (!this.setUp()) this.node.classList.add('jp-mod-fallback');
  }

  set(state: OrbState): void {
    this.state = state;
    this.node.dataset.state = state;
  }

  /** Starts drawing (when shown); stop() when hidden, so a closed conversation costs nothing. */
  start(): void {
    if (this.frame) return;
    this.resize.observe(this.node);
    this.last = performance.now();
    const tick = (now: number) => {
      this.frame = requestAnimationFrame(tick);
      this.draw(now);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resize.disconnect();
    this.node.style.setProperty('--academia-level', '0');
  }

  private setUp(): boolean {
    const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return false;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type) as WebGLShader;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return false;
    const program = gl.createProgram() as WebGLProgram;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    // One triangle that covers the canvas.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const name of ['iTime', 'iResolution', 'hue', 'hover', 'rot', 'hoverIntensity', 'dim']) this.uniforms[name] = gl.getUniformLocation(program, name);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.gl = gl;
    this.node.append(this.canvas);
    return true;
  }

  private fit(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(this.node.clientWidth * ratio);
    const height = Math.round(this.node.clientHeight * ratio);
    if (!width || !height || (this.canvas.width === width && this.canvas.height === height)) return;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  private draw(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // The voice's level, rising fast and falling slowly, so the orb breathes with the words rather than flickering.
    const target = this.state === 'listening' || this.state === 'speaking' ? this.voiceLevel() : 0;
    this.level += (target - this.level) * (target > this.level ? 0.35 : 0.08);
    const look = LOOK[this.state];
    this.hue += (look.hue - this.hue) * 0.06;
    this.dim += (look.dim - this.dim) * 0.08;
    // Always turning a little; faster with the voice, and while it thinks.
    this.rotation += dt * this.motion * (0.3 + (this.state === 'thinking' ? 0.9 : 0) + this.level * 2.4);
    this.node.style.setProperty('--academia-level', this.level.toFixed(3));

    const gl = this.gl;
    if (!gl) return;
    this.fit();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(this.uniforms.iTime, now / 1000);
    gl.uniform3f(this.uniforms.iResolution, this.canvas.width, this.canvas.height, this.canvas.width / Math.max(1, this.canvas.height));
    gl.uniform1f(this.uniforms.hue, this.hue);
    gl.uniform1f(this.uniforms.hover, Math.min(this.level * 2, 1) * this.motion);
    gl.uniform1f(this.uniforms.rot, this.rotation);
    gl.uniform1f(this.uniforms.hoverIntensity, Math.min(this.level * 0.64, 0.8));
    gl.uniform1f(this.uniforms.dim, this.dim);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
