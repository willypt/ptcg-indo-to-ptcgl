// Joins data/id-cards.json with data/en-cards.json into data/map.json.
//
// Pokémon: Indonesian prints keep English Pokémon names, so candidates are English
// cards with the same name, narrowed by a gameplay fingerprint (HP, retreat,
// abilities, and each attack's energy count + damage). Text is translated, so it
// is never compared.
// Trainers & Energy: names are translated, so they go through the curated
// dictionary in data/trainer-names.json and are then checked for the same subtype.
//
// Writes data/map.json (consumed by the web app) and data/report.md.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fromHex64, hammingDistance } from "./phash";
import type { EnCard, IdCard } from "./types";

const idCards: IdCard[] = JSON.parse(await readFile("data/id-cards.json", "utf8"));
const enCards: EnCard[] = JSON.parse(await readFile("data/en-cards.json", "utf8"));
const dict: Record<string, string> = JSON.parse(await readFile("data/trainer-names.json", "utf8"));

const overrides: Record<string, string> = JSON.parse(await readFile("data/overrides.json", "utf8"));
const aliases: { owners: Record<string, string>; pokemon: Record<string, string> } = JSON.parse(
  await readFile("data/pokemon-names.json", "utf8"),
);

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const dmg = (d: string) => d.replace(/[×✕]/g, "x").replace(/\s/g, "");
const numbers = (s: string) => (s.match(/\d+/g) ?? []).sort().join(",");

// Indonesian prints write trainer-owned Pokémon as "Pinsir <Ethan>" and translate
// some owners and forms ("<Tim Roket>", "Kyurem Hitam"); English uses "Ethan's Pinsir".
function idPokemonName(name: string): string {
  const ex = / ex$/.test(name) ? " ex" : "";
  let base = name.replace(/ ex$/, "");
  const owner = base.match(/^(.*?)\s*<([^>]+)>$/);
  if (owner) base = `${aliases.owners[owner[2]!] ?? owner[2]}'s ${owner[1]}`;
  return (aliases.pokemon[base] ?? base) + ex;
}

// The Indonesian site lists the Tera rule box as a zero-cost "Terastal" attack and
// sometimes renders blank attack rows; neither is a real attack.
const idAttacks = (c: IdCard) =>
  c.skills.filter((s) => s.kind !== "Ability" && !(s.name === "Terastal" && !s.cost.length) && (s.name || s.effect));
const idAbilities = (c: IdCard) => c.skills.filter((s) => s.kind === "Ability");

type Fp = { hp: number | null; retreat: number; abilities: number; attacks: string };
const idFp = (c: IdCard): Fp => ({
  hp: c.hp,
  retreat: c.retreat ?? 0,
  abilities: idAbilities(c).length,
  attacks: idAttacks(c).map((s) => `${s.cost.length}:${dmg(s.damage)}`).join(","),
});
const enFp = (c: EnCard): Fp => ({
  hp: c.hp,
  retreat: c.retreat ?? 0,
  abilities: c.abilities.length,
  attacks: c.attacks.map((a) => `${a.cost.length}:${dmg(a.damage)}`).join(","),
});

// Progressively looser comparisons. The Indonesian site has occasional typos in
// HP or retreat, so later tiers drop those fields.
const TIERS: { label: string; same: (a: Fp, b: Fp) => boolean }[] = [
  { label: "exact", same: (a, b) => a.hp === b.hp && a.retreat === b.retreat && a.abilities === b.abilities && a.attacks === b.attacks },
  { label: "ignoring retreat", same: (a, b) => a.hp === b.hp && a.abilities === b.abilities && a.attacks === b.attacks },
  { label: "ignoring HP and retreat", same: (a, b) => a.abilities === b.abilities && a.attacks === b.attacks },
];

// Different English cards (not just reprints) are told apart by attack/ability names.
const cardKey = (e: EnCard) => [...e.abilities.map((a) => a.name), ...e.attacks.map((a) => a.name)].join("/");

