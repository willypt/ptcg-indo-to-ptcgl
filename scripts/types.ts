export interface Skill {
  /** "Ability", or the section header as printed: "Serangan" (attack), "Item", "Supporter", … */
  kind: string;
  name: string;
  cost: string[];
  damage: string;
  effect: string;
}

/** One print scraped from asia.pokemon-card.com/id. */
export interface IdCard {
  detailId: number;
  setCode: string;
  setName: string;
  /** Printed collector number, e.g. "019/130" or "110/SV-P". */
  number: string;
  regulationMark: string | null;
  name: string;
  category: "Pokemon" | "Trainer" | "Energy";
  stage: string | null;
  /** Trainer/Energy header as printed (Item, Supporter, Stadium, …). */
  subtype: string | null;
  hp: number | null;
  types: string[];
  skills: Skill[];
  weakness: string | null;
  resistance: string | null;
  retreat: number | null;
  image: string;
  url: string;
}

/** One English print from TCGdex. */
export interface EnCard {
  id: string;
  name: string;
  setId: string;
  setName: string;
  /** PTCG Live / tournament set code, e.g. "PAR". */
  ptcgo: string | null;
  number: string;
  /** Cards in the set's main numbering; higher numbers are secret rares. */
  setOfficial: number;
  regulationMark: string | null;
  category: "Pokemon" | "Trainer" | "Energy";
  stage: string | null;
  trainerType: string | null;
  energyType: string | null;
  hp: number | null;
  types: string[];
  retreat: number | null;
  attacks: { name: string; cost: string[]; damage: string; effect: string }[];
  abilities: { name: string; effect: string }[];
  releaseDate: string;
  image: string | null;
}
