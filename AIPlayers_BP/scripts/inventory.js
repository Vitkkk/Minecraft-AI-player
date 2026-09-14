import { ItemStack } from "@minecraft/server";
import { FOOD_ITEMS, LOG_BLOCKS } from "./config.js";
import { safe } from "./util.js";

const STACK_LIMIT = 64;

export function getContainer(entity) {
  return safe(() => entity.getComponent("minecraft:inventory")?.container);
}

export function inventoryEntries(entity) {
  const container = getContainer(entity);
  if (!container) return [];
  const entries = [];
  for (let slot = 0; slot < container.size; slot++) {
    const item = safe(() => container.getItem(slot));
    if (item) entries.push({ slot, typeId: item.typeId, amount: item.amount });
  }
  return entries;
}

function asMatcher(matcher) {
  if (typeof matcher === "function") return matcher;
  if (matcher instanceof Set) return typeId => matcher.has(typeId);
  if (Array.isArray(matcher)) {
    const values = new Set(matcher);
    return typeId => values.has(typeId);
  }
  return typeId => typeId === matcher;
}

export function countItems(entity, matcher) {
  const matches = asMatcher(matcher);
  return inventoryEntries(entity)
    .filter(entry => matches(entry.typeId))
    .reduce((sum, entry) => sum + entry.amount, 0);
}

export function hasItem(entity, typeId, amount = 1) {
  return countItems(entity, typeId) >= amount;
}

export function takeItems(entity, matcher, requestedAmount) {
  const container = getContainer(entity);
  if (!container || requestedAmount <= 0) return false;
  const matches = asMatcher(matcher);
  if (countItems(entity, matches) < requestedAmount) return false;

  let remaining = requestedAmount;
  for (let slot = 0; slot < container.size && remaining > 0; slot++) {
    const item = safe(() => container.getItem(slot));
    if (!item || !matches(item.typeId)) continue;
    const used = Math.min(item.amount, remaining);
    remaining -= used;
    if (used === item.amount) {
      safe(() => container.setItem(slot));
    } else {
      const next = item.clone();
      next.amount = item.amount - used;
      safe(() => container.setItem(slot, next));
    }
  }
  return remaining === 0;
}

export function giveItem(entity, typeId, amount = 1) {
  let remaining = Math.max(0, Math.floor(amount));
  while (remaining > 0) {
    const stackSize = Math.min(STACK_LIMIT, remaining);
    const stack = safe(() => new ItemStack(typeId, stackSize));
    if (!stack) return false;
    const leftover = safe(() => entity.addItem(stack), stack);
    if (leftover) {
      remaining = leftover.amount;
      return false;
    }
    remaining -= stackSize;
  }
  return true;
}

export function craft(entity, ingredients, resultType, resultAmount = 1) {
  for (const ingredient of ingredients) {
    if (countItems(entity, ingredient.matcher) < ingredient.amount) return false;
  }
  for (const ingredient of ingredients) {
    takeItems(entity, ingredient.matcher, ingredient.amount);
  }
  return giveItem(entity, resultType, resultAmount);
}

export function countFood(entity) {
  return countItems(entity, FOOD_ITEMS);
}

export function countWood(entity) {
  return countItems(entity, LOG_BLOCKS);
}

export function countPlanks(entity) {
  return countItems(entity, typeId => typeId.endsWith("_planks"));
}

export function ensurePlanks(entity, wanted = 4) {
  while (countPlanks(entity) < wanted && countWood(entity) > 0) {
    if (!takeItems(entity, LOG_BLOCKS, 1)) break;
    giveItem(entity, "minecraft:oak_planks", 4);
  }
  return countPlanks(entity) >= wanted;
}

export function ensureSticks(entity, wanted = 2) {
  ensurePlanks(entity, 2);
  while (countItems(entity, "minecraft:stick") < wanted && countPlanks(entity) >= 2) {
    craft(entity, [{ matcher: typeId => typeId.endsWith("_planks"), amount: 2 }],
      "minecraft:stick", 4);
  }
  return countItems(entity, "minecraft:stick") >= wanted;
}

export function equipCommand(entity, slot, typeId) {
  if (!typeId) return safe(() => {
    entity.runCommand(`replaceitem entity @s ${slot} 0 air`);
    return true;
  }, false);
  return safe(() => {
    entity.runCommand(`replaceitem entity @s ${slot} 0 ${typeId} 1`);
    return true;
  }, false);
}

export function bestPickaxe(entity) {
  const order = [
    "minecraft:netherite_pickaxe", "minecraft:diamond_pickaxe",
    "minecraft:iron_pickaxe", "minecraft:stone_pickaxe",
    "minecraft:wooden_pickaxe"
  ];
  return order.find(item => hasItem(entity, item));
}

export function bestWeapon(entity) {
  const order = [
    "minecraft:netherite_sword", "minecraft:diamond_sword",
    "minecraft:iron_sword", "minecraft:stone_sword",
    "minecraft:wooden_sword", "minecraft:stone_axe",
    "minecraft:wooden_axe"
  ];
  return order.find(item => hasItem(entity, item));
}

export function equipForWork(entity) {
  const pickaxe = bestPickaxe(entity);
  if (pickaxe) equipCommand(entity, "slot.weapon.mainhand", pickaxe);
}

export function equipForCombat(entity, guarding = false) {
  const weapon = bestWeapon(entity);
  if (weapon) equipCommand(entity, "slot.weapon.mainhand", weapon);
  if (guarding && hasItem(entity, "minecraft:shield")) {
    equipCommand(entity, "slot.weapon.offhand", "minecraft:shield");
  }
}

export function equipArmor(entity) {
  const pieces = [
    ["slot.armor.head", ["minecraft:diamond_helmet", "minecraft:iron_helmet"]],
    ["slot.armor.chest", ["minecraft:diamond_chestplate", "minecraft:iron_chestplate"]],
    ["slot.armor.legs", ["minecraft:diamond_leggings", "minecraft:iron_leggings"]],
    ["slot.armor.feet", ["minecraft:diamond_boots", "minecraft:iron_boots"]]
  ];
  for (const [slot, choices] of pieces) {
    const item = choices.find(typeId => hasItem(entity, typeId));
    if (item) equipCommand(entity, slot, item);
  }
}

export function snapshotInventory(entity) {
  return inventoryEntries(entity).map(({ typeId, amount }) => ({ typeId, amount }));
}

export function restoreInventory(entity, entries) {
  for (const entry of entries ?? []) {
    if (typeof entry?.typeId === "string" && Number.isFinite(entry?.amount)) {
      giveItem(entity, entry.typeId, Math.max(1, Math.floor(entry.amount)));
    }
  }
}

export function inventorySummary(entity, maxLines = 12) {
  const grouped = new Map();
  for (const entry of inventoryEntries(entity)) {
    grouped.set(entry.typeId, (grouped.get(entry.typeId) ?? 0) + entry.amount);
  }
  const lines = [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxLines)
    .map(([typeId, amount]) => `• ${typeId.replace("minecraft:", "")} ×${amount}`);
  return lines.length ? lines.join("\n") : "Inventário vazio";
}