// Tie-break score for an English card vs the Indonesian print: regulation mark,
// attack/ability names left untranslated, and numbers in the effect text.
function score(c: IdCard, e: EnCard): number {
  let s = 0;
  if (e.regulationMark && e.regulationMark === c.regulationMark) s += 2;
  const idNames = new Set(c.skills.map((k) => norm(k.name)));
  for (const a of [...e.attacks, ...e.abilities]) if (idNames.has(norm(a.name))) s += 3;
  const idNums = [...idAbilities(c), ...idAttacks(c)].map((k) => numbers(k.effect));
  const enNums = [...e.abilities, ...e.attacks].map((a) => numbers(a.effect));
  idNums.forEach((n, i) => {
    if (n && n === enNums[i]) s += 1;
  });
  return s;
}

const TRAINER_SUBTYPE: Record<string, string> = {
  Item: "Item",
  Supporter: "Supporter",
  Stadium: "Stadium",
  "Pokémon Tool": "Tool",
  "Item Pokémon Tool": "Tool",
};

// One English print stands in for a functional card in exported deck lists:
// prefer regular expansions (special sets like 30th Celebration may lag in PTCG Live),
// then prints inside the main numbering (not secret rares), then the most recent set.
const isMain = (e: EnCard) => /^\d+$/.test(e.number) && (!e.setOfficial || Number(e.number) <= e.setOfficial);
const isRegular = (e: EnCard) => !UNMARKED_SETS.has(e.setId);
const UNMARKED_SETS = new Set(["30th", "30th-c"]);
// Promos are only chosen when nothing else exists (or when converting a promo, see sameArt).
const isPromoEn = (e: EnCard) => e.setId === "svp" || e.setId === "mep";
const isPromoId = (c: IdCard) => /-P$/.test(c.setCode);
function canonical(prints: EnCard[]): EnCard {
  return [...prints].sort(
    (a, b) =>
      Number(!!b.image) - Number(!!a.image) || // a picture beats none (TCGdex lacks MEE energy art)
      Number(isPromoEn(a)) - Number(isPromoEn(b)) ||
      Number(isRegular(b)) - Number(isRegular(a)) ||
      Number(isMain(b)) - Number(isMain(a)) ||
      b.releaseDate.localeCompare(a.releaseDate) ||
      Number(a.number) - Number(b.number),
  )[0]!;
}

const byName = new Map<string, EnCard[]>();
for (const c of enCards) {
  const k = norm(c.name);
  byName.set(k, [...(byName.get(k) ?? []), c]);
}

type Status = "matched" | "ambiguous" | "unmatched";
interface Row {
  id: IdCard;
  status: Status;
  reason?: string;
  en: EnCard[];
}

function matchPokemon(c: IdCard): Row {
  const name = idPokemonName(c.name);
  const sameName = (byName.get(norm(name)) ?? []).filter((e) => e.category === "Pokemon");
  if (!sameName.length) return { id: c, status: "unmatched", reason: `no English Pokémon named "${name}"`, en: [] };

  const fp = idFp(c);
  for (const tier of TIERS) {
    const hits = sameName.filter((e) => tier.same(fp, enFp(e)));
    if (!hits.length) continue;
    const note = tier.label === "exact" ? undefined : `matched ${tier.label}`;
    const groups = Map.groupBy(hits, cardKey);
    if (groups.size === 1) return { id: c, status: "matched", reason: note, en: hits };

    const ranked = [...groups.values()]
      .map((prints) => ({ prints, score: Math.max(...prints.map((e) => score(c, e))) }))
      .sort((a, b) => b.score - a.score);
    const forced = overrides[`${c.setCode} ${c.number.split("/")[0]}`];
    const pinned = forced && [...groups.values()].find((prints) => prints.some((e) => e.id === forced));
    if (pinned) return { id: c, status: "matched", reason: "look-alike resolved by data/overrides.json", en: pinned };
    const [best, next] = ranked;
    if (best!.score > next!.score)
      return { id: c, status: "matched", reason: [note, `picked over ${groups.size - 1} look-alike(s) by tie-break`].filter(Boolean).join("; "), en: best!.prints };
    return { id: c, status: "ambiguous", reason: `${groups.size} different English "${name}" cards fit equally`, en: hits };
  }
  return { id: c, status: "unmatched", reason: `no English "${name}" with HP ${fp.hp}, attacks ${fp.attacks || "none"}`, en: [] };
}

