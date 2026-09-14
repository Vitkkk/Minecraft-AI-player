import { EntityComponentTypes } from "@minecraft/server";

export function safe(action, fallback = undefined) {
  try {
    const value = action();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

export function getProp(entity, key, fallback = undefined) {
  const value = safe(() => entity.getDynamicProperty(key));
  return value === undefined ? fallback : value;
}

export function setProp(entity, key, value) {
  return safe(() => {
    entity.setDynamicProperty(key, value);
    return true;
  }, false);
}

export function getJson(entity, key, fallback = {}) {
  const raw = getProp(entity, key, "");
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  return safe(() => JSON.parse(raw), fallback);
}

export function setJson(entity, key, value) {
  return setProp(entity, key, JSON.stringify(value));
}

export function addStat(entity, key, amount = 1) {
  const property = `aip:stat_${key}`;
  const next = Number(getProp(entity, property, 0)) + amount;
  setProp(entity, property, next);
  return next;
}

export function getStat(entity, key) {
  return Number(getProp(entity, `aip:stat_${key}`, 0));
}

export function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance(a, b) {
  return Math.sqrt(distanceSquared(a, b));
}

export function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function normalizeXZ(dx, dz) {
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

export function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededUnit(seed) {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4294967296;
}

export function chooseDeterministic(items, seed) {
  return items[Math.floor(seededUnit(seed) * items.length) % items.length];
}

export function encodeLocation(location) {
  return JSON.stringify({
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z)
  });
}

export function decodeLocation(raw, fallback = undefined) {
  if (!raw) return fallback;
  return safe(() => {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (![value.x, value.y, value.z].every(Number.isFinite)) return fallback;
    return { x: value.x, y: value.y, z: value.z };
  }, fallback);
}

export function healthInfo(entity) {
  const component = safe(() => entity.getComponent(EntityComponentTypes.Health));
  if (!component) return { current: 20, max: 20, ratio: 1 };
  const max = component.effectiveMax ?? component.defaultValue ?? 20;
  const current = component.currentValue ?? max;
  return { current, max, ratio: max > 0 ? current / max : 1 };
}

export function heal(entity, amount) {
  const component = safe(() => entity.getComponent(EntityComponentTypes.Health));
  if (!component) return false;
  const max = component.effectiveMax ?? component.defaultValue ?? 20;
  return safe(() => {
    component.setCurrentValue(Math.min(max, component.currentValue + amount));
    return true;
  }, false);
}

export function isValid(entity) {
  return Boolean(entity && safe(() => entity.isValid, false));
}

export function dimensionId(entity) {
  return safe(() => entity.dimension.id, "");
}

export function ownerPlayer(entity, world) {
  const ownerId = String(getProp(entity, "aip:owner_id", ""));
  if (!ownerId) return undefined;
  return world.getAllPlayers().find(player => player.id === ownerId);
}

export function nearbyMessage(entity, message) {
  safe(() => {
    for (const player of entity.dimension.getPlayers({
      location: entity.location,
      maxDistance: 48
    })) {
      player.sendMessage(message);
    }
  });
}

export function modeEvent(entity, mode) {
  const desired = `aip:${mode}`;
  const previous = String(getProp(entity, "aip:last_mode_event", ""));
  if (previous === desired) return;
  safe(() => entity.triggerEvent(desired));
  setProp(entity, "aip:last_mode_event", desired);
}

export function blockKey(location) {
  return `${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
}
