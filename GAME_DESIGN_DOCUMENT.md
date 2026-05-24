# MCP Miner Game Design Document

## 1. Overview

### Working Title

MCP Miner

### High Concept

MCP Miner is a passive asteroid-mining progression game for Codex users. The player does normal work or research in Codex, and the game translates observable Codex activity into mining progress, discoveries, gear upgrades, fabrication, base construction, and cozy sci-fi survival events. The player does not need to issue gameplay commands to mine. The game runs quietly in the background and reports progress at the end of Codex replies.

### Player Fantasy

The player is a slightly overworked asteroid prospector using an advanced mining suit and a suspiciously enthusiastic onboard computer. Every Codex session is an expedition. Research scans the asteroid. File exploration maps mineral pockets. Code edits drill into veins. Tests refine ore. Completed work repairs and expands the player's base.

### One-Sentence Pitch

Use Codex like normal, and your work becomes a persistent asteroid-mining expedition where you collect Chonks, discover real and fictional minerals, fulfill orders, upgrade gear, and keep your base alive.

## 2. Design Pillars

### Passive First

The game should progress from the user's actual Codex work, not from explicit game commands. Commands exist for status, settings, sync, and store access.

### Work-Shaped Progress

The game rewards useful patterns of work: research, implementation, verification, review, and completion. It should avoid rewarding raw spam, empty prompts, or repetitive tool loops.

### Privacy By Design

The game should convert Codex activity into abstract game events locally. The cloud service should receive gameplay summaries, not source code, prompts, transcripts, command output, filenames, or repository names unless the user explicitly opts in.

### Lightweight Presence

The game should feel like an ambient HUD inside Codex. End-of-reply reports should be compact, readable, and easy to disable.

### Long-Term Progression

Players should have durable goals: richer asteroids, better gear, rare minerals, base repairs, fabrication devices, order fulfillment, cosmetic unlocks, and eventual guild asteroid projects.

## 3. Target Audience

### Primary Audience

Codex users who spend meaningful time coding, researching, debugging, reviewing, writing, or building artifacts with Codex.

### Secondary Audience

Users who enjoy idle games, progression systems, productivity streaks, RPG gear upgrades, and ambient gamification.

### Player Motivation

- Make everyday Codex work feel more rewarding.
- See visible progress across sessions.
- Collect rare resources, Chonks, minerals, and upgrades.
- Customize a miner, base, and suit.
- Fulfill orders and earn Space Bucks.
- Compare progress with friends or guilds later without exposing private work.

## 4. Platform And Integration

### Primary Platform

Codex desktop app plugin with bundled hooks, MCP server, and optional skills.

### Companion Platform

Web app for optional account sync, progress dashboard, inventory, orders, upgrades, and settings. The MVP web app starts as a dashboard only.

### Plugin Components

- Hooks: observe supported Codex lifecycle events.
- Local game engine: converts events into game rewards.
- Local save store: keeps progress available offline.
- MCP server: exposes utility tools to Codex.
- Web sync client: syncs abstract game state to the cloud.
- Optional skill: teaches Codex how to display MCP Miner summaries and respond to user commands.

## 5. Core Experience

### Default Player Flow

1. Player installs and enables the MCP Miner plugin.
2. Player optionally links an MCP Miner account.
3. Player uses Codex normally.
4. Hooks observe supported work events.
5. Local engine scores the turn.
6. At the end of Codex's response, a compact mining report appears.
7. Progress is saved locally and optionally synced.
8. Player can open the web dashboard or store when desired.

### Example End-Of-Reply Report

```text
MCP Miner: +38 Chonks, nickel seam mapped, suit 92%, order ETA holding.
```

### Expanded Report Example

```text
MCP Miner Expedition Report
Mined: 38 Chonks
Found: nickel x2, Sparkglass x1
Suit: 92%
Order: 18% toward Microthruster Batch
XP: +14 research, +8 engineering
Asteroid: A-17 "Noodle Rock"
```

### Report Frequency

Default: compact report at the end of every meaningful Codex turn. Players can customize reporting frequency.

User settings:

- Off
- Every turn, compact
- Every turn, full
- Meaningful turns only
- Session summary only
- Milestones only

## 6. Core Game Loop

### Passive Loop

1. Codex activity occurs.
2. Activity becomes work energy.
3. Work energy becomes mining actions.
4. Mining actions produce Chonks, ore, elements, minerals, scrap, gems, and odd little artifacts.
5. Resources can be refined, sold, stockpiled, or used in fabrication.
6. Orders create demand for raw materials, refined materials, and fabricated goods.
7. Selling goods earns Space Bucks.
8. Space Bucks buy gear, devices, upgrades, and base improvements.
9. Upgrades unlock richer asteroids, rarer resources, and stranger hazards.

### Meta Loop

1. Complete expeditions across many Codex sessions.
2. Mine asteroids until they are depleted.
3. Build and repair base modules.
4. Fulfill orders before buyers go elsewhere.
5. Buy fabrication devices and manufacture higher-value goods.
6. Upgrade suit, drill, scanner, refinery, drones, and base systems.
7. Unlock richer asteroid classes and eventually guild asteroid projects.

## 7. Codex Activity Mapping

### Activity Categories

| Codex Activity | Game Meaning | Primary Reward |
| --- | --- | --- |
| Starting a session | Launch expedition | Energy reserve |
| Asking research questions | Scan asteroid | Map reveal, research XP |
| Reading files or docs | Survey mineral pockets | Vein discovery |
| Searching code or web | Long-range scan | Rare vein chance |
| Editing files | Drill strike | Chonks, ore |
| Applying patches | Precision extraction | Ore, engineering XP |
| Running builds/tests | Refining ore | Purity bonus |
| Passing tests | Stable extraction | Gem multiplier |
| Failing tests | Hazard event | Suit damage, unstable ore, salvage chance |
| Fixing failures | Recovery operation | Scrap, resilience XP |
| Reviewing code | Defensive survey | Shield/base integrity, safety XP |
| Writing docs | Blueprint drafting | Order planning, base progress |
| Creating artifacts | Fabrication | Components, product unlocks |
| Commit/PR workflow | Return to base | Expedition payout |
| Long focused turn | Deep drilling cycle | Asteroid depletion progress |

### Scoring Principle

Reward work diversity, verification, and completion more than volume.

```text
work_energy =
  base_activity_score
  + research_signal
  + edit_weight
  + verification_bonus
  + completion_bonus
  + variety_bonus
  - spam_penalty
```

```text
mining_output =
  work_energy
  * drill_multiplier
  * asteroid_modifier
  * suit_condition_modifier
  * daily_cap_modifier
```

## 8. Resources

### Primary Mined Material

#### Chonks

Common chunky asteroid material. Chonks are the most recognizable thing the player mines. They are used for basic repairs, low-tier crafting, crude fabrication, and some order fulfillment.

### Money

#### Space Bucks

Spendable currency earned by selling raw materials, refined materials, and fabricated goods. Space Bucks are used to buy gear, fabrication devices, upgrades, base items, and utility services.

### Crafting Materials

#### Ore

Raw extracted material. Ore can be sold as-is, refined for better value, or consumed by fabrication devices.

#### Scrap

Recovered from failed tests, repair events, hazard cleanup, and old equipment.

#### Circuits

Used for scanner, drone, and base automation upgrades.

#### Fuel Cells

Used for long-range expeditions and high-energy asteroid mining.

### Real Elements And Minerals

Asteroids should contain recognizable real materials. These make the economy feel grounded and help orders feel readable.

Science assumption: "solid in space" is not a single physical state because phase depends on temperature and pressure. For game design, MCP Miner uses `solid-core elements` for normal asteroid ore: elements classified as solid, or expected solid, at room-temperature/standard-state references. Volatile elements that can freeze in cold space, bind into compounds, or require pressure are tracked separately as `cryo/volatile specials`.

Sources for this catalog should be the PubChem and RSC periodic tables, both of which expose element standard-state data. PubChem's standard-state view classifies elements by solid, liquid, gas, and expected state; RSC exposes state at 20 degrees C. The game should use those sources as the data baseline and then layer fantasy availability on top.

Reference URLs:

- PubChem periodic table standard-state PDF: https://pubchem.ncbi.nlm.nih.gov/periodic-table/pdf/Periodic_Table_of_Elements_w_Standard_State_PubChem.pdf
- PubChem periodic table data overview: https://pubchem.ncbi.nlm.nih.gov/docs/periodic-table-element-pages
- Royal Society of Chemistry periodic table: https://periodic-table.rsc.org/

MVP shortlist:

| Material | Tier | Primary Use |
| --- | --- | --- |
| Iron | Common | Base repairs, frames, hull plates |
| Nickel | Common | Machine parts, plating |
| Silicon | Common | Circuits, processors, glass |
| Carbon | Common | Filters, composites, fuel |
| Titanium | Uncommon | Suit frames, drill parts |
| Cobalt | Uncommon | Batteries, magnets |
| Lithium | Uncommon | Power cells, drones |
| Platinum | Rare | High-end circuits, luxury orders |
| Iridium | Rare | Deep-space components |
| Uranium | Dangerous | Reactor parts, hazardous orders |

#### Solid-Core Element Catalog

These elements can appear as normal asteroid loot, refined resources, recipe inputs, or high-tier order requirements.

