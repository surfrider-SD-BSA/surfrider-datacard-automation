// The digit net's two heavy layers, for WebAssembly with 128-bit SIMD.
//
// Built by scripts/build-net-wasm.mjs into src/lib/net-wasm.ts. The same
// arithmetic as netLogits in src/lib/digits.ts -- pixel-major activations,
// weights laid out [in][ky][kx][out], zero inputs skipped -- with the innermost
// loop over output channels, which clang turns into f32x4 multiply-adds.
// No globals, no calls, no allocation: JS owns the memory and passes offsets.

__attribute__((export_name("conv")))
void conv(const float *restrict x, int h, int w, int c, const float *restrict wt, const float *restrict b,
          int o, int k, int pad, float *restrict out) {
  for (int p = 0; p < h * w; p++)
    for (int oo = 0; oo < o; oo++) out[p * o + oo] = b[oo];
  for (int y = 0; y < h; y++)
    for (int xx = 0; xx < w; xx++) {
      const float *px = x + (y * w + xx) * c;
      for (int i = 0; i < c; i++) {
        const float v = px[i];
        if (v == 0.0f) continue;
        for (int ky = 0; ky < k; ky++) {
          const int oy = y - (ky - pad);
          if (oy < 0 || oy >= h) continue;
          for (int kx = 0; kx < k; kx++) {
            const int ox = xx - (kx - pad);
            if (ox < 0 || ox >= w) continue;
            const float *wr = wt + ((i * k + ky) * k + kx) * o;
            float *dst = out + (oy * w + ox) * o;
            for (int oo = 0; oo < o; oo++) dst[oo] += wr[oo] * v;
          }
        }
      }
    }
}

__attribute__((export_name("dense")))
void dense(const float *restrict x, int in, const float *restrict wt, const float *restrict b, int n,
           float *restrict out) {
  for (int oo = 0; oo < n; oo++) out[oo] = b[oo];
  for (int i = 0; i < in; i++) {
    const float v = x[i];
    if (v == 0.0f) continue;
    const float *row = wt + i * n;
    for (int oo = 0; oo < n; oo++) out[oo] += row[oo] * v;
  }
}
