import { type ReferenceOrbit, orbitTextureSize } from "./reference";
import { type KernelMode, VERTEX_SHADER, buildFragmentShader } from "./shader";

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
] as const;

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
  }

  /** Largest offscreen render this GPU will accept, in pixels per axis. */
  get maxRenderSize(): number {
    return this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE) as number;
  }

  private getProgram(kernel: KernelMode, aa: number): ProgramInfo {
    const key = `${kernel}${aa}`;
    const cached = this.programs.get(key);
    if (cached) return cached;

    const gl = this.gl;
    const fragment = compile(
      gl,
      gl.FRAGMENT_SHADER,
      buildFragmentShader({ kernel, aa }),
    );
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

  private draw(width: number, height: number, params: RenderParams): void {
    const gl = this.gl;
    const kernel =
      params.kernel === "perturb" && !params.orbit ? "double" : params.kernel;
    const { program, uniforms } = this.getProgram(kernel, params.aa);

    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, width, height);

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
    gl.uniform1i(uniforms.uPalette, params.palette);
    gl.uniform1f(uniforms.uColorCycle, Math.max(1, params.colorCycle));
    gl.uniform1f(uniforms.uColorOffset, params.colorOffset);
    gl.uniform3f(uniforms.uInteriorColor, ...params.interior);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
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
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    for (const { program } of this.programs.values()) gl.deleteProgram(program);
    this.programs.clear();
    gl.deleteShader(this.vertexShader);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.orbitTexture) gl.deleteTexture(this.orbitTexture);
    this.vao = null;
    this.orbitTexture = null;
    this.uploadedOrbit = null;
  }
}
