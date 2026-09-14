import { system, world } from "@minecraft/server";
import {
  DIMENSION_IDS,
  ENTITY_ID,
  MAX_AGENTS,
  UPDATE_INTERVAL
} from "./config.js";
import { tickCombat, registerKill, clearCombatState } from "./combat.js";
import {
  clearProgressionState,
  getStage,
  initializeAgent,
  restoreAgent,
  snapshotAgent,
  statusLine,
  tickProgression
} from "./progression.js";
import {
  considerMeeting,
  registerAttack,
  relationBetween,
  showAgentMenu,
  showRosterMenu
} from "./social.js";
import {
  getProp,
  hashString,
  isValid,
  ownerPlayer,
  safe,
  setProp
} from "./util.js";

function agentsIn(dimension) {
  return safe(() => [...dimension.getEntities({ type: ENTITY_ID })], []);
}

function allLoadedAgents() {
  const agents = [];
  for (const id of DIMENSION_IDS) {
    const dimension = safe(() => world.getDimension(id));
    if (dimension) agents.push(...agentsIn(dimension));
  }
  return agents;
}

function initializeSpawnedAgent(entity, owner = undefined) {
  if (!entity || entity.typeId !== ENTITY_ID) return;
  const agents = allLoadedAgents();
  if (agents.length > MAX_AGENTS && !getProp(entity, "aip:initialized", false)) {
    safe(() => entity.remove());
    for (const player of world.getAllPlayers()) {
      player.sendMessage(`§cLimite de ${MAX_AGENTS} Jogadores IA carregados atingido.`);
    }
    return;
  }
  initializeAgent(entity, owner);
}

function spawnAgents(player, requested) {
  const current = allLoadedAgents().length;
  const amount = Math.max(1, Math.min(8, Math.floor(requested || 1),
    MAX_AGENTS - current));
  if (amount <= 0) {
    player.sendMessage(`§cO limite de ${MAX_AGENTS} agentes já foi atingido.`);
    return;
  }
  for (let i = 0; i < amount; i++) {
    const angle = i / amount * Math.PI * 2;
    const location = {
      x: player.location.x + Math.cos(angle) * 3,
      y: player.location.y,
      z: player.location.z + Math.sin(angle) * 3
    };
    const agent = safe(() => player.dimension.spawnEntity(ENTITY_ID, location));
    if (agent) initializeSpawnedAgent(agent, player);
  }
  player.sendMessage(`§a${amount} Jogador(es) IA criado(s). Eles começam como seus aliados.`);
}

function alliedAgents(player) {
  return allLoadedAgents().filter(agent =>
    relationBetween(agent, player) === "ally");
}

function handleCommand(player, rawMessage) {
  const parts = rawMessage.trim().split(/\s+/);
  const command = (parts[1] ?? "help").toLowerCase();

  if (command === "spawn") {
    spawnAgents(player, Number(parts[2] ?? 1));
    return;
  }
  if (command === "menu") {
    showRosterMenu(player, agentsIn(player.dimension));
    return;
  }
  if (command === "status") {
    const agents = agentsIn(player.dimension);
    if (!agents.length) {
      player.sendMessage("§7Nenhum Jogador IA carregado nesta dimensão.");
      return;
    }
    player.sendMessage("§8—— §bStatus dos Jogadores IA §8——");
    for (const agent of agents) player.sendMessage(statusLine(agent));
    return;
  }
  if (command === "rally" || command === "follow") {
    const allies = alliedAgents(player);
    for (const agent of allies) {
      setProp(agent, "aip:mode", "follow");
      setProp(agent, "aip:owner_id", player.id);
    }
    player.sendMessage(`§b${allies.length} aliado(s) vão acompanhar você.`);
    return;
  }
  if (command === "auto" || command === "resume") {
    const allies = alliedAgents(player);
    for (const agent of allies) setProp(agent, "aip:mode", "auto");
    player.sendMessage(`§a${allies.length} aliado(s) retomaram a progressão.`);
    return;
  }
  if (command === "hold" || command === "pause") {
    const allies = alliedAgents(player);
    for (const agent of allies) {
      setProp(agent, "aip:mode", "hold");
      setProp(agent, "aip:hold_location", JSON.stringify(agent.location));
    }
    player.sendMessage(`§7${allies.length} aliado(s) vão guardar a posição.`);
    return;
  }
  if (command === "debug") {
    const enabled = !Boolean(getProp(player, "aip:debug", false));
    setProp(player, "aip:debug", enabled);
    player.sendMessage(`§eHUD de depuração: ${enabled ? "ligado" : "desligado"}.`);
    return;
  }

  player.sendMessage([
    "§8—— §bAI Players §8——",
    "§f!ai spawn [1–8] §7— cria agentes aliados",
    "§f!ai menu §7— abre o painel",
    "§f!ai status §7— mostra progresso e recursos",
    "§f!ai rally §7— chama seus aliados",
    "§f!ai auto §7— retoma a autonomia",
    "§f!ai hold §7— guarda a posição",
    "§f!ai debug §7— alterna o HUD técnico",
    "§7Também é possível tocar/clicar diretamente em um agente."
  ].join("\n"));
}

