import { type ReferenceOrbit, orbitTextureSize } from "./reference";
import {
  type KernelMode,
  VERTEX_SHADER,
  buildColorizeShader,
  buildCountShader,
  buildFragmentShader,
} from "./shader";

export interface RenderParams {
  /** Only used by the single/double kernels; perturbation bakes it into the orbit. */
  centerX: number;
  centerY: number;
  spanY: number;
  maxIter: number;
  palette: number;
  colorCycle: number;
  colorOffset: number;
  /** Supersampling grid per axis: 1, 2 or 3. */
  aa: number;
  kernel: KernelMode;
  interior: [number, number, number];
  /** Required when kernel is "perturb". */
  orbit?: ReferenceOrbit | null;
  /** Offset of the view center from the orbit's center, in complex units. */
  deltaC?: [number, number];
}

interface ProgramInfo {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

const UNIFORM_NAMES = [
  "uResolution",
  "uCenterX",
  "uCenterY",
  "uSpan",
  "uSpanX",
  "uSpanY",
  "uDeltaC0X",
  "uDeltaC0Y",
  "uMaxIter",
  "uPalette",
  "uColorCycle",
  "uColorOffset",
  "uInteriorColor",
  "uOrbit",
  "uOrbitSize",
  "uOrbitLength",
  "uCounts",
] as const;

/**
 * Ceiling on the count cache, in samples. Each is one float32, so 32M samples
 * is ~128MB of VRAM — already generous, and a 4K canvas at AA 2 sits right on
 * it. Past this the cache is declined and the single-pass path is used, which
 * is slower to animate but allocates nothing.
 */
const MAX_COUNT_SAMPLES = 32_000_000;

/**
 * Split a JS double into two floats whose sum reproduces ~48 mantissa bits.
 * `x - hi` is exact in double arithmetic, so no precision is lost in the split.
 */
function splitDouble(x: number): [number, number] {
  const hi = Math.fround(x);
  return [hi, Math.fround(x - hi)];
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to allocate shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export class MandelbrotRenderer {
  readonly gl: WebGL2RenderingContext;

  private vao: WebGLVertexArrayObject | null;
  private vertexShader: WebGLShader;
  private programs = new Map<string, ProgramInfo>();
  private disposed = false;

  /** R32F render targets need this; a few older drivers lack it. */
  private colorBufferFloat: boolean;
  private readonly maxTextureSize: number;

  // Cached escape counts, at AA x canvas resolution. Only allocated once
  // something actually asks to recolour without recomputing.
  private countTexture: WebGLTexture | null = null;
  private countFramebuffer: WebGLFramebuffer | null = null;
  private countDims: [number, number] = [0, 0];
  /** Geometry the cached counts belong to; null means nothing is cached. */
  private cacheKey: string | null = null;
  private cacheOrbit: ReferenceOrbit | null = null;

  private orbitTexture: WebGLTexture | null = null;
  /** Identity of the orbit currently on the GPU, to skip redundant uploads. */
  private uploadedOrbit: ReferenceOrbit | null = null;
  private orbitDims: [number, number] = [1, 1];

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false, // supersampling happens in the fragment shader
      depth: false,
      stencil: false,
      desynchronized: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      throw new Error("WebGL2 is not available in this browser.");
    }
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    this.colorBufferFloat = gl.getExtension("EXT_color_buffer_float") !== null;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  }

  /** Whether recolouring without recomputing escape counts is possible here. */
  get supportsCountCache(): boolean {
    return this.colorBufferFloat;
  }

