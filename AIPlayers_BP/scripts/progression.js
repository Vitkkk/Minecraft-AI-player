import { world } from "@minecraft/server";
import {
  COAL_ORES,
  DIAMOND_ORES,
  ENCOUNTER_TIMEOUT_TICKS,
  GUARANTEE_PROGRESS,
  IRON_ORES,
  LAVA_BLOCKS,
  LOG_BLOCKS,
  NAMES,
  PERSONAS,
  REPLACEABLE_BLOCKS,
  STONE_BLOCKS
} from "./config.js";
import { Stage, advanceStage, stageLabel } from "./core/brain.js";
import {
  countFood,
  countItems,
  countPlanks,
  craft,
  ensurePlanks,
  ensureSticks,
  equipArmor,
  equipForWork,
  giveItem,
  hasItem,
  restoreInventory,
  snapshotInventory,
  takeItems
} from "./inventory.js";
import {
  findNearestBlock,
  findSafeArrival,
  firstBlockingBlock,
  isPassable,
  moveToward,
  wanderTarget
} from "./navigation.js";
import {
  addStat,
  decodeLocation,
  dimensionId,
  encodeLocation,
  getProp,
  getStat,
  hashString,
  modeEvent,
  nearbyMessage,
  safe,
  seededUnit,
  setProp
} from "./util.js";

const resourceTargets = new Map();
const miningStates = new Map();
const buildStates = new Map();
const travelStates = new Map();

const PLANK_MATCHER = typeId => typeId.endsWith("_planks");
const BREAKABLE_PATH_BLOCKS = typeId =>
  STONE_BLOCKS.has(typeId) || COAL_ORES.has(typeId) ||
  IRON_ORES.has(typeId) || DIAMOND_ORES.has(typeId) ||
  typeId.includes("dirt") || typeId.includes("sand") ||
  typeId.includes("gravel") || typeId.includes("netherrack");

function currentBlock(dimension, location) {
  return safe(() => dimension.getBlock({
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z)
  }));
}

function setBlock(dimension, location, typeId) {
  const block = currentBlock(dimension, location);
  return safe(() => {
    block?.setType(typeId);
    return Boolean(block);
  }, false);
}

function propBool(entity, key) {
  return Boolean(getProp(entity, key, false));
}

export function getStage(entity) {
  return Math.max(0, Math.min(Stage.COMPLETE,
    Math.floor(Number(getProp(entity, "aip:stage", Stage.BOOT)))));
}

export function factsFor(entity) {
  return {
    dimension: dimensionId(entity),
    woodMined: getStat(entity, "wood_mined"),
    stoneMined: getStat(entity, "stone_mined"),
    food: countFood(entity),
    diamonds: countItems(entity, "minecraft:diamond"),
    blazeRods: countItems(entity, "minecraft:blaze_rod"),
    enderEyes: countItems(entity, "minecraft:ender_eye"),
    hasWoodPick: hasItem(entity, "minecraft:wooden_pickaxe"),
    hasStonePick: hasItem(entity, "minecraft:stone_pickaxe"),
    hasFurnace: propBool(entity, "aip:furnace_built"),
    hasIronPick: hasItem(entity, "minecraft:iron_pickaxe"),
    hasIronSword: hasItem(entity, "minecraft:iron_sword"),
    hasShield: hasItem(entity, "minecraft:shield"),
    hasDiamondPick: hasItem(entity, "minecraft:diamond_pickaxe"),
    shelterBuilt: propBool(entity, "aip:shelter_built"),
    portalBuilt: propBool(entity, "aip:portal_built"),
    dragonDead: propBool(entity, "aip:dragon_dead")
  };
}

export function updateNameplate(entity) {
  const base = String(getProp(entity, "aip:base_name", "Jogador IA"));
  const stage = getStage(entity);
  entity.nameTag = `§b${base} §7[${stageLabel(stage)}]`;
}

export function setStage(entity, stage) {
  const previous = getStage(entity);
  if (previous === stage) return false;
  setProp(entity, "aip:stage", stage);
  setProp(entity, "aip:stage_started", world.getAbsoluteTime());
  resourceTargets.delete(entity.id);
  miningStates.delete(entity.id);
  updateNameplate(entity);
  nearbyMessage(entity,
    `§8[AI] §b${getProp(entity, "aip:base_name", "Agente")} §7→ §f${stageLabel(stage)}`);
  return true;
}

export function initializeAgent(entity, owner = undefined) {
  if (propBool(entity, "aip:initialized")) return false;
  const seed = hashString(entity.id);
  const baseName = NAMES[seed % NAMES.length];
  const suffix = (seed >>> 8) % 10;
  const name = suffix < 3 ? `${baseName}${(seed % 90) + 10}` : baseName;
  const persona = PERSONAS[(seed >>> 4) % PERSONAS.length];

  setProp(entity, "aip:initialized", true);
  setProp(entity, "aip:base_name", name);
  setProp(entity, "aip:persona", persona);
  setProp(entity, "aip:stage", Stage.BOOT);
  setProp(entity, "aip:mode", "auto");
  setProp(entity, "aip:home", encodeLocation(entity.location));
  setProp(entity, "aip:spawn_tick", world.getAbsoluteTime());
  setProp(entity, "aip:stage_started", world.getAbsoluteTime());
  setProp(entity, "aip:deaths", 0);
  setProp(entity, "aip:relations", "{}");

  if (owner) {
    setProp(entity, "aip:owner_id", owner.id);
    setProp(entity, "aip:team", `human:${owner.id}`);
    setProp(entity, "aip:relations", JSON.stringify({ [owner.id]: 100 }));
  } else {
    setProp(entity, "aip:team", `solo:${entity.id}`);
  }

  giveItem(entity, "minecraft:apple", 2);
  updateNameplate(entity);
  modeEvent(entity, "work");
  return true;
}

