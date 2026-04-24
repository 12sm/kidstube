/**
 * Canonical tag map and normalization for video/interest tagging.
 *
 * The LLM generates freeform tags per video. This module collapses synonyms
 * and variants into a fixed canonical set so interest weights don't get
 * diluted across equivalent strings.
 */

const CANONICAL_TAGS = {
  // ── Gaming (core) ──────────────────────────────────────────────
  'gaming':            ['gameplay', 'gaming-gameplay', 'gaming-content', 'gaming-comedy', 'gaming-humor', 'gaming-commentary', 'gaming-adventure', 'gaming-reaction', 'funny-gaming', 'gaming-animation', 'casual-gameplay', 'casual-gaming', 'casual-games', 'competitive-gameplay', 'competitive-gaming', 'competitive-games', 'family-gaming', 'family-gameplay', 'family-friendly-gaming', 'gaming-competition', 'video-games'],
  'gaming-challenge':  ['gaming-challenges', 'challenge-gameplay', 'challenge-games', 'challenge-video', 'challenge-videos', 'challenges', 'challenge'],
  'gaming-tutorial':   ['gaming-walkthrough', 'gaming-guide', 'gaming-guides', 'gaming-tips', 'gaming-tutorials', 'gameplay-walkthrough', 'gameplay-guide', 'video-game-walkthrough', 'strategy-guide', 'gameplay-tutorial'],
  'gaming-strategy':   ['strategy', 'strategy-games', 'strategy-gameplay'],
  'gaming-updates':    ['gaming-news', 'game-updates', 'gaming-codes', 'promo-codes'],
  'pvp':               ['pvp-gaming', 'pvp-gameplay'],
  'multiplayer':       ['multiplayer-gaming', 'multiplayer-games', 'multiplayer-gameplay', 'survival-multiplayer'],
  'speedrun':          ['speedrunning'],
  'simulation':        ['simulator-games', 'simulation-games', 'simulator', 'simulators', 'gaming-simulation'],
  'survival-games':    ['survival-gameplay', 'survival-challenge', 'survival-gaming', 'survival-game', 'survival', 'hardcore-survival', 'hardcore-mode'],
  'tower-defense':     [],
  'idle-games':        ['progression', 'progression-gameplay'],
  'parkour':           ['obstacle-course', 'obstacle-courses'],

  // ── Minecraft ──────────────────────────────────────────────────
  'minecraft':           ['minecraft-gameplay', 'minecraft-gaming', 'minecraft-style', 'minecraft-java'],
  'minecraft-mods':      ['minecraft-mod', 'mods', 'modding', 'modded-gameplay', 'gaming-mods', 'custom-mobs', 'mobs', 'minecraft-mobs'],
  'minecraft-challenge': ['minecraft-manhunt', 'minecraft-hardcore'],
  'minecraft-building':  ['build-battle', 'base-building'],
  'minecraft-roleplay':  ['minecraft-smp', 'smp'],
  'minecraft-animation': ['minecraft-memes'],

  // ── Roblox ─────────────────────────────────────────────────────
  'roblox':              ['roblox-gameplay', 'roblox-gaming', 'roblox-games', 'roblox-animation'],
  'blox-fruits':         [],
  'pet-simulator':       ['pet-simulator-99', 'pet-simulation', 'pet-collection'],
  'brookhaven':          [],
  'adopt-me':            [],
  'build-a-boat':        [],
  'creatures-of-sonaria': ['creature-collection'],
  'grow-a-garden':       ['garden-simulation', 'garden-horizons', 'garden-games', 'gardening-simulation'],

  // ── Other Games ────────────────────────────────────────────────
  'sonic':               ['sonic-the-hedgehog', 'sonic-animation'],
  'super-mario':         ['mario', 'mario-odyssey', 'super-mario-odyssey', 'mario-kart'],
  'plants-vs-zombies':   [],
  'geometry-dash':       [],
  'pokemon':             [],
  'fortnite':            ['lego-fortnite'],
  'incredibox':          ['sprunki'],

  // ── Animals ────────────────────────────────────────────────────
  'animals':        ['funny-animals', 'cute-animals', 'animal-behavior', 'animal-videos', 'animal-compilation', 'animal-facts', 'animal-characters', 'animal-friendships', 'farm-animals'],
  'dogs':           ['puppies', 'cute-dogs'],
  'cats':           [],
  'pets':           ['pet-videos', 'cute-pets', 'pet-care', 'pet-humor', 'funny-pets'],
  'animal-rescue':  ['rescue-missions'],
  'wildlife':       ['nature-documentary', 'nature-facts', 'nature-education', 'nature-exploration', 'nature', 'wildlife-education'],

  // ── Educational ────────────────────────────────────────────────
  'educational':  ['educational-content', 'educational-entertainment', 'educational-learning', 'educational-gaming', 'educational-games', 'educational-animation', 'educational-cartoons', 'learning', 'learning-cartoons'],
  'math':         ['math-education', 'math-learning', 'math-games', 'educational-math', 'math-songs', 'counting', 'counting-for-kids', 'number-games', 'addition-subtraction', 'fractions', 'geometry', 'multiplication'],
  'science':      ['science-education', 'science-experiments', 'science-experiment', 'educational-science', 'earth-science', 'physics', 'physics-concepts', 'physics-experiments', 'stem', 'stem-learning', 'stem-education', 'physics-simulation'],
  'phonics':      ['alphabet', 'alphabet-learning', 'early-literacy', 'reading', 'reading-skills', 'word-games'],
  'coding':       ['coding-for-kids', 'creative-coding'],
  'geography':    ['world-cultures'],
  'history':      [],
  'astronomy':    ['outer-space', 'space-exploration', 'nasa', 'astronauts', 'international-space-station', 'planets', 'space-adventure'],

  // ── Shows / Brands ─────────────────────────────────────────────
  'sesame-street':  [],
  'bluey':          [],
  'peppa-pig':      [],
  'numberblocks':   [],
  'pbs-kids':       ['blippi'],
  'spongebob':      [],
  'disney':         ['pixar'],
  'star-trek':      [],

  // ── Creative ───────────────────────────────────────────────────
  'creative-building': ['building', 'building-games', 'creative-gameplay', 'creative-gaming', 'creative-play', 'creative-challenge', 'creative-challenges', 'building-creativity', 'creativity', 'building-challenge', 'building-challenges', 'build-challenge', 'building-tutorial', 'sandbox-gaming'],
  'lego':              ['lego-building'],
  'engineering':       ['creative-engineering'],
  'crafts':            ['diy-crafts', 'diy-projects', 'crafting', 'drawing', 'drawing-games', 'creative-drawing'],
  'stop-motion':       [],

  // ── Entertainment ──────────────────────────────────────────────
  'animation':        ['animated-series', 'cartoon-animation', 'children-animation', 'kids-animation', 'kids-cartoons', 'kids-cartoon', 'cartoon', 'cartoons', 'animated-comedy', 'family-animation', 'children-cartoons', 'kids-entertainment', 'children-entertainment', 'family-entertainment', 'family-content', 'entertainment', 'preschool-entertainment', 'preschool-cartoons', 'preschool', 'preschool-content'],
  'comedy':           ['humor', 'silly-humor', 'funny-moments', 'family-humor', 'family-comedy', 'family-fun', 'comedy-adventure', 'comedy-skits'],
  'music':            ['music-video', 'music-performance', 'music-game', 'music-games', 'music-education', 'music-learning', 'kids-music', 'kids-songs', 'educational-music', 'educational-songs', 'nursery-rhymes', 'dance-songs', 'sing-along', 'piano', 'children-music', 'gaming-music'],
  'dance':            ['dancing', 'movement-activities', 'physical-activity'],
  'storytelling':     ['fantasy-storytelling', 'storytime', 'heartwarming-stories', 'fairy-tales', 'creative-storytelling', 'audiobook'],
  'mystery':          ['mystery-solving', 'mystery-games'],
  'roleplay':         ['fantasy-roleplay', 'pretend-play', 'imaginative-play', 'imagination'],
  'pranks':           ['prank'],
  'reaction-videos':  ['reaction-video'],
  'unboxing':         ['collectibles', 'collecting', 'toys'],
  'asmr':             [],
  'behind-the-scenes': [],
  'vlog':             ['family-vlog', 'real-life-vlog', 'travel-vlog'],

  // ── Physical / Sports ─────────────────────────────────────────
  'sports':      ['sports-challenges', 'sports-challenge', 'basketball'],
  'gymnastics':  ['physical-challenges'],
  'trick-shots': [],
  'nerf':        ['nerf-wars', 'nerf-games'],

  // ── Other ──────────────────────────────────────────────────────
  'adventure':         ['action-adventure', 'adventure-gaming', 'adventure-series', 'fantasy-adventure', 'exploration', 'outdoor-adventure'],
  'cooking':           ['food-preparation', 'food', 'food-challenges', 'food-challenge'],
  'friendship':        ['kindness', 'teamwork', 'compassion', 'social-emotional-learning', 'emotional-learning'],
  'community-service': ['philanthropy', 'charity', 'environmental-awareness'],
  'dinosaurs':         ['paleontology'],
  'robots':            [],
  'magic':             ['magic-tricks', 'optical-illusions'],
  'monster-trucks':    ['hot-wheels'],
  'cars':              ['vehicles', 'transportation', 'racing', 'racing-games'],
  'trains':            [],
  'guessing-games':    ['guessing-game', 'brain-teasers', 'brain-teaser', 'quiz', 'interactive-quiz', 'game-shows', 'would-you-rather'],
  'problem-solving':   ['puzzle-games', 'puzzle-solving', 'puzzles'],
  'hide-and-seek':     [],
  'competition':       ['friendly-competition'],
  'family-friendly':   [],
};

