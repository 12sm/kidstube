# Tag Normalization System

**Date:** 2026-04-23
**Status:** Approved

## Problem

The LLM (Claude Haiku) generates 3-5 freeform tags per video during the nightly batch. With 2,394 unique tags across the corpus, synonyms and variants dilute interest signals:

- `educational` vs `educational-content` vs `educational-entertainment`
- `story-game` vs `story-games`
- `gaming` vs `gameplay` vs `gaming-gameplay` vs `gaming-content`
- `comedy` vs `humor` vs `silly-humor` vs `funny-moments`

Profile interests accumulate weight per tag string, so synonyms split what should be a single signal across multiple entries.

## Solution

Static alias map + LLM prompt update (Approach A).

### New File: `backend/src/tags.js`

Exports:
- `CANONICAL_TAGS` — object: canonical tag (string) → aliases (string[])
- `normalizeTag(tag)` — returns canonical form via reverse-lookup hash, or original tag if no match (freeform passthrough)
- `getCanonicalList()` — returns flat array of canonical tag names (for LLM prompt injection)

The reverse-lookup hash is built once at module load from `CANONICAL_TAGS`.

### Canonical Tag List (~75 tags)

#### Gaming (core)
| Canonical | Aliases |
|-----------|---------|
| `gaming` | gameplay, gaming-gameplay, gaming-content, gaming-comedy, gaming-humor, gaming-commentary, gaming-adventure, gaming-reaction, funny-gaming, gaming-animation, casual-gameplay, casual-gaming, casual-games, competitive-gameplay, competitive-gaming, competitive-games, family-gaming, family-gameplay, family-friendly-gaming, gaming-competition, video-games |
| `gaming-challenge` | gaming-challenges, challenge-gameplay, challenge-games, challenge-video, challenge-videos, challenges, challenge |
| `gaming-tutorial` | gaming-walkthrough, gaming-guide, gaming-guides, gaming-tips, gaming-tutorials, gameplay-walkthrough, gameplay-guide, video-game-walkthrough, strategy-guide, gameplay-tutorial |
| `gaming-strategy` | strategy, strategy-games, strategy-gameplay |
| `gaming-updates` | gaming-news, game-updates, gaming-codes, promo-codes |
| `pvp` | pvp-gaming, pvp-gameplay |
| `multiplayer` | multiplayer-gaming, multiplayer-games, multiplayer-gameplay, survival-multiplayer |
| `speedrun` | speedrunning |
| `simulation` | simulator-games, simulation-games, simulator, simulators, gaming-simulation |
| `survival-games` | survival-gameplay, survival-challenge, survival-gaming, survival-game, survival, hardcore-survival, hardcore-mode |
| `tower-defense` | |
| `idle-games` | progression, progression-gameplay |
| `parkour` | obstacle-course, obstacle-courses |

#### Minecraft
| Canonical | Aliases |
|-----------|---------|
| `minecraft` | minecraft-gameplay, minecraft-gaming, minecraft-style, minecraft-java |
| `minecraft-mods` | minecraft-mod, mods, modding, modded-gameplay, gaming-mods, custom-mobs, mobs, minecraft-mobs |
| `minecraft-challenge` | minecraft-manhunt, minecraft-hardcore |
| `minecraft-building` | build-battle, base-building |
| `minecraft-roleplay` | minecraft-smp, smp |
| `minecraft-animation` | minecraft-memes |

#### Roblox
| Canonical | Aliases |
|-----------|---------|
| `roblox` | roblox-gameplay, roblox-gaming, roblox-games, roblox-animation |
| `blox-fruits` | |
| `pet-simulator` | pet-simulator-99, pet-simulation, pet-collection |
| `brookhaven` | |
| `adopt-me` | |
| `build-a-boat` | |
| `creatures-of-sonaria` | creature-collection |
| `grow-a-garden` | garden-simulation, garden-horizons, garden-games, gardening-simulation |

#### Other Games
| Canonical | Aliases |
|-----------|---------|
| `sonic` | sonic-the-hedgehog, sonic-animation |
| `super-mario` | mario, mario-odyssey, super-mario-odyssey, mario-kart |
| `plants-vs-zombies` | |
| `geometry-dash` | |
| `pokemon` | |
| `fortnite` | lego-fortnite |
| `incredibox` | sprunki |

#### Animals
| Canonical | Aliases |
|-----------|---------|
| `animals` | funny-animals, cute-animals, animal-behavior, animal-videos, animal-compilation, animal-facts, animal-characters, animal-friendships, farm-animals |
| `dogs` | puppies, cute-dogs |
| `cats` | |
| `pets` | pet-videos, cute-pets, pet-care, pet-humor, funny-pets |
| `animal-rescue` | rescue-missions |
| `wildlife` | nature-documentary, nature-facts, nature-education, nature-exploration, nature, wildlife-education |

#### Educational
| Canonical | Aliases |
|-----------|---------|
| `educational` | educational-content, educational-entertainment, educational-learning, educational-gaming, educational-games, educational-animation, educational-cartoons, learning, learning-cartoons |
| `math` | math-education, math-learning, math-games, educational-math, math-songs, counting, counting-for-kids, number-games, addition-subtraction, fractions, geometry, multiplication |
| `science` | science-education, science-experiments, science-experiment, educational-science, earth-science, physics, physics-concepts, physics-experiments, stem, stem-learning, stem-education, physics-simulation |
| `phonics` | alphabet, alphabet-learning, early-literacy, reading, reading-skills, word-games |
| `coding` | coding-for-kids, creative-coding |
| `geography` | world-cultures |
| `history` | |
| `astronomy` | outer-space, space-exploration, nasa, astronauts, international-space-station, planets, space-adventure |