function dropForBlock(typeId) {
  if (LOG_BLOCKS.has(typeId)) return typeId;
  if (typeId === "minecraft:stone") return "minecraft:cobblestone";
  if (typeId === "minecraft:deepslate") return "minecraft:cobbled_deepslate";
  if (COAL_ORES.has(typeId)) return "minecraft:coal";
  if (IRON_ORES.has(typeId)) return "minecraft:raw_iron";
  if (DIAMOND_ORES.has(typeId)) return "minecraft:diamond";
  if (typeId === "minecraft:obsidian") return "minecraft:obsidian";
  if (typeId.includes("dirt")) return "minecraft:dirt";
  if (typeId.includes("sand")) return "minecraft:sand";
  if (typeId.includes("gravel")) return "minecraft:gravel";
  if (typeId.includes("netherrack")) return "minecraft:netherrack";
  if (STONE_BLOCKS.has(typeId)) return "minecraft:cobblestone";
  return undefined;
}

function miningThreshold(typeId, entity) {
  if (LOG_BLOCKS.has(typeId)) return 5;
  if (typeId === "minecraft:obsidian") return 30;
  if (DIAMOND_ORES.has(typeId)) return 14;
  if (IRON_ORES.has(typeId) || COAL_ORES.has(typeId)) return 10;
  if (STONE_BLOCKS.has(typeId)) return hasItem(entity, "minecraft:stone_pickaxe") ? 6 : 9;
  if (typeId.includes("dirt") || typeId.includes("sand") ||
      typeId.includes("gravel") || typeId.includes("netherrack")) return 4;
  return 10;
}

function recordMinedBlock(entity, typeId) {
  const drop = dropForBlock(typeId);
  if (drop) giveItem(entity, drop, 1);
  if (LOG_BLOCKS.has(typeId)) {
    addStat(entity, "wood_mined", 1);
    if (Math.random() < 0.2) giveItem(entity, "minecraft:apple", 1);
  } else if (STONE_BLOCKS.has(typeId)) {
    addStat(entity, "stone_mined", 1);
  } else if (COAL_ORES.has(typeId)) {
    addStat(entity, "coal_mined", 1);
  } else if (IRON_ORES.has(typeId)) {
    addStat(entity, "iron_mined", 1);
  } else if (DIAMOND_ORES.has(typeId)) {
    addStat(entity, "diamond_mined", 1);
  } else if (typeId === "minecraft:obsidian") {
    addStat(entity, "obsidian_mined", 1);
  }
}

function workBlock(entity, block, tick, collect = true) {
  if (!block) return false;
  const location = block.location;
  const key = `${location.x},${location.y},${location.z}`;
  const d = Math.hypot(
    entity.location.x - (location.x + 0.5),
    entity.location.y + 0.8 - (location.y + 0.5),
    entity.location.z - (location.z + 0.5)
  );
  if (d > 2.8) {
    moveToward(entity, { x: location.x + 0.5, y: location.y, z: location.z + 0.5 }, {
      tick,
      reach: 2.25,
      cautious: false,
      impulse: 0.058
    });
    return false;
  }

  equipForWork(entity);
  safe(() => entity.lookAt({
    x: location.x + 0.5,
    y: location.y + 0.5,
    z: location.z + 0.5
  }));
  if (tick % 10 === 0) {
    safe(() => entity.playAnimation("animation.humanoid.attack.rotations"));
    const sound = LOG_BLOCKS.has(block.typeId) ? "dig.wood" : "dig.stone";
    safe(() => entity.dimension.playSound(sound, entity.location, {
      volume: 0.45,
      pitch: 0.9 + Math.random() * 0.2
    }));
  }

  let state = miningStates.get(entity.id);
  if (!state || state.key !== key || state.typeId !== block.typeId) {
    state = { key, typeId: block.typeId, progress: 0 };
  }
  state.progress += 1;
  miningStates.set(entity.id, state);
  setProp(entity, "aip:activity", `mining:${block.typeId}`);

  if (state.progress < miningThreshold(block.typeId, entity)) return false;
  const typeId = block.typeId;
  if (!setBlock(entity.dimension, location, "minecraft:air")) return false;
  if (collect) recordMinedBlock(entity, typeId);
  miningStates.delete(entity.id);
  safe(() => entity.dimension.spawnParticle(
    "minecraft:basic_crit_particle",
    { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 }
  ));
  return true;
}

function validTargetBlock(entity, state, matcher) {
  if (!state?.location) return undefined;
  const block = currentBlock(entity.dimension, state.location);
  if (!block || !matcher(block)) return undefined;
  return block;
}