  /** Largest offscreen render this GPU will accept, in pixels per axis. */
  get maxRenderSize(): number {
    return this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE) as number;
  }

  private getProgram(kernel: KernelMode, aa: number): ProgramInfo {
    return this.buildProgram(`shade:${kernel}:${aa}`, () =>
      buildFragmentShader({ kernel, aa }),
    );
  }

  private getCountProgram(kernel: KernelMode, aa: number): ProgramInfo {
    return this.buildProgram(`count:${kernel}:${aa}`, () =>
      buildCountShader(kernel, aa),
    );
  }

  private getColorizeProgram(aa: number): ProgramInfo {
    return this.buildProgram(`color:${aa}`, () => buildColorizeShader(aa));
  }

  private buildProgram(key: string, source: () => string): ProgramInfo {
    const cached = this.programs.get(key);
    if (cached) return cached;

    const gl = this.gl;
    const fragment = compile(gl, gl.FRAGMENT_SHADER, source());
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to allocate program");
    gl.attachShader(program, this.vertexShader);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${log}`);
    }

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of UNIFORM_NAMES) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    const info = { program, uniforms };
    this.programs.set(key, info);
    return info;
  }

  /** Upload a reference orbit as an RGBA32F texture (skipped if unchanged). */
  private bindOrbit(orbit: ReferenceOrbit): [number, number] {
    const gl = this.gl;

    if (!this.orbitTexture) this.orbitTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.orbitTexture);

    if (this.uploadedOrbit !== orbit) {
      const [width, height] = orbitTextureSize(orbit.length);
      // texImage2D needs the full rectangle, so pad the tail of the last row.
      const padded = new Float32Array(width * height * 4);
      padded.set(orbit.data.subarray(0, Math.min(orbit.data.length, padded.length)));

      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, padded,
      );
      // Integer indexing only — filtering would blend unrelated iterations.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.uploadedOrbit = orbit;
      this.orbitDims = [width, height];
    }
    return this.orbitDims;
  }

  /** Perturbation silently degrades to the double kernel without an orbit. */
  private static kernelFor(params: RenderParams): KernelMode {
    return params.kernel === "perturb" && !params.orbit
      ? "double"
      : params.kernel;
  }

  /** Everything the escape-time kernel needs. Shared by both count paths. */
  private setGeometryUniforms(
    uniforms: ProgramInfo["uniforms"],
    width: number,
    height: number,
    params: RenderParams,
    kernel: KernelMode,
  ): void {
    const gl = this.gl;
    const [cxHi, cxLo] = splitDouble(params.centerX);
    const [cyHi, cyLo] = splitDouble(params.centerY);
    const spanX = params.spanY * (width / height);

    gl.uniform2f(uniforms.uResolution, width, height);
    gl.uniform2f(uniforms.uCenterX, cxHi, cxLo);
    gl.uniform2f(uniforms.uCenterY, cyHi, cyLo);
    gl.uniform2f(uniforms.uSpan, spanX, params.spanY);
    gl.uniform1i(uniforms.uMaxIter, Math.max(1, Math.round(params.maxIter)));

    if (kernel === "perturb" && params.orbit) {
      const [ow, oh] = this.bindOrbit(params.orbit);
      const [dx, dy] = params.deltaC ?? [0, 0];
      gl.uniform2f(uniforms.uSpanX, ...splitDouble(spanX));
      gl.uniform2f(uniforms.uSpanY, ...splitDouble(params.spanY));
      gl.uniform2f(uniforms.uDeltaC0X, ...splitDouble(dx));
      gl.uniform2f(uniforms.uDeltaC0Y, ...splitDouble(dy));
      gl.uniform1i(uniforms.uOrbit, 0);
      gl.uniform2i(uniforms.uOrbitSize, ow, oh);
      gl.uniform1i(uniforms.uOrbitLength, params.orbit.length);
    }
  }

  private setColorUniforms(
    uniforms: ProgramInfo["uniforms"],
    params: RenderParams,
  ): void {
    const gl = this.gl;
    gl.uniform1i(uniforms.uPalette, params.palette);
    gl.uniform1f(uniforms.uColorCycle, Math.max(1, params.colorCycle));
    gl.uniform1f(uniforms.uColorOffset, params.colorOffset);
    gl.uniform3f(uniforms.uInteriorColor, ...params.interior);
  }

  private draw(width: number, height: number, params: RenderParams): void {
    const gl = this.gl;
    const kernel = MandelbrotRenderer.kernelFor(params);
    const { program, uniforms } = this.getProgram(kernel, params.aa);

    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, width, height);
    this.setGeometryUniforms(uniforms, width, height, params, kernel);
    this.setColorUniforms(uniforms, params);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /**
   * Escape counts into the R32F cache, one sample per fragment.
   * `width`/`height` are the *canvas* size; the viewport is AA times that, and
   * the shader recovers the pixel index from gl_FragCoord.
   */
  private drawCounts(width: number, height: number, params: RenderParams): void {
    const gl = this.gl;
    const kernel = MandelbrotRenderer.kernelFor(params);
    const aa = Math.max(1, Math.round(params.aa));
    const { program, uniforms } = this.getCountProgram(kernel, aa);

    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, width * aa, height * aa);
    // Canvas resolution, not sample resolution: the uv expression in the count
    // shader must match the single-pass one exactly.
    this.setGeometryUniforms(uniforms, width, height, params, kernel);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Cached counts -> pixels. The only pass that reruns while cycling. */
  private drawColorize(
    width: number,
    height: number,
    params: RenderParams,
  ): void {
    const gl = this.gl;
    const { program, uniforms } = this.getColorizeProgram(params.aa);

    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, width, height);
    // Unit 1: unit 0 belongs to the orbit texture and must survive.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.countTexture);
    gl.uniform1i(uniforms.uCounts, 1);
    this.setColorUniforms(uniforms, params);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Identity of the geometry a cached count buffer was produced from. */
  private geometryKey(
    width: number,
    height: number,
    params: RenderParams,
  ): string {
    const [dx, dy] = params.deltaC ?? [0, 0];
    return [
      width,
      height,
      params.aa,
      MandelbrotRenderer.kernelFor(params),
      params.maxIter,
      params.centerX,
      params.centerY,
      params.spanY,
      dx,
      dy,
    ].join("|");
  }

  private ensureCountTarget(width: number, height: number): boolean {
    const gl = this.gl;
    if (
      this.countTexture &&
      this.countDims[0] === width &&
      this.countDims[1] === height
    ) {
      return true;
    }
    this.disposeCountCache();

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      return false;
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null,
    );
    // texelFetch only, so filtering would never kick in — but NEAREST also
    // keeps R32F sampleable on drivers that refuse to filter float textures.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0,
    );
    const complete =
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (!complete) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      // Some drivers advertise the extension but reject R32F as a colour
      // attachment. Stop asking rather than retrying every frame.
      this.colorBufferFloat = false;
      return false;
    }

    this.countTexture = texture;
    this.countFramebuffer = framebuffer;
    this.countDims = [width, height];
    return true;
  }

  /**
   * Compute escape counts into the cache, then colour them onto the canvas.
   * Returns false when the cache is unavailable or too large, in which case
   * the caller should fall back to `render`.
   */
  renderCached(width: number, height: number, params: RenderParams): boolean {
    if (this.disposed || !this.colorBufferFloat || width < 1 || height < 1) {
      return false;
    }
    const gl = this.gl;
    const aa = Math.max(1, Math.round(params.aa));
    const sampleWidth = width * aa;
    const sampleHeight = height * aa;
    if (
      sampleWidth > this.maxTextureSize ||
      sampleHeight > this.maxTextureSize ||
      sampleWidth * sampleHeight > MAX_COUNT_SAMPLES
    ) {
      return false;
    }
    if (!this.ensureCountTarget(sampleWidth, sampleHeight)) return false;

    const canvas = gl.canvas as HTMLCanvasElement;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.countFramebuffer);
    this.drawCounts(width, height, params);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.cacheKey = this.geometryKey(width, height, params);
    this.cacheOrbit = params.orbit ?? null;
    this.drawColorize(width, height, params);
    return true;
  }

  /**
   * Redraw from cached counts with new colour settings. Returns false if the
   * cache does not match the requested geometry.
   */
  recolor(width: number, height: number, params: RenderParams): boolean {
    if (this.disposed || !this.countTexture || this.cacheKey === null) {
      return false;
    }
    if (this.cacheKey !== this.geometryKey(width, height, params)) return false;
    if ((params.orbit ?? null) !== this.cacheOrbit) return false;

    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    if (canvas.width !== width || canvas.height !== height) return false;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.drawColorize(width, height, params);
    return true;
  }

  /** Release the count buffer. Worth doing as soon as cycling stops. */
  disposeCountCache(): void {
    const gl = this.gl;
    if (this.countTexture) gl.deleteTexture(this.countTexture);
    if (this.countFramebuffer) gl.deleteFramebuffer(this.countFramebuffer);
    this.countTexture = null;
    this.countFramebuffer = null;
    this.countDims = [0, 0];
    this.cacheKey = null;
    this.cacheOrbit = null;
  }

  /**
   * Resize the drawing buffer if needed and render into it.
   * Returns false if the canvas has no area yet.
   */
  render(width: number, height: number, params: RenderParams): boolean {
    if (this.disposed || width < 1 || height < 1) return false;
    const canvas = this.gl.canvas as HTMLCanvasElement;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.draw(width, height, params);
    return true;
  }

  /**
   * Render offscreen at an arbitrary size and read the pixels back, without
   * disturbing what is on screen. Rows come out top-down, ready for ImageData.
   */
  renderToPixels(
    width: number,
    height: number,
    params: RenderParams,
  ): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.gl;
    const limit = this.maxRenderSize;
    if (width > limit || height > limit) {
      throw new Error(
        `This GPU caps offscreen renders at ${limit}x${limit} pixels.`,
      );
    }

    const framebuffer = gl.createFramebuffer();
    const renderbuffer = gl.createRenderbuffer();
    try {
      gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.RENDERBUFFER,
        renderbuffer,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Offscreen framebuffer is incomplete.");
      }

      this.draw(width, height, params);

      const raw = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);

      // readPixels returns bottom-up; flip into top-down row order.
      const flipped = new Uint8ClampedArray(raw.length);
      const stride = width * 4;
      for (let y = 0; y < height; y++) {
        const src = (height - 1 - y) * stride;
        flipped.set(raw.subarray(src, src + stride), y * stride);
      }
      return flipped;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteRenderbuffer(renderbuffer);
    }
  }

  /** Drop cached programs after a context loss so they get rebuilt. */
  invalidate(): void {
    this.programs.clear();
    this.orbitTexture = null;
    this.uploadedOrbit = null;
    // The GL objects are gone with the context; drop the handles, do not
    // try to delete them.
    this.countTexture = null;
    this.countFramebuffer = null;
    this.countDims = [0, 0];
    this.cacheKey = null;
    this.cacheOrbit = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    for (const { program } of this.programs.values()) gl.deleteProgram(program);
    this.programs.clear();
    gl.deleteShader(this.vertexShader);
    this.disposeCountCache();
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.orbitTexture) gl.deleteTexture(this.orbitTexture);
    this.vao = null;
    this.orbitTexture = null;
    this.uploadedOrbit = null;
  }
}
