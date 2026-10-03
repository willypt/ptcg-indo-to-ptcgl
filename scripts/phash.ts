// DCT-based perceptual hash (pHash). Parametrized by DCT input size N and
// hash side K. The canonical Zauner/pHash.org configuration is N=32, K=8 → 64
// bits. We also expose N=64, K=16 → 256 bits for cases where the 8×8 DCT
// block doesn't carry enough mid-frequency detail (e.g. distinguishing same-
// art reprints with different stamp/foil overlays).
//
// Algorithm (per call):
//   1. Caller provides an N×N grayscale buffer (one byte per pixel).
//   2. Compute 2D DCT-II of the N×N matrix.
//   3. Take the top-left K×K block (low-frequency components).
//   4. Compute median of those K² values, excluding the DC term at [0][0].
//   5. For each of the K² coefficients, emit a 1 bit if coefficient > median.
//   6. Pack the bits MSB-first into a BigInt.

// Cache DCT matrices per N so we don't recompute cosines per call.
const dctCache = new Map<number, Float64Array>();

function getDctMatrix(N: number): Float64Array {
  let m = dctCache.get(N);
  if (m) return m;
  m = new Float64Array(N * N);
  const c0 = Math.sqrt(1 / N);
  const ck = Math.sqrt(2 / N);
  for (let k = 0; k < N; k++) {
    const coeff = k === 0 ? c0 : ck;
    for (let n = 0; n < N; n++) {
      m[k * N + n] = coeff * Math.cos((Math.PI / N) * (n + 0.5) * k);
    }
  }
  dctCache.set(N, m);
  return m;
}

function dct2d(input: Float64Array, N: number): Float64Array {
  const M = getDctMatrix(N);
  const tmp = new Float64Array(N * N);
  // rows
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let n = 0; n < N; n++) {
        s += M[k * N + n]! * input[j * N + n]!;
      }
      tmp[k * N + j] = s;
    }
  }
  const out = new Float64Array(N * N);
  // columns
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let n = 0; n < N; n++) {
        s += M[k * N + n]! * tmp[j * N + n]!;
      }
      out[k * N + j] = s;
    }
  }
  return out;
}

// Generic pHash: input is N×N grayscale, output is K²-bit BigInt.
export function pHash(
  gray: Uint8Array | Buffer,
  N: number,
  K: number,
): bigint {
  if (gray.length !== N * N) {
    throw new Error(`pHash expected ${N * N} bytes, got ${gray.length}`);
  }
  const input = new Float64Array(N * N);
  for (let i = 0; i < input.length; i++) input[i] = gray[i]!;

  const dct = dct2d(input, N);

  const block = new Float64Array(K * K);
  for (let y = 0; y < K; y++) {
    for (let x = 0; x < K; x++) {
      block[y * K + x] = dct[y * N + x]!;
    }
  }

  // Median, excluding the DC term at [0][0].
  const sorted = Array.from(block).slice(1).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = (sorted[mid - 1]! + sorted[mid]!) / 2;

  let hash = 0n;
  for (let i = 0; i < block.length; i++) {
    hash <<= 1n;
    if (block[i]! > median) hash |= 1n;
  }
  return hash;
}

// Convenience: 64-bit pHash from a 32×32 grayscale buffer.
export function pHash64(gray32x32: Uint8Array | Buffer): bigint {
  return pHash(gray32x32, 32, 8);
}

// Convenience: 256-bit pHash from a 64×64 grayscale buffer. Used for
// panel_phash where the extra mid-frequency budget is needed.
export function pHash256(gray64x64: Uint8Array | Buffer): bigint {
  return pHash(gray64x64, 64, 16);
}

export function toHex64(h: bigint): string {
  return h.toString(16).padStart(16, "0");
}

export function fromHex64(h: string): bigint {
  return BigInt("0x" + h);
}

export function toHex256(h: bigint): string {
  return h.toString(16).padStart(64, "0");
}

export function fromHex256(h: string): bigint {
  return BigInt("0x" + h);
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0n) {
    x &= x - 1n;
    count++;
  }
  return count;
}