function match(c: IdCard): Row {
  if (c.category === "Pokemon") return matchPokemon(c);

  const enName = dict[c.name];
  if (!enName) return { id: c, status: "unmatched", reason: `"${c.name}" missing from trainer-names.json`, en: [] };
  const hits = (byName.get(norm(enName)) ?? []).filter((e) => e.category === c.category);
  if (!hits.length) return { id: c, status: "unmatched", reason: `"${enName}" is not an English Standard card`, en: [] };
  const want = c.category === "Trainer" ? TRAINER_SUBTYPE[c.subtype ?? ""] : null;
  if (want && hits.some((h) => h.trainerType !== want))
    return { id: c, status: "ambiguous", reason: `subtype ${c.subtype} vs ${hits[0]!.trainerType}`, en: hits };
  return { id: c, status: "matched", en: hits };
}

const rows = idCards.map(match);

// Same-artwork prints: compare perceptual hashes (data/art-hashes.json from hash-art.ts)
// between an Indonesian print and each English print of the same card. The art-window
// hash catches regular cards; the whole-card hash catches full-art ones.
const artHashes: Record<string, { art: string; full: string }> = existsSync("data/art-hashes.json")
  ? JSON.parse(await readFile("data/art-hashes.json", "utf8"))
  : {};
// Of 64 bits, on the art window. Calibrated on known pairs: same artwork scored 0–8,
// different artwork 22+. The whole-card hash is only trusted when nearly identical,
// because Trainer cards share a layout and look alike as whole cards (12 apart for
// different Boss's Orders art).
const ART_MAX_DISTANCE = 12;
const FULL_MAX_DISTANCE = 6;
const enHash = (e: EnCard) => (e.image ? artHashes[`${e.image}/low.webp`] : undefined);
function artDistance(c: IdCard, e: EnCard): number | null {
  const a = artHashes[c.image];
  const b = enHash(e);
  if (!a || !b) return null;
  const art = hammingDistance(fromHex64(a.art), fromHex64(b.art));
  const full = hammingDistance(fromHex64(a.full), fromHex64(b.full));
  if (art <= ART_MAX_DISTANCE) return art;
  return full <= FULL_MAX_DISTANCE ? full : null;
}
// Prefer the closest artwork. Reprints often reuse the same art (TWM and ASC Dragapult ex),
// so prints within a few bits of the best count as ties and the usual canonical rules pick.
// A promo is only an art match for a promo: a regular print beats a promo that happens to share its art.
function sameArt(c: IdCard, prints: EnCard[]): { en: EnCard } | null {
  const scored = prints
    .filter((e) => isPromoId(c) || !isPromoEn(e))
    .map((e) => ({ e, d: artDistance(c, e) }))
    .filter((x) => x.d !== null) as { e: EnCard; d: number }[];
  if (!scored.length) return null;
  const best = Math.min(...scored.map((x) => x.d));
  return { en: canonical(scored.filter((x) => x.d <= best + 4).map((x) => x.e)) };
}
const artOf = rows.map((r) => (r.status === "matched" ? sameArt(r.id, r.en) : null));