| Z | Symbol | Element | Game Availability |
| ---: | --- | --- | --- |
| 3 | Li | Lithium | Uncommon battery material |
| 4 | Be | Beryllium | Rare lightweight structure |
| 5 | B | Boron | Uncommon ceramics and shielding |
| 6 | C | Carbon | Common composites and filters |
| 11 | Na | Sodium | Common reactive salts |
| 12 | Mg | Magnesium | Common light alloy |
| 13 | Al | Aluminum | Common hull material |
| 14 | Si | Silicon | Common electronics and glass |
| 15 | P | Phosphorus | Uncommon chemical feedstock |
| 16 | S | Sulfur | Common chemical feedstock |
| 19 | K | Potassium | Common reactive salts |
| 20 | Ca | Calcium | Common mineral filler |
| 21 | Sc | Scandium | Rare aerospace alloy |
| 22 | Ti | Titanium | Uncommon suit and drill alloy |
| 23 | V | Vanadium | Uncommon high-strength alloy |
| 24 | Cr | Chromium | Uncommon plating |
| 25 | Mn | Manganese | Common steel additive |
| 26 | Fe | Iron | Common structural metal |
| 27 | Co | Cobalt | Uncommon magnets and batteries |
| 28 | Ni | Nickel | Common plating and machine parts |
| 29 | Cu | Copper | Common wiring |
| 30 | Zn | Zinc | Common coatings and alloys |
| 31 | Ga | Gallium | Uncommon electronics |
| 32 | Ge | Germanium | Uncommon semiconductors |
| 33 | As | Arsenic | Hazardous semiconductor dopant |
| 34 | Se | Selenium | Uncommon optics and sensors |
| 37 | Rb | Rubidium | Rare precision instruments |
| 38 | Sr | Strontium | Uncommon signal materials |
| 39 | Y | Yttrium | Rare ceramics and lasers |
| 40 | Zr | Zirconium | Rare heat-resistant alloy |
| 41 | Nb | Niobium | Rare superconducting components |
| 42 | Mo | Molybdenum | Rare high-temp alloy |
| 43 | Tc | Technetium | Dangerous synthetic tracer |
| 44 | Ru | Ruthenium | Rare catalyst |
| 45 | Rh | Rhodium | Rare catalyst and plating |
| 46 | Pd | Palladium | Rare catalyst |
| 47 | Ag | Silver | Uncommon conductor and luxury material |
| 48 | Cd | Cadmium | Hazardous battery material |
| 49 | In | Indium | Rare display and solder material |
| 50 | Sn | Tin | Common solder and alloy |
| 51 | Sb | Antimony | Uncommon hardening agent |
| 52 | Te | Tellurium | Rare semiconductor material |
| 53 | I | Iodine | Uncommon volatile solid and med-tech input |
| 55 | Cs | Cesium | Dangerous reactive metal |
| 56 | Ba | Barium | Uncommon sensor and shielding material |
| 57 | La | Lanthanum | Rare optics and battery material |
| 58 | Ce | Cerium | Rare catalyst and alloy |
| 59 | Pr | Praseodymium | Rare magnets and glass |
| 60 | Nd | Neodymium | Rare high-power magnets |
| 61 | Pm | Promethium | Dangerous luminous isotope material |
| 62 | Sm | Samarium | Rare magnets and shielding |
| 63 | Eu | Europium | Rare display phosphors |
| 64 | Gd | Gadolinium | Rare sensor and shielding material |
| 65 | Tb | Terbium | Rare actuators and emitters |
| 66 | Dy | Dysprosium | Rare heat-stable magnets |
| 67 | Ho | Holmium | Rare magnetic systems |
| 68 | Er | Erbium | Rare lasers and fiber systems |
| 69 | Tm | Thulium | Rare radiation devices |
| 70 | Yb | Ytterbium | Rare lasers and alloys |
| 71 | Lu | Lutetium | Rare detectors and catalysts |
| 72 | Hf | Hafnium | Rare reactor and heat shield material |
| 73 | Ta | Tantalum | Rare electronics and capacitors |
| 74 | W | Tungsten | Rare heavy-duty drill material |
| 75 | Re | Rhenium | Rare turbine and thruster alloy |
| 76 | Os | Osmium | Rare dense alloy |
| 77 | Ir | Iridium | Rare deep-space component |
| 78 | Pt | Platinum | Rare high-end circuits and luxury orders |
| 79 | Au | Gold | Rare conductor and luxury material |
| 81 | Tl | Thallium | Hazardous specialty electronics |
| 82 | Pb | Lead | Common shielding |
| 83 | Bi | Bismuth | Uncommon low-toxicity heavy alloy |
| 84 | Po | Polonium | Dangerous heat source |
| 85 | At | Astatine | Dangerous ultra-rare halogen |
| 87 | Fr | Francium | Legendary unstable reactive metal |
| 88 | Ra | Radium | Dangerous luminous isotope material |
| 89 | Ac | Actinium | Dangerous isotope material |
| 90 | Th | Thorium | Dangerous reactor fuel |
| 91 | Pa | Protactinium | Dangerous rare actinide |
| 92 | U | Uranium | Dangerous reactor material |
| 93 | Np | Neptunium | Dangerous transuranic material |
| 94 | Pu | Plutonium | Dangerous reactor and weapons-grade material |
| 95 | Am | Americium | Dangerous sensor isotope |
| 96 | Cm | Curium | Dangerous isotope material |
| 97 | Bk | Berkelium | Exotic lab-only material |
| 98 | Cf | Californium | Exotic neutron source |
| 99 | Es | Einsteinium | Exotic lab-only material |
| 100 | Fm | Fermium | Exotic lab-only material |
| 101 | Md | Mendelevium | Exotic lab-only material |
| 102 | No | Nobelium | Exotic lab-only material |
| 103 | Lr | Lawrencium | Exotic lab-only material |
| 104 | Rf | Rutherfordium | Exotic superheavy material |
| 105 | Db | Dubnium | Exotic superheavy material |
| 106 | Sg | Seaborgium | Exotic superheavy material |
| 107 | Bh | Bohrium | Exotic superheavy material |
| 108 | Hs | Hassium | Exotic superheavy material |
| 109 | Mt | Meitnerium | Exotic superheavy material |
| 110 | Ds | Darmstadtium | Exotic superheavy material |
| 111 | Rg | Roentgenium | Exotic superheavy material |
| 112 | Cn | Copernicium | Exotic expected-solid superheavy |
| 113 | Nh | Nihonium | Exotic expected-solid superheavy |
| 114 | Fl | Flerovium | Exotic expected-solid superheavy |
| 115 | Mc | Moscovium | Exotic expected-solid superheavy |
| 116 | Lv | Livermorium | Exotic expected-solid superheavy |
| 117 | Ts | Tennessine | Exotic expected-solid superheavy |

#### Cryo/Volatile Special Elements

These are not normal solid-core asteroid loot. They can appear as cryogenic deposits, trapped ices, pressurized canisters, bound compounds, event resources, or buyer-specific order requirements.

| Z | Symbol | Element | Game Treatment |
| ---: | --- | --- | --- |
| 1 | H | Hydrogen | Fuel ice, hydrides, cryo tanks |
| 2 | He | Helium | Pressure-only cryo resource, fusion and cooling orders |
| 7 | N | Nitrogen | Nitrogen ice, nitrides, atmosphere packs |
| 8 | O | Oxygen | Oxides, oxygen ice, life-support orders |
| 9 | F | Fluorine | Dangerous fluorides and etching chemistry |
| 10 | Ne | Neon | Noble-gas cryo canisters and lighting orders |
| 17 | Cl | Chlorine | Chlorides, disinfectant chemistry, hazard orders |
| 18 | Ar | Argon | Shield gas canisters and welding orders |
| 35 | Br | Bromine | Cold-trap solid or hazardous liquid order input |
| 36 | Kr | Krypton | Noble-gas cryo canisters and engine orders |
| 54 | Xe | Xenon | Ion-drive propellant canisters |
| 80 | Hg | Mercury | Cold-trap solid or hazardous liquid order input |
| 86 | Rn | Radon | Dangerous noble-gas isotope canisters |
| 118 | Og | Oganesson | Theoretical event-only superheavy; state is model-dependent |

#### Element Price Catalog

Prices are baseline Space Bucks per unit for direct market valuation. Order payouts, urgency, buyer reputation, quality, and windfall variation are applied on top of these values. Refined price uses the baseline `ceil(raw_price * 1.55)` rule.