function socialTick(agents, tick) {
  if (tick % 80 !== 0) return;
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];
      if (a.dimension.id !== b.dimension.id) continue;
      const d = Math.hypot(
        a.location.x - b.location.x,
        a.location.y - b.location.y,
        a.location.z - b.location.z
      );
      if (d <= 14) considerMeeting(a, b);
    }
  }
}

function updateDebugHud(agents, tick) {
  if (tick % 10 !== 0) return;
  for (const player of world.getAllPlayers()) {
    if (!getProp(player, "aip:debug", false)) continue;
    const nearby = agents
      .filter(agent => agent.dimension.id === player.dimension.id)
      .sort((a, b) => {
        const da = Math.hypot(a.location.x - player.location.x,
          a.location.z - player.location.z);
        const db = Math.hypot(b.location.x - player.location.x,
          b.location.z - player.location.z);
        return da - db;
      })[0];
    const text = nearby ? statusLine(nearby).replace(/§./g, "") :
      "Nenhum agente carregado";
    safe(() => player.onScreenDisplay.setActionBar(text));
  }
}

world.beforeEvents.chatSend.subscribe(event => {
  if (!event.message.toLowerCase().startsWith("!ai")) return;
  event.cancel = true;
  const player = event.sender;
  const message = event.message;
  system.run(() => handleCommand(player, message));
});

world.afterEvents.entitySpawn.subscribe(event => {
  if (event.entity.typeId !== ENTITY_ID) return;
  system.run(() => initializeSpawnedAgent(event.entity));
});

safe(() => world.afterEvents.entityLoad.subscribe(event => {
  if (event.entity.typeId !== ENTITY_ID) return;
  system.run(() => {
    if (!getProp(event.entity, "aip:initialized", false)) {
      initializeSpawnedAgent(event.entity);
    }
  });
}));

world.afterEvents.playerInteractWithEntity.subscribe(event => {
  if (event.target.typeId !== ENTITY_ID) return;
  system.run(() => showAgentMenu(event.player, event.target));
});

world.afterEvents.entityHurt.subscribe(event => {
  const victim = event.hurtEntity;
  const attacker = event.damageSource?.damagingEntity;
  if (victim?.typeId === ENTITY_ID && attacker) {
    registerAttack(victim, attacker);
  }
});

world.afterEvents.entityDie.subscribe(event => {
  const dead = event.deadEntity;
  const killer = event.damageSource?.damagingEntity;

  if (killer?.typeId === ENTITY_ID) registerKill(killer, dead.typeId);

  if (dead.typeId === "minecraft:ender_dragon") {
    for (const agent of agentsIn(dead.dimension)) {
      setProp(agent, "aip:dragon_dead", true);
    }
  }

  if (dead.typeId !== ENTITY_ID) return;
  const autoRespawn = getProp(dead, "aip:auto_respawn", true) !== false;
  const snapshot = safe(() => snapshotAgent(dead));
  clearCombatState(dead.id);
  clearProgressionState(dead.id);
  if (!autoRespawn || !snapshot) return;

  system.runTimeout(() => {
    const overworld = world.getDimension("minecraft:overworld");
    const ownerId = String(snapshot.properties?.["aip:owner_id"] ?? "");
    const owner = world.getAllPlayers().find(player => player.id === ownerId);
    const spawn = owner && owner.dimension.id === overworld.id
      ? { x: owner.location.x + 2, y: owner.location.y, z: owner.location.z + 2 }
      : world.getDefaultSpawnLocation();
    const replacement = safe(() => overworld.spawnEntity(ENTITY_ID, spawn));
    if (!replacement) return;
    restoreAgent(replacement, snapshot);
    for (const player of world.getAllPlayers()) {
      if (player.id === ownerId) {
        player.sendMessage(`§e${replacement.nameTag} reapareceu e manteve suas memórias.`);
      }
    }
  }, 100);
});

world.afterEvents.playerSpawn.subscribe(event => {
  if (!event.initialSpawn) return;
  const player = event.player;
  if (getProp(player, "aip:welcomed", false)) return;
  setProp(player, "aip:welcomed", true);
  system.runTimeout(() => {
    player.sendMessage("§bAI Players ativo. §fUse §e!ai help §fou procure o ovo §bJogador IA §fno Criativo.");
  }, 30);
});

system.runInterval(() => {
  const tick = system.currentTick;
  const agents = allLoadedAgents().filter(isValid);
  socialTick(agents, tick);

  for (const agent of agents) {
    if (!getProp(agent, "aip:initialized", false)) initializeSpawnedAgent(agent);
    const divisor = agents.length > 8 ? 3 : agents.length > 4 ? 2 : 1;
    if ((tick + hashString(agent.id)) % divisor !== 0) continue;
    const stage = getStage(agent);
    const fighting = tickCombat(agent, stage, tick);
    if (!fighting) {
      tickProgression(agent, tick, ownerPlayer(agent, world));
    }
  }
  updateDebugHud(agents, tick);
}, UPDATE_INTERVAL);
