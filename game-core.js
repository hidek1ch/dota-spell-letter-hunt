"use strict";

const crypto = require("crypto");

const ROUND_SECONDS = 5 * 60;
const DEFAULT_LETTERS = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШ".split("");
const ALL_LETTERS = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ".split("");

function shuffle(input, rng = Math.random) {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roomCode(existing = new Set()) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = "";
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!existing.has(code)) return code;
  }
  throw new Error("Не удалось создать уникальный код комнаты");
}

function token() {
  return crypto.randomUUID();
}

function sanitizeName(name, fallback = "Игрок") {
  const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
  return clean || fallback;
}

function normalizeLetters(letters) {
  const allowed = new Set(ALL_LETTERS);
  const unique = [];
  for (const raw of Array.isArray(letters) ? letters : []) {
    const l = String(raw || "").toUpperCase();
    if (allowed.has(l) && !unique.includes(l)) unique.push(l);
  }
  return unique.length >= 3 ? unique : DEFAULT_LETTERS.slice();
}

function drawLetters(letters, count = 3, rng = Math.random) {
  const pool = normalizeLetters(letters);
  return shuffle(pool, rng).slice(0, Math.min(count, pool.length));
}

function refillDeck(registry, rng = Math.random) {
  return shuffle(registry.map((_, index) => index), rng);
}

function drawAbilityIndex(room, registry, rng = Math.random) {
  if (!registry.length) return -1;
  if (!Array.isArray(room.deck) || room.deck.length === 0) room.deck = refillDeck(registry, rng);

  let pos = room.deck.length - 1;
  const lastHero = room.lastHero;
  if (lastHero && registry[room.deck[pos]]?.hero === lastHero && room.deck.length > 1) {
    const alt = room.deck.findIndex(index => registry[index]?.hero !== lastHero);
    if (alt >= 0) pos = alt;
  }

  const [index] = room.deck.splice(pos, 1);
  room.lastHero = registry[index]?.hero || null;
  return index;
}

function getRemaining(room, now = Date.now()) {
  const game = room.game;
  if (game.phase === "paused") return Math.max(0, game.pausedRemaining || 0);
  if (game.phase !== "playing" || !game.turnEndsAt) return Math.max(0, game.remaining || room.settings.roundSeconds);
  return Math.max(0, Math.ceil((game.turnEndsAt - now) / 1000));
}

function createRoom({ code, hostSocketId, hostName, registryCount }) {
  return {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    host: {
      socketId: hostSocketId,
      token: token(),
      name: sanitizeName(hostName, "Хост"),
      connected: true
    },
    players: [],
    deck: [],
    lastHero: null,
    currentAbilityIndex: -1,
    currentLetters: [],
    settings: {
      roundSeconds: ROUND_SECONDS,
      letters: DEFAULT_LETTERS.slice(),
      comboBonuses: false,
      specialRounds: false
    },
    game: {
      phase: "lobby",
      activeIndex: 0,
      turn: 0,
      remaining: ROUND_SECONDS,
      pausedRemaining: ROUND_SECONDS,
      turnEndsAt: null,
      lastEvent: "Комната создана"
    },
    registryCount
  };
}

function publicState(room, now = Date.now()) {
  const active = room.players[room.game.activeIndex] || null;
  return {
    code: room.code,
    hostName: room.host.name,
    hostConnected: room.host.connected,
    phase: room.game.phase,
    turn: room.game.turn,
    remaining: getRemaining(room, now),
    roundSeconds: room.settings.roundSeconds,
    activePlayerId: active?.id || null,
    activePlayerName: active?.name || null,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      streak: p.streak,
      skips: p.skips,
      connected: p.connected
    })),
    allowedLetters: room.settings.letters,
    lastEvent: room.game.lastEvent,
    registryCount: room.registryCount,
    futureFeatures: {
      comboBonuses: room.settings.comboBonuses,
      specialRounds: room.settings.specialRounds
    }
  };
}

function hostSecret(room, registry) {
  if (room.currentAbilityIndex < 0) return null;
  const ability = registry[room.currentAbilityIndex];
  if (!ability) return null;
  return {
    ability,
    letters: room.currentLetters.slice()
  };
}

module.exports = {
  ROUND_SECONDS,
  DEFAULT_LETTERS,
  ALL_LETTERS,
  shuffle,
  roomCode,
  token,
  sanitizeName,
  normalizeLetters,
  drawLetters,
  refillDeck,
  drawAbilityIndex,
  getRemaining,
  createRoom,
  publicState,
  hostSecret
};
