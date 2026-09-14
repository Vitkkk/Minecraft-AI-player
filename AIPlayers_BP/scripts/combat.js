import { EntityDamageCause } from "@minecraft/server";
import {
  HOSTILE_TYPES,
  PREY_TYPES,
  RANGED_THREATS
} from "./config.js";
import { Stage, chooseTactic } from "./core/brain.js";
import {
  bestWeapon,
  countFood,
  countItems,
  equipForCombat,
  giveItem,
  hasItem,
  takeItems
} from "./inventory.js";
import { moveToward } from "./navigation.js";
import { relationBetween } from "./social.js";
import {
  addStat,
  distance,
  getProp,
  heal,
  healthInfo,
  isValid,
  modeEvent,
  normalizeXZ,
  safe,
  setProp
} from "./util.js";

const combatStates = new Map();

function loadedEntityById(dimension, id, origin) {
  return safe(() => [...dimension.getEntities({
    location: origin,
    maxDistance: 112
  })].find(entity => entity.id === id));
}

function targetScore(agent, target, stage) {
  const d = distance(agent.location, target.location);
  if (stage === Stage.END) {
    if (target.typeId === "minecraft:ender_crystal") return d - 80;
    if (target.typeId === "minecraft:ender_dragon") return d - 45;
  }
  if (stage === Stage.NETHER && target.typeId === "minecraft:blaze") return d - 28;
  if (stage === Stage.PEARLS && target.typeId === "minecraft:enderman") return d - 24;
  if (target.typeId === "minecraft:creeper") return d - 8;
  return d;
}

function canTarget(agent, target, stage) {
  if (!target || target.id === agent.id || !isValid(target)) return false;
  if (target.typeId === "minecraft:item" || target.typeId === "minecraft:xp_orb") return false;

  if (stage === Stage.END &&
      (target.typeId === "minecraft:ender_crystal" ||
       target.typeId === "minecraft:ender_dragon")) return true;
  if (stage === Stage.NETHER && target.typeId === "minecraft:blaze") return true;
  if (stage === Stage.PEARLS && target.typeId === "minecraft:enderman") return true;
  if (HOSTILE_TYPES.has(target.typeId)) return true;
  if (stage === Stage.SHELTER && countFood(agent) < 8 && PREY_TYPES.has(target.typeId)) {
    return true;
  }
  if (target.typeId === "minecraft:player" || target.typeId === "aip:player") {
    return relationBetween(agent, target) === "hostile";
  }
  return false;
}

function chooseTarget(agent, stage) {
  const radius = stage === Stage.END ? 112 : stage === Stage.NETHER ? 36 : 22;
  let best;
  let bestScore = Number.POSITIVE_INFINITY;
  const entities = safe(() => agent.dimension.getEntities({
    location: agent.location,
    maxDistance: radius
  }), []);
  for (const target of entities) {
    if (!canTarget(agent, target, stage)) continue;
    const score = targetScore(agent, target, stage);
    if (score < bestScore) {
      best = target;
      bestScore = score;
    }
  }
  return best;
}

function attackDamage(agent) {
  const weapon = bestWeapon(agent);
  if (weapon?.includes("netherite")) return 9;
  if (weapon?.includes("diamond")) return 8;
  if (weapon?.includes("iron")) return 6;
  if (weapon?.includes("stone")) return 5;
  return 3;
}

function attack(agent, target, amount) {
  safe(() => agent.lookAt(target.getHeadLocation?.() ?? target.location));
  safe(() => agent.playAnimation("animation.humanoid.attack.rotations"));
  safe(() => agent.dimension.playSound("random.attack", agent.location, {
    volume: 0.7,
    pitch: 0.92 + Math.random() * 0.16
  }));
  return safe(() => target.applyDamage(amount, {
    cause: EntityDamageCause.entityAttack,
    damagingEntity: agent
  }), false);
}

function rangedAttack(agent, target) {
  safe(() => agent.lookAt(target.location));
  safe(() => agent.playAnimation("animation.humanoid.attack.rotations"));
  safe(() => agent.dimension.spawnParticle(
    "minecraft:basic_crit_particle",
    target.location
  ));
  safe(() => agent.dimension.playSound("random.bow", agent.location, {
    volume: 0.9,
    pitch: 1
  }));
  takeItems(agent, "minecraft:arrow", 1);
  return safe(() => target.applyDamage(4, {
    cause: EntityDamageCause.projectile,
    damagingEntity: agent
  }), false);
}

function maybeEat(agent, tick) {
  const health = healthInfo(agent);
  if (health.ratio >= 0.58 || tick % 40 !== 0 || countFood(agent) <= 0) return;
  const foodEntry = [
    "minecraft:cooked_beef", "minecraft:cooked_porkchop",
    "minecraft:cooked_chicken", "minecraft:cooked_mutton",
    "minecraft:bread", "minecraft:apple", "minecraft:beef",
    "minecraft:porkchop", "minecraft:chicken", "minecraft:mutton"
  ].find(typeId => hasItem(agent, typeId));
  if (!foodEntry) return;
  takeItems(agent, foodEntry, 1);
  heal(agent, foodEntry.includes("cooked") ? 6 : 3);
  safe(() => agent.dimension.playSound("random.burp", agent.location));
}

