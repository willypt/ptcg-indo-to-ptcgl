// Perceptual hashes of every card image (Indonesian and English) into data/art-hashes.json,
// so build-map can pick the English print with the same artwork as an Indonesian print.
//
// Two 64-bit pHashes per image: the artwork window of a regular card, and the whole card
// (for full-art prints, where the art fills the card). Images are hashed in memory and not
// kept; the JSON is keyed by image URL so re-runs only fetch new cards.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { pHash64, toHex64 } from "./phash";
import type { EnCard, IdCard } from "./types";

const OUT = "data/art-hashes.json";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
// Artwork window of a standard card, as fractions of the card's width/height.
const ART = { left: 0.08, top: 0.105, width: 0.84, height: 0.385 };

export type ArtHash = { art: string; full: string };

async function gray32(img: sharp.Sharp): Promise<Buffer> {
  return img.grayscale().resize(32, 32, { fit: "fill" }).raw().toBuffer();
}

async function hashImage(url: string): Promise<ArtHash> {
  const res = await fetch(url, { headers: { "User-Agent": "ptcg-id-en/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { width = 0, height = 0 } = await sharp(buf).metadata();
  const crop = {
    left: Math.round(width * ART.left),
    top: Math.round(height * ART.top),
    width: Math.round(width * ART.width),
    height: Math.round(height * ART.height),
  };
  return {
    art: toHex64(pHash64(await gray32(sharp(buf).extract(crop)))),
    full: toHex64(pHash64(await gray32(sharp(buf)))),
  };
}

async function main() {
  const ids: IdCard[] = JSON.parse(await readFile("data/id-cards.json", "utf8"));
  const en: EnCard[] = JSON.parse(await readFile("data/en-cards.json", "utf8"));
  const hashes: Record<string, ArtHash> = existsSync(OUT) ? JSON.parse(await readFile(OUT, "utf8")) : {};

  const urls = [
    ...new Set([...ids.map((c) => c.image), ...en.filter((e) => e.image).map((e) => `${e.image}/low.webp`)]),
  ].filter((u) => u && !hashes[u]);
  console.log(`${urls.length} images to hash (${Object.keys(hashes).length} cached)`);

  let done = 0;
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < urls.length) {
        const url = urls[next++]!;
        try {
          hashes[url] = await hashImage(url);
        } catch (err) {
          failed++;
          console.warn(`  ${url}: ${err}`);
        }
        if (++done % 250 === 0) {
          console.log(`  ${done}/${urls.length}`);
          await writeFile(OUT, JSON.stringify(hashes));
        }
      }
    }),
  );
  await writeFile(OUT, JSON.stringify(hashes));
  console.log(`Wrote ${Object.keys(hashes).length} hashes to ${OUT} (${failed} failed)`);
}

if (import.meta.main) await main();