function seekAndMine(entity, matcher, options, tick) {
  const existing = resourceTargets.get(entity.id);
  let target = validTargetBlock(entity, existing, matcher);

  if (!target && (tick % 35 === hashString(entity.id) % 35 || !existing)) {
    target = findNearestBlock(entity, matcher, options);
    if (target) {
      resourceTargets.set(entity.id, {
        location: { ...target.location },
        typeId: target.typeId
      });
    }
  }

  if (!target) {
    const wander = wanderTarget(entity, options.wanderRadius ?? 18, tick);
    moveToward(entity, wander, { tick, reach: 2, cautious: true });
    setProp(entity, "aip:activity", "searching");
    return false;
  }

  const d = Math.hypot(
    entity.location.x - target.location.x,
    entity.location.y - target.location.y,
    entity.location.z - target.location.z
  );
  if (d > 3.1) {
    const obstruction = firstBlockingBlock(entity, target.location);
    if (obstruction && BREAKABLE_PATH_BLOCKS(obstruction.typeId)) {
      workBlock(entity, obstruction, tick, true);
      return false;
    }
  }

  const done = workBlock(entity, target, tick, true);
  if (done) resourceTargets.delete(entity.id);
  return done;
}

function staircaseMine(entity, desiredY, tick) {
  const headingIndex = hashString(entity.id) % 4;
  const headings = [
    { x: 1, z: 0 }, { x: -1, z: 0 },
    { x: 0, z: 1 }, { x: 0, z: -1 }
  ];
  const heading = headings[headingIndex];
  const current = entity.location;
  const descend = current.y > desiredY + 3;
  const goal = {
    x: Math.floor(current.x) + heading.x * 2 + 0.5,
    y: Math.floor(current.y) - (descend ? 1 : 0),
    z: Math.floor(current.z) + heading.z * 2 + 0.5
  };

  const obstruction = firstBlockingBlock(entity, goal);
  if (obstruction && BREAKABLE_PATH_BLOCKS(obstruction.typeId)) {
    workBlock(entity, obstruction, tick, true);
  } else {
    const belowGoal = currentBlock(entity.dimension, {
      x: goal.x,
      y: goal.y - 1,
      z: goal.z
    });
    if (descend && belowGoal && !isPassable(belowGoal)) {
      workBlock(entity, belowGoal, tick, true);
    } else {
      moveToward(entity, goal, { tick, reach: 0.9, cautious: false });
    }
  }
  setProp(entity, "aip:activity", descend ? "digging_staircase" : "branch_mining");
}

function ensureWoodTools(entity) {
  ensurePlanks(entity, 10);
  ensureSticks(entity, 4);
  if (!hasItem(entity, "minecraft:wooden_pickaxe")) {
    craft(entity, [
      { matcher: PLANK_MATCHER, amount: 3 },
      { matcher: "minecraft:stick", amount: 2 }
    ], "minecraft:wooden_pickaxe", 1);
  }
  if (!hasItem(entity, "minecraft:wooden_sword") && countPlanks(entity) >= 2) {
    craft(entity, [
      { matcher: PLANK_MATCHER, amount: 2 },
      { matcher: "minecraft:stick", amount: 1 }
    ], "minecraft:wooden_sword", 1);
  }
}

function ensureStoneTools(entity) {
  ensureSticks(entity, 5);
  if (!hasItem(entity, "minecraft:stone_pickaxe")) {
    craft(entity, [
      { matcher: new Set(["minecraft:cobblestone", "minecraft:cobbled_deepslate"]), amount: 3 },
      { matcher: "minecraft:stick", amount: 2 }
    ], "minecraft:stone_pickaxe", 1);
  }
  if (!hasItem(entity, "minecraft:stone_sword")) {
    craft(entity, [
      { matcher: new Set(["minecraft:cobblestone", "minecraft:cobbled_deepslate"]), amount: 2 },
      { matcher: "minecraft:stick", amount: 1 }
    ], "minecraft:stone_sword", 1);
  }
  if (!propBool(entity, "aip:furnace_built") &&
      countItems(entity, new Set(["minecraft:cobblestone", "minecraft:cobbled_deepslate"])) >= 8) {
    if (takeItems(entity,
      new Set(["minecraft:cobblestone", "minecraft:cobbled_deepslate"]), 8)) {
      setProp(entity, "aip:furnace_built", true);
      addStat(entity, "crafted", 1);
    }
  }
}

function ensureIronTools(entity) {
  ensurePlanks(entity, 8);
  ensureSticks(entity, 6);
  if (!hasItem(entity, "minecraft:iron_pickaxe")) {
    craft(entity, [
      { matcher: "minecraft:iron_ingot", amount: 3 },
      { matcher: "minecraft:stick", amount: 2 }
    ], "minecraft:iron_pickaxe", 1);
  }
  if (!hasItem(entity, "minecraft:iron_sword")) {
    craft(entity, [
      { matcher: "minecraft:iron_ingot", amount: 2 },
      { matcher: "minecraft:stick", amount: 1 }
    ], "minecraft:iron_sword", 1);
  }
  if (!hasItem(entity, "minecraft:bucket")) {
    craft(entity, [{ matcher: "minecraft:iron_ingot", amount: 3 }],
      "minecraft:bucket", 1);
  }
  if (!hasItem(entity, "minecraft:shield")) {
    craft(entity, [
      { matcher: "minecraft:iron_ingot", amount: 1 },
      { matcher: PLANK_MATCHER, amount: 6 }
    ], "minecraft:shield", 1);
  }
  if (!hasItem(entity, "minecraft:iron_chestplate") &&
      countItems(entity, "minecraft:iron_ingot") >= 8) {
    craft(entity, [{ matcher: "minecraft:iron_ingot", amount: 8 }],
      "minecraft:iron_chestplate", 1);
  }
  equipArmor(entity);
}

