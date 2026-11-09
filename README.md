# Block Buster

A top-down hex-grid shooter for the browser, built mobile-first. Drill outward through a crystal mine, break the Keystone, and spend what you mine on upgrades between levels.

**Play:** https://ctmbren.github.io/block-buster/ (deployed automatically from `main` by GitHub Actions)

## How it plays

- **Move:** drag on the left side of the screen (WASD on desktop). **Aim:** touch anywhere else (mouse on desktop). The blaster fires automatically.
- Gem colour shows remaining HP: amethyst → sapphire → emerald → topaz → amber → ruby → grey (one hit left).
- Every level is generated from its number, so there's no limit and any level replays exactly.
- **Objective:** break the 7-hex Keystone. From level 3 it sits inside a force field powered by generators elsewhere on the map; follow the beams and break them first.
- **Stars:** Keystone (2 skill points), clear 70% of gems (1), all 3 golden gems (1). Each star pays once per level.
- Breaking the Keystone opens an exit; walk into it, or the mine collapses after 90 seconds.

## Currencies

| Currency | Earned | Spent on | Lasts |
| --- | --- | --- | --- |
| Shards | Breaking gems in a level | Blaster boosts and specialty shots (Multishot, Ricochet, Piercing, Poison) | Resets each level |
| Ore | Ore veins, generators, the Keystone, plus 10% of Shards collected | Permanent stat upgrades (no level cap) | Forever |
| Skill points | Stars | Unlocks: Poison, extra ability slots, perks, Mastery | Forever |

Specialty shots are timed abilities: tap their button to fire them for a few seconds, then they cool down.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check and build to dist/
```

Code lives in `src/`:

- `economy.ts` — every formula: level scaling, costs, upgrade effects
- `level.ts` — seeded procedural level generator
- `game.ts` — in-level simulation (movement, shots, damage, rewards)
- `render.ts` — canvas renderer (crystal mine style)
- `ui.ts`, `style.css` — HUD, shop, results and upgrade screens
- `input.ts`, `audio.ts`, `save.ts` — controls, synthesized sound, localStorage save