// Build reverse lookup: alias → canonical
const ALIAS_MAP = {};
for (const [canonical, aliases] of Object.entries(CANONICAL_TAGS)) {
  for (const alias of aliases) {
    ALIAS_MAP[alias] = canonical;
  }
}

/**
 * Normalize a tag to its canonical form.
 * Returns the canonical tag if a mapping exists, otherwise returns the
 * original tag unchanged (freeform passthrough).
 */
function normalizeTag(tag) {
  const t = tag.toLowerCase().trim();
  if (CANONICAL_TAGS[t]) return t;       // already canonical
  if (ALIAS_MAP[t])      return ALIAS_MAP[t]; // known alias
  return t;                               // freeform passthrough
}

/**
 * Normalize an array of tags, deduplicating after normalization.
 */
function normalizeTags(tags) {
  const seen = new Set();
  const result = [];
  for (const tag of tags) {
    const canonical = normalizeTag(tag);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      result.push(canonical);
    }
  }
  return result;
}

/**
 * Returns the flat list of canonical tag names (for LLM prompt injection).
 */
function getCanonicalList() {
  return Object.keys(CANONICAL_TAGS);
}

module.exports = { CANONICAL_TAGS, ALIAS_MAP, normalizeTag, normalizeTags, getCanonicalList };