// Reverse direction: for each English print, the Indonesian print of the same card with the closest art.
const idArtOf = new Map<string, { index: number; distance: number }>();
rows.forEach((r, index) => {
  if (r.status !== "matched") return;
  for (const e of r.en) {
    if (isPromoId(r.id) && !isPromoEn(e)) continue; // same rule as sameArt: promos only stand in for promos
    const d = artDistance(r.id, e);
    if (d === null) continue;
    const cur = idArtOf.get(e.id);
    if (!cur || d < cur.distance) idArtOf.set(e.id, { index, distance: d });
  }
});

// Compact payload for the web app: one entry per Indonesian print, English prints by id.
const enUsed = new Map<string, EnCard>();
for (const r of rows) for (const e of r.en) enUsed.set(e.id, e);
const energyArt: Record<string, string> = existsSync("data/energy-art.json")
  ? JSON.parse(await readFile("data/energy-art.json", "utf8"))
  : {};
const map = {
  generatedAt: new Date().toISOString(),
  en: Object.fromEntries(
    [...enUsed.values()].map((e) => [
      e.id,
      {
        name: e.name,
        set: e.ptcgo,
        setName: e.setName,
        number: e.number.replace(/^0+(?=\d)/, ""),
        mark: e.regulationMark,
        // Basic Energy without a picture borrows one from another print (display only).
        image: e.image ?? (e.energyType === "Normal" ? energyArt[e.name] ?? null : null),
        imageBorrowed: !e.image && e.energyType === "Normal" && !!energyArt[e.name],
        idArt: idArtOf.get(e.id)?.index ?? null,
      },
    ]),
  ),
  id: rows.map((r, i) => ({
    name: r.id.name,
    set: r.id.setCode,
    setName: r.id.setName,
    number: r.id.number.split("/")[0],
    // Printed set size ("019/130" → 130); numbers above it are secret rares.
    of: Number(r.id.number.split("/")[1]) || null,
    printed: r.id.number,
    mark: r.id.regulationMark,
    category: r.id.category,
    image: r.id.image,
    url: r.id.url,
    status: r.status,
    reason: r.reason,
    en: r.en.map((e) => e.id),
    // Same-art English print when one exists, else the standard print.
    canonical: r.en.length ? (artOf[i]?.en ?? canonical(r.en)).id : null,
    sameArt: !!artOf[i],
  })),
};
await writeFile("data/map.json", JSON.stringify(map));
await writeFile("docs/map.json", JSON.stringify(map));

// Human-readable report.
const count = (s: Status) => rows.filter((r) => r.status === s).length;
const byCat = (cat: string, s: Status) => rows.filter((r) => r.id.category === cat && r.status === s).length;
const lines = [
  "# Match report",
  "",
  `Generated ${map.generatedAt}. Indonesian Standard prints: ${rows.length}.`,
  "",
  "| Category | Matched | Ambiguous | Unmatched |",
  "|---|---|---|---|",
  ...["Pokemon", "Trainer", "Energy"].map(
    (cat) => `| ${cat} | ${byCat(cat, "matched")} | ${byCat(cat, "ambiguous")} | ${byCat(cat, "unmatched")} |`,
  ),
  `| **Total** | ${count("matched")} | ${count("ambiguous")} | ${count("unmatched")} |`,
  "",
  `Same-art English print found for ${artOf.filter(Boolean).length} of ${count("matched")} matched Indonesian prints.`,
  "",
  "## Not matched or ambiguous",
  "",
  "| Set | No. | Name | Mark | Status | Reason |",
  "|---|---|---|---|---|---|",
  ...rows
    .filter((r) => r.status !== "matched")
    .map((r) => `| ${r.id.setCode} | ${r.id.number} | ${r.id.name} | ${r.id.regulationMark ?? ""} | ${r.status} | ${r.reason ?? ""} |`),
];
await writeFile("data/report.md", lines.join("\n") + "\n");
console.log(`matched ${count("matched")}, ambiguous ${count("ambiguous")}, unmatched ${count("unmatched")} of ${rows.length}`);
