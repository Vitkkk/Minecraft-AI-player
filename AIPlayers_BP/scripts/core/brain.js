export const Stage = Object.freeze({
  BOOT: 0,
  WOOD: 1,
  STONE: 2,
  SHELTER: 3,
  IRON: 4,
  DIAMOND: 5,
  PORTAL: 6,
  NETHER: 7,
  PEARLS: 8,
  STRONGHOLD: 9,
  END: 10,
  COMPLETE: 11
});

export const STAGES = Object.freeze([
  { id: Stage.BOOT, key: "boot", label: "Acordando" },
  { id: Stage.WOOD, key: "wood", label: "Coletando madeira" },
  { id: Stage.STONE, key: "stone", label: "Idade da Pedra" },
  { id: Stage.SHELTER, key: "shelter", label: "Abrigo e comida" },
  { id: Stage.IRON, key: "iron", label: "Idade do Ferro" },
  { id: Stage.DIAMOND, key: "diamond", label: "Caçando diamantes" },
  { id: Stage.PORTAL, key: "portal", label: "Construindo portal" },
  { id: Stage.NETHER, key: "nether", label: "Fortaleza do Nether" },
  { id: Stage.PEARLS, key: "pearls", label: "Olhos do End" },
  { id: Stage.STRONGHOLD, key: "stronghold", label: "Buscando fortaleza" },
  { id: Stage.END, key: "end", label: "Batalha do End" },
  { id: Stage.COMPLETE, key: "complete", label: "Jogo zerado" }
]);

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function stageLabel(stage) {
  return STAGES[stage]?.label ?? "Estado desconhecido";
}

export function advanceStage(stage, facts) {
  switch (stage) {
    case Stage.BOOT:
      return Stage.WOOD;
    case Stage.WOOD:
      return facts.woodMined >= 8 && facts.hasWoodPick ? Stage.STONE : stage;
    case Stage.STONE:
      return facts.stoneMined >= 20 && facts.hasStonePick && facts.hasFurnace
        ? Stage.SHELTER : stage;
    case Stage.SHELTER:
      return facts.shelterBuilt && facts.food >= 6 ? Stage.IRON : stage;
    case Stage.IRON:
      return facts.hasIronPick && facts.hasIronSword && facts.hasShield
        ? Stage.DIAMOND : stage;
    case Stage.DIAMOND:
      return facts.diamonds >= 3 && facts.hasDiamondPick ? Stage.PORTAL : stage;
    case Stage.PORTAL:
      return facts.portalBuilt && facts.dimension === "minecraft:nether"
        ? Stage.NETHER : stage;
    case Stage.NETHER:
      return facts.blazeRods >= 6 ? Stage.PEARLS : stage;
    case Stage.PEARLS:
      return facts.enderEyes >= 12 ? Stage.STRONGHOLD : stage;
    case Stage.STRONGHOLD:
      return facts.dimension === "minecraft:the_end" ? Stage.END : stage;
    case Stage.END:
      return facts.dragonDead ? Stage.COMPLETE : stage;
    default:
      return stage;
  }
}

export function chooseTactic(context) {
  const {
    healthRatio = 1,
    distance = 99,
    targetType = "",
    hasShield = false,
    hasBow = false,
    outnumbered = false
  } = context;

  if (healthRatio < 0.24) return hasShield ? "guard_retreat" : "retreat";
  if (targetType === "minecraft:creeper" && distance < 5.2) return "kite";
  if (outnumbered && healthRatio < 0.55) return hasShield ? "guard_strafe" : "strafe";
  if (hasShield && context.rangedThreat && distance < 12) return "guard_strafe";
  if (hasBow && distance > 5.5 && distance < 42) return "ranged";
  if (distance > 2.7) return "approach";
  return "melee_combo";
}

export function relationshipKind({ sameTeam = false, trust = 0, provoked = false }) {
  if (sameTeam) return "ally";
  if (provoked || trust <= -45) return "hostile";
  if (trust >= 45) return "ally";
  return "neutral";
}

export function personalityTrustDelta(personaA, personaB) {
  if (personaA === "diplomat" || personaB === "diplomat") return 18;
  if (personaA === "guardian" && personaB === "guardian") return 12;
  if (personaA === "rival" && personaB === "rival") return -28;
  if (personaA === "hunter" && personaB === "rival") return -10;
  return 4;
}

export function scoreResourceCandidate({ distance, verticalDelta, exposed = false, danger = false }) {
  return distance + Math.abs(verticalDelta) * 0.65 - (exposed ? 2.5 : 0) + (danger ? 50 : 0);
}