| Z | Symbol | Element | Raw SB/unit | Refined SB/unit |
| ---: | --- | --- | ---: | ---: |
| 1 | H | Hydrogen | 2 | 4 |
| 2 | He | Helium | 18 | 28 |
| 3 | Li | Lithium | 26 | 41 |
| 4 | Be | Beryllium | 42 | 66 |
| 5 | B | Boron | 14 | 22 |
| 6 | C | Carbon | 4 | 7 |
| 7 | N | Nitrogen | 8 | 13 |
| 8 | O | Oxygen | 4 | 7 |
| 9 | F | Fluorine | 30 | 47 |
| 10 | Ne | Neon | 28 | 44 |
| 11 | Na | Sodium | 5 | 8 |
| 12 | Mg | Magnesium | 6 | 10 |
| 13 | Al | Aluminum | 7 | 11 |
| 14 | Si | Silicon | 8 | 13 |
| 15 | P | Phosphorus | 11 | 18 |
| 16 | S | Sulfur | 9 | 14 |
| 17 | Cl | Chlorine | 12 | 19 |
| 18 | Ar | Argon | 20 | 31 |
| 19 | K | Potassium | 7 | 11 |
| 20 | Ca | Calcium | 6 | 10 |
| 21 | Sc | Scandium | 38 | 59 |
| 22 | Ti | Titanium | 18 | 28 |
| 23 | V | Vanadium | 20 | 31 |
| 24 | Cr | Chromium | 16 | 25 |
| 25 | Mn | Manganese | 12 | 19 |
| 26 | Fe | Iron | 5 | 8 |
| 27 | Co | Cobalt | 24 | 38 |
| 28 | Ni | Nickel | 6 | 10 |
| 29 | Cu | Copper | 10 | 16 |
| 30 | Zn | Zinc | 9 | 14 |
| 31 | Ga | Gallium | 34 | 53 |
| 32 | Ge | Germanium | 38 | 59 |
| 33 | As | Arsenic | 28 | 44 |
| 34 | Se | Selenium | 26 | 41 |
| 35 | Br | Bromine | 22 | 35 |
| 36 | Kr | Krypton | 45 | 70 |
| 37 | Rb | Rubidium | 32 | 50 |
| 38 | Sr | Strontium | 24 | 38 |
| 39 | Y | Yttrium | 40 | 62 |
| 40 | Zr | Zirconium | 32 | 50 |
| 41 | Nb | Niobium | 48 | 75 |
| 42 | Mo | Molybdenum | 54 | 84 |
| 43 | Tc | Technetium | 180 | 279 |
| 44 | Ru | Ruthenium | 75 | 117 |
| 45 | Rh | Rhodium | 110 | 171 |
| 46 | Pd | Palladium | 95 | 148 |
| 47 | Ag | Silver | 55 | 86 |
| 48 | Cd | Cadmium | 35 | 55 |
| 49 | In | Indium | 75 | 117 |
| 50 | Sn | Tin | 18 | 28 |
| 51 | Sb | Antimony | 32 | 50 |
| 52 | Te | Tellurium | 48 | 75 |
| 53 | I | Iodine | 30 | 47 |
| 54 | Xe | Xenon | 70 | 109 |
| 55 | Cs | Cesium | 44 | 69 |
| 56 | Ba | Barium | 28 | 44 |
| 57 | La | Lanthanum | 60 | 93 |
| 58 | Ce | Cerium | 58 | 90 |
| 59 | Pr | Praseodymium | 62 | 97 |
| 60 | Nd | Neodymium | 66 | 103 |
| 61 | Pm | Promethium | 210 | 326 |
| 62 | Sm | Samarium | 72 | 112 |
| 63 | Eu | Europium | 80 | 124 |
| 64 | Gd | Gadolinium | 78 | 121 |
| 65 | Tb | Terbium | 92 | 143 |
| 66 | Dy | Dysprosium | 94 | 146 |
| 67 | Ho | Holmium | 96 | 149 |
| 68 | Er | Erbium | 90 | 140 |
| 69 | Tm | Thulium | 105 | 163 |
| 70 | Yb | Ytterbium | 88 | 137 |
| 71 | Lu | Lutetium | 125 | 194 |
| 72 | Hf | Hafnium | 120 | 186 |
| 73 | Ta | Tantalum | 115 | 179 |
| 74 | W | Tungsten | 105 | 163 |
| 75 | Re | Rhenium | 160 | 248 |
| 76 | Os | Osmium | 145 | 225 |
| 77 | Ir | Iridium | 130 | 202 |
| 78 | Pt | Platinum | 90 | 140 |
| 79 | Au | Gold | 120 | 186 |
| 80 | Hg | Mercury | 40 | 62 |
| 81 | Tl | Thallium | 55 | 86 |
| 82 | Pb | Lead | 12 | 19 |
| 83 | Bi | Bismuth | 38 | 59 |
| 84 | Po | Polonium | 240 | 372 |
| 85 | At | Astatine | 300 | 465 |
| 86 | Rn | Radon | 260 | 403 |
| 87 | Fr | Francium | 500 | 775 |
| 88 | Ra | Radium | 240 | 372 |
| 89 | Ac | Actinium | 260 | 403 |
| 90 | Th | Thorium | 125 | 194 |
| 91 | Pa | Protactinium | 260 | 403 |
| 92 | U | Uranium | 110 | 171 |
| 93 | Np | Neptunium | 300 | 465 |
| 94 | Pu | Plutonium | 340 | 527 |
| 95 | Am | Americium | 300 | 465 |
| 96 | Cm | Curium | 360 | 558 |
| 97 | Bk | Berkelium | 420 | 651 |
| 98 | Cf | Californium | 520 | 806 |
| 99 | Es | Einsteinium | 640 | 992 |
| 100 | Fm | Fermium | 800 | 1,240 |
| 101 | Md | Mendelevium | 950 | 1,473 |
| 102 | No | Nobelium | 1,100 | 1,705 |
| 103 | Lr | Lawrencium | 1,300 | 2,015 |
| 104 | Rf | Rutherfordium | 1,700 | 2,635 |
| 105 | Db | Dubnium | 2,000 | 3,100 |
| 106 | Sg | Seaborgium | 2,400 | 3,720 |
| 107 | Bh | Bohrium | 2,800 | 4,340 |
| 108 | Hs | Hassium | 3,300 | 5,115 |
| 109 | Mt | Meitnerium | 3,900 | 6,045 |
| 110 | Ds | Darmstadtium | 4,600 | 7,130 |
| 111 | Rg | Roentgenium | 5,400 | 8,370 |
| 112 | Cn | Copernicium | 6,200 | 9,610 |
| 113 | Nh | Nihonium | 7,000 | 10,850 |
| 114 | Fl | Flerovium | 7,800 | 12,090 |
| 115 | Mc | Moscovium | 8,600 | 13,330 |
| 116 | Lv | Livermorium | 9,400 | 14,570 |
| 117 | Ts | Tennessine | 10,500 | 16,275 |
| 118 | Og | Oganesson | 12,500 | 19,375 |

### Fictional Materials

Fictional materials add personality, humor, and late-game mystery.

| Material | Tier | Flavor | Primary Use |
| --- | --- | --- | --- |
| Sparkglass | Uncommon | Glows when insulted by bad code | Scanner lenses, dashboard trinkets |
| Nebulite | Rare | Condensed purple-ish space nonsense | Advanced batteries, cozy lamps |
| Chatterium | Rare | Vibrates near long conversations | Comms gear, guild beacons |
| Glitchsalt | Rare | Makes machines briefly too confident | Fabrication catalysts |
| Snaccite | Uncommon | Technically edible, legally questionable | Suit morale modules |
| Aetherium | Legendary | Refuses to explain itself | Prestige gear, asteroid keys |

### Gems

Rare progression materials with themed uses.

| Gem | Source | Primary Use |
| --- | --- | --- |
| Quartz | Research, file reading | Scanner upgrades |
| Sapphire | Passing tests, verification | Refinery upgrades |
| Ruby | Heavy edits, implementation | Drill upgrades |
| Emerald | Documentation, planning | Base modules |
| Amethyst | Reviews, refactors | Suit upgrades |
| Diamond | Major milestones | Prestige upgrades |

## 9. Player Stats

### Core Stats

- Chonks mined
- Space Bucks earned
- Ore refined
- Elements and minerals found
- Gems discovered
- Asteroids completed
- Suit condition
- Base integrity
- Energy reserve
- Research XP
- Engineering XP
- Survival XP
- Refinement quality
- Orders fulfilled
- Products fabricated

### Session Stats

- Chonks mined this turn
- Gems found this turn
- Materials added to stock
- Space Bucks earned this turn
- Order progress gained
- Products fabricated
- Hazards triggered
- Repairs completed
- Base progress gained
- Asteroid depletion progress
- XP gained

### Lifetime Stats

- Total Chonks mined
- Total Space Bucks earned
- Total gems discovered
- Total orders fulfilled
- Total products fabricated
- Asteroids completed
- Expeditions completed
- Base rooms repaired
- Upgrades purchased
- Rare finds collected

## 10. Progression Systems

### Miner Avatar

The player has a generated miner avatar that can be customized over time. Codex should help generate the avatar's concept, look, name, suit style, and later visual assets.

Avatar customization:

- Suit colors.
- Helmet shape.
- Visor style.
- Backpack and tool rig.
- Patch badges.
- Mascot decals.
- Pose or profile card.

Avatar generation should be playful and local-first. The player can regenerate or refine their miner identity without affecting gameplay power.

### Miner Suit

The suit protects the player from environmental hazards.

Upgrade tracks:

- Armor: reduces hazard damage.
- Oxygen: extends expedition range.
- Battery: increases energy reserve.
- Mobility: improves exploration efficiency.
- Thermal lining: protects in hot asteroid classes.
- Radiation shielding: protects in radioactive asteroid classes.

### Drill

The drill controls extraction output.

Upgrade tracks:

- Power: increases Chonks mined.
- Precision: increases gem chance.
- Heat control: reduces hazard chance.
- Auto-bit: increases passive mining.
- Resonance head: improves rare vein extraction.

### Scanner

The scanner controls discovery and map reveal.

Upgrade tracks:

- Range: increases vein discovery.
- Resolution: improves gem identification.
- Stability: reduces false positives.
- Asteroid analyzer: improves asteroid-specific rewards.

### Refinery

The refinery turns ore into valuable materials.

Upgrade tracks:

- Purity: increases gem yield.
- Speed: processes more ore per session.
- Efficiency: reduces waste.
- Catalyst slots: adds temporary modifiers.

### Fabrication Devices

Fabrication devices turn mined and refined materials into higher-value products that can be sold through orders.

Device types:

- Basic 3D Printer: produces simple brackets, panels, housings, and repair clips.
- Circuit Loom: produces RAM sticks, processors, sensor boards, and control modules.
- Microforge: produces ship parts, drill heads, nozzles, and pressure fittings.
- Biofoam Extruder: produces filters, insulation, med-gel packs, and questionable space snacks.
- Weird Matter Press: produces fictional-material goods such as Nebulite lamps and Glitchsalt regulators.

Products should require recipes. More complex recipes need rarer materials, better devices, and higher work-category progression.

### Drones

Drones continue background work between active Codex sessions.

Drone types:

- Survey drone: reveals map tiles.
- Repair drone: restores base integrity.
- Hauler drone: increases Chonk storage.
- Refinery drone: processes queued ore.
- Guard drone: reduces hazard losses.

### Base

The base is the player's long-term home and progression hub.

Base modules:

- Command Center: unlocks account sync and expedition logs.
- Workshop: unlocks gear upgrades.
- Refinery: unlocks ore processing.
- Fabrication Bay: unlocks product manufacturing.
- Order Terminal: unlocks buyer orders and quotas.
- Med Bay: improves suit recovery.
- Radar Tower: unlocks map and rare vein alerts.
- Hangar: unlocks drones.
- Vault: increases storage.
- Greenhouse: improves passive recovery.
- Shield Generator: protects from asteroid storms.

## 11. Asteroids And Mining Sites

Asteroids are the main explorable units. Each asteroid has a composition profile, depletion meter, hazard profile, and order suitability score. The player chooses where to mine based on current orders, needed upgrades, and risk tolerance.

### Starter Rubble

Intro asteroid class. Low risk, common Chonks, iron, nickel, silicon, carbon, and frequent scrap.

### Quartz Belt

Research-heavy asteroid class. Rewards scanning, reading, and exploration. High chance for quartz, silicon, Sparkglass, and scanner-related materials.

### Iron Tumblers

Engineering-heavy asteroid class. Rewards edits, builds, and sustained implementation. High chance for iron, nickel, titanium, and ruby-bearing ore.

### Sapphire Debris Field

Verification-heavy asteroid class. Rewards passing tests, debugging, and QA. High chance for sapphire shards, platinum traces, and high-purity ore.

### Ember Rocks

High-risk asteroid class. Rewards big implementation sessions but damages suit if unstable. High chance for cobalt, lithium, uranium, and heat-warped fictional materials.

### Amethyst Archive Belt

Review and documentation asteroid class. Rewards code review, planning, docs, and careful refactoring. High chance for amethyst, Chatterium, and blueprint fragments.

### Diamond-Class Bodies

Late-game asteroid class. Requires strong gear, high base integrity, and consistent verified work. High chance for legendary minerals, Aetherium, and prestige materials.

## 12. Orders And Fabrication Economy

### Order Fantasy

