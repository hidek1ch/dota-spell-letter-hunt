"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const {
  ROUND_SECONDS,
  ALL_LETTERS,
  roomCode,
  token,
  sanitizeName,
  normalizeLetters,
  drawLetters,
  drawAbilityIndex,
  createRoom,
  publicState,
  hostSecret,
  getRemaining
} = require("./game-core");

const PORT = Number(process.env.PORT || 3000);
const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com";
const rooms = new Map();
let registry = [];
let registrySource = "загрузка…";
let registryUpdatedAt = null;

const FALLBACK_REGISTRY = [
  ["Kunkka", "Torrent", "kunkka_torrent"], ["Kunkka", "Tidebringer", "kunkka_tidebringer"], ["Kunkka", "X Marks the Spot", "kunkka_x_marks_the_spot"], ["Kunkka", "Ghostship", "kunkka_ghostship"],
  ["Shadow Fiend", "Shadowraze", "nevermore_shadowraze1"], ["Shadow Fiend", "Necromastery", "nevermore_necromastery"], ["Shadow Fiend", "Presence of the Dark Lord", "nevermore_dark_lord"], ["Shadow Fiend", "Requiem of Souls", "nevermore_requiem"],
  ["Crystal Maiden", "Crystal Nova", "crystal_maiden_crystal_nova"], ["Crystal Maiden", "Frostbite", "crystal_maiden_frostbite"], ["Crystal Maiden", "Arcane Aura", "crystal_maiden_brilliance_aura"], ["Crystal Maiden", "Freezing Field", "crystal_maiden_freezing_field"],
  ["Pudge", "Meat Hook", "pudge_meat_hook"], ["Pudge", "Rot", "pudge_rot"], ["Pudge", "Flesh Heap", "pudge_flesh_heap"], ["Pudge", "Dismember", "pudge_dismember"],
  ["Invoker", "Cold Snap", "invoker_cold_snap"], ["Invoker", "Ghost Walk", "invoker_ghost_walk"], ["Invoker", "Tornado", "invoker_tornado"], ["Invoker", "EMP", "invoker_emp"], ["Invoker", "Sun Strike", "invoker_sun_strike"],
  ["Earthshaker", "Fissure", "earthshaker_fissure"], ["Earthshaker", "Enchant Totem", "earthshaker_enchant_totem"], ["Earthshaker", "Aftershock", "earthshaker_aftershock"], ["Earthshaker", "Echo Slam", "earthshaker_echo_slam"],
  ["Storm Spirit", "Static Remnant", "storm_spirit_static_remnant"], ["Storm Spirit", "Electric Vortex", "storm_spirit_electric_vortex"], ["Storm Spirit", "Overload", "storm_spirit_overload"], ["Storm Spirit", "Ball Lightning", "storm_spirit_ball_lightning"],
  ["Axe", "Berserker's Call", "axe_berserkers_call"], ["Axe", "Battle Hunger", "axe_battle_hunger"], ["Axe", "Counter Helix", "axe_counter_helix"], ["Axe", "Culling Blade", "axe_culling_blade"],
  ["Juggernaut", "Blade Fury", "juggernaut_blade_fury"], ["Juggernaut", "Healing Ward", "juggernaut_healing_ward"], ["Juggernaut", "Blade Dance", "juggernaut_blade_dance"], ["Juggernaut", "Omnislash", "juggernaut_omni_slash"],
  ["Tidehunter", "Gush", "tidehunter_gush"], ["Tidehunter", "Kraken Shell", "tidehunter_kraken_shell"], ["Tidehunter", "Anchor Smash", "tidehunter_anchor_smash"], ["Tidehunter", "Ravage", "tidehunter_ravage"],
  ["Lina", "Dragon Slave", "lina_dragon_slave"], ["Lina", "Light Strike Array", "lina_light_strike_array"], ["Lina", "Fiery Soul", "lina_fiery_soul"], ["Lina", "Laguna Blade", "lina_laguna_blade"],
  ["Lion", "Earth Spike", "lion_impale"], ["Lion", "Hex", "lion_voodoo"], ["Lion", "Mana Drain", "lion_mana_drain"], ["Lion", "Finger of Death", "lion_finger_of_death"],
  ["Queen of Pain", "Shadow Strike", "queenofpain_shadow_strike"], ["Queen of Pain", "Blink", "queenofpain_blink"], ["Queen of Pain", "Scream of Pain", "queenofpain_scream_of_pain"], ["Queen of Pain", "Sonic Wave", "queenofpain_sonic_wave"]
].map(([hero, name, id]) => ({
  id, hero, name,
  icon: `${STEAM_CDN}/apps/dota2/images/dota_react/abilities/${id}.png`,
  innate: false,
  passive: false,
  shard: false,
  scepter: false
}));

