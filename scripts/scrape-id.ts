// Scrapes Standard-legal Indonesian cards from the official Pokémon Asia site
// (https://asia.pokemon-card.com/id/card-search/) into data/id-cards.json.
//
// Per expansion: list pages filtered with regulation=1 (Standard) → detail IDs →
// detail page parsed into gameplay fields (HP, attacks, costs, retreat, mark…).
// Detail HTML is cached under data/.cache so re-runs only fetch new cards.
//
// Env: EXPANSIONS=MA1,SV9s  CONCURRENCY=4  DELAY_MS=200

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { IdCard, Skill } from "./types";

const BASE = "https://asia.pokemon-card.com/id";
const UA = "ptcg-id-en/0.1 (+https://github.com/willypt)";
const CACHE = "data/.cache/id";
const OUT = "data/id-cards.json";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const DELAY_MS = Number(process.env.DELAY_MS ?? 200);
const ONLY = process.env.EXPANSIONS?.split(",").map((s) => s.trim());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, tries = 3): Promise<string> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "id" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err}`);
      await sleep(1000 * i);
    }
  }
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "") // the site sprinkles zero-width joiners into names
    .replace(/\s+/g, " ")
    .trim();

const energies = (html: string) =>
  [...html.matchAll(/various_images\/energy\/([A-Za-z]+)\.png/g)].map((m) => m[1]!);

function parseExpansions(html: string): { code: string; name: string }[] {
  const re = /class="expansionCode"\s+value="([^"]+)"[\s\S]*?<label[^>]*>([\s\S]*?)<\/label>/g;
  return [...html.matchAll(re)].map((m) => ({ code: m[1]!.trim(), name: decode(m[2]!) }));
}

const parseDetailIds = (html: string) =>
  [...new Set([...html.matchAll(/href="\/id\/card-search\/detail\/(\d+)\/"/g)].map((m) => Number(m[1])))];

const parseTotalPages = (html: string) =>
  Number(html.match(/class="resultTotalPages"[^>]*>[^<]*?(\d+)/)?.[1] ?? 1);

export function parseDetail(html: string, detailId: number, setCode: string, setName: string): IdCard | null {
  const h1 = html.match(/<h1 class="pageHeader cardDetail">([\s\S]*?)<\/h1>/)?.[1];
  if (!h1) return null;
  const stage = decode(h1.match(/<span class="evolveMarker">([\s\S]*?)<\/span>/)?.[1] ?? "") || null;
  const name = decode(h1.replace(/<span class="evolveMarker">[\s\S]*?<\/span>/, ""));

  const info = html.match(/<section class="cardInformationColumn">([\s\S]*?)<\/section>/)?.[1] ?? "";
  const main = info.match(/<p class="mainInfomation">([\s\S]*?)<\/p>/)?.[1];
  const hp = main ? Number(main.match(/<span class="number">\s*(\d+)/)?.[1]) || null : null;
  const types = main ? energies(main) : [];

  // Each skillInformation block has a header (Serangan / Kemampuan / Item / Supporter …)
  // followed by one or more .skill entries.
  const skills: Skill[] = [];
  const headers: string[] = [];
  for (const block of info.split('<div class="skillInformation">').slice(1)) {
    const header = decode(block.match(/<h3 class="commonHeader">([\s\S]*?)<\/h3>/)?.[1] ?? "");
    headers.push(header);
    for (const sk of block.split('<div class="skill">').slice(1)) {
      // Abilities are listed under the attack header with an "[Ability]" name prefix.
      const rawName = decode(sk.match(/<span class="skillName">([\s\S]*?)<\/span>/)?.[1] ?? "");
      const isAbility = rawName.startsWith("[Ability]");
      skills.push({
        kind: isAbility ? "Ability" : header,
        name: isAbility ? rawName.replace("[Ability]", "").trim() : rawName,
        cost: energies(sk.match(/<span class="skillCost">([\s\S]*?)<\/span>/)?.[1] ?? ""),
        damage: decode(sk.match(/<span class="skillDamage">([\s\S]*?)<\/span>/)?.[1] ?? ""),
        effect: decode(sk.match(/<p class="skillEffect">([\s\S]*?)<\/p>/)?.[1] ?? ""),
      });
    }
  }

  const td = (cls: string) => info.match(new RegExp(`<td class="${cls}">([\\s\\S]*?)</td>`))?.[1] ?? "";
  const weak = td("weakpoint");
  const resist = td("resist");
  const exp = html.match(/<section class="expansionColumn">([\s\S]*?)<\/section>/)?.[1] ?? "";

  return {
    detailId,
    setCode,
    setName,
    number: decode(exp.match(/<span class="collectorNumber">([\s\S]*?)<\/span>/)?.[1] ?? ""),
    regulationMark: decode(exp.match(/<span class="alpha">([\s\S]*?)<\/span>/)?.[1] ?? "") || null,
    name,
    // Some special Energy pages have an empty header, so fall back to the name.
    category: hp ? "Pokemon" : /energi/i.test(headers[0] ?? "") || /^Energi\s/.test(name) && !headers[0] ? "Energy" : "Trainer",
    stage,
    subtype: hp ? null : headers[0] ?? null,
    hp,
    types,
    skills,
    weakness: energies(weak)[0] ?? null,
    resistance: energies(resist)[0] ?? null,
    retreat: hp ? energies(td("escape")).length : null,
    image: html.match(/<div class="cardImage">\s*<img[^>]*src="([^"]+)"/)?.[1] ?? "",
    url: `${BASE}/card-search/detail/${detailId}/`,
  };
}

async function detailHtml(id: number): Promise<string> {
  const path = `${CACHE}/${id}.html`;
  if (existsSync(path)) return readFile(path, "utf8");
  await sleep(DELAY_MS);
  const html = await get(`${BASE}/card-search/detail/${id}/`);
  await writeFile(path, html);
  return html;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  const all = parseExpansions(await get(`${BASE}/card-search/`));
  const expansions = ONLY ? all.filter((e) => ONLY.includes(e.code)) : all;
  console.log(`${all.length} expansions on site, crawling ${expansions.length}`);

  const cards: IdCard[] = [];
  let failed = 0;
  for (const exp of expansions) {
    const listUrl = (p: number) => `${BASE}/card-search/list/?regulation=1&expansionCodes=${encodeURIComponent(exp.code)}&pageNo=${p}`;
    const first = await get(listUrl(1));
    const ids = new Set(parseDetailIds(first));
    if (ids.size === 0) continue; // no Standard-legal cards in this expansion
    const pages = parseTotalPages(first);
    for (let p = 2; p <= pages; p++) {
      await sleep(DELAY_MS);
      for (const id of parseDetailIds(await get(listUrl(p)))) ids.add(id);
    }
    const parsed = await pool([...ids], CONCURRENCY, async (id) => {
      try {
        const card = parseDetail(await detailHtml(id), id, exp.code, exp.name);
        if (!card) console.warn(`  parse failed: ${id}`);
        return card;
      } catch (err) {
        console.warn(`  fetch failed: ${err}`);
        return null;
      }
    });
    const ok = parsed.filter((c): c is IdCard => !!c);
    failed += parsed.length - ok.length;
    cards.push(...ok);
    console.log(`[${exp.code}] ${exp.name}: ${ok.length}/${ids.size} cards (${pages} pages)`);
  }

  cards.sort((a, b) => a.setCode.localeCompare(b.setCode) || a.number.localeCompare(b.number) || a.detailId - b.detailId);
  await writeFile(OUT, JSON.stringify(cards, null, 1));
  console.log(`Wrote ${cards.length} cards to ${OUT} (${failed} failed)`);
  if (failed) process.exitCode = 1;
}

if (import.meta.main) await main();
