/**
 * The digit net run in WebAssembly with 128-bit SIMD, where the platform has it.
 *
 * The convolutions and dense layers are almost all of a scan's reading time
 * (measured on 3.15 Imperial with the width-4 net: 907 net runs for 366 boxes,
 * about all of the 35 s). They are the same loops as `netLogits` in digits.ts,
 * compiled from scripts/wasm/net.c with clang -O3 -msimd128, so the innermost
 * multiply-add over output channels runs four floats at a time. ReLU, pooling
 * and flatten stay in JS, on views of the same memory, so nothing is copied
 * between layers.
 *
 * Same arithmetic, same order of summation as the JS version, so the logits
 * agree to float precision (tests/digits-net.test.ts). Where WebAssembly SIMD
 * is not available, `wasmNet` returns null and the JS version runs.
 */
import type { CnnModel } from "./digits";
import { NET_WASM } from "./net-wasm-bytes";

type Engine = { exports: { conv: Function; dense: Function }; memory: WebAssembly.Memory };

type Layer =
  | { type: "conv"; k: number; pad: number; o: number; wt: number; b: number }
  | { type: "relu" }
  | { type: "maxpool"; k: number }
  | { type: "flatten" }
  | { type: "dense"; in: number; n: number; wt: number; b: number };

type Prepared = { engine: Engine; layers: Layer[]; bufA: number; bufB: number; size: number };

const SIDE = 28;
let module: WebAssembly.Module | null | undefined;
const prepared = new WeakMap<CnnModel, Prepared | null>();

function wasmModule(): WebAssembly.Module | null {
  if (module !== undefined) return module;
  try {
    const bin = atob(NET_WASM);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    module = WebAssembly.validate(bytes) ? new WebAssembly.Module(bytes) : null;
  } catch {
    module = null;
  }
  return module;
}

/** Copy a model's weights into WebAssembly memory once, in the layout the kernels read. */
function prepare(model: CnnModel): Prepared | null {
  const mod = wasmModule();
  if (!mod) return null;

  // Shapes first, to size the memory.
  let c = 1;
  let h = SIDE;
  let w = SIDE;
  let floats = 0;
  let maxAct = SIDE * SIDE;
  let flat = { c: 1, h: SIDE, w: SIDE };
  for (const l of model.layers) {
    if (l.type === "conv") {
      floats += l.w.length + l.b.length;
      c = l.out;
    } else if (l.type === "maxpool") {
      h = Math.floor(h / l.k);
      w = Math.floor(w / l.k);
    } else if (l.type === "flatten") {
      flat = { c, h, w };
      c = c * h * w;
      h = w = 1;
    } else if (l.type === "dense") {
      floats += l.w.length + l.b.length;
      c = l.out;
    }
    maxAct = Math.max(maxAct, c * h * w);
  }
  const size = maxAct;
  const bytes = (floats + 2 * size + 16) * 4;
  const memory = new WebAssembly.Memory({ initial: Math.ceil(bytes / 65536) + 1 });
  let inst: WebAssembly.Instance;
  try {
    inst = new WebAssembly.Instance(mod, {
      env: { __linear_memory: memory, __indirect_function_table: new WebAssembly.Table({ initial: 0, element: "anyfunc" }) },
    });
  } catch {
    return null;
  }
  const f = new Float32Array(memory.buffer);
  let at = 16; // floats; keep address 0 unused
  const alloc = (n: number) => {
    const o = at;
    at += n;
    return o;
  };

  const layers: Layer[] = [];
  c = 1;
  h = SIDE;
  w = SIDE;
  for (const l of model.layers) {
    if (l.type === "conv") {
      const { k, pad } = l;
      const o = l.out;
      const wt = alloc(l.w.length);
      // [o][i][ky][kx] -> [i][ky][kx][o]
      for (let oo = 0; oo < o; oo++)
        for (let i = 0; i < c; i++)
          for (let q = 0; q < k * k; q++) f[wt + (i * k * k + q) * o + oo] = l.w[(oo * c + i) * k * k + q]!;
      const b = alloc(o);
      f.set(l.b, b);
      layers.push({ type: "conv", k, pad, o, wt: wt * 4, b: b * 4 });
      c = o;
    } else if (l.type === "relu") {
      layers.push({ type: "relu" });
    } else if (l.type === "maxpool") {
      layers.push({ type: "maxpool", k: l.k });
      h = Math.floor(h / l.k);
      w = Math.floor(w / l.k);
    } else if (l.type === "flatten") {
      flat = { c, h, w };
      layers.push({ type: "flatten" });
      c = c * h * w;
      h = w = 1;
    } else if (l.type === "dense") {
      const n = l.out;
      const wt = alloc(l.w.length);
      // Trained against channel-major input; reordered to the pixel-major
      // activations it is handed, and transposed to [in][out].
      for (let ch = 0; ch < flat.c; ch++)
        for (let p = 0; p < flat.h * flat.w; p++) {
          const from = ch * flat.h * flat.w + p;
          const to = p * flat.c + ch;
          for (let oo = 0; oo < n; oo++) f[wt + to * n + oo] = l.w[oo * l.in + from]!;
        }
      const b = alloc(n);
      f.set(l.b, b);
      layers.push({ type: "dense", in: l.in, n, wt: wt * 4, b: b * 4 });
      flat = { c: n, h: 1, w: 1 };
      c = n;
    }
  }
  const bufA = alloc(size) * 4;
  const bufB = alloc(size) * 4;
  return { engine: { exports: inst.exports as Engine["exports"], memory }, layers, bufA, bufB, size };
}