#### Shows/Brands
| Canonical | Aliases |
|-----------|---------|
| `sesame-street` | |
| `bluey` | |
| `peppa-pig` | |
| `numberblocks` | |
| `pbs-kids` | blippi |
| `spongebob` | |
| `disney` | pixar |
| `star-trek` | |

#### Creative
| Canonical | Aliases |
|-----------|---------|
| `creative-building` | building, building-games, creative-gameplay, creative-gaming, creative-play, creative-challenge, creative-challenges, building-creativity, creativity, building-challenge, building-challenges, build-challenge, building-tutorial, sandbox-gaming |
| `lego` | lego-building |
| `engineering` | creative-engineering |
| `crafts` | diy-crafts, diy-projects, crafting, drawing, drawing-games, creative-drawing |
| `stop-motion` | |

#### Entertainment
| Canonical | Aliases |
|-----------|---------|
| `animation` | animated-series, cartoon-animation, children-animation, kids-animation, kids-cartoons, kids-cartoon, cartoon, cartoons, animated-comedy, family-animation, children-cartoons, kids-entertainment, children-entertainment, family-entertainment, family-content, entertainment, preschool-entertainment, preschool-cartoons, preschool, preschool-content |
| `comedy` | humor, silly-humor, funny-moments, family-humor, family-comedy, family-fun, comedy-adventure, comedy-skits |
| `music` | music-video, music-performance, music-game, music-games, music-education, music-learning, kids-music, kids-songs, educational-music, educational-songs, nursery-rhymes, dance-songs, sing-along, piano, children-music, gaming-music |
| `dance` | dancing, movement-activities, physical-activity |
| `storytelling` | fantasy-storytelling, storytime, heartwarming-stories, fairy-tales, creative-storytelling, audiobook |
| `mystery` | mystery-solving, mystery-games |
| `roleplay` | fantasy-roleplay, pretend-play, imaginative-play, imagination |
| `pranks` | prank |
| `reaction-videos` | reaction-video |
| `unboxing` | collectibles, collecting, toys |
| `asmr` | |
| `behind-the-scenes` | |
| `vlog` | family-vlog, real-life-vlog, travel-vlog |

#### Physical/Sports
| Canonical | Aliases |
|-----------|---------|
| `sports` | sports-challenges, sports-challenge, basketball |
| `gymnastics` | physical-challenges |
| `trick-shots` | |
| `nerf` | nerf-wars, nerf-games |

#### Other
| Canonical | Aliases |
|-----------|---------|
| `adventure` | action-adventure, adventure-gaming, adventure-series, fantasy-adventure, exploration, outdoor-adventure |
| `cooking` | food-preparation, food, food-challenges, food-challenge |
| `friendship` | kindness, teamwork, compassion, social-emotional-learning, emotional-learning |
| `community-service` | philanthropy, charity, environmental-awareness |
| `dinosaurs` | paleontology |
| `robots` | |
| `magic` | magic-tricks, optical-illusions |
| `monster-trucks` | hot-wheels |
| `cars` | vehicles, transportation, racing, racing-games |
| `trains` | |
| `guessing-games` | guessing-game, brain-teasers, brain-teaser, quiz, interactive-quiz, game-shows, would-you-rather |
| `problem-solving` | puzzle-games, puzzle-solving, puzzles |
| `hide-and-seek` | |
| `competition` | friendly-competition |
| `family-friendly` | |

### Integration Points

#### `llm.js` — Prompt Update

Add to system prompt after existing tag instruction:

```
Pick from this list when possible. Only invent a new tag if nothing fits:
[canonical list joined with ", "]
```

#### `db.js` — Write-Time Normalization

1. `insertVideoTags()` — call `normalizeTag()` on each tag before INSERT
2. `upsertProfileInterest()` — call `normalizeTag()` on tag before INSERT/UPDATE

#### Migration (one-time, at startup)

Gated by checking whether a `tag_normalization_v1` flag exists in a simple key-value migration tracking approach.

Steps (single transaction):
1. For each alias → canonical mapping in `CANONICAL_TAGS`:
   - `video_tags`: DELETE rows where both alias and canonical exist for same video_id, then UPDATE remaining alias rows to canonical
   - `profile_interests`: merge alias rows into canonical by summing weights, keeping max last_seen, then DELETE alias rows
   - `interest_tag_settings`: UPDATE tag references from alias to canonical

### Data Flow

```
Video ingested (nightly batch)
  → LLM returns tags (prefers canonical list from prompt)
  → parseResponse() lowercases/trims
  → insertVideoTags() calls normalizeTag() → writes canonical form

Kid watches video (80%+ completion)
  → applyCompletionToInterests() reads video_tags (already canonical)
  → upsertProfileInterest() calls normalizeTag() as safety net → writes canonical form

Parent sets interest tag
  → normalizeTag() applied → writes canonical form
```
