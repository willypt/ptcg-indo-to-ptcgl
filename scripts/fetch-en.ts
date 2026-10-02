// Fetches every English H/I/J card from TCGdex into data/en-cards.json.

import { writeFile } from "node:fs/promises";
import type { EnCard } from "./types";

const GQL = "https://api.tcgdex.net/v2/graphql";
const REST = "https://api.tcgdex.net/v2/en";
const MARKS = ["H", "I", "J"];
const BASIC_ENERGY_SETS = ["sve", "mee"];
// Sets TCGdex hasn't tagged with regulation marks yet, fetched whole.
const UNMARKED_SETS = ["30th", "30th-c"];

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(GQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (!res.ok || body.errors || !body.data) throw new Error(`TCGdex: ${res.status} ${JSON.stringify(body.errors)}`);
  return body.data;
}

interface RawCard {
  id: string;
  localId: string;
  name: string;
  category: EnCard["category"];
  regulationMark: string | null;
  stage: string | null;
  trainerType: string | null;
  energyType: string | null;
  hp: number | null;
  types: string[] | null;
  retreat: number | null;
  image: string | null;
  attacks: { name: string; cost: string[] | null; damage: string | number | null; effect: string | null }[] | null;
  abilities: { name: string; effect: string | null }[] | null;
  set: { id: string };
}

async function main() {
  const raw: RawCard[] = [];
  for (const mark of MARKS) {
    const { cards } = await gql<{ cards: RawCard[] }>(`{
      cards(filters: { regulationMark: "${mark}" }) {
        id localId name category regulationMark stage trainerType energyType hp types retreat image
        attacks { name cost damage effect } abilities { name effect } set { id }
      }
    }`);
    console.log(`${mark}: ${cards.length} cards`);
    raw.push(...cards);
  }
  // Basic Energy has no regulation mark but is always Standard-legal.
  const { cards: basics } = await gql<{ cards: RawCard[] }>(`{
    cards(filters: { energyType: "Normal" }) {
      id localId name category regulationMark stage trainerType energyType hp types retreat image
      attacks { name cost damage effect } abilities { name effect } set { id }
    }
  }`);
  raw.push(...basics.filter((c) => BASIC_ENERGY_SETS.includes(c.set.id)));
  for (const set of UNMARKED_SETS) {
    // GraphQL errors on these sets (null categories in its index), so use REST card by card.
    const s = (await (await fetch(`${REST}/sets/${set}`)).json()) as { cards: { id: string }[] };
    for (const { id } of s.cards) {
      const c = (await (await fetch(`${REST}/cards/${encodeURIComponent(id)}`)).json()) as RawCard;
      raw.push({ ...c, regulationMark: c.regulationMark ?? null, retreat: c.retreat ?? null, trainerType: c.trainerType ?? null, energyType: c.energyType ?? null, stage: c.stage ?? null, hp: c.hp ?? null, types: c.types ?? null, image: c.image ?? null, attacks: c.attacks ?? null, abilities: c.abilities ?? null });
    }
    console.log(`${set}: ${s.cards.length} cards`);
  }

  // Set metadata (PTCG Live code, release date) from the REST endpoint.
  const setIds = [...new Set(raw.map((c) => c.set.id))];
  const sets = new Map<string, { name: string; ptcgo: string | null; releaseDate: string; official: number }>();
  for (const id of setIds) {
    const s = (await (await fetch(`${REST}/sets/${encodeURIComponent(id)}`)).json()) as {
      name: string;
      releaseDate: string;
      abbreviation?: { official?: string };
      cardCount: { official: number };
    };
    sets.set(id, { name: s.name, ptcgo: s.abbreviation?.official ?? null, releaseDate: s.releaseDate, official: s.cardCount.official });
  }

  const cards: EnCard[] = raw.map((c) => {
    const set = sets.get(c.set.id)!;
    return {
      id: c.id,
      name: c.name,
      setId: c.set.id,
      setName: set.name,
      ptcgo: set.ptcgo,
      number: c.localId,
      setOfficial: set.official,
      regulationMark: c.regulationMark,
      category: c.category,
      stage: c.stage,
      trainerType: c.trainerType,
      energyType: c.energyType,
      hp: c.hp,
      types: c.types ?? [],
      retreat: c.retreat,
      attacks: (c.attacks ?? []).map((a) => ({ name: a.name, cost: a.cost ?? [], damage: String(a.damage ?? ""), effect: a.effect ?? "" })),
      abilities: (c.abilities ?? []).map((a) => ({ name: a.name, effect: a.effect ?? "" })),
      releaseDate: set.releaseDate,
      image: c.image,
    };
  });
  cards.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  await writeFile("data/en-cards.json", JSON.stringify(cards, null, 1));
  console.log(`Wrote ${cards.length} cards from ${sets.size} sets to data/en-cards.json`);
  const noCode = [...sets].filter(([, s]) => !s.ptcgo).map(([id]) => id);
  if (noCode.length) console.warn(`Sets without a PTCG Live code: ${noCode.join(", ")}`);
}

await main();
