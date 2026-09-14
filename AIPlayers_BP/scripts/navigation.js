import {
  DANGER_BLOCKS,
  REPLACEABLE_BLOCKS,
  SCAN_BUDGET
} from "./config.js";
import {
  distance,
  hashString,
  normalizeXZ,
  safe,
  seededUnit
} from "./util.js";
import { scoreResourceCandidate } from "./core/brain.js";

const navigationState = new Map();
const scanCursors = new Map();

function blockAt(dimension, location) {
  return safe(() => dimension.getBlock({
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z)
  }));
}

export function isPassable(block) {
  if (!block) return false;
  return REPLACEABLE_BLOCKS.has(block.typeId) ||
    block.typeId === "minecraft:water" ||
    block.typeId === "minecraft:flowing_water";
}

export function isDanger(block) {
  return Boolean(block && DANGER_BLOCKS.has(block.typeId));
}

function candidateOffsets(entity, radius, vertical, budget) {
  const offsets = [];
  for (let y = -2; y <= Math.min(4, vertical); y++) {
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        offsets.push({ x, y, z });
      }
    }
  }

  const cursor = scanCursors.get(entity.id) ?? 0;
  const seedBase = hashString(entity.id) + cursor * 2654435761;
  const remaining = Math.max(0, budget - offsets.length);
  for (let i = 0; i < remaining; i++) {
    const seed = seedBase + i * 1013904223;
    const angle = seededUnit(seed) * Math.PI * 2;
    const radial = 3 + Math.sqrt(seededUnit(seed ^ 0x9e3779b9)) * (radius - 3);
    const y = Math.floor((seededUnit(seed ^ 0x85ebca6b) * 2 - 1) * vertical);
    offsets.push({
      x: Math.round(Math.cos(angle) * radial),
      y,
      z: Math.round(Math.sin(angle) * radial)
    });
  }
  scanCursors.set(entity.id, cursor + 1);
  return offsets;
}

export function findNearestBlock(entity, matcher, options = {}) {
  const radius = options.radius ?? 16;
  const vertical = options.vertical ?? 8;
  const budget = options.budget ?? SCAN_BUDGET;
  const origin = entity.location;
  const matches = typeof matcher === "function" ? matcher : block => matcher.has(block.typeId);
  let best;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const offset of candidateOffsets(entity, radius, vertical, budget)) {
    const block = blockAt(entity.dimension, {
      x: origin.x + offset.x,
      y: origin.y + offset.y,
      z: origin.z + offset.z
    });
    if (!block || !matches(block)) continue;
    const below = blockAt(entity.dimension, {
      x: block.location.x,
      y: block.location.y - 1,
      z: block.location.z
    });
    const exposed = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0],
      [0, -1, 0], [0, 0, 1], [0, 0, -1]
    ].some(([x, y, z]) => {
      const adjacent = blockAt(entity.dimension, {
        x: block.location.x + x,
        y: block.location.y + y,
        z: block.location.z + z
      });
      return adjacent && isPassable(adjacent);
    });
    const danger = isDanger(below);
    const score = scoreResourceCandidate({
      distance: distance(origin, block.location),
      verticalDelta: block.location.y - origin.y,
      exposed,
      danger
    });
    if (score < bestScore) {
      best = block;
      bestScore = score;
    }
  }
  return best;
}

export function firstBlockingBlock(entity, target) {
  const origin = entity.location;
  const dx = target.x - origin.x;
  const dy = target.y - (origin.y + 0.8);
  const dz = target.z - origin.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  const direction = { x: dx / length, y: dy / length, z: dz / length };

  for (let step = 1; step <= Math.min(3.2, length); step += 0.65) {
    for (const height of [0.15, 1.15]) {
      const block = blockAt(entity.dimension, {
        x: origin.x + direction.x * step,
        y: origin.y + height + direction.y * step,
        z: origin.z + direction.z * step
      });
      if (block && !isPassable(block) && !isDanger(block)) return block;
    }
  }
  return undefined;
}