function behaviorList(meta) {
  if (!meta) return [];
  if (Array.isArray(meta.behavior)) return meta.behavior;
  if (typeof meta.behavior === "string") return [meta.behavior];
  return [];
}

function isHidden(meta) {
  return behaviorList(meta).some(x => String(x).toLowerCase() === "hidden") && !meta?.is_innate;
}

function isHelperAbility(id, meta) {
  if (typeof id !== "string" || !id) return true;
  if (id === "generic_hidden" || id === "attribute_bonus") return true;
  if (id.startsWith("special_bonus_")) return true;
  if (id.startsWith("item_")) return true;
  if (isHidden(meta)) return true;
  const name = String(meta?.dname || "").trim();
  if (!name) return true;
  const lower = id.toLowerCase();
  const helperSuffixes = ["_stop", "_cancel", "_end", "_release", "_empty1", "_empty2", "_empty3"];
  return helperSuffixes.some(s => lower.endsWith(s));
}

function aghanimFlags(meta) {
  let text = "";
  try { text = JSON.stringify(meta).toLowerCase(); } catch (_) {}
  return {
    shard: Boolean(meta?.is_shard) || text.includes("shard"),
    scepter: Boolean(meta?.is_scepter) || text.includes("scepter") || text.includes("aghanim")
  };
}