/** The net's ten logits, in WebAssembly; null where it cannot run here. */
export function wasmNet(bitmap: ArrayLike<number>, model: CnnModel): Float32Array | null {
  let p = prepared.get(model);
  if (p === undefined) {
    p = prepare(model);
    prepared.set(model, p);
  }
  if (!p) return null;
  const { conv, dense } = p.engine.exports;
  const mem = new Float32Array(p.engine.memory.buffer);
  let x = p.bufA;
  let y = p.bufB;
  for (let i = 0; i < SIDE * SIDE; i++) mem[x / 4 + i] = (bitmap[i] ?? 0) / 255;
  let c = 1;
  let h = SIDE;
  let w = SIDE;
  for (const l of p.layers) {
    if (l.type === "conv") {
      conv(x, h, w, c, l.wt, l.b, l.o, l.k, l.pad, y);
      c = l.o;
      [x, y] = [y, x];
    } else if (l.type === "relu") {
      const n = h * w * c;
      const v = mem.subarray(x / 4, x / 4 + n);
      for (let i = 0; i < n; i++) if (v[i]! < 0) v[i] = 0;
    } else if (l.type === "maxpool") {
      const { k } = l;
      const oh = Math.floor(h / k);
      const ow = Math.floor(w / k);
      const src = x / 4;
      const dst = y / 4;
      mem.fill(-Infinity, dst, dst + oh * ow * c);
      for (let yy = 0; yy < oh * k; yy++)
        for (let xx = 0; xx < ow * k; xx++) {
          const s = src + (yy * w + xx) * c;
          const d = dst + (Math.floor(yy / k) * ow + Math.floor(xx / k)) * c;
          for (let ch = 0; ch < c; ch++) if (mem[s + ch]! > mem[d + ch]!) mem[d + ch] = mem[s + ch]!;
        }
      h = oh;
      w = ow;
      [x, y] = [y, x];
    } else if (l.type === "flatten") {
      c = c * h * w;
      h = w = 1;
    } else if (l.type === "dense") {
      dense(x, l.in, l.wt, l.b, l.n, y);
      c = l.n;
      [x, y] = [y, x];
    }
  }
  return Float32Array.from(mem.subarray(x / 4, x / 4 + c));
}