function smeltIron(entity, tick) {
  if (tick % 20 !== hashString(entity.id) % 20) return;
  const storedFuel = getStat(entity, "smelt_fuel");
  const coal = countItems(entity, "minecraft:coal");
  if (countItems(entity, "minecraft:raw_iron") > 0 &&
      (storedFuel > 0 || coal > 0)) {
    takeItems(entity, "minecraft:raw_iron", 1);
    if (storedFuel <= 0) {
      takeItems(entity, "minecraft:coal", 1);
      setProp(entity, "aip:stat_smelt_fuel", 7);
    } else {
      addStat(entity, "smelt_fuel", -1);
    }
    giveItem(entity, "minecraft:iron_ingot", 1);
    safe(() => entity.dimension.playSound("block.furnace.fire_crackle", entity.location, {
      volume: 0.5,
      pitch: 1
    }));
  }
}

function shelterBlueprint(origin) {
  const blocks = [];
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x <= 3; x++) {
      for (let z = 0; z <= 3; z++) {
        const edge = x === 0 || x === 3 || z === 0 || z === 3;
        const doorway = z === 0 && x === 1 && y < 2;
        if (edge && !doorway) {
          blocks.push({ x: origin.x + x, y: origin.y + y, z: origin.z + z,
            typeId: "minecraft:oak_planks", item: "planks" });
        }
      }
    }
  }
  for (let x = 0; x <= 3; x++) {
    for (let z = 0; z <= 3; z++) {
      blocks.push({ x: origin.x + x, y: origin.y + 3, z: origin.z + z,
        typeId: "minecraft:oak_planks", item: "planks" });
    }
  }
  blocks.push({ x: origin.x + 1, y: origin.y, z: origin.z + 2,
    typeId: "minecraft:crafting_table", item: "free" });
  blocks.push({ x: origin.x + 2, y: origin.y, z: origin.z + 2,
    typeId: "minecraft:furnace", item: "free" });
  blocks.push({ x: origin.x + 1, y: origin.y + 2, z: origin.z,
    typeId: "minecraft:torch", item: "free" });
  return blocks;
}

function buildShelter(entity) {
  const home = decodeLocation(getProp(entity, "aip:home", ""));
  if (!home) return false;
  let state = buildStates.get(entity.id);
  if (!state || state.kind !== "shelter") {
    const origin = { x: home.x - 1, y: home.y, z: home.z - 1 };
    state = { kind: "shelter", index: 0, blocks: shelterBlueprint(origin) };
  }

  while (state.index < state.blocks.length) {
    const entry = state.blocks[state.index];
    const block = currentBlock(entity.dimension, entry);
    if (!block) return false;
    if (!REPLACEABLE_BLOCKS.has(block.typeId) && block.typeId !== entry.typeId) {
      state.index++;
      continue;
    }
    if (block.typeId === entry.typeId) {
      state.index++;
      continue;
    }
    if (entry.item === "planks") {
      if (!ensurePlanks(entity, 1) || !takeItems(entity, PLANK_MATCHER, 1)) {
        buildStates.set(entity.id, state);
        return false;
      }
    }
    setBlock(entity.dimension, entry, entry.typeId);
    state.index++;
    buildStates.set(entity.id, state);
    setProp(entity, "aip:activity", "building_shelter");
    return false;
  }

  setProp(entity, "aip:shelter_built", true);
  buildStates.delete(entity.id);
  safe(() => entity.dimension.spawnParticle(
    "minecraft:villager_happy", entity.location
  ));
  return true;
}

function portalBlueprint(origin) {
  const blocks = [];
  for (const x of [1, 2]) {
    blocks.push({ x: origin.x + x, y: origin.y, z: origin.z });
    blocks.push({ x: origin.x + x, y: origin.y + 4, z: origin.z });
  }
  for (const x of [0, 3]) {
    for (let y = 1; y <= 3; y++) {
      blocks.push({ x: origin.x + x, y: origin.y + y, z: origin.z });
    }
  }
  return blocks;
}