function buildRegistry(abilities, heroAbilities, heroes) {
  const heroNameByInternal = new Map();
  for (const h of Object.values(heroes || {})) {
    if (h?.name && h?.localized_name) heroNameByInternal.set(h.name, h.localized_name);
  }

  const out = [];
  const seen = new Set();

  for (const [heroInternal, info] of Object.entries(heroAbilities || {})) {
    const hero = heroNameByInternal.get(heroInternal);
    if (!hero || !info) continue;

    const ids = new Set();
    const addAbilityRefs = value => {
      if (typeof value === "string") {
        ids.add(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) addAbilityRefs(item);
        return;
      }
      if (value && typeof value === "object") {
        // В свежем hero_abilities.json часть facet-способностей иногда
        // представлена не простой строкой. Берём только строки, которые
        // реально существуют в abilities.json; лишнее ниже отфильтруется.
        for (const item of Object.values(value)) addAbilityRefs(item);
      }
    };

    addAbilityRefs(info.abilities);
    if (Array.isArray(info.facets)) {
      for (const facet of info.facets) addAbilityRefs(facet?.abilities);
    }

    for (const abilityId of ids) {
      const meta = abilities?.[abilityId];
      if (isHelperAbility(abilityId, meta)) continue;
      const name = String(meta.dname).trim();
      const key = `${hero}|${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const behaviors = behaviorList(meta).map(x => String(x).toLowerCase());
      const aghs = aghanimFlags(meta);
      out.push({
        id: abilityId,
        hero,
        name,
        icon: meta.img ? STEAM_CDN + meta.img : `${STEAM_CDN}/apps/dota2/images/dota_react/abilities/${abilityId}.png`,
        innate: Boolean(meta.is_innate),
        passive: behaviors.includes("passive"),
        shard: aghs.shard,
        scepter: aghs.scepter
      });
    }
  }

  return out;
}

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "DotaSpellLetterHunt/1.0" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

const DATA_SOURCES = [
  {
    name: "jsDelivr / dotaconstants",
    abilities: "https://cdn.jsdelivr.net/gh/odota/dotaconstants@master/build/abilities.json",
    heroAbilities: "https://cdn.jsdelivr.net/gh/odota/dotaconstants@master/build/hero_abilities.json",
    heroes: "https://cdn.jsdelivr.net/gh/odota/dotaconstants@master/build/heroes.json"
  },
  {
    name: "OpenDota constants",
    abilities: "https://api.opendota.com/api/constants/abilities",
    heroAbilities: "https://api.opendota.com/api/constants/hero_abilities",
    heroes: "https://api.opendota.com/api/constants/heroes"
  },
  {
    name: "GitHub Raw / dotaconstants",
    abilities: "https://raw.githubusercontent.com/odota/dotaconstants/master/build/abilities.json",
    heroAbilities: "https://raw.githubusercontent.com/odota/dotaconstants/master/build/hero_abilities.json",
    heroes: "https://raw.githubusercontent.com/odota/dotaconstants/master/build/heroes.json"
  }
];

async function loadRegistry() {
  for (const source of DATA_SOURCES) {
    try {
      console.log(`[registry] Пробую ${source.name}...`);
      const [abilities, heroAbilities, heroes] = await Promise.all([
        fetchJson(source.abilities),
        fetchJson(source.heroAbilities),
        fetchJson(source.heroes)
      ]);
      const built = buildRegistry(abilities, heroAbilities, heroes);
      if (built.length < 250) throw new Error(`слишком мало способностей: ${built.length}`);
      registry = built;
      registrySource = source.name;
      registryUpdatedAt = new Date().toISOString();
      console.log(`[registry] Готово: ${registry.length} способностей (${registrySource})`);
      for (const room of rooms.values()) room.registryCount = registry.length;
      return;
    } catch (error) {
      console.warn(`[registry] ${source.name} не сработал:`, error.message);
    }
  }

  registry = FALLBACK_REGISTRY;
  registrySource = "встроенный аварийный пул";
  registryUpdatedAt = new Date().toISOString();
  console.warn(`[registry] Сеть недоступна. Использую ${registry.length} встроенных способностей.`);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    registryCount: registry.length,
    registrySource,
    registryUpdatedAt,
    rooms: rooms.size
  });
});
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

function socketRoom(socket) {
  const code = socket.data?.roomCode;
  return code ? rooms.get(code) : null;
}

function isHost(socket, room) {
  return Boolean(room && room.host.socketId === socket.id);
}

function fail(ack, message) {
  if (typeof ack === "function") ack({ ok: false, error: message });
}

function emitState(room) {
  room.updatedAt = Date.now();
  io.to(room.code).emit("room-state", publicState(room));
  if (room.host.socketId) {
    io.to(room.host.socketId).emit("host-secret", hostSecret(room, registry));
  }
}

function nextTurn(room, eventText) {
  if (!room.players.length) {
    room.game.phase = "lobby";
    room.game.lastEvent = "Нужен хотя бы один игрок";
    room.currentAbilityIndex = -1;
    room.currentLetters = [];
    return;
  }

  if (room.game.turn > 0) room.game.activeIndex = (room.game.activeIndex + 1) % room.players.length;
  if (room.game.activeIndex >= room.players.length) room.game.activeIndex = 0;

  room.currentAbilityIndex = drawAbilityIndex(room, registry);
  room.currentLetters = drawLetters(room.settings.letters, 3);
  room.game.turn += 1;
  room.game.remaining = room.settings.roundSeconds;
  room.game.pausedRemaining = room.settings.roundSeconds;
  room.game.turnEndsAt = Date.now() + room.settings.roundSeconds * 1000;
  room.game.phase = "playing";
  room.game.lastEvent = eventText || `Ход игрока ${room.players[room.game.activeIndex].name}`;
}

function startMatch(room) {
  room.players.forEach(p => {
    p.score = 0;
    p.streak = 0;
    p.skips = 0;
  });
  room.deck = [];
  room.lastHero = null;
  room.currentAbilityIndex = -1;
  room.currentLetters = [];
  room.game.activeIndex = 0;
  room.game.turn = 0;
  nextTurn(room, "Матч начался");
}

function leaveSocketRoom(socket) {
  const room = socketRoom(socket);
  if (!room) return;
  socket.leave(room.code);
  socket.data.roomCode = null;
  socket.data.role = null;
  socket.data.identityToken = null;
}

io.on("connection", socket => {
  socket.emit("server-status", {
    registryCount: registry.length,
    registrySource,
    allLetters: ALL_LETTERS
  });

  socket.on("create-room", (payload = {}, ack) => {
    leaveSocketRoom(socket);
    const code = roomCode(new Set(rooms.keys()));
    const room = createRoom({
      code,
      hostSocketId: socket.id,
      hostName: payload.name,
      registryCount: registry.length
    });
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = "host";
    socket.data.identityToken = room.host.token;
    emitState(room);
    if (typeof ack === "function") ack({ ok: true, code, role: "host", token: room.host.token });
  });

  socket.on("join-room", (payload = {}, ack) => {
    leaveSocketRoom(socket);
    const code = String(payload.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return fail(ack, "Комната не найдена");
    if (room.game.phase !== "lobby" && room.game.phase !== "finished") return fail(ack, "Матч уже идёт. Вход новых игроков временно закрыт");
    if (room.players.length >= 8) return fail(ack, "В комнате уже 8 игроков");

    const player = {
      id: token(),
      token: token(),
      socketId: socket.id,
      name: sanitizeName(payload.name),
      score: 0,
      streak: 0,
      skips: 0,
      connected: true
    };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = "player";
    socket.data.identityToken = player.token;
    room.game.lastEvent = `${player.name} вошёл в комнату`;
    emitState(room);
    if (typeof ack === "function") ack({ ok: true, code, role: "player", token: player.token, playerId: player.id });
  });

  socket.on("resume-session", (payload = {}, ack) => {
    const code = String(payload.code || "").trim().toUpperCase();
    const identityToken = String(payload.token || "");
    const room = rooms.get(code);
    if (!room || !identityToken) return fail(ack, "Сессия не найдена");

    leaveSocketRoom(socket);
    if (room.host.token === identityToken) {
      room.host.socketId = socket.id;
      room.host.connected = true;
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.role = "host";
      socket.data.identityToken = identityToken;
      emitState(room);
      if (typeof ack === "function") ack({ ok: true, code, role: "host", token: identityToken });
      return;
    }

    const player = room.players.find(p => p.token === identityToken);
    if (!player) return fail(ack, "Сессия игрока не найдена");
    player.socketId = socket.id;
    player.connected = true;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = "player";
    socket.data.identityToken = identityToken;
    emitState(room);
    if (typeof ack === "function") ack({ ok: true, code, role: "player", token: identityToken, playerId: player.id });
  });

  socket.on("update-settings", (payload = {}, ack) => {
    const room = socketRoom(socket);
    if (!isHost(socket, room)) return fail(ack, "Только хост меняет настройки");
    if (room.game.phase === "playing" || room.game.phase === "paused") return fail(ack, "Настройки букв можно менять между матчами");

    if (Array.isArray(payload.letters)) room.settings.letters = normalizeLetters(payload.letters);
    if (payload.roundSeconds != null) {
      const seconds = Math.max(30, Math.min(900, Number(payload.roundSeconds) || ROUND_SECONDS));
      room.settings.roundSeconds = seconds;
      room.game.remaining = seconds;
      room.game.pausedRemaining = seconds;
    }
    room.game.lastEvent = "Хост обновил настройки";
    emitState(room);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("start-game", (_payload, ack) => {
    const room = socketRoom(socket);
    if (!isHost(socket, room)) return fail(ack, "Только хост запускает игру");
    if (!room.players.length) return fail(ack, "Нужен хотя бы один игрок");
    if (!registry.length) return fail(ack, "База способностей ещё загружается");
    startMatch(room);
    emitState(room);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("mark-correct", (_payload, ack) => {
    const room = socketRoom(socket);
    if (!isHost(socket, room)) return fail(ack, "Только хост подтверждает ответ");
    if (room.game.phase !== "playing" && room.game.phase !== "paused") return fail(ack, "Сейчас нет активного хода");
    const player = room.players[room.game.activeIndex];
    if (!player) return fail(ack, "Активный игрок не найден");
    player.score += 1;
    player.streak += 1;
    const name = player.name;
    nextTurn(room, `✅ ${name} угадал! +1`);
    emitState(room);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("skip-turn", (_payload, ack) => {
    const room = socketRoom(socket);
    if (!isHost(socket, room)) return fail(ack, "Только хост может пропустить");
    if (room.game.phase !== "playing" && room.game.phase !== "paused") return fail(ack, "Сейчас нет активного хода");
    const player = room.players[room.game.activeIndex];
    if (player) {
      player.skips += 1;
      player.streak = 0;
    }
    nextTurn(room, `↪ Пропуск${player ? ` — ${player.name}` : ""}`);
    emitState(room);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("pause-game", (_payload, ack) => {
    const room = socketRoom(socket);
    if (!isHost(socket, room)) return fail(ack, "Только хост ставит паузу");
    if (room.game.phase !== "playing") return fail(ack, "Игра уже не идёт");
    room.game.pausedRemaining = getRemaining(room);
    room.game.remaining = room.game.pausedRemaining;
    room.game.turnEndsAt = null;
    room.game.phase = "paused";
    room.game.lastEvent = "⏸ Пауза";
    emitState(room);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("resume-game", (_payload, ack) => {
    const room = socketRoom(socket);
    if (!isHost(socket, room)) return fail(ack, "Только хост снимает паузу");
    if (room.game.phase !== "paused") return fail(ack, "Игра не на паузе");
    const remaining = Math.max(1, room.game.pausedRemaining || room.settings.roundSeconds);
    room.game.remaining = remaining;
    room.game.turnEndsAt = Date.now() + remaining * 1000;
    room.game.phase = "playing";
    room.game.lastEvent = "▶ Игра продолжена";
    emitState(room);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("finish-game", (_payload, ack) => {
    const room = socketRoom(socket);
    if (!isHost(socket, room)) return fail(ack, "Только хост завершает матч");
    if (room.game.phase !== "playing" && room.game.phase !== "paused") return fail(ack, "Матч ещё не начат");
    room.game.remaining = getRemaining(room);
    room.game.turnEndsAt = null;
    room.game.phase = "finished";
    room.game.lastEvent = "🏁 Матч завершён";
    room.currentAbilityIndex = -1;
    room.currentLetters = [];
    emitState(room);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("back-to-lobby", (_payload, ack) => {
    const room = socketRoom(socket);
    if (!isHost(socket, room)) return fail(ack, "Только хост сбрасывает матч");
    room.players.forEach(p => { p.score = 0; p.streak = 0; p.skips = 0; });
    room.deck = [];
    room.lastHero = null;
    room.currentAbilityIndex = -1;
    room.currentLetters = [];
    room.game = {
      phase: "lobby",
      activeIndex: 0,
      turn: 0,
      remaining: room.settings.roundSeconds,
      pausedRemaining: room.settings.roundSeconds,
      turnEndsAt: null,
      lastEvent: "Новый матч готов"
    };
    emitState(room);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("remove-player", (payload = {}, ack) => {
    const room = socketRoom(socket);
    if (!isHost(socket, room)) return fail(ack, "Только хост может удалить игрока");
    const index = room.players.findIndex(p => p.id === payload.playerId);
    if (index < 0) return fail(ack, "Игрок не найден");
    const [removed] = room.players.splice(index, 1);
    if (removed.socketId) {
      io.to(removed.socketId).emit("removed-from-room", { reason: "Хост удалил вас из комнаты" });
      const removedSocket = io.sockets.sockets.get(removed.socketId);
      if (removedSocket) leaveSocketRoom(removedSocket);
    }
    if (room.game.activeIndex >= room.players.length) room.game.activeIndex = 0;
    room.game.lastEvent = `${removed.name} покинул комнату`;
    emitState(room);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = socketRoom(socket);
    if (!room) return;
    if (isHost(socket, room)) {
      room.host.connected = false;
      room.host.socketId = null;
      room.game.lastEvent = "Хост временно отключился";
    } else {
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        player.connected = false;
        player.socketId = null;
        room.game.lastEvent = `${player.name} временно отключился`;
      }
    }
    emitState(room);
  });
});

// Серверный таймер: публичное состояние синхронизируется для всех клиентов.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.game.phase !== "playing") continue;
    const remaining = getRemaining(room, now);
    room.game.remaining = remaining;
    if (remaining <= 0) {
      const player = room.players[room.game.activeIndex];
      if (player) player.streak = 0;
      nextTurn(room, `⏰ Время вышло${player ? ` — ${player.name}` : ""}`);
    }
    emitState(room);
  }
}, 1000);

// Удаляем заброшенные комнаты через два часа без активности.
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.updatedAt < cutoff && !room.host.connected && room.players.every(p => !p.connected)) rooms.delete(code);
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Dota Spell Letter Hunt: http://localhost:${PORT}`);
  loadRegistry();
});