export function moveToward(entity, target, options = {}) {
  const reach = options.reach ?? 1.7;
  const current = entity.location;
  const totalDistance = distance(current, target);
  if (totalDistance <= reach) return true;

  safe(() => entity.lookAt({
    x: target.x,
    y: target.y + (options.lookYOffset ?? 0.6),
    z: target.z
  }));

  let direction = normalizeXZ(target.x - current.x, target.z - current.z);
  const state = navigationState.get(entity.id) ?? {
    last: current,
    stuck: 0,
    side: hashString(entity.id) % 2 ? 1 : -1,
    sampleTick: 0
  };
  const tick = options.tick ?? 0;

  if (tick - state.sampleTick >= 20) {
    const moved = Math.hypot(current.x - state.last.x, current.z - state.last.z);
    state.stuck = moved < 0.3 ? state.stuck + 1 : 0;
    state.last = { ...current };
    state.sampleTick = tick;
    if (state.stuck === 3) state.side *= -1;
  }

  const aheadFeet = blockAt(entity.dimension, {
    x: current.x + direction.x * 1.1,
    y: current.y + 0.15,
    z: current.z + direction.z * 1.1
  });
  const aheadHead = blockAt(entity.dimension, {
    x: current.x + direction.x * 1.1,
    y: current.y + 1.25,
    z: current.z + direction.z * 1.1
  });
  const landing = blockAt(entity.dimension, {
    x: current.x + direction.x * 1.4,
    y: current.y - 1.05,
    z: current.z + direction.z * 1.4
  });

  if (isDanger(aheadFeet) || isDanger(landing)) {
    direction = {
      x: -direction.z * state.side,
      z: direction.x * state.side
    };
  } else if ((!isPassable(aheadFeet) || !isPassable(aheadHead)) && entity.isOnGround) {
    const aboveObstacle = blockAt(entity.dimension, {
      x: current.x + direction.x * 1.1,
      y: current.y + 2.15,
      z: current.z + direction.z * 1.1
    });
    if (isPassable(aboveObstacle)) {
      safe(() => entity.applyImpulse({
        x: direction.x * 0.055,
        y: 0.38,
        z: direction.z * 0.055
      }));
    } else {
      direction = {
        x: -direction.z * state.side,
        z: direction.x * state.side
      };
    }
  } else if (options.cautious && (!landing || isPassable(landing))) {
    direction = {
      x: -direction.z * state.side,
      z: direction.x * state.side
    };
  }

  const velocity = safe(() => entity.getVelocity(), { x: 0, y: 0, z: 0 });
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  const impulse = options.impulse ?? 0.052;
  if (horizontalSpeed < (options.maxSpeed ?? 0.36)) {
    safe(() => entity.applyImpulse({
      x: direction.x * impulse,
      y: entity.isInWater ? 0.035 : 0,
      z: direction.z * impulse
    }));
  }

  if (state.stuck >= 8) {
    const escape = {
      x: current.x - direction.z * state.side * 1.2,
      y: current.y + 0.6,
      z: current.z + direction.x * state.side * 1.2
    };
    const feet = blockAt(entity.dimension, escape);
    const head = blockAt(entity.dimension, { ...escape, y: escape.y + 1 });
    if (isPassable(feet) && isPassable(head)) {
      safe(() => entity.tryTeleport(escape, {
        checkForBlocks: true,
        dimension: entity.dimension,
        keepVelocity: false
      }));
    }
    state.stuck = 0;
  }

  navigationState.set(entity.id, state);
  return false;
}

export function wanderTarget(entity, radius = 14, tick = 0) {
  const state = navigationState.get(entity.id) ?? {};
  if (state.wander && tick < state.wanderUntil &&
      distance(entity.location, state.wander) > 2) {
    return state.wander;
  }

  const seed = hashString(entity.id) ^ (tick * 1103515245);
  const angle = seededUnit(seed) * Math.PI * 2;
  const length = 5 + seededUnit(seed ^ 0xa5a5a5a5) * radius;
  state.wander = {
    x: entity.location.x + Math.cos(angle) * length,
    y: entity.location.y,
    z: entity.location.z + Math.sin(angle) * length
  };
  state.wanderUntil = tick + 160;
  navigationState.set(entity.id, state);
  return state.wander;
}

export function findSafeArrival(dimension, x, z, preferredY = 70) {
  const minY = Math.max(-58, preferredY - 30);
  const maxY = Math.min(120, preferredY + 30);
  for (let y = maxY; y >= minY; y--) {
    const ground = blockAt(dimension, { x, y: y - 1, z });
    const feet = blockAt(dimension, { x, y, z });
    const head = blockAt(dimension, { x, y: y + 1, z });
    if (ground && !isPassable(ground) && !isDanger(ground) &&
        isPassable(feet) && isPassable(head)) {
      return { x: x + 0.5, y, z: z + 0.5 };
    }
  }
  return { x: x + 0.5, y: preferredY, z: z + 0.5 };
}

export function forgetNavigation(entityId) {
  navigationState.delete(entityId);
  scanCursors.delete(entityId);
}