function buildNetherPortal(entity, tick) {
  const home = decodeLocation(getProp(entity, "aip:home", ""), entity.location);
  let state = buildStates.get(entity.id);
  if (!state || state.kind !== "nether_portal") {
    const origin = { x: home.x + 6, y: home.y, z: home.z };
    state = {
      kind: "nether_portal",
      index: 0,
      origin,
      blocks: portalBlueprint(origin),
      finishedAt: 0
    };
  }

  if (state.index < state.blocks.length) {
    const entry = state.blocks[state.index];
    if (countItems(entity, "minecraft:obsidian") <= 0) {
      buildStates.set(entity.id, state);
      return false;
    }
    const block = currentBlock(entity.dimension, entry);
    if (block?.typeId !== "minecraft:obsidian") {
      takeItems(entity, "minecraft:obsidian", 1);
      setBlock(entity.dimension, entry, "minecraft:obsidian");
    }
    state.index++;
    buildStates.set(entity.id, state);
    setProp(entity, "aip:activity", "building_nether_portal");
    return false;
  }

  if (!state.finishedAt) {
    state.finishedAt = tick;
    setBlock(entity.dimension, {
      x: state.origin.x + 1,
      y: state.origin.y + 1,
      z: state.origin.z
    }, "minecraft:fire");
    buildStates.set(entity.id, state);
    return false;
  }

  if (tick - state.finishedAt >= 30) {
    for (const x of [1, 2]) {
      for (let y = 1; y <= 3; y++) {
        const location = {
          x: state.origin.x + x,
          y: state.origin.y + y,
          z: state.origin.z
        };
        const block = currentBlock(entity.dimension, location);
        if (block && block.typeId !== "minecraft:portal") {
          setBlock(entity.dimension, location, "minecraft:portal");
        }
      }
    }
    setProp(entity, "aip:portal_built", true);
    setProp(entity, "aip:portal_location", encodeLocation(state.origin));
    buildStates.delete(entity.id);
    return true;
  }
  return false;
}

function castLava(entity, tick) {
  const lava = findNearestBlock(entity, LAVA_BLOCKS, {
    radius: 15,
    vertical: 10,
    budget: 620,
    wanderRadius: 14
  });
  if (!lava) {
    staircaseMine(entity, -48, tick);
    return false;
  }
  const d = Math.hypot(
    entity.location.x - lava.location.x,
    entity.location.y - lava.location.y,
    entity.location.z - lava.location.z
  );
  if (d > 2.8) {
    const obstruction = firstBlockingBlock(entity, lava.location);
    if (obstruction && BREAKABLE_PATH_BLOCKS(obstruction.typeId)) {
      workBlock(entity, obstruction, tick, true);
    } else {
      moveToward(entity, lava.location, { tick, reach: 2.2, cautious: true });
    }
    return false;
  }
  setBlock(entity.dimension, lava.location, "minecraft:obsidian");
  safe(() => entity.dimension.playSound("random.fizz", lava.location, {
    volume: 0.8,
    pitch: 1
  }));
  return true;
}

function teleportToNether(entity) {
  const nether = world.getDimension("minecraft:nether");
  const home = decodeLocation(getProp(entity, "aip:home", ""), entity.location);
  const x = Math.floor(home.x / 8);
  const z = Math.floor(home.z / 8);
  const arrival = findSafeArrival(nether, x, z, 72);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      setBlock(nether, { x: arrival.x + dx, y: arrival.y - 1, z: arrival.z + dz },
        "minecraft:netherrack");
      setBlock(nether, { x: arrival.x + dx, y: arrival.y, z: arrival.z + dz },
        "minecraft:air");
      setBlock(nether, { x: arrival.x + dx, y: arrival.y + 1, z: arrival.z + dz },
        "minecraft:air");
    }
  }
  safe(() => entity.teleport(arrival, {
    dimension: nether,
    keepVelocity: false
  }));
  setProp(entity, "aip:entered_nether", true);
  setProp(entity, "aip:activity", "entered_nether");
}

function returnToOverworld(entity) {
  const overworld = world.getDimension("minecraft:overworld");
  const home = decodeLocation(getProp(entity, "aip:home", ""), world.getDefaultSpawnLocation());
  const arrival = findSafeArrival(overworld, home.x, home.z, home.y);
  safe(() => entity.teleport(arrival, {
    dimension: overworld,
    keepVelocity: false
  }));
  setProp(entity, "aip:activity", "returned_overworld");
}

function maybeSpawnEncounter(entity, typeId, count, key, tick) {
  if (!GUARANTEE_PROGRESS) return false;
  const state = travelStates.get(entity.id) ?? {};
  const last = state[key] ?? Number(getProp(entity, "aip:stage_started", tick));
  if (tick - last < ENCOUNTER_TIMEOUT_TICKS) {
    if (!state[key]) {
      state[key] = last;
      travelStates.set(entity.id, state);
    }
    return false;
  }

  for (let i = 0; i < count; i++) {
    const angle = i / count * Math.PI * 2;
    const location = {
      x: entity.location.x + Math.cos(angle) * (7 + i),
      y: entity.location.y + 1,
      z: entity.location.z + Math.sin(angle) * (7 + i)
    };
    safe(() => entity.dimension.spawnEntity(typeId, location));
  }
  state[key] = tick;
  travelStates.set(entity.id, state);
  nearbyMessage(entity, `§8[AI] §7${entity.nameTag} encontrou um grupo durante a expedição.`);
  return true;
}

function craftEnderEyes(entity) {
  while (countItems(entity, "minecraft:blaze_rod") > 0 &&
         countItems(entity, "minecraft:blaze_powder") <
         countItems(entity, "minecraft:ender_pearl")) {
    takeItems(entity, "minecraft:blaze_rod", 1);
    giveItem(entity, "minecraft:blaze_powder", 2);
  }
  while (countItems(entity, "minecraft:ender_pearl") > 0 &&
         countItems(entity, "minecraft:blaze_powder") > 0 &&
         countItems(entity, "minecraft:ender_eye") < 12) {
    takeItems(entity, "minecraft:ender_pearl", 1);
    takeItems(entity, "minecraft:blaze_powder", 1);
    giveItem(entity, "minecraft:ender_eye", 1);
  }
}

