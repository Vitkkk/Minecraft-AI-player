import test from "node:test";
import assert from "node:assert/strict";
import {
  Stage,
  advanceStage,
  chooseTactic,
  personalityTrustDelta,
  relationshipKind,
  scoreResourceCandidate,
  stageLabel
} from "../AIPlayers_BP/scripts/core/brain.js";

const baseline = {
  dimension: "minecraft:overworld",
  woodMined: 0,
  stoneMined: 0,
  food: 0,
  diamonds: 0,
  blazeRods: 0,
  enderEyes: 0,
  hasWoodPick: false,
  hasStonePick: false,
  hasFurnace: false,
  hasIronPick: false,
  hasIronSword: false,
  hasShield: false,
  hasDiamondPick: false,
  shelterBuilt: false,
  portalBuilt: false,
  dragonDead: false
};

test("progression does not skip requirements", () => {
  assert.equal(advanceStage(Stage.WOOD, baseline), Stage.WOOD);
  assert.equal(advanceStage(Stage.IRON, baseline), Stage.IRON);
  assert.equal(advanceStage(Stage.END, baseline), Stage.END);
});

test("progression advances one milestone at a time", () => {
  assert.equal(advanceStage(Stage.BOOT, baseline), Stage.WOOD);
  assert.equal(advanceStage(Stage.WOOD, {
    ...baseline, woodMined: 8, hasWoodPick: true
  }), Stage.STONE);
  assert.equal(advanceStage(Stage.STONE, {
    ...baseline, stoneMined: 20, hasStonePick: true, hasFurnace: true
  }), Stage.SHELTER);
  assert.equal(advanceStage(Stage.PORTAL, {
    ...baseline, portalBuilt: true, dimension: "minecraft:nether"
  }), Stage.NETHER);
  assert.equal(advanceStage(Stage.END, {
    ...baseline, dragonDead: true
  }), Stage.COMPLETE);
});

test("tactics react to health, distance and opponent", () => {
  assert.equal(chooseTactic({
    healthRatio: 0.2, distance: 3, hasShield: true
  }), "guard_retreat");
  assert.equal(chooseTactic({
    healthRatio: 0.8, distance: 3.5, targetType: "minecraft:creeper"
  }), "kite");
  assert.equal(chooseTactic({
    healthRatio: 0.9, distance: 12, hasBow: true
  }), "ranged");
  assert.equal(chooseTactic({
    healthRatio: 0.9, distance: 2
  }), "melee_combo");
});

test("relationships honor team, trust and provocation", () => {
  assert.equal(relationshipKind({ sameTeam: true, trust: -100 }), "ally");
  assert.equal(relationshipKind({ trust: 50 }), "ally");
  assert.equal(relationshipKind({ trust: -50 }), "hostile");
  assert.equal(relationshipKind({ trust: 0 }), "neutral");
  assert.equal(relationshipKind({ trust: 30, provoked: true }), "hostile");
  assert.ok(personalityTrustDelta("diplomat", "rival") > 0);
});

test("resource scoring favors exposed safe blocks", () => {
  const exposed = scoreResourceCandidate({
    distance: 10, verticalDelta: 0, exposed: true, danger: false
  });
  const buried = scoreResourceCandidate({
    distance: 10, verticalDelta: 0, exposed: false, danger: false
  });
  const lavaSide = scoreResourceCandidate({
    distance: 2, verticalDelta: 0, exposed: true, danger: true
  });
  assert.ok(exposed < buried);
  assert.ok(lavaSide > buried);
  assert.equal(stageLabel(Stage.COMPLETE), "Jogo zerado");
});
