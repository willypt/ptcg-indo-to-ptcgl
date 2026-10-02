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

import { readFile, writeFile } from "node:fs/promises";
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
function canonical(prints: EnCard[]): EnCard {
  return [...prints].sort(
    (a, b) =>
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

// Compact payload for the web app: one entry per Indonesian print, English prints by id.
const enUsed = new Map<string, EnCard>();
for (const r of rows) for (const e of r.en) enUsed.set(e.id, e);
const map = {
  generatedAt: new Date().toISOString(),
  en: Object.fromEntries(
    [...enUsed.values()].map((e) => [
      e.id,
      { name: e.name, set: e.ptcgo, setName: e.setName, number: e.number.replace(/^0+(?=\d)/, ""), mark: e.regulationMark, image: e.image },
    ]),
  ),
  id: rows.map((r) => ({
    name: r.id.name,
    set: r.id.setCode,
    setName: r.id.setName,
    number: r.id.number.split("/")[0],
    // Printed set size ("019/130" → 130); numbers above it are secret rares.
    of: Number(r.id.number.split("/")[1]) || null,
    mark: r.id.regulationMark,
    category: r.id.category,
    image: r.id.image,
    url: r.id.url,
    status: r.status,
    reason: r.reason,
    en: r.en.map((e) => e.id),
    canonical: r.en.length ? canonical(r.en).id : null,
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
