# Kartu ID ⇄ EN

Maps every Standard-legal **Indonesian** Pokémon TCG print (regulation marks H, I, J) to its **English** counterpart, the card you'd use in Pokémon TCG Live, and back.

- `docs/`: a static page (served on GitHub Pages at https://willypt.github.io/ptcg-indo-to-ptcgl/) that converts deck lists both ways, lets you browse the mapping, and shows coverage. No server needed.
- `data/map.json`: the mapping itself, for anyone who wants to use it in their own tools.
- `data/report.md`: match rate and every card that didn't match automatically, with the reason.

## Current coverage

As of 2026-10-03: **4,132 of 4,152** Standard Indonesian prints (99.5%) are matched to English. Every Trainer and Energy that has an English release is mapped. The 20 unmatched cards have no English print yet:

- Indonesia-only promos (Batik Pikachu)
- The newest Mega Evolution promos (`M-P 166–182`)
- Three promo Trainers: Simbol Kemenangan, Gris, Deura

Spot checks of the automatically tie-broken matches all came out correct.

## Why it isn't a simple lookup

Indonesian sets follow the Japanese release structure, not the English one. Set codes and collector numbers don't line up. For example, Indonesian `SV4s 050` Zebstrika is English `PAR 63`. No official cross-reference exists, so the mapping is built from the cards themselves:

| Card kind | How it's matched |
|---|---|
| Pokémon | Indonesian prints keep English Pokémon names. Candidates with the same name are narrowed by a gameplay fingerprint: HP, retreat cost, number of abilities, and each attack's energy count + damage. Attack text is translated, so it is never compared. The Indonesian site has occasional typos in HP or retreat, so if nothing matches exactly the matcher retries without retreat, then without HP; the report notes which step matched. |
| Trainer / Energy | Names are translated ("Bola Nest" = Nest Ball), so they go through the curated dictionary `data/trainer-names.json`. The English target must exist as an English Standard card of the same subtype (Item, Supporter, Stadium, Tool). Character names sometimes differ entirely ("Lilac" = Jacinthe, "Suci" = Gwynn); each of those was confirmed against the English effect text. |

Name differences between the two languages live in `data/pokemon-names.json`: trainer owners (`<Tim Roket>` = Team Rocket's, `<Mistika>` = Iono's) and forms ("Ogerpon Topeng Teal" = Teal Mask Ogerpon). When two different English cards share the same stats (the 30th Celebration Pikachus, for example), the matcher compares regulation mark, attack names left in English, and the numbers in the effect text. The few it still can't separate are pinned by hand in `data/overrides.json`.

Cards with the same name and effect are interchangeable in play, so a match can point to several English prints. To keep the exact print, the converter compares artwork: every card image gets a perceptual hash (`scripts/hash-art.ts`, of the art window and of the whole card), and the English print whose art matches the Indonesian one is used. On known pairs, same-art prints scored 0–8 out of 64 and different art 24+, so the cut-off is 12. When no English print shares the art (Asia-only artwork, for example), the converter falls back to a *canonical* print: a regular expansion over special sets, main-set numbering over secret rares, then the most recent set. The browse view labels each row "same art" or "different art".

## Data sources

- Indonesian: [asia.pokemon-card.com/id/card-search](https://asia.pokemon-card.com/id/card-search/), the official Pokémon Asia database, filtered to Standard. Scraped politely (4 concurrent requests, 200 ms delay) and cached locally.
- English: [TCGdex](https://tcgdex.dev) GraphQL API. Its Indonesian data stops at SV9s, which is why it isn't used for that side.

## Running it

Requires [Bun](https://bun.sh).

```sh
bun run scrape:id   # Indonesian Standard cards → data/id-cards.json (~20 min first run, cached after)
bun run fetch:en    # English H/I/J cards → data/en-cards.json
bun run hash:art    # perceptual hashes of every card image → data/art-hashes.json (~40 min first run, cached after)
bun run build       # match → data/map.json, docs/map.json, data/report.md
bun run dev         # serve docs/ locally
```

When a new Indonesian set releases, re-run all three steps. Any new trainer names show up as `unmatched` in `data/report.md`. Add them to `data/trainer-names.json` and run `build` again.

## Deck list formats

- Pokepedia.id's Indonesian format is read as-is, and is the default output for PTCG Live → Indonesian (switchable to the official site's naming): `3 Snorunt MA3 035/193`, `Perintah Bos [Ghetsis]`, `Energi Dasar [Psikis]`, card-count headers and `Total: 60`.
- English side: PTCG Live export format, `4 Mega Gardevoir ex MEG 60`. `Basic {P} Energy` and `Psychic Energy` are both accepted.
- Indonesian side: the same shape with Indonesian set codes, `4 Mega Gardevoir ex MA1 060`. Set and number are optional; a name alone picks any matching print.

## Known limits

- Indonesian sets release before their English versions. Cards from those sets have no English match until the English set is out, so they're reported as `unmatched` instead of guessed.
- English basic Energy is written as TCGdex names it (`Psychic Energy MEE 5`). The input side accepts PTCG Live's `Basic {P} Energy` too.
- TCGdex hasn't tagged 30th Celebration with regulation marks yet, so that set is fetched whole (`UNMARKED_SETS` in `scripts/fetch-en.ts`).
- The Indonesian site is not an official API. If its HTML changes, the scraper's parser (`scripts/scrape-id.ts`) needs updating.

Inspired by [Pokepedia.id](https://pokepedia.id). Unofficial fan project. Not affiliated with The Pokémon Company, Nintendo, Creatures or GAME FREAK.