The player is not just mining for a pile. Buyers across space place orders for raw materials, refined materials, and fabricated goods. The player can fill the order from stock or mine/fabricate the missing materials before the order expires and goes elsewhere.

### Order Types

- Raw material orders: deliver Chonks, iron, nickel, carbon, quartz, or other mined goods.
- Refined material orders: deliver purified ingots, crystals, wafers, cells, or alloys.
- Fabricated product orders: deliver finished goods made by fabrication devices.
- Rush orders: short deadline, higher Space Bucks.
- Cozy contracts: low pressure, lower value, good for early progression.
- Specialty orders: require rare real or fictional materials.

### Order Lifecycle

1. Buyer posts order with required items, deadline, payout, and optional bonus.
2. Player checks stock.
3. If stock is missing, scanner recommends asteroid classes known for the needed materials.
4. Codex work generates mining and fabrication progress passively.
5. Player fulfills the order and earns Space Bucks.
6. Missed orders expire and are replaced by other buyers.

### Example Orders

| Order | Requirements | Deadline | Reward |
| --- | --- | --- | --- |
| Patchy Hull Plate Batch | Iron x30, Nickel x12, Chonks x80 | 2 days | 420 Space Bucks |
| RAM For A Nervous Satellite | Silicon x22, Platinum x2, Circuits x4 | 3 days | 980 Space Bucks |
| Cozy Reactor Blanket | Carbon x18, Titanium x8, Snaccite x3 | 4 days | 760 Space Bucks |
| Definitely Legal Microthrusters | Cobalt x10, Lithium x8, Sparkglass x2 | 2 days | 1,350 Space Bucks |
| Glitchsalt Regulator | Glitchsalt x2, Iridium x1, Circuits x8 | 5 days | 2,900 Space Bucks |

### Product Complexity

More complicated products require:

- More input materials.
- Higher-tier fabrication devices.
- More refined materials.
- More rare materials.
- Better scanner/refinery upgrades.
- Higher work-category XP.

The more complicated an item is to acquire or produce, the more Space Bucks it is worth.

### Fabricated Product Order Catalog

Each fabrication machine starts with 100 fabricated product order types. To keep the catalog readable, each machine uses 25 product bases and 4 order variants. Every product base has a required material recipe. Every order variant then applies exact material rules to that base recipe.

Display format:

```text
<Order Variant> <Product Base>
```

Order variants:

| Variant | Material Rule | Gameplay Meaning | Payout Modifier |
| --- | --- | --- | ---: |
| Standard Batch | `base_recipe` | Normal quantity and deadline | 1.00x |
| Rush Batch | `ceil(base_recipe * 1.15)` | Shorter deadline | 1.20x |
| Premium Spec | `ceil(base_recipe * 1.25)` plus `refined primary material x1` | Higher quality requirement, quality grade >= 1 | 1.35x |
| Collector Grade | `ceil(base_recipe * 1.10)` plus listed `collector accent x1` | Low quantity, rare buyer taste, quality grade >= 2 | 1.55x |

This creates 100 order types per machine. Across 5 fabrication machines, the MVP catalog supports 500 fabricated product order types before buyer, quantity, quality, deadline, mineral substitution, and windfall variations.

If an order has quantity greater than one, multiply the final variant recipe by order quantity after applying variant rules.

For Premium Spec orders, `primary material` means the first refinable material in the base recipe. Skip Chonks when selecting the primary material. If the primary material is fictional, use its refined or high-purity equivalent.

#### Fabrication Tier Material Rules

Higher-level machines should only require materials the player can reasonably access by that stage.

| Machine | Progression Tier | Expected Player Access | Allowed Material Band |
| --- | ---: | --- | --- |
| Basic 3D Printer | 1 | Starter Rubble, early Quartz Belt | Chonks, scrap, carbon, iron, nickel, copper, silicon, aluminum, magnesium, sodium, potassium, calcium, quartz |
| Circuit Loom | 2 | Quartz Belt, early Sapphire Debris Field | Basic materials plus lithium, cobalt, silver, gold, tin, gallium, germanium, indium, antimony, Sparkglass, sapphire |
| Microforge | 3 | Iron Tumblers, Ember Rocks | Basic and Circuit materials plus titanium, chromium, manganese, vanadium, zirconium, molybdenum, tungsten, tantalum, hafnium, platinum, iridium, ruby |
| Biofoam Extruder | 2-3 | Starter Rubble, Quartz Belt, Ember Rocks cryo pockets | Basic materials plus hydrogen ice, oxygen ice, nitrogen ice, phosphorus, sulfur, chlorine salts, iodine, Snaccite, Sparkglass |
| Weird Matter Press | 4-5 | Amethyst Archive Belt, Diamond-Class Bodies | Lower-tier materials plus Sparkglass, Nebulite, Chatterium, Glitchsalt, Snaccite, Aetherium, diamond, rhenium, osmium, hafnium, tantalum, uranium |

Cryo and compound recipe materials map back to element prices for valuation: `Hydrogen Ice` uses H, `Oxygen Ice` uses O, `Nitrogen Ice` uses N, and `Chlorine Salts` uses Cl.

#### Basic 3D Printer Recipes

25 bases x 4 variants = 100 Basic 3D Printer order types.

| # | Product Base | Base Recipe | Collector Accent |
| ---: | --- | --- | --- |
| 1 | Hull Patch Clips | Chonks x18; Iron x6; Nickel x2 | Quartz x1 |
| 2 | Cable Brackets | Chonks x12; Carbon x4; Silicon x2; Copper x1 | Aluminum x1 |
| 3 | Conduit Saddles | Chonks x14; Aluminum x4; Silicon x2 | Quartz x1 |
| 4 | Panel Spacers | Chonks x10; Magnesium x3; Carbon x2 | Silicon x1 |
| 5 | Tool Caddies | Chonks x22; Iron x4; Carbon x3 | Nickel x1 |
| 6 | Storage Bin Inserts | Chonks x16; Carbon x5; Aluminum x2 | Quartz x1 |
| 7 | Helmet Visor Frames | Chonks x14; Silicon x4; Aluminum x3 | Quartz x1 |
| 8 | Airlock Label Plates | Chonks x8; Aluminum x2; Carbon x1 | Silicon x1 |
| 9 | Drone Shell Halves | Chonks x20; Magnesium x5; Silicon x3 | Nickel x1 |
| 10 | Sensor Mount Blocks | Chonks x12; Silicon x3; Iron x2 | Quartz x1 |
| 11 | Valve Handle Replacements | Chonks x18; Iron x5; Nickel x2 | Aluminum x1 |
| 12 | Filter Cartridge Housings | Chonks x15; Carbon x6; Silicon x2 | Calcium x1 |
| 13 | Battery Cradle Trays | Chonks x14; Aluminum x4; Sodium x2 | Magnesium x1 |
| 14 | Docking Bumper Pads | Chonks x24; Carbon x8; Calcium x2 | Quartz x1 |
| 15 | Pipe Clamp Sets | Chonks x16; Iron x4; Nickel x2 | Magnesium x1 |
| 16 | Workbench Organizer Rails | Chonks x18; Aluminum x5; Carbon x3 | Silicon x1 |
| 17 | Emergency Wedge Kits | Chonks x20; Iron x3; Magnesium x2 | Quartz x1 |
| 18 | Mini Antenna Stands | Chonks x10; Silicon x5; Aluminum x2 | Copper x1 |
| 19 | Thermal Tile Holders | Chonks x12; Carbon x4; Silicon x4 | Calcium x1 |
| 20 | Bulkhead Corner Caps | Chonks x22; Iron x6; Nickel x2 | Aluminum x1 |
| 21 | Sample Tube Racks | Chonks x10; Silicon x4; Carbon x2 | Quartz x1 |
| 22 | Handrail Connector Sets | Chonks x20; Iron x5; Aluminum x3 | Nickel x1 |
| 23 | Console Button Bezels | Chonks x8; Silicon x3; Carbon x2 | Quartz x1 |
| 24 | Chonk Sorter Trays | Chonks x18; Carbon x4; Potassium x1 | Silicon x1 |
| 25 | Utility Drawer Dividers | Chonks x16; Aluminum x3; Carbon x4 | Magnesium x1 |

#### Circuit Loom Recipes

25 bases x 4 variants = 100 Circuit Loom order types.

| # | Product Base | Base Recipe | Collector Accent |
| ---: | --- | --- | --- |
| 1 | RAM Stick Packs | Silicon x12; Copper x4; Tin x2 | Gold x1 |
| 2 | Navigation Sensor Boards | Silicon x10; Copper x5; Quartz x2 | Sparkglass x1 |
| 3 | Oxygen Controller Cards | Silicon x8; Copper x4; Lithium x2 | Sapphire x1 |
| 4 | Drone Logic Cores | Silicon x12; Copper x6; Cobalt x2 | Gold x1 |
| 5 | Scanner Signal Filters | Silicon x10; Germanium x2; Quartz x3 | Sparkglass x1 |
| 6 | Airlock Timing Modules | Silicon x8; Copper x4; Silver x2 | Sapphire x1 |
| 7 | Refinery Regulator Boards | Silicon x10; Gallium x2; Copper x5 | Sapphire x1 |
| 8 | Fabricator Control Chips | Silicon x12; Germanium x3; Copper x4 | Gold x1 |
| 9 | Suit HUD Flex Ribbons | Silicon x8; Indium x2; Silver x2 | Sparkglass x1 |
| 10 | Battery Management Boards | Silicon x9; Lithium x4; Cobalt x2 | Silver x1 |
| 11 | Thruster Ignition Cards | Silicon x10; Cobalt x3; Copper x5 | Sapphire x1 |
| 12 | Emergency Beacon Boards | Silicon x8; Copper x4; Silver x3 | Gold x1 |
| 13 | Mineral Assay Chips | Silicon x10; Gallium x2; Quartz x2 | Sparkglass x1 |
| 14 | Temperature Probe Arrays | Silicon x8; Antimony x2; Copper x3 | Sapphire x1 |
| 15 | Vault Keypad Matrices | Silicon x9; Copper x4; Aluminum x3 | Silver x1 |
| 16 | Lighting Driver Strips | Silicon x7; Copper x5; Gallium x2 | Sparkglass x1 |
| 17 | Router Backplane Panels | Silicon x12; Copper x8; Tin x3 | Gold x1 |
| 18 | Autopilot Buffer Cards | Silicon x14; Germanium x3; Lithium x2 | Sapphire x1 |
| 19 | Ore Sorter Logic Boards | Silicon x10; Copper x5; Quartz x2 | Sparkglass x1 |
| 20 | Solar Charge Controllers | Silicon x12; Silver x3; Copper x5 | Gold x1 |
| 21 | Shield Phase Timers | Silicon x10; Cobalt x2; Germanium x2 | Sapphire x1 |
| 22 | Docking Lidar Boards | Silicon x11; Gallium x3; Quartz x2 | Sparkglass x1 |
| 23 | Vending Machine Brains | Silicon x8; Copper x4; Tin x2 | Silver x1 |
| 24 | Cargo Scale Circuits | Silicon x9; Copper x5; Cobalt x1 | Sapphire x1 |
| 25 | Signal Cleanup Tiles | Silicon x10; Germanium x2; Silver x2 | Sparkglass x1 |