function strongholdTarget(entity) {
  const home = decodeLocation(getProp(entity, "aip:home", ""), entity.location);
  const seed = hashString(entity.id);
  const angle = seededUnit(seed ^ 0x51f15e) * Math.PI * 2;
  const range = 180 + seededUnit(seed ^ 0x9e3779b9) * 100;
  return {
    x: Math.floor(home.x + Math.cos(angle) * range),
    y: Math.max(22, Math.floor(home.y - 22)),
    z: Math.floor(home.z + Math.sin(angle) * range)
  };
}

function strongholdBlueprint(origin) {
  const blocks = [];
  for (let x = -3; x <= 3; x++) {
    for (let z = -3; z <= 3; z++) {
      blocks.push({ x: origin.x + x, y: origin.y - 1, z: origin.z + z,
        typeId: "minecraft:stone_bricks" });
      if (Math.abs(x) === 3 || Math.abs(z) === 3) {
        for (let y = 0; y <= 2; y++) {
          const doorway = z === -3 && x === 0 && y < 2;
          if (!doorway) blocks.push({
            x: origin.x + x, y: origin.y + y, z: origin.z + z,
            typeId: "minecraft:stone_bricks"
          });
        }
      }
    }
  }
  const frames = [
    [-2, -2], [-1, -2], [0, -2],
    [2, -1], [2, 0], [2, 1],
    [-2, 2], [-1, 2], [0, 2],
    [-3, -1], [-3, 0], [-3, 1]
  ];
  for (const [x, z] of frames) {
    blocks.push({ x: origin.x + x, y: origin.y, z: origin.z + z,
      typeId: "minecraft:end_portal_frame" });
  }
  for (let x = -2; x <= 0; x++) {
    for (let z = -1; z <= 1; z++) {
      blocks.push({ x: origin.x + x, y: origin.y, z: origin.z + z,
        typeId: "minecraft:end_portal" });
    }
  }
  return blocks;
}

function buildStronghold(entity, tick) {
  const target = strongholdTarget(entity);
  const surfaceGoal = { x: target.x + 0.5, y: entity.location.y, z: target.z + 0.5 };
  const horizontal = Math.hypot(
    entity.location.x - surfaceGoal.x,
    entity.location.z - surfaceGoal.z
  );
  if (horizontal > 7) {
    moveToward(entity, surfaceGoal, {
      tick,
      reach: 5,
      cautious: true,
      impulse: 0.066,
      maxSpeed: 0.4
    });
    setProp(entity, "aip:activity", "triangulating_stronghold");
    return false;
  }

  let state = buildStates.get(entity.id);
  if (!state || state.kind !== "stronghold") {
    const origin = {
      x: Math.floor(entity.location.x),
      y: Math.max(5, Math.floor(entity.location.y)),
      z: Math.floor(entity.location.z)
    };
    state = {
      kind: "stronghold",
      index: 0,
      origin,
      blocks: strongholdBlueprint(origin),
      finishedAt: 0
    };
  }

  if (state.index < state.blocks.length) {
    const entry = state.blocks[state.index++];
    setBlock(entity.dimension, entry, entry.typeId);
    buildStates.set(entity.id, state);
    setProp(entity, "aip:activity", "excavating_stronghold");
    return false;
  }

  if (!state.finishedAt) {
    state.finishedAt = tick;
    takeItems(entity, "minecraft:ender_eye",
      Math.min(12, countItems(entity, "minecraft:ender_eye")));
    if (!hasItem(entity, "minecraft:bow")) giveItem(entity, "minecraft:bow", 1);
    if (countItems(entity, "minecraft:arrow") < 32) giveItem(entity, "minecraft:arrow", 32);
    giveItem(entity, "minecraft:bread", 8);
    setProp(entity, "aip:stronghold_built", true);
    setProp(entity, "aip:end_portal_location", encodeLocation(state.origin));
    buildStates.set(entity.id, state);
    return false;
  }

  if (tick - state.finishedAt > 35) {
    const end = world.getDimension("minecraft:the_end");
    const arrival = { x: 100.5, y: 50, z: 0.5 };
    safe(() => entity.teleport(arrival, {
      dimension: end,
      keepVelocity: false
    }));
    buildStates.delete(entity.id);
    setProp(entity, "aip:activity", "entered_end");
    return true;
  }
  return false;
}

function tickWood(entity, tick) {
  ensureWoodTools(entity);
  if (getStat(entity, "wood_mined") < 8 || !hasItem(entity, "minecraft:wooden_pickaxe")) {
    seekAndMine(entity, block => LOG_BLOCKS.has(block.typeId), {
      radius: 18, vertical: 10, budget: 760, wanderRadius: 22
    }, tick);
  }
  ensureWoodTools(entity);
}

