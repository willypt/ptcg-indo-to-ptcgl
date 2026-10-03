# Kartu ID ⇄ EN

[![Live site](https://img.shields.io/badge/live-willypt.github.io%2Fptcg--indo--to--ptcgl-e8590c)](https://willypt.github.io/ptcg-indo-to-ptcgl/)
[![Source](https://img.shields.io/badge/source-GitHub-181717?logo=github)](https://github.com/willypt/ptcg-indo-to-ptcgl)
[![Indonesian data](https://img.shields.io/badge/Indonesian%20data-Pok%C3%A9mon%20Asia-ffcb05)](https://asia.pokemon-card.com/id/card-search/)
[![English data](https://img.shields.io/badge/English%20data-TCGdex-3b82f6)](https://tcgdex.dev)

Maps every Standard-legal **Indonesian** Pokémon TCG print (regulation marks H, I, J) to its **English** counterpart, the card you'd use in Pokémon TCG Live, and back.

- `docs/`: a static page (served on GitHub Pages at https://willypt.github.io/ptcg-indo-to-ptcgl/) that converts deck lists both ways, lets you browse the mapping, and shows coverage. No server needed.
- `data/map.json`: the mapping itself, for anyone who wants to use it in their own tools.
- `data/report.md`: match rate and every card that didn't match automatically, with the reason.

## Current coverage

As of 2026-10-03: **4,132 of 4,152** Standard Indonesian prints (99.5%) are matched to English. Every Trainer and Energy that has an English release is mapped. The 20 unmatched cards have no English print yet:

- Indonesia-only promos (Batik Pikachu)
- The newest Mega Evolution promos (`M-P 166–182`)
- Three promo Trainers: Simbol Kemenangan, Gris, Deura

Spot checks of the automatically tie-broken matches all came out correct. 3,717 of the matched prints also have an English print with the same artwork.

## Why it isn't a simple lookup

Indonesian sets follow the Japanese release structure, not the English one. Set codes and collector numbers don't line up. For example, Indonesian `SV4s 050` Zebstrika is English `PAR 63`. No official cross-reference exists, so the mapping is built from the cards themselves:

| Card kind | How it's matched |
|---|---|
| Pokémon | Indonesian prints keep English Pokémon names. Candidates with the same name are narrowed by a gameplay fingerprint: HP, retreat cost, number of abilities, and each attack's energy count + damage. Attack text is translated, so it is never compared. The Indonesian site has occasional typos in HP or retreat, so if nothing matches exactly the matcher retries without retreat, then without HP; the report notes which step matched. |
| Trainer / Energy | Names are translated ("Bola Nest" = Nest Ball), so they go through the curated dictionary `data/trainer-names.json`. The English target must exist as an English Standard card of the same subtype (Item, Supporter, Stadium, Tool). Character names sometimes differ entirely ("Lilac" = Jacinthe, "Suci" = Gwynn); each of those was confirmed against the English effect text. |

Name differences between the two languages live in `data/pokemon-names.json`: trainer owners (`<Tim Roket>` = Team Rocket's, `<Mistika>` = Iono's) and forms ("Ogerpon Topeng Teal" = Teal Mask Ogerpon). When two different English cards share the same stats (the 30th Celebration Pikachus, for example), the matcher compares regulation mark, attack names left in English, and the numbers in the effect text. The few it still can't separate are pinned by hand in `data/overrides.json`.

Cards with the same name and effect are interchangeable in play, so a match can point to several English prints. To keep the exact print, the converter compares artwork: every card image gets a perceptual hash (`scripts/hash-art.ts`, of the art window and of the whole card), and the English print whose art matches the Indonesian one is used. On known pairs, same-art prints scored 0–8 out of 64 and different art 22+, so the cut-off is 12. When no English print shares the art (Asia-only artwork, for example), the converter falls back to a *canonical* print: a regular expansion over special sets, main-set numbering over secret rares, then the most recent set. The browse view labels each row "same art" or "different art".

## Data sources

- Indonesian: [asia.pokemon-card.com/id/card-search](https://asia.pokemon-card.com/id/card-search/), the official Pokémon Asia database, filtered to Standard. Scraped politely (4 concurrent requests, 200 ms delay) and cached locally.
- English: [TCGdex](https://tcgdex.dev) GraphQL API. Its Indonesian data stops at SV9s, which is why it isn't used for that side.

## Running it locally

You need [Bun](https://bun.sh) 1.1 or later and Git.

```sh
git clone https://github.com/willypt/ptcg-indo-to-ptcgl.git
cd ptcg-indo-to-ptcgl
bun install         # only dependency is sharp, used for image hashing
bun run dev         # serves docs/ at http://localhost:3000
```

That's enough to use the converter: the generated data (`docs/map.json`) is committed, so nothing has to be rebuilt first.

To rebuild the data from scratch:

```sh
bun run scrape:id   # Indonesian Standard cards → data/id-cards.json (~20 min first run, cached in data/.cache after)
bun run fetch:en    # English H/I/J cards from TCGdex → data/en-cards.json (~2 min)
bun run hash:art    # picture fingerprints of every card → data/art-hashes.json (~40 min first run, only new cards after)
bun run build       # matching → data/map.json, docs/map.json, data/report.md (seconds)
```

`bun run all` runs the four steps in order.

## When a new set comes out

Run this whenever a new Indonesian set or a new English set releases. An Indonesian set usually comes out first; its cards stay `unmatched` until the English set exists, and match on the next update after that.

1. **Refresh the data:** `bun run all`. Only new cards are downloaded and fingerprinted, so a normal update takes a few minutes.
2. **Read `data/report.md`.** The top table shows the match rate; the list below it names every card that didn't match and why. Each reason has its own fix:

   | Reason in the report | What to do |
   |---|---|
   | `"Bola Xyz" missing from trainer-names.json` | A new Trainer or Energy name. Add `"Bola Xyz": "English Name"` to `data/trainer-names.json`. If the name isn't an obvious translation (character names often differ), compare the effect text on both sites before adding it. |
   | `no English Pokémon named "Pinsir <Siapa>"` | A new trainer owner or form name. Add it to `owners` or `pokemon` in `data/pokemon-names.json`. |
   | `"English Name" is not an English Standard card` | The English set isn't out yet, or isn't in TCGdex yet. Nothing to do; it matches on a later update. |
   | `N different English "X" cards fit equally` | Two English cards with identical stats. Read both effect texts and pin the right one in `data/overrides.json` (`"SET NUMBER": "tcgdex-card-id"`). |
   | A whole new English set is missing | TCGdex sometimes leaves a new set without regulation marks (as it did with 30th Celebration). Add its TCGdex set id to `UNMARKED_SETS` in both `scripts/fetch-en.ts` and `scripts/build-map.ts`, then re-run from `fetch:en`. |

3. **Rebuild after editing:** `bun run build` (no re-download needed), and check the report again.
4. **Try it:** `bun run dev`, paste a deck that uses the new set, and look at the deck images.
5. **Publish:** commit and push to `main`. GitHub Pages serves `docs/`, so the live site updates within a minute or two.

## Deck list formats

- Pokepedia.id's Indonesian format is read as-is, and is the default output for PTCG Live → Indonesian (switchable to the official site's naming): `3 Snorunt MA3 035/193`, `Perintah Bos [Ghetsis]`, `Energi Dasar [Psikis]`, card-count headers and `Total: 60`.
- English side: PTCG Live export format, `4 Mega Gardevoir ex MEG 60`. `Basic {P} Energy` and `Psychic Energy` are both accepted.
- Indonesian side: the same shape with Indonesian set codes, `4 Mega Gardevoir ex MA1 060`. Set and number are optional; a name alone picks any matching print.

## Known limits

- Indonesian sets release before their English versions. Cards from those sets have no English match until the English set is out, so they're reported as `unmatched` instead of guessed.
- English basic Energy is written as TCGdex names it (`Psychic Energy MEE 5`). The input side accepts PTCG Live's `Basic {P} Energy` too.
- TCGdex hasn't tagged 30th Celebration with regulation marks yet, so that set is fetched whole (`UNMARKED_SETS` in `scripts/fetch-en.ts`).
- The Indonesian site is not an official API. If its HTML changes, the scraper's parser (`scripts/scrape-id.ts`) needs updating.

Inspired by [Pokepedia.id](https://pokepedia.id). Unofficial fan tool, by WillyPT @ [Brewek Santai](https://www.instagram.com/breweksantai). Not affiliated with The Pokémon Company, Nintendo, Creatures or GAME FREAK.