#### Microforge Recipes

25 bases x 4 variants = 100 Microforge order types.

| # | Product Base | Base Recipe | Collector Accent |
| ---: | --- | --- | --- |
| 1 | Thruster Nozzle Liners | Titanium x8; Tungsten x2; Nickel x4 | Platinum x1 |
| 2 | Docking Clamp Jaws | Iron x10; Nickel x6; Chromium x3 | Titanium x1 |
| 3 | Drill Bit Teeth | Tungsten x4; Cobalt x4; Titanium x5 | Ruby x1 |
| 4 | Pump Impeller Cores | Titanium x6; Vanadium x3; Nickel x5 | Platinum x1 |
| 5 | Pressure Valve Bodies | Iron x8; Chromium x4; Molybdenum x2 | Iridium x1 |
| 6 | Reactor Bracket Arms | Titanium x8; Hafnium x2; Nickel x4 | Platinum x1 |
| 7 | Gyro Stabilizer Rings | Titanium x6; Zirconium x3; Cobalt x2 | Ruby x1 |
| 8 | Heat Sink Blocks | Aluminum x6; Copper x4; Molybdenum x2 | Tungsten x1 |
| 9 | Landing Skid Shoes | Titanium x8; Iron x8; Chromium x3 | Nickel x1 |
| 10 | Antenna Mast Collars | Titanium x5; Aluminum x5; Vanadium x2 | Ruby x1 |
| 11 | Airlock Hinge Pins | Iron x8; Nickel x4; Chromium x2 | Titanium x1 |
| 12 | Cargo Winch Drums | Iron x10; Manganese x4; Nickel x3 | Cobalt x1 |
| 13 | Fuel Injector Tips | Titanium x5; Tantalum x2; Cobalt x3 | Platinum x1 |
| 14 | Hull Rib Segments | Iron x12; Titanium x6; Vanadium x3 | Ruby x1 |
| 15 | Micro Gear Trains | Titanium x4; Cobalt x3; Molybdenum x2 | Iridium x1 |
| 16 | Bolt Head Assortments | Iron x8; Chromium x3; Manganese x3 | Titanium x1 |
| 17 | Bearing Race Sets | Titanium x5; Cobalt x4; Nickel x4 | Platinum x1 |
| 18 | Magnetic Coupler Plates | Cobalt x5; Nickel x6; Iron x6 | Ruby x1 |
| 19 | Shield Emitter Brackets | Titanium x6; Hafnium x2; Tungsten x2 | Iridium x1 |
| 20 | Refinery Crucible Inserts | Tungsten x5; Tantalum x2; Zirconium x3 | Platinum x1 |
| 21 | Printer Rail Carriages | Titanium x5; Chromium x3; Nickel x4 | Ruby x1 |
| 22 | Suit Knee Actuators | Titanium x6; Cobalt x3; Vanadium x3 | Iridium x1 |
| 23 | Drone Rotor Hubs | Titanium x5; Aluminum x5; Cobalt x2 | Ruby x1 |
| 24 | Mining Cart Axles | Iron x12; Manganese x4; Nickel x4 | Titanium x1 |
| 25 | Compressor Pistons | Titanium x6; Molybdenum x2; Chromium x3 | Platinum x1 |

#### Biofoam Extruder Recipes

25 bases x 4 variants = 100 Biofoam Extruder order types.

| # | Product Base | Base Recipe | Collector Accent |
| ---: | --- | --- | --- |
| 1 | Suit Seal Foam Packs | Carbon x8; Hydrogen Ice x4; Silicon x2 | Snaccite x1 |
| 2 | Air Filter Slabs | Carbon x10; Oxygen Ice x3; Calcium x2 | Iodine x1 |
| 3 | Med-Gel Pouches | Hydrogen Ice x6; Oxygen Ice x4; Sodium x2 | Snaccite x1 |
| 4 | Vibration Dampener Pads | Carbon x8; Sulfur x2; Silicon x3 | Sparkglass x1 |
| 5 | Thermal Blanket Rolls | Carbon x10; Magnesium x3; Silicon x2 | Snaccite x1 |
| 6 | Emergency Cushion Blocks | Carbon x12; Nitrogen Ice x3; Calcium x2 | Iodine x1 |
| 7 | Hydroponic Root Mats | Carbon x8; Phosphorus x3; Potassium x2 | Snaccite x1 |
| 8 | Water Reclaimer Sponges | Carbon x8; Oxygen Ice x5; Sodium x2 | Iodine x1 |
| 9 | Impact Absorber Rings | Carbon x10; Silicon x3; Sulfur x2 | Sparkglass x1 |
| 10 | Cable Insulation Sleeves | Carbon x8; Chlorine Salts x2; Silicon x3 | Snaccite x1 |
| 11 | Pressure Bladder Liners | Carbon x10; Hydrogen Ice x4; Nitrogen Ice x2 | Iodine x1 |
| 12 | Reactor Noise Mufflers | Carbon x12; Sulfur x3; Magnesium x2 | Sparkglass x1 |
| 13 | Helmet Comfort Pads | Carbon x6; Hydrogen Ice x3; Calcium x2 | Snaccite x1 |
| 14 | Cold-Sleep Neck Rolls | Carbon x8; Nitrogen Ice x4; Oxygen Ice x2 | Iodine x1 |
| 15 | Anti-Dust Gaskets | Carbon x8; Silicon x3; Sodium x2 | Snaccite x1 |
| 16 | Soft Grip Tool Wraps | Carbon x7; Hydrogen Ice x3; Sulfur x2 | Sparkglass x1 |
| 17 | Repair Putty Tubes | Carbon x8; Silicon x2; Calcium x3 | Iodine x1 |
| 18 | Firebreak Foam Sheets | Carbon x10; Phosphorus x3; Magnesium x2 | Snaccite x1 |
| 19 | Nutrient Bar Blanks | Carbon x6; Nitrogen Ice x2; Potassium x2 | Snaccite x1 |
| 20 | Biofoam Packaging Bricks | Carbon x12; Hydrogen Ice x4; Calcium x2 | Iodine x1 |
| 21 | Sterile Docking Wipes | Carbon x6; Chlorine Salts x3; Oxygen Ice x3 | Snaccite x1 |
| 22 | Decon Curtain Strips | Carbon x8; Chlorine Salts x3; Silicon x2 | Sparkglass x1 |
| 23 | Oxygen Mask Cushions | Carbon x7; Oxygen Ice x4; Calcium x2 | Iodine x1 |
| 24 | Habitat Wall Plugs | Carbon x9; Silicon x3; Magnesium x2 | Snaccite x1 |
| 25 | Morale Pillow Cores | Carbon x6; Hydrogen Ice x4; Snaccite x2 | Sparkglass x1 |

#### Weird Matter Press Recipes

25 bases x 4 variants = 100 Weird Matter Press order types.

| # | Product Base | Base Recipe | Collector Accent |
| ---: | --- | --- | --- |
| 1 | Nebulite Mood Lamps | Nebulite x3; Sparkglass x4; Gold x2 | Diamond x1 |
| 2 | Glitchsalt Regulators | Glitchsalt x3; Iridium x2; Silicon x4 | Aetherium x1 |
| 3 | Chatterium Guild Beacons | Chatterium x4; Platinum x2; Sparkglass x2 | Diamond x1 |
| 4 | Sparkglass Dream Windows | Sparkglass x8; Titanium x2; Gold x1 | Nebulite x1 |
| 5 | Aetherium Lock Keys | Aetherium x2; Iridium x2; Diamond x1 | Glitchsalt x1 |
| 6 | Snaccite Flavor Chonks | Snaccite x5; Carbon x4; Nebulite x1 | Sparkglass x1 |
| 7 | Probability Washers | Glitchsalt x2; Tantalum x2; Platinum x2 | Aetherium x1 |
| 8 | Quantum Cup Holders | Chatterium x3; Hafnium x2; Sparkglass x2 | Nebulite x1 |
| 9 | Anti-Boredom Coils | Chatterium x4; Copper x4; Nebulite x2 | Diamond x1 |
| 10 | Whisperproof Door Plates | Sparkglass x5; Osmium x1; Chatterium x2 | Glitchsalt x1 |
| 11 | Impossible Screw Sets | Glitchsalt x2; Tungsten x3; Iridium x1 | Aetherium x1 |
| 12 | Pocket Gravity Anchors | Aetherium x1; Tungsten x3; Rhenium x2 | Diamond x1 |
| 13 | Time-Safe Lunch Seals | Snaccite x3; Hafnium x2; Nebulite x2 | Glitchsalt x1 |
| 14 | Vibe-Calibrated Antennas | Chatterium x4; Gold x2; Sparkglass x3 | Diamond x1 |
| 15 | Cosmic Receipt Printers | Glitchsalt x2; Silicon x6; Platinum x1 | Nebulite x1 |
| 16 | Memory Fog Condensers | Nebulite x4; Osmium x1; Chatterium x2 | Aetherium x1 |
| 17 | Phase-Shift Name Badges | Sparkglass x4; Iridium x1; Glitchsalt x2 | Diamond x1 |
| 18 | Luck-Compliant Bolts | Glitchsalt x3; Tantalum x2; Tungsten x2 | Aetherium x1 |
| 19 | Mood Stabilizer Discs | Nebulite x3; Snaccite x3; Gold x1 | Sparkglass x1 |
| 20 | Stardust Complaint Filters | Sparkglass x4; Uranium x1; Chatterium x2 | Glitchsalt x1 |
| 21 | Joke-Powered Switches | Chatterium x3; Copper x3; Snaccite x2 | Nebulite x1 |
| 22 | Reality Alignment Shims | Aetherium x1; Iridium x2; Glitchsalt x3 | Diamond x1 |
| 23 | Bureaucracy Deflectors | Chatterium x4; Platinum x2; Nebulite x2 | Aetherium x1 |
| 24 | Apology Amplifier Plates | Sparkglass x5; Gold x2; Chatterium x2 | Diamond x1 |
| 25 | Suspiciously Normal Chonks | Chonks x50; Aetherium x1; Glitchsalt x2 | Nebulite x1 |

