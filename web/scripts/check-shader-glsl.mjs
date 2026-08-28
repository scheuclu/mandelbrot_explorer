/**
 * Static sanity check over every GLSL source the renderer can generate.
 *
 *   node --experimental-strip-types web/scripts/check-shader-glsl.mjs
 *
 * A shader only compiles when a GPU sees it, so `tsc` and `next build` both
 * pass happily on GLSL that will fail at runtime. This catches the cheap class
 * of that: identifiers that collide with words GLSL ES 3.00 reserves. It exists
 * because `ivec2 sample = ...` shipped once and broke colour cycling entirely
 * with "Illegal use of reserved word".
 *
 * It is not a compiler. It will not catch type errors or bad swizzles.
 */
import {
  buildColorizeShader,
  buildCountShader,
  buildFragmentShader,
} from "../lib/shader.ts";

// GLSL ES 3.00, section 3.7: keywords reserved for future use. Words that are
// merely built-in types or functions are legal to shadow and are not listed.
const RESERVED = [
  "active", "asm", "atomic_uint", "attribute", "cast", "class", "coherent",
  "common", "double", "enum", "extern", "external", "filter", "fixed",
  "fvec2", "fvec3", "fvec4", "goto", "half", "hvec2", "hvec3", "hvec4",
  "image1D", "image2D", "image3D", "imageCube", "inline", "input", "interface",
  "long", "namespace", "noinline", "output", "partition", "patch", "precise",
  "public", "readonly", "resource", "restrict", "row_major", "sample",
  "sampler3DRect", "shared", "short", "sizeof", "static", "subroutine",
  "superp", "template", "this", "typedef", "union", "unsigned", "using",
  "varying", "volatile", "writeonly",
];

/** Comments are free to say "double"; only code matters. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const KERNELS = ["single", "double", "perturb"];
const AA_VALUES = [1, 2, 3];

const variants = [];
for (const kernel of KERNELS) {
  for (const aa of AA_VALUES) {
    variants.push([`fragment ${kernel} AA=${aa}`, buildFragmentShader({ kernel, aa })]);
    variants.push([`count ${kernel} AA=${aa}`, buildCountShader(kernel, aa)]);
  }
}
for (const aa of AA_VALUES) {
  variants.push([`colorize AA=${aa}`, buildColorizeShader(aa)]);
}

let failures = 0;
for (const [name, source] of variants) {
  const code = stripComments(source);
  const problems = [];

  for (const word of RESERVED) {
    const hit = new RegExp(`\\b${word}\\b`).exec(code);
    if (hit) problems.push(`reserved word "${word}" at index ${hit.index}`);
  }
  if (!source.startsWith("#version 300 es")) {
    problems.push("missing #version 300 es on the first line");
  }
  if (!/void\s+main\s*\(\s*\)/.test(code)) problems.push("no main()");

  const opens = (code.match(/{/g) ?? []).length;
  const closes = (code.match(/}/g) ?? []).length;
  if (opens !== closes) problems.push(`unbalanced braces: ${opens} vs ${closes}`);

  if (problems.length > 0) {
    failures++;
    console.error(`FAIL ${name}`);
    for (const problem of problems) console.error(`     ${problem}`);
  }
}

console.log(`${variants.length} shader variants checked, ${failures} failing`);
if (failures > 0) process.exit(1);
console.log("PASS");
