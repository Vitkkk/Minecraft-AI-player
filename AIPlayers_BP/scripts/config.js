export const ENTITY_ID = "aip:player";
export const UPDATE_INTERVAL = 5;
export const MAX_AGENTS = 16;
export const SCAN_BUDGET = 760;
export const GUARANTEE_PROGRESS = true;
export const ENCOUNTER_TIMEOUT_TICKS = 2400;

export const DIMENSION_IDS = [
  "minecraft:overworld",
  "minecraft:nether",
  "minecraft:the_end"
];

export const LOG_BLOCKS = new Set([
  "minecraft:oak_log", "minecraft:spruce_log", "minecraft:birch_log",
  "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log",
  "minecraft:mangrove_log", "minecraft:cherry_log", "minecraft:pale_oak_log",
  "minecraft:crimson_stem", "minecraft:warped_stem",
  "minecraft:stripped_oak_log", "minecraft:stripped_spruce_log",
  "minecraft:stripped_birch_log", "minecraft:stripped_jungle_log",
  "minecraft:stripped_acacia_log", "minecraft:stripped_dark_oak_log",
  "minecraft:stripped_mangrove_log", "minecraft:stripped_cherry_log",
  "minecraft:stripped_pale_oak_log"
]);

export const STONE_BLOCKS = new Set([
  "minecraft:stone", "minecraft:deepslate", "minecraft:tuff",
  "minecraft:andesite", "minecraft:diorite", "minecraft:granite"
]);

export const COAL_ORES = new Set([
  "minecraft:coal_ore", "minecraft:deepslate_coal_ore"
]);

export const IRON_ORES = new Set([
  "minecraft:iron_ore", "minecraft:deepslate_iron_ore"
]);

export const DIAMOND_ORES = new Set([
  "minecraft:diamond_ore", "minecraft:deepslate_diamond_ore"
]);

export const LAVA_BLOCKS = new Set([
  "minecraft:lava", "minecraft:flowing_lava"
]);

export const REPLACEABLE_BLOCKS = new Set([
  "minecraft:air", "minecraft:cave_air", "minecraft:void_air",
  "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern",
  "minecraft:large_fern", "minecraft:snow_layer", "minecraft:vine",
  "minecraft:deadbush"
]);

export const DANGER_BLOCKS = new Set([
  "minecraft:lava", "minecraft:flowing_lava", "minecraft:fire",
  "minecraft:soul_fire", "minecraft:cactus", "minecraft:magma"
]);

export const HOSTILE_TYPES = new Set([
  "minecraft:zombie", "minecraft:husk", "minecraft:drowned",
  "minecraft:skeleton", "minecraft:stray", "minecraft:bogged",
  "minecraft:creeper", "minecraft:spider", "minecraft:cave_spider",
  "minecraft:witch", "minecraft:pillager", "minecraft:vindicator",
  "minecraft:evocation_illager", "minecraft:ravager",
  "minecraft:phantom", "minecraft:slime", "minecraft:magma_cube",
  "minecraft:piglin_brute", "minecraft:zombified_piglin",
  "minecraft:wither_skeleton", "minecraft:blaze", "minecraft:ghast",
  "minecraft:guardian", "minecraft:elder_guardian",
  "minecraft:shulker", "minecraft:silverfish", "minecraft:endermite",
  "minecraft:breeze", "minecraft:warden"
]);

export const RANGED_THREATS = new Set([
  "minecraft:skeleton", "minecraft:stray", "minecraft:bogged",
  "minecraft:pillager", "minecraft:witch", "minecraft:blaze",
  "minecraft:ghast", "minecraft:shulker"
]);

export const PREY_TYPES = new Set([
  "minecraft:cow", "minecraft:pig", "minecraft:sheep",
  "minecraft:chicken", "minecraft:rabbit"
]);

export const FOOD_ITEMS = new Set([
  "minecraft:apple", "minecraft:bread", "minecraft:carrot",
  "minecraft:baked_potato", "minecraft:cooked_beef",
  "minecraft:cooked_porkchop", "minecraft:cooked_chicken",
  "minecraft:cooked_mutton", "minecraft:cooked_rabbit",
  "minecraft:beef", "minecraft:porkchop", "minecraft:chicken",
  "minecraft:mutton", "minecraft:rabbit", "minecraft:sweet_berries"
]);

export const NAMES = [
  "Ayla", "Caio", "Luna", "Nico", "Maya", "Theo", "Iris", "Ravi",
  "Bia", "Noah", "Liz", "Gael", "Zoe", "Davi", "Nina", "Kai"
];

export const PERSONAS = [
  "explorer", "builder", "guardian", "hunter", "diplomat", "rival"
];

export const PERSONA_LABELS = {
  explorer: "Explorador",
  builder: "Construtor",
  guardian: "Guardião",
  hunter: "Caçador",
  diplomat: "Diplomata",
  rival: "Competitivo"
};