## 13. Hazards

### Hazard Types

- Micro-meteor shove: triggered by repeated failed commands or unstable sessions.
- Power drain: triggered by long sessions without completion.
- Suit leak: triggered by abandoned failing work.
- Crystal surge: triggered by high reward rolls.
- Equipment jam: triggered by repetitive activity patterns.
- Base airlock squeak: triggered by neglecting repairs.

### Hazard Design

Hazards should create flavor and resource sinks without making the user feel punished for difficult work. Failed tests should not be purely bad. Fixing failures should create some of the best recovery rewards.

## 14. Economy

### Reward Sources

- Turn rewards
- Session rewards
- Milestone rewards
- Daily expeditions
- Weekly contracts
- Base module production
- Drone automation
- Order fulfillment
- Fabricated product sales

### Spend Sinks

- Suit upgrades
- Drill upgrades
- Scanner upgrades
- Refinery upgrades
- Fabrication devices
- Device recipes
- Base repair
- Base rooms
- Drone crafting
- Cosmetics
- Asteroid permits

### Anti-Farming Controls

- Daily soft caps.
- Diminishing returns on repetitive actions.
- Variety bonuses for balanced work.
- Verification multipliers.
- Completion bonuses.
- Local event signing.
- Cloud-side anomaly detection.
- No rewards for obviously empty/no-op patterns.

## 15. In-Game Store And Economy

### Current Direction

No real-money upgrades for the current product direction. The game economy uses Space Bucks earned from play.

### In-Game Store Goals

The in-game store should support progression through earned Space Bucks. It sells gear, upgrades, fabrication devices, recipes, base items, and cosmetics.

### In-Game Purchases

- Miner suit upgrades.
- Drill upgrades.
- Scanner upgrades.
- Refinery upgrades.
- Fabrication devices.
- Recipes.
- Drone parts.
- Base modules.
- Cosmetics purchased with Space Bucks.

### Future Monetization Guardrail

If real-money purchases are added later, they should start with cosmetics and avoid power.

## 16. Social And Competitive Features

### MVP Direction

Stay personal for now. No leaderboards in MVP.

### Fast Follow: Guild Asteroids

Guilds let multiple players mine the same asteroid until it is finished. Each player contributes through their own Codex work. When the asteroid is depleted, the guild receives a completion report showing total output and each player's contribution.

Guild end-of-asteroid report:

- Total Chonks mined.
- Materials discovered.
- Orders fulfilled.
- Fabricated goods completed.
- Hazards survived.
- Each player's contribution.
- MVP, best scanner, best fabricator, best repair contribution, and similar awards.

### Later Optional Features

- Friend leaderboards.
- Guild bases.
- Weekly expedition summaries.
- Shared contracts.
- Cosmetic showcases.
- Rare find announcements.

### Privacy Rule

Leaderboards should expose only gameplay stats, never work contents.

Example:

```text
Jared mined 12,480 Chonks this week and found 3 sapphire shards.
```

Not:

```text
Jared worked on repo-name and fixed file-name.
```

## 17. Commands And MCP Tools

### Player-Facing Commands

Commands should be optional utility tools, not the main game loop.

- `mcp-miner status`: show current stats.
- `mcp-miner report`: show latest expedition report.
- `mcp-miner open`: open web dashboard.
- `mcp-miner store`: open in-game store.
- `mcp-miner orders`: show active orders.
- `mcp-miner sync`: sync local progress.
- `mcp-miner settings`: configure report style and privacy.
- `mcp-miner inventory`: show resources and gems.

### MCP Tools

- `get_player_status`
- `get_latest_report`
- `open_dashboard`
- `open_store`
- `get_active_orders`
- `sync_progress`
- `update_settings`
- `claim_milestone`

## 18. Hook Design

### Collector Hooks

The local MVP hook runtime stores only abstract gameplay progress in `~/.mcp-miner/state.json`.
Hook input may include prompts, commands, paths, or working directories, but the stored state keeps
only counters, anonymous fingerprints, rewards, and report text.

#### `SessionStart`

Records a `work_session_start` stat, stores the last session ID, updates `last_seen_at`, and injects
hidden context that the passive hooks are active. It does not create mined rewards and it does not
store prompt text, code, terminal output, file paths, or repo names.

#### `UserPromptSubmit`

Ensures a `current_turn` exists for the turn, records one `work_user_prompt` reward event, updates
`last_seen_at`, and injects hidden context telling Codex not to mention MCP Miner unless the user
asks or the `Stop` hook explicitly requests a footer.

#### `SubagentStart`

Tracks anonymous subagent activity in `agent_stats`. The key is a SHA-256 fingerprint of the agent
ID or type, truncated to 12 hex characters. The stored value contains the agent type, start count,
stop count, and `last_seen_at`; no transcript content is stored.

#### `SubagentStop`

Updates the same anonymous `agent_stats` entry as `SubagentStart` and increments its stop count. It
returns `continue: true` and does not request any report text.

#### `PostToolUse`

Classifies supported tool activity into abstract work events and converts those events into score,
Chonks, materials, suit wear, asteroid progress, and stat counters. Supported classifications are:

- Shell tests become `work_test_pass` or `work_test_fail`.
- Commits, pushes, PR creation, and release commands become `work_commit_or_pr`.
- Search commands become `work_search`.
- File-read commands become `work_file_read`.
- Review/audit/inspect commands become `work_review`.
- `apply_patch` changes become `work_apply_patch` or `work_write_docs`.
- Non-MCP-Miner MCP tools become search, review, or artifact events based on the tool name.

Each reward event is deduped by turn, hook event name, abstract event ID, and tool-use suffix. Project
activity is stored only under an anonymous `project_` fingerprint derived from the hook working
directory; the raw working directory and repo name are not stored.

#### `Stop`

Decides whether the turn should emit a report. It builds a report from `report_templates.yaml`, saves
it in `latest_report`, increments `reports_emitted`, and marks the current turn as reported. If the
assistant response does not already include an MCP Miner footer, and this is not a nested stop-hook
continuation, it blocks with an instruction to append the exact generated footer as the final
paragraph.

### Footer Injection Strategy

The implemented MVP uses `Stop` as the authoritative footer gate. `UserPromptSubmit` only injects
background context that the game is tracking the turn. `Stop` checks the selected report mode,
current turn score, milestone state, and whether the assistant already included a footer before
requesting any appended text.

Report modes:

- `off`: never emit reports.
- `every_turn_compact`: report every turn with compact templates.
- `every_turn_full`: report every turn with full templates.
- `meaningful_turns_only`: report concrete non-prompt work when the turn score reaches the
  meaningful threshold, or when a milestone is reached.
- `session_summary_only`: suppress per-turn reports in the current MVP.
- `milestones_only`: report only when asteroid milestone progress is reached.

### Report Rules

- Keep compact reports to one line.
- Do not include prompts, assistant replies, source code, terminal output, file paths, repo names,
  browser content, app content, or raw transcripts.
- Do not report zero-progress turns unless user enables verbose mode.
- Do not interrupt important error messages.
- Respect user opt-out immediately.
- Do not append a second footer if the assistant message already contains `MCP Miner:` or the exact
  generated report text.

## 19. Privacy And Data Policy

### Local Data

The local plugin may store:

- Abstract event counts.
- Game state.
- Resource balances.
- Upgrade levels.
- Settings.
- Signed event summaries.

### Cloud Data

The server should store:

- Account ID.
- Game profile.
- Inventory.
- Upgrades.
- Base state.
- Order state.
- In-game transaction records.
- Abstract signed reward events.

### Data Not Sent By Default

- Prompts.
- Assistant replies.
- Source code.
- Terminal output.
- File paths.
- Repository names.
- Browser content.
- Email or app content.
- Raw transcripts.

### Opt-In Analytics

Optional diagnostic uploads may be added, but they must be explicit, visible, and revocable.

## 20. Technical Architecture

### Local Plugin

Responsibilities:

- Install hooks.
- Run local MCP server.
- Maintain local save state.
- Score supported activity.
- Generate report text.
- Sync with backend.
- Open dashboard/store links.

### Backend API

Responsibilities:

- Authenticate users.
- Store cloud game state.
- Validate signed local events.
- Manage the in-game store, orders, inventory, and Space Bucks balances.
- Serve store inventory.
- Support guilds and leaderboards later.
- Detect suspicious farming.

### Web App

Responsibilities:

- Account creation and login.
- Miner profile.
- Dashboard view.
- Inventory.
- Upgrade store.
- Orders.
- Fabricators.
- Settings.
- Privacy controls.

### Suggested Local Storage

SQLite or local JSON for MVP. SQLite is preferred once event history, sync queues, or migrations matter.

### Suggested Cloud Storage

PostgreSQL for accounts, inventory, orders, in-game transactions, optional guilds, and event summaries.

## 21. Data Model Sketch

### Player

```json
{
  "id": "player_123",
  "displayName": "Miner",
  "createdAt": "2026-05-24T00:00:00Z",
  "settings": {
    "reportMode": "compact",
    "cloudSync": true,
    "guilds": false
  }
}
```

### Game State

```json
{
  "playerId": "player_123",
  "chonks": 1200,
  "spaceBucks": 640,
  "ore": 84,
  "scrap": 42,
  "materials": {
    "iron": 32,
    "nickel": 18,
    "silicon": 12,
    "sparkglass": 2
  },
  "gems": {
    "quartz": 8,
    "sapphire": 2,
    "ruby": 1,
    "emerald": 0,
    "amethyst": 0,
    "diamond": 0
  },
  "currentAsteroid": "A-17 Noodle Rock",
  "asteroidDepletion": 18,
  "suitCondition": 92,
  "baseIntegrity": 61
}
```

### Turn Reward