function tickStone(entity, tick) {
  ensureStoneTools(entity);
  if (getStat(entity, "stone_mined") < 20 || !hasItem(entity, "minecraft:stone_pickaxe")) {
    const found = seekAndMine(entity, block => STONE_BLOCKS.has(block.typeId), {
      radius: 12, vertical: 7, budget: 700, wanderRadius: 14
    }, tick);
    if (!found && entity.location.y > 30) staircaseMine(entity, 28, tick);
  }
  ensureStoneTools(entity);
}

function tickShelter(entity, tick) {
  if (!propBool(entity, "aip:shelter_built") && countPlanks(entity) < 1) {
    ensurePlanks(entity, 16);
  }
  if (countPlanks(entity) < 1 && !propBool(entity, "aip:shelter_built")) {
    seekAndMine(entity, block => LOG_BLOCKS.has(block.typeId), {
      radius: 20, vertical: 10, budget: 760, wanderRadius: 22
    }, tick);
    ensurePlanks(entity, 16);
    return;
  }
  if (!propBool(entity, "aip:shelter_built")) {
    buildShelter(entity);
    return;
  }
  if (countFood(entity) < 6) {
    const wander = wanderTarget(entity, 24, tick);
    moveToward(entity, wander, { tick, reach: 2, cautious: true });
    setProp(entity, "aip:activity", "hunting_food");
  }
}

function tickIron(entity, tick) {
  smeltIron(entity, tick);
  ensureIronTools(entity);
  const ready = hasItem(entity, "minecraft:iron_pickaxe") &&
    hasItem(entity, "minecraft:iron_sword") &&
    hasItem(entity, "minecraft:shield");
  if (ready) return;

  const needsCoal = countItems(entity, "minecraft:coal") < 3 &&
    getStat(entity, "smelt_fuel") <= 0;
  const matcher = needsCoal
    ? block => COAL_ORES.has(block.typeId)
    : block => IRON_ORES.has(block.typeId);
  const found = seekAndMine(entity, matcher, {
    radius: 13, vertical: 10, budget: 760, wanderRadius: 12
  }, tick);
  if (!found) staircaseMine(entity, 12, tick);
}

function tickDiamond(entity, tick) {
  if (countItems(entity, "minecraft:diamond") >= 3 &&
      !hasItem(entity, "minecraft:diamond_pickaxe")) {
    ensureSticks(entity, 2);
    craft(entity, [
      { matcher: "minecraft:diamond", amount: 3 },
      { matcher: "minecraft:stick", amount: 2 }
    ], "minecraft:diamond_pickaxe", 1);
  }
  if (hasItem(entity, "minecraft:diamond_pickaxe")) return;
  const found = seekAndMine(entity, block => DIAMOND_ORES.has(block.typeId), {
    radius: 13, vertical: 11, budget: 760, wanderRadius: 10
  }, tick);
  if (!found) staircaseMine(entity, -52, tick);
}

function tickPortal(entity, tick) {
  if (!hasItem(entity, "minecraft:diamond_pickaxe")) {
    tickDiamond(entity, tick);
    return;
  }
  if (countItems(entity, "minecraft:obsidian") < 10) {
    const obsidian = seekAndMine(entity,
      block => block.typeId === "minecraft:obsidian",
      { radius: 13, vertical: 10, budget: 650, wanderRadius: 10 }, tick);
    if (!obsidian) castLava(entity, tick);
    return;
  }
  if (!propBool(entity, "aip:portal_built")) {
    buildNetherPortal(entity, tick);
    return;
  }
  const state = travelStates.get(entity.id) ?? {};
  if (!state.netherReady) {
    state.netherReady = tick;
    travelStates.set(entity.id, state);
  } else if (tick - state.netherReady > 30 &&
             dimensionId(entity) !== "minecraft:nether") {
    teleportToNether(entity);
  }
}

function tickNether(entity, tick) {
  const blazes = safe(() => entity.dimension.getEntities({
    type: "minecraft:blaze",
    location: entity.location,
    maxDistance: 40
  }), []);
  if (!blazes.length) {
    const goal = wanderTarget(entity, 30, tick);
    moveToward(entity, goal, { tick, reach: 2, cautious: true });
    setProp(entity, "aip:activity", "searching_fortress");
    maybeSpawnEncounter(entity, "minecraft:blaze", 3, "blazeEncounter", tick);
  }
}

function tickPearls(entity, tick) {
  if (dimensionId(entity) === "minecraft:nether") {
    returnToOverworld(entity);
    return;
  }
  craftEnderEyes(entity);
  if (countItems(entity, "minecraft:ender_eye") >= 12) return;
  const endermen = safe(() => entity.dimension.getEntities({
    type: "minecraft:enderman",
    location: entity.location,
    maxDistance: 36
  }), []);
  if (!endermen.length) {
    const goal = wanderTarget(entity, 30, tick);
    moveToward(entity, goal, { tick, reach: 2, cautious: true });
    setProp(entity, "aip:activity", "hunting_endermen");
    maybeSpawnEncounter(entity, "minecraft:enderman", 3, "pearlEncounter", tick);
  }
}

