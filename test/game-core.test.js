"use strict";
const assert = require("assert");
const core = require("../game-core");

(function testLetters() {
  const letters = core.drawLetters(["А","Б","В","Г"], 3, () => 0.25);
  assert.strictEqual(letters.length, 3);
  assert.strictEqual(new Set(letters).size, 3);
})();

(function testName() {
  assert.strictEqual(core.sanitizeName("   Иван   Иванов   "), "Иван Иванов");
  assert.strictEqual(core.sanitizeName(""), "Игрок");
})();

(function testDeckNoRepeatUntilEmpty() {
  const registry = [
    {hero:"A",name:"1"},{hero:"B",name:"2"},{hero:"C",name:"3"},{hero:"D",name:"4"}
  ];
  const room = { deck: [], lastHero: null };
  const picked = [];
  for (let i=0;i<registry.length;i++) picked.push(core.drawAbilityIndex(room, registry, () => 0.42));
  assert.strictEqual(new Set(picked).size, registry.length);
})();

(function testPublicStateDoesNotLeakSecret() {
  const room = core.createRoom({code:"ABCDE",hostSocketId:"h",hostName:"Host",registryCount:500});
  room.players.push({id:"p1",token:"t",socketId:"s",name:"Player",score:0,streak:0,skips:0,connected:true});
  room.currentAbilityIndex = 7;
  room.currentLetters = ["А","Б","В"];
  const state = core.publicState(room);
  assert.ok(!("currentAbilityIndex" in state));
  assert.ok(!("currentLetters" in state));
  assert.ok(!JSON.stringify(state).includes("А,Б,В"));
})();

console.log("game-core tests: OK");