```json
{
  "turnId": "turn_abc",
  "timestamp": "2026-05-24T00:00:00Z",
  "workEnergy": 42,
  "rewards": {
    "chonks": 38,
    "ore": 6,
    "materials": {
      "nickel": 2,
      "sparkglass": 1
    },
    "gems": {
      "quartz": 1
    },
    "spaceBucks": 0,
    "xp": {
      "research": 14,
      "engineering": 8
    }
  },
  "report": "MCP Miner: +38 Chonks, nickel seam mapped, Sparkglass x1, suit 92%."
}
```

## 22. MVP Scope

### MVP Features

- Local plugin.
- Local save state.
- Passive event collection through hooks.
- Compact end-of-reply report.
- Desktop app target.
- Basic resources: Chonks, ore, scrap, iron, nickel, silicon, quartz, sapphire.
- Space Bucks earned through simple order fulfillment.
- Basic orders for raw and refined materials.
- Basic stats: Chonks mined, gems found, Space Bucks earned, suit condition, base integrity.
- Basic upgrades: drill, scanner, suit.
- Utility MCP tools: status, report, orders, settings, open dashboard placeholder.
- Privacy-first event abstraction.
- Optional cloud sync, not required for local progression.

### MVP Non-Goals

- Full web store.
- Real-money payments.
- Guilds.
- Leaderboards.
- Complex asteroid classes.
- Animated base view.
- Real-time multiplayer.
- Raw token usage scoring.

## 23. V1 Scope

### V1 Features

- Optional account linking.
- Optional cloud sync.
- Web dashboard.
- In-game store using Space Bucks.
- Expanded order board.
- Basic fabrication devices.
- Product recipes.
- Expanded gems.
- Base modules.
- Drones.
- Asteroid classes.
- Weekly contracts.
- Milestone reports.
- Basic anti-farming detection.

## 24. V2 And Beyond

### Future Features

- Guild asteroids.
- Leaderboards.
- Seasons and events.
- Rare artifacts with lore.
- Mobile companion view.
- Shareable expedition cards.
- Animated miner/base dashboard.
- Prestige worlds.
- Marketplace cosmetics.
- Public API for guild events.

## 25. Tone And World

### Tone

Sci-fi, funny, cozy, useful, warm, and lightly adventurous. The game should add delight to work without getting in the way.

### Visual Direction

- Dark space interfaces with bright asteroid mineral highlights.
- Clean sci-fi HUD elements.
- Chunky voxel/Chonk resource language.
- Distinct gem colors.
- Base modules with clear silhouettes.
- Minimal Codex footer styling in text form.

### Writing Style

Short, flavorful, and readable.

Examples:

- "Quartz seam mapped."
- "Refinery stabilized."
- "Suit plating held."
- "Base lights restored."
- "Scanner found a sapphire echo."
- "Buyer still believes in us. Somehow."
- "Chonks secured. Dignity status pending."

## 26. Progression Math And Upgrade Algorithms

### Research Basis

The economy should use exponential or near-exponential cost growth, bounded or slower benefit growth, and regular simulation passes. This follows common incremental-game practice: upgrade costs often grow exponentially while production grows linearly or polynomially, and tuning should be spreadsheet/simulation-driven rather than trusted blindly from a single formula.

Reference notes:

- Kongregate's "The Math of Idle Games" describes exponential upgrade costs, production multipliers, and bulk-buy formulas: https://www.kongregate.com/en/pages/the-math-of-idle-games-part-i
- Game Balance Concepts frames cost curves as the relationship between increasing costs and increasing benefits, and notes that increasing curves encourage players to diversify choices: https://gamebalanceconcepts.wordpress.com/2010/07/21/level-3-transitive-mechanics-and-cost-curves/
- GameDeveloper's Idle Idol balancing article notes the practical pattern of exponential upgrade costs, slower reward growth, and spreadsheet-driven tuning: https://www.gamedeveloper.com/design/balancing-tips-how-we-managed-math-on-idle-idol
- Diminishing-return curves should be used carefully because logarithmic-style returns can make choices feel flat if returns shrink too aggressively: https://blog.nerdbucket.com/diminishing-returns-in-game-design-the-logarithm/article

### Economy Units

- Chonks are mined material, not money.
- Space Bucks are the spendable economy currency.
- Materials and products convert into Space Bucks through orders or market sales.
- Upgrades cost Space Bucks plus increasingly rare material baskets.

### Upgrade Cost Formula

Let `L` be the current upgrade level, starting at `0`. The cost to buy the next level, `L + 1`, is:

```text
next_cost_space_bucks(track, L) =
  nice_round(
    base_cost(track)
    * growth_rate(track)^L
    * phase_multiplier(L)
    * rarity_pressure(track, L)
  )
```

```text
phase_multiplier(L) =
  1 + 0.08 * floor(L / 10)^2
```

```text
rarity_pressure(track, L) =
  1 + 0.04 * count_of_rare_material_gates_unlocked(track, L)
```

`phase_multiplier` creates visible early, mid, and late-game phases. `rarity_pressure` adds a small cost lift when an upgrade starts requiring rarer materials.

### Nice Rounding

Prices should be readable. Use two significant digits and always round up.

```text
nice_round(x) =
  ceil(x / 10^(floor(log10(x)) - 1))
  * 10^(floor(log10(x)) - 1)
```

Examples:

- `137` becomes `140`
- `1,284` becomes `1,300`
- `47,120` becomes `48,000`

### Bulk Upgrade Cost

For exact bulk purchases, sum each next level because phase and rarity gates can change:

```text
bulk_cost(track, L, n) =
  sum(next_cost_space_bucks(track, i))
  for i = L to L + n - 1
```

For tracks without phase or rarity changes, the geometric shortcut is:

```text
bulk_cost_simple(B, G, L, n) =
  B * (G^L * (G^n - 1)) / (G - 1)
```

### Upgrade Benefit Formula

Most power upgrades should use bounded exponential growth. This gives exciting early gains without letting late-game multipliers explode.

```text
bounded_bonus(L, max_bonus, curve_speed) =
  max_bonus * (1 - e^(-curve_speed * L))
```

```text
effect_multiplier(L) =
  1 + bounded_bonus(L, max_bonus, curve_speed) + milestone_bonus(L)
```

```text
milestone_bonus(L) =
  milestone_value * floor(L / milestone_interval)
```

The value gained by one upgrade level is:

```text
marginal_gain(L) =
  effect(L + 1) - effect(L)
```

This should shrink over time for most systems, while milestone bonuses create occasional spikes that feel good.

### Upgrade Track Defaults

These are starting values for the MVP economy. They should be tuned by simulation after the first playable build.

| Track | Cap | Base Cost | Growth | Benefit Formula | Level 10 Value | Level 25 Value | Level 50 Value |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| Drill Power | 50 | 120 | 1.19 | `1 + 2.6*(1-e^(-0.045L)) + 0.05*floor(L/10)` Chonk output | 1.99x | 2.86x | 3.58x |
| Scanner Range | 50 | 100 | 1.16 | `1 + 1.8*(1-e^(-0.05L))` discovery output | 1.71x | 2.28x | 2.65x |
| Scanner Precision | 50 | 130 | 1.17 | `1 + 1.2*(1-e^(-0.04L))` rare-find weighting | 1.40x | 1.76x | 2.04x |
| Suit Plating | 50 | 140 | 1.17 | `0.72*(1-e^(-0.045L))` damage reduction | 26% | 49% | 64% |
| Refinery Purity | 50 | 180 | 1.18 | `1 + 1.6*(1-e^(-0.04L))` refined yield | 1.53x | 2.01x | 2.38x |
| Fabricator Throughput | 30 | 300 | 1.21 | `1 + 1.4*(1-e^(-0.06L))` product progress | 1.63x | 2.09x | N/A |
| Vault Storage | 60 | 80 | 1.14 | `base_storage * 1.08^L` storage capacity | 2.16x | 6.85x | 46.9x |
| Drone Automation | 25 | 450 | 1.24 | `1 + 0.06L + 0.005*L^1.35` passive support | 1.71x | 2.89x | N/A |

### Example Upgrade Prices

Prices below are the cost to buy the next level from the listed current level. They use the base formula, phase multiplier, and nice rounding, before material baskets are added.

| Track | L0 -> 1 | L1 -> 2 | L5 -> 6 | L10 -> 11 | L25 -> 26 | L49 -> 50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Drill Power | 120 | 150 | 290 | 740 | 13,000 | 1,400,000 |
| Scanner Range | 100 | 120 | 220 | 480 | 5,400 | 330,000 |
| Scanner Precision | 130 | 160 | 290 | 680 | 8,700 | 660,000 |
| Suit Plating | 140 | 170 | 310 | 730 | 9,400 | 710,000 |
| Refinery Purity | 180 | 220 | 420 | 1,100 | 15,000 | 1,400,000 |
| Fabricator Throughput | 300 | 370 | 780 | 2,200 | 47,000 | N/A |
| Vault Storage | 80 | 92 | 160 | 330 | 2,800 | 120,000 |
| Drone Automation | 450 | 560 | 1,400 | 4,200 | N/A | N/A |

### Material Basket Formula

Upgrade costs should become more specific as the player reaches higher levels. Space Bucks buy the service, but materials make the upgrade feel physically grounded.

```text
material_quantity(material, track, L) =
  ceil(
    base_quantity(track, material)
    * rarity_multiplier(material)
    * (1 + L / 10)^1.30
    * phase_multiplier(L)
  )
```

Rarity multipliers:

| Rarity | Multiplier |
| --- | ---: |
| Common | 1.00 |
| Uncommon | 1.60 |
| Rare | 2.40 |
| Dangerous | 2.80 |
| Fictional Rare | 3.20 |
| Legendary | 5.00 |

Material gates:

| Upgrade Level | Material Rules |
| ---: | --- |
| 0-4 | Chonks, scrap, iron, nickel, silicon, carbon |
| 5-14 | Adds titanium, cobalt, lithium, quartz |
| 15-29 | Adds platinum, sapphire, ruby, Sparkglass |
| 30-44 | Adds iridium, uranium, Nebulite, Chatterium, Glitchsalt |
| 45+ | Adds diamond, Aetherium, legendary fragments |

### Material Value Formula

Each material needs a base Space Bucks value so orders, market sales, and recipes can be priced consistently.

```text
material_value(m) =
  base_tier_value(m)
  * rarity_value_multiplier(m)
  * hazard_multiplier(m)
  * refinement_multiplier(m)
```

```text
refinement_multiplier(raw) = 1.00
refinement_multiplier(refined) = 1.55
refinement_multiplier(high_purity) = 2.25
```

