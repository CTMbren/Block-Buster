# Block Buster

A top-down hex-grid shooter for the browser, built mobile-first. Drill outward through a crystal mine, break the Keystone, and spend what you mine on upgrades between levels.

**Play:** https://ctmbren.github.io/Block-Buster/ (deployed automatically from `main` by GitHub Actions)

## How it plays

- **Move:** drag on the left side of the screen (WASD on desktop). **Aim:** drag with your right thumb anywhere else; the stick appears where your thumb lands and the aim holds when you let go (mouse on desktop). The blaster fires automatically and a laser sight shows where shots land, including Ricochet bounces.
- **Smart Aim** is a skill-point unlock: while you are not aiming, the turret picks targets itself. Toggle it with the Auto button; dragging the aim stick always overrides it.
- Gem colour shows remaining HP: amethyst → sapphire → emerald → topaz → amber → ruby → grey (one hit left).
- Every level is generated from its number, so there's no limit and any level replays exactly.
- **Objective:** break the 7-hex Keystone. From level 3 it sits inside a force field powered by generators elsewhere on the map; follow the beams and break them first.
- **Stars:** Keystone (2 skill points), clear 70% of gems (1), all 3 golden gems (1). Each star pays once per level.
- **Bonus challenge:** each level rolls one (a chain, Ore gems mined, a Piercing triple, a speed run…) worth +1 skill point once.
- From level 6 some Keystones get an armored shell; from level 10 generators come in linked pairs that must break within 8 seconds of each other.
- Special gems: armored, explosive, golden, Ore veins and deposits, geodes (big Ore), and regenerating gems from level 9.
- Breaking the Keystone opens an exit; walk into it, or the mine collapses after 90 seconds. Ore gems pay double during the collapse.
- **Sealed rooms (level 6+):** the mine is split into rooms behind cyan seals. Clear a room to trigger a Breach: the seal shatters, the next room takes a shockwave, you get a Shard burst and your cooldowns refill, and progress is saved. The last few stragglers in a room crumble on their own. Twin rooms from level 6, a chain of three from level 11.
- **Region stars:** Keystone, Par (open the force field before the par timer runs out) and Vault (break the 3 golds to open a gold-sealed side room, then clear it).
- **Hidden gem (level 8+):** each level hides one glowing gem in a walled pocket. Direct hits do nothing; it needs a bounce, a pierce or a blast. It chimes when you're close. Found gems are marked ◆ in the level picker, and every 10 earns a permanent relic.
- **Lucky effects:** each specialty shot has a 4th Ore line, a small chance per hit while active: Lucky Split (Multishot), Lucky Overcharge (Ricochet), Lucky Rupture (Piercing), Lucky Spread (Poison). Crit is now Lucky Crit.
- A minimap shows the rooms, seals and your position.
- Installs to the home screen and works offline.

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
- `level.ts` — seeded procedural level generator (open disc, levels 1–5)
- `regions.ts` — sealed-room level generator (level 6+)
- `game.ts` — in-level simulation (movement, shots, damage, rewards)
- `render.ts` — canvas renderer (crystal mine style)
- `ui.ts`, `style.css` — HUD, shop, results and upgrade screens
- `input.ts`, `audio.ts`, `save.ts` — controls, synthesized sound, localStorage save