function tickEnd(entity, tick) {
  if (dimensionId(entity) !== "minecraft:the_end") {
    const end = world.getDimension("minecraft:the_end");
    safe(() => entity.teleport({ x: 100.5, y: 50, z: 0.5 }, {
      dimension: end,
      keepVelocity: false
    }));
    return;
  }
  const dragon = safe(() => [...entity.dimension.getEntities({
    type: "minecraft:ender_dragon"
  })][0]);
  if (!dragon) {
    setProp(entity, "aip:dragon_dead", true);
    return;
  }
  const center = { x: 0, y: 62, z: 0 };
  if (Math.hypot(entity.location.x, entity.location.z) > 42) {
    moveToward(entity, center, {
      tick,
      reach: 12,
      cautious: true,
      impulse: 0.066,
      maxSpeed: 0.4
    });
  }
  setProp(entity, "aip:activity", "fighting_ender_dragon");
}

function tickComplete(entity, tick) {
  modeEvent(entity, "idle");
  entity.isSneaking = false;
  setProp(entity, "aip:activity", "completed");
  if (tick % 80 === hashString(entity.id) % 80) {
    safe(() => entity.dimension.spawnParticle(
      "minecraft:totem_particle",
      { x: entity.location.x, y: entity.location.y + 1.2, z: entity.location.z }
    ));
  }
}

function advanceIfReady(entity) {
  const stage = getStage(entity);
  const next = advanceStage(stage, factsFor(entity));
  if (next !== stage) setStage(entity, next);
  return getStage(entity);
}

export function tickProgression(entity, tick, owner = undefined) {
  if (!propBool(entity, "aip:initialized")) initializeAgent(entity, owner);
  const mode = String(getProp(entity, "aip:mode", "auto"));

  if (mode === "hold") {
    const hold = decodeLocation(getProp(entity, "aip:hold_location", ""), entity.location);
    if (Math.hypot(entity.location.x - hold.x, entity.location.z - hold.z) > 3) {
      modeEvent(entity, "work");
      moveToward(entity, hold, { tick, reach: 1.5, cautious: true });
    } else {
      modeEvent(entity, "idle");
      setProp(entity, "aip:activity", "holding_position");
    }
    return;
  }

  if (mode === "follow" && owner?.isValid) {
    const d = Math.hypot(
      entity.location.x - owner.location.x,
      entity.location.z - owner.location.z
    );
    if (entity.dimension.id !== owner.dimension.id || d > 48) {
      safe(() => entity.teleport({
        x: owner.location.x + 1.5,
        y: owner.location.y,
        z: owner.location.z + 1.5
      }, { dimension: owner.dimension, checkForBlocks: true }));
    } else if (d > 4) {
      modeEvent(entity, "sprint");
      moveToward(entity, owner.location, { tick, reach: 3.2, cautious: true,
        impulse: 0.07, maxSpeed: 0.42 });
    } else {
      modeEvent(entity, "idle");
    }
    setProp(entity, "aip:activity", "following_owner");
    return;
  }

  modeEvent(entity, "work");
  let stage = advanceIfReady(entity);
  switch (stage) {
    case Stage.WOOD:
      tickWood(entity, tick);
      break;
    case Stage.STONE:
      tickStone(entity, tick);
      break;
    case Stage.SHELTER:
      tickShelter(entity, tick);
      break;
    case Stage.IRON:
      tickIron(entity, tick);
      break;
    case Stage.DIAMOND:
      tickDiamond(entity, tick);
      break;
    case Stage.PORTAL:
      tickPortal(entity, tick);
      break;
    case Stage.NETHER:
      tickNether(entity, tick);
      break;
    case Stage.PEARLS:
      tickPearls(entity, tick);
      break;
    case Stage.STRONGHOLD:
      buildStronghold(entity, tick);
      break;
    case Stage.END:
      tickEnd(entity, tick);
      break;
    case Stage.COMPLETE:
      tickComplete(entity, tick);
      break;
  }
  advanceIfReady(entity);
}

export function snapshotAgent(entity) {
  const properties = {};
  const ids = safe(() => entity.getDynamicPropertyIds(), []);
  for (const id of ids) {
    if (id.startsWith("aip:")) {
      properties[id] = safe(() => entity.getDynamicProperty(id));
    }
  }
  return {
    nameTag: entity.nameTag,
    properties,
    inventory: snapshotInventory(entity)
  };
}

export function restoreAgent(entity, snapshot) {
  for (const [key, value] of Object.entries(snapshot?.properties ?? {})) {
    setProp(entity, key, value);
  }
  setProp(entity, "aip:initialized", true);
  setProp(entity, "aip:deaths",
    Number(getProp(entity, "aip:deaths", 0)) + 1);
  restoreInventory(entity, snapshot?.inventory ?? []);
  updateNameplate(entity);
  equipArmor(entity);
}

export function clearProgressionState(entityId) {
  resourceTargets.delete(entityId);
  miningStates.delete(entityId);
  buildStates.delete(entityId);
  travelStates.delete(entityId);
}

export function statusLine(entity) {
  const facts = factsFor(entity);
  const activity = String(getProp(entity, "aip:activity", "idle"));
  return [
    `§b${getProp(entity, "aip:base_name", "IA")}`,
    `§7${stageLabel(getStage(entity))}`,
    `§8${activity}`,
    `§fcomida ${facts.food} | diamantes ${facts.diamonds} | olhos ${facts.enderEyes}`
  ].join(" §8— ");
}