Use the `Element Price Catalog` as the source of truth for real element raw and refined prices. The table below is a shorthand list for core MVP materials and fictional resources used heavily in examples.

| Material | Base Value |
| --- | ---: |
| Chonk | 1 |
| Scrap | 3 |
| Ore | 4 |
| Carbon | 4 |
| Iron | 5 |
| Nickel | 6 |
| Silicon | 8 |
| Titanium | 18 |
| Cobalt | 24 |
| Lithium | 26 |
| Quartz | 30 |
| Sparkglass | 55 |
| Sapphire | 80 |
| Ruby | 75 |
| Amethyst | 90 |
| Platinum | 90 |
| Uranium | 110 |
| Iridium | 130 |
| Nebulite | 140 |
| Chatterium | 160 |
| Glitchsalt | 220 |
| Diamond | 500 |
| Aetherium | 600 |

### Order Payout Formula

Orders should pay more than direct market sale because they require planning, timing, and sometimes targeted asteroid choice.

```text
raw_order_value =
  sum(required_quantity(m) * material_value(m))
```

```text
deadline_multiplier =
  1 + clamp((standard_deadline_days - deadline_days) * 0.12, 0, 0.60)
```

```text
complexity_multiplier =
  1
  + 0.08 * number_of_distinct_inputs
  + 0.18 * recipe_tier
  + 0.10 * required_device_tier
```

```text
order_payout =
  nice_round(
    raw_order_value
    * deadline_multiplier
    * complexity_multiplier
    * buyer_reputation_multiplier
    * price_variation_multiplier
  )
```

Buyer reputation defaults to `1.00`. Later, trusted buyers can pay `1.05-1.25x`, while questionable buyers can pay more but add hazard or deadline risk.

### Order Price Variation

Each order gets a price variation roll after its base payout is calculated. This creates ordinary market texture and a 10% chance of a much higher-than-average payout.

```text
price_variation_multiplier =
  if random_0_to_1 < 0.10:
    random_uniform(2.25, 4.00)
  else:
    random_triangular(0.85, 1.00, 1.18)
```

The 10% high-reward result is called a `windfall order`.

Windfall order labels:

- Hot Buyer
- Panic Budget
- Collector Overpay
- No Questions Asked
- Executive Shortcut
- The Invoice Is Already Approved

Windfall rules:

- Windfall orders should be visually obvious in the dashboard.
- Windfall orders should not be guaranteed to match the player's current stock.
- Windfall orders may have tighter deadlines or stranger material requirements.
- Windfall orders should be rare enough to feel exciting but common enough to shape decision-making.
- The expected rate is exactly 10% of generated orders before player filtering.

### Fabricated Product Value Formula

Fabricated goods should be worth meaningfully more than their inputs, especially as recipes become complex.

```text
input_value =
  sum(input_quantity(m) * material_value(m))
```

```text
fabrication_markup =
  1
  + 0.20 * recipe_tier
  + 0.08 * number_of_distinct_inputs
  + 0.06 * fabrication_steps
```

```text
product_value =
  nice_round(
    input_value
    * fabrication_markup
    * quality_multiplier
  )
```

```text
quality_multiplier =
  1 + 0.15 * product_quality_grade
```

Quality grades start at `0` and can increase through refinery purity, fabrication throughput, and verification-heavy Codex activity.

### Asteroid Yield Algorithm

Each asteroid has a composition table. Example:

```json
{
  "name": "A-17 Noodle Rock",
  "class": "Starter Rubble",
  "yieldMultiplier": 1.00,
  "hazardMultiplier": 0.80,
  "composition": {
    "chonks": 0.38,
    "iron": 0.18,
    "nickel": 0.13,
    "silicon": 0.10,
    "carbon": 0.09,
    "scrap": 0.08,
    "quartz": 0.03,
    "sparkglass": 0.01
  }
}
```

Mining output per meaningful turn:

```text
effective_work =
  work_energy
  * drill_power_multiplier
  * suit_condition_multiplier
  * asteroid_yield_multiplier
  * daily_cap_modifier
```

```text
chonks_mined =
  floor(effective_work * 0.90)
```

```text
material_pulls =
  floor(effective_work / 12)
```

For each material pull:

```text
weight(m) =
  asteroid_composition_weight(m)
  * scanner_range_multiplier
  * scanner_precision_bonus(m)
  * active_order_bonus(m)
  / rarity_divisor(m)
```

```text
P(m) = weight(m) / sum(weight(all materials))
```

`active_order_bonus(m)` should be `1.0` normally and `1.15-1.35` when the player has an active order requiring that material. This helps the game feel fair without guaranteeing instant order completion.

### Rare Find And Pity Algorithm

Rare materials should feel lucky but not impossible.

```text
rare_find_chance =
  base_rare_rate(asteroid_class)
  * scanner_precision_multiplier
  * verification_bonus
  * asteroid_depletion_bonus
```

```text
asteroid_depletion_bonus =
  1 + min(0.35, asteroid_depletion_percent / 200)
```

If no rare find occurs, add pity:

```text
pity_score_next =
  min(pity_score_current + rare_find_chance, 3.0)
```

Final chance on the next rare roll:

```text
final_rare_chance =
  min(rare_find_chance + 0.04 * pity_score, 0.35)
```

On rare success:

```text
pity_score_next = 0
```

### Work Category Multipliers

Rewards should differ by work type while still feeding the same economy.

| Work Category | Primary Effect | Formula |
| --- | --- | --- |
| Research | Scanner boost | `scanner_range_multiplier += 0.01 * research_score_this_turn` capped at `+25%` |
| Coding | Chonk output | `drill_power_multiplier += 0.008 * coding_score_this_turn` capped at `+30%` |
| Testing | Refinery quality | `quality_grade_chance += 0.015 * testing_score_this_turn` capped at `+35%` |
| Review | Hazard reduction | `hazard_chance *= 1 / (1 + 0.02 * review_score_this_turn)` |
| Writing | Order planning | `active_order_bonus += 0.006 * writing_score_this_turn` capped at `+20%` |

These are turn-local bonuses. Permanent progression comes from XP and upgrades.

### Session Payback Targets

Upgrade cost should be checked against expected Space Bucks per useful session. The target is not "can the player afford it instantly," but "does the next upgrade feel reachable?"

```text
target_sessions_to_afford(L) =
  1.5
  + 0.14 * L
  + 0.35 * floor(L / 10)
```

Examples:

| Level | Target Sessions To Afford Next Upgrade |
| ---: | ---: |
| 0 | 1.5 |
| 5 | 2.2 |
| 10 | 3.25 |
| 25 | 5.7 |
| 50 | 10.25 |

During balancing, simulate a typical player and compare:

```text
actual_sessions_to_afford =
  next_cost_space_bucks(track, L)
  / average_space_bucks_per_session(player_stage)
```

Tuning rule:

```text
if actual_sessions_to_afford > target * 1.25:
  lower base_cost or growth_rate

if actual_sessions_to_afford < target * 0.75:
  raise base_cost or growth_rate
```

### Direct Market Sale Formula

Direct sales should exist as a pressure release, but orders should be better.

```text
market_sale_value =
  nice_round(sum(quantity(m) * material_value(m)) * market_condition_multiplier)
```

```text
market_condition_multiplier = random value from 0.72 to 0.92
```

This makes direct selling useful when the player needs Space Bucks now, while orders remain the efficient path.

### Upgrade Design Guardrails

- Early upgrades should feel punchy: first 5 levels can each feel like `5-12%` practical improvement.
- Midgame upgrades should still matter: levels 10-30 should generally feel like `2-6%` practical improvement.
- Late upgrades should be strategic: levels 30+ should rely on material gates, milestones, and new asteroid unlocks more than raw percent increases.
- No single upgrade track should dominate all others for more than one phase.
- If one track has stronger late-game effects, increase its growth rate or rare material requirements.
- If an upgrade only improves comfort or storage, let it be cheaper than direct output upgrades.
- If an upgrade unlocks a new order type or fabrication tier, add a one-time unlock cost separate from its level cost.

### Balancing Workflow

1. Define target session length and expected meaningful turns per session.
2. Simulate work energy by player stage: early, mid, late.
3. Calculate expected materials per session for each asteroid class.
4. Calculate expected Space Bucks per session from orders.
5. Calculate upgrade affordability using `actual_sessions_to_afford`.
6. Tune base costs and growth rates until affordability matches target.
7. Check material gates to ensure rare materials are needed after they become available.
8. Run a 30-session simulation and inspect upgrade choices, order completion, and asteroid depletion.
9. Adjust formulas before adding more content.

## 27. Implementation Data Contract

Before engineering starts, MCP Miner must define gameplay data in versioned source-of-truth files and validate those files before runtime. The required implementation contract is maintained in [IMPLEMENTATION_DATA_CONTRACT.md](IMPLEMENTATION_DATA_CONTRACT.md).

Key rule:

```text
Do not invent gameplay data in code. If data is missing, fail loudly and report the missing ID or field.
```

The contract defines required files for materials, recipes, order variants, order generation, fabrication machines, asteroid classes, upgrades, work scoring, hazards, base modules, starting state, report templates, and balance constants.

## 28. Resolved Decisions And Remaining Questions

### Resolved Decisions

- Name: MCP Miner.
- Setting: asteroid mining.
- Main mined material: Chonks.
- Spendable money: Space Bucks.
- Tone: sci-fi, funny, cozy.
- MVP social model: personal progression only.
- Fast follow social model: guild asteroids.
- Real-money upgrades: not included.
- Report frequency: user configurable.
- Avatar: player miner avatar generated and customized in Codex.
- Web app MVP: dashboard first.
- Cloud sync: optional.
- Rewards: differ by work category.
- Seasons/events: not yet.
- First platform: Codex desktop app.

### Remaining Questions

The original MVP content questions are resolved by the checked-in data and implementation:

1. Fabrication products come from `data/recipes.yaml` and `data/order_variants.yaml`.
2. The current MVP generates a small active order queue locally.
3. Missed orders expire and are replaced; the penalty is lost opportunity.
4. Space Bucks can come from orders and direct market sales.
5. MVP asteroid classes come from `data/asteroid_classes.yaml`.
6. Compact report copy comes from `data/report_templates.yaml`.
7. Local-only play is allowed; cloud sync remains optional.

Open V1 product questions should be tracked as Linear issues once they need implementation detail,
especially miner avatar defaults, dashboard presentation, and sync conflict UX.
