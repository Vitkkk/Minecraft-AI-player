import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { system } from "@minecraft/server";
import {
  personalityTrustDelta,
  relationshipKind,
  stageLabel
} from "./core/brain.js";
import {
  getJson,
  getProp,
  hashString,
  safe,
  seededUnit,
  setJson,
  setProp
} from "./util.js";
import { inventorySummary } from "./inventory.js";
import { PERSONA_LABELS } from "./config.js";

const MAX_RELATIONS = 24;

export function teamOf(entity) {
  return String(getProp(entity, "aip:team", ""));
}

export function trustToward(agent, target) {
  if (!agent || !target) return 0;
  if (target.typeId === "minecraft:player" &&
      String(getProp(agent, "aip:owner_id", "")) === target.id) {
    return 100;
  }
  const relations = getJson(agent, "aip:relations", {});
  return Number(relations[target.id] ?? 0);
}

export function setTrust(agent, target, value) {
  if (!agent || !target) return;
  const relations = getJson(agent, "aip:relations", {});
  relations[target.id] = Math.max(-100, Math.min(100, Math.round(value)));
  const keys = Object.keys(relations);
  if (keys.length > MAX_RELATIONS) {
    keys
      .sort((a, b) => Math.abs(relations[a]) - Math.abs(relations[b]))
      .slice(0, keys.length - MAX_RELATIONS)
      .forEach(key => delete relations[key]);
  }
  setJson(agent, "aip:relations", relations);
}

export function changeTrust(agent, target, delta) {
  const next = trustToward(agent, target) + delta;
  setTrust(agent, target, next);
  return next;
}

export function relationBetween(agent, target) {
  if (!agent || !target) return "neutral";
  const teamA = teamOf(agent);
  const teamB = target.typeId === "aip:player" ? teamOf(target) : "";
  const sameTeam = Boolean(teamA && teamB && teamA === teamB);
  const trust = trustToward(agent, target);
  const mode = String(getProp(agent, "aip:mode", "auto"));
  const provoked = mode === "hostile" &&
    (target.typeId === "minecraft:player" || target.typeId === "aip:player");
  return relationshipKind({ sameTeam, trust, provoked });
}

export function considerMeeting(agentA, agentB) {
  if (!agentA || !agentB || agentA.id === agentB.id) return;
  const relationsA = getJson(agentA, "aip:relations", {});
  if (relationsA[agentB.id] !== undefined) return;

  const personaA = String(getProp(agentA, "aip:persona", "explorer"));
  const personaB = String(getProp(agentB, "aip:persona", "explorer"));
  const seed = hashString(agentA.id + agentB.id);
  let trust = personalityTrustDelta(personaA, personaB);
  const roll = seededUnit(seed);
  if (roll < 0.12) trust -= 58;
  else if (roll > 0.78) trust += 44;

  setTrust(agentA, agentB, trust);
  setTrust(agentB, agentA, trust);
  if (trust >= 45) {
    const team = teamOf(agentA) || teamOf(agentB) || `ai:${agentA.id}`;
    setProp(agentA, "aip:team", team);
    setProp(agentB, "aip:team", team);
  }
}

export function registerAttack(victim, attacker) {
  if (!victim || !attacker) return;
  if (attacker.typeId !== "minecraft:player" && attacker.typeId !== "aip:player") return;
  const next = changeTrust(victim, attacker, -42);
  if (next <= -45) setProp(victim, "aip:mode", "hostile");
}

function relationLabel(agent, player) {
  const relation = relationBetween(agent, player);
  if (relation === "ally") return "Aliado";
  if (relation === "hostile") return "Hostil";
  return "Neutro";
}

export async function showAgentMenu(player, agent) {
  if (!player || !agent?.isValid) return;
  const stage = Number(getProp(agent, "aip:stage", 0));
  const persona = String(getProp(agent, "aip:persona", "explorer"));
  const mode = String(getProp(agent, "aip:mode", "auto"));
  const deaths = Number(getProp(agent, "aip:deaths", 0));
  const body = [
    `§7Etapa: §f${stageLabel(stage)}`,
    `§7Personalidade: §f${PERSONA_LABELS[persona] ?? persona}`,
    `§7Relação: §f${relationLabel(agent, player)}`,
    `§7Modo: §f${mode}`,
    `§7Mortes: §f${deaths}`
  ].join("\n");

  const form = new ActionFormData()
    .title(agent.nameTag || "Jogador IA")
    .body(body)
    .button("§aFormar aliança")
    .button("§bSeguir-me")
    .button("§eTrabalhar sozinho")
    .button("§7Esperar aqui")
    .button("§cTornar rival")
    .button("§fVer inventário");

  const result = await safe(() => form.show(player));
  if (!result || result.canceled) return;

  switch (result.selection) {
    case 0:
      setProp(agent, "aip:owner_id", player.id);
      setProp(agent, "aip:team", `human:${player.id}`);
      setProp(agent, "aip:mode", "auto");
      setTrust(agent, player, 100);
      player.sendMessage(`§a${agent.nameTag} agora é seu aliado.`);
      break;
    case 1:
      setProp(agent, "aip:owner_id", player.id);
      setProp(agent, "aip:team", `human:${player.id}`);
      setProp(agent, "aip:mode", "follow");
      setTrust(agent, player, 100);
      player.sendMessage(`§b${agent.nameTag} vai acompanhar você.`);
      break;
    case 2:
      setProp(agent, "aip:mode", "auto");
      player.sendMessage(`§e${agent.nameTag} retomou a progressão autônoma.`);
      break;
    case 3:
      setProp(agent, "aip:mode", "hold");
      setProp(agent, "aip:hold_location", JSON.stringify(agent.location));
      player.sendMessage(`§7${agent.nameTag} ficará nesta área.`);
      break;
    case 4:
      setProp(agent, "aip:mode", "hostile");
      setTrust(agent, player, -100);
      player.sendMessage(`§c${agent.nameTag} considera você um rival.`);
      break;
    case 5:
      await showInventory(player, agent);
      break;
  }
}

export async function showInventory(player, agent) {
  if (!player || !agent?.isValid) return;
  const form = new MessageFormData()
    .title(`Inventário — ${agent.nameTag}`)
    .body(inventorySummary(agent, 18))
    .button1("Fechar")
    .button2("Voltar");
  const result = await safe(() => form.show(player));
  if (result && !result.canceled && result.selection === 1) {
    system.run(() => showAgentMenu(player, agent));
  }
}

export async function showRosterMenu(player, agents) {
  const valid = agents.filter(agent => agent?.isValid);
  if (!valid.length) {
    player.sendMessage("§7Nenhum Jogador IA carregado nesta dimensão.");
    return;
  }
  const form = new ActionFormData()
    .title("Jogadores IA")
    .body("Escolha um agente para gerenciar.");
  for (const agent of valid.slice(0, 20)) {
    const stage = Number(getProp(agent, "aip:stage", 0));
    form.button(`${agent.nameTag}\n§7${stageLabel(stage)}`);
  }
  const result = await safe(() => form.show(player));
  if (!result || result.canceled || result.selection === undefined) return;
  const selected = valid[result.selection];
  if (selected) system.run(() => showAgentMenu(player, selected));
}