export function tickCombat(agent, stage, tick) {
  maybeEat(agent, tick);
  let state = combatStates.get(agent.id) ?? {
    targetId: "",
    lastSelect: -999,
    lastAttack: -999,
    lastRanged: -999,
    combo: 0
  };

  let target = state.targetId
    ? loadedEntityById(agent.dimension, state.targetId, agent.location)
    : undefined;
  if (!target || !canTarget(agent, target, stage) ||
      distance(agent.location, target.location) > 120) {
    target = undefined;
    state.targetId = "";
  }
  if (!target && tick - state.lastSelect >= 15) {
    target = chooseTarget(agent, stage);
    state.lastSelect = tick;
    state.targetId = target?.id ?? "";
  }
  combatStates.set(agent.id, state);

  if (!target) {
    agent.isSneaking = false;
    return false;
  }

  const d = distance(agent.location, target.location);
  const nearbyEnemies = safe(() => [...agent.dimension.getEntities({
    location: agent.location,
    maxDistance: 9
  })].filter(other => canTarget(agent, other, stage)).length, 1);
  const nearbyAllies = safe(() => [...agent.dimension.getEntities({
    type: "aip:player",
    location: agent.location,
    maxDistance: 9
  })].filter(other => relationBetween(agent, other) === "ally").length, 0);
  const hasShield = hasItem(agent, "minecraft:shield");
  const hasBow = hasItem(agent, "minecraft:bow") &&
    countItems(agent, "minecraft:arrow") > 0;
  const tactic = chooseTactic({
    healthRatio: healthInfo(agent).ratio,
    distance: d,
    targetType: target.typeId,
    hasShield,
    hasBow,
    rangedThreat: RANGED_THREATS.has(target.typeId),
    outnumbered: nearbyEnemies > nearbyAllies + 1
  });

  setProp(agent, "aip:activity", `combat:${tactic}`);
  if (tactic === "guard_retreat" || tactic === "guard_strafe") {
    modeEvent(agent, "guard");
    agent.isSneaking = true;
    equipForCombat(agent, true);
    safe(() => agent.addEffect("resistance", 10, {
      amplifier: 0,
      showParticles: false
    }));
  } else {
    modeEvent(agent, tactic === "approach" ? "sprint" : "work");
    agent.isSneaking = false;
    equipForCombat(agent, false);
  }

  const away = normalizeXZ(
    agent.location.x - target.location.x,
    agent.location.z - target.location.z
  );
  if (tactic === "retreat" || tactic === "guard_retreat" || tactic === "kite") {
    moveToward(agent, {
      x: agent.location.x + away.x * 8,
      y: agent.location.y,
      z: agent.location.z + away.z * 8
    }, { tick, cautious: true, impulse: 0.075, maxSpeed: 0.42 });
  } else if (tactic === "strafe" || tactic === "guard_strafe") {
    const side = ((tick >> 5) + agent.id.length) % 2 ? 1 : -1;
    moveToward(agent, {
      x: target.location.x - away.z * side * 5,
      y: target.location.y,
      z: target.location.z + away.x * side * 5
    }, { tick, cautious: true, impulse: 0.062 });
  } else if (tactic === "approach") {
    moveToward(agent, target.location, {
      tick,
      reach: 2.15,
      impulse: 0.07,
      maxSpeed: 0.43
    });
  }

  if (tactic === "ranged" && tick - state.lastRanged >= 24 && d <= 42) {
    rangedAttack(agent, target);
    state.lastRanged = tick;
  } else if (tactic === "melee_combo" && tick - state.lastAttack >= 11 && d <= 3.05) {
    state.combo = (state.combo + 1) % 3;
    attack(agent, target, attackDamage(agent) + (state.combo === 2 ? 1 : 0));
    state.lastAttack = tick;
    safe(() => agent.applyImpulse({
      x: (target.location.x - agent.location.x) * 0.014,
      y: state.combo === 2 ? 0.08 : 0,
      z: (target.location.z - agent.location.z) * 0.014
    }));
  }

  combatStates.set(agent.id, state);
  return true;
}

export function registerKill(killer, victimType) {
  if (!killer || killer.typeId !== "aip:player") return;
  addStat(killer, "kills", 1);
  if (victimType === "minecraft:blaze") {
    giveItem(killer, "minecraft:blaze_rod", 1);
  } else if (victimType === "minecraft:enderman") {
    if (Math.random() < 0.62) giveItem(killer, "minecraft:ender_pearl", 1);
  } else if (victimType === "minecraft:cow") {
    giveItem(killer, "minecraft:cooked_beef", 2);
    giveItem(killer, "minecraft:leather", 1);
  } else if (victimType === "minecraft:pig") {
    giveItem(killer, "minecraft:cooked_porkchop", 2);
  } else if (victimType === "minecraft:sheep") {
    giveItem(killer, "minecraft:cooked_mutton", 2);
    giveItem(killer, "minecraft:white_wool", 1);
  } else if (victimType === "minecraft:chicken") {
    giveItem(killer, "minecraft:cooked_chicken", 1);
    giveItem(killer, "minecraft:feather", 1);
  } else if (victimType === "minecraft:rabbit") {
    giveItem(killer, "minecraft:cooked_rabbit", 1);
  } else if (victimType === "minecraft:skeleton") {
    giveItem(killer, "minecraft:arrow", 2);
    giveItem(killer, "minecraft:bone", 1);
  } else if (victimType === "minecraft:spider" ||
             victimType === "minecraft:cave_spider") {
    giveItem(killer, "minecraft:string", 1);
  } else if (victimType === "minecraft:ender_dragon") {
    setProp(killer, "aip:dragon_dead", true);
  }
}

export function clearCombatState(entityId) {
  combatStates.delete(entityId);
}
