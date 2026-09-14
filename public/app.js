"use strict";

const socket = io();
const $ = id => document.getElementById(id);
const SESSION_KEY = "dota_spell_hunt_session_v1";
const DEFAULT_LETTERS = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШ".split("");
let allLetters = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ".split("");
let session = null;
let state = null;
let secret = null;
let toastTimer = null;

function savedSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch (_) { return null; }
}
function saveSession(value) {
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}
function showToast(message, kind = "") {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").className = "toast" + (kind ? ` ${kind}` : "");
  toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 2600);
}
function formatTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function phaseLabel(phase) {
  return ({ lobby: "Лобби", playing: "Игра", paused: "Пауза", finished: "Итоги" })[phase] || "—";
}
function setConnection(online, text) {
  $("connectionPill").className = `connection-pill ${online ? "online" : "offline"}`;
  $("connectionText").textContent = text;
}
function setView(inRoom) {
  $("homeView").classList.toggle("hidden", inRoom);
  $("roomView").classList.toggle("hidden", !inRoom);
}
function emitAck(event, payload = {}) {
  return new Promise(resolve => {
    socket.emit(event, payload, response => resolve(response || { ok: false, error: "Нет ответа от сервера" }));
  });
}

async function createRoom() {
  const response = await emitAck("create-room", { name: $("hostName").value });
  if (!response.ok) return showToast(response.error, "error");
  saveSession({ code: response.code, role: response.role, token: response.token, playerId: null });
  history.replaceState(null, "", `?room=${encodeURIComponent(response.code)}`);
  setView(true);
  // Сервер может успеть прислать room-state до ack create-room.
  // В таком случае состояние уже сохранено, но раньше не рисовалось,
  // потому что session ещё не была установлена.
  if (state) renderState();
  showToast("Комната создана", "success");
}

async function joinRoom() {
  const code = $("joinCode").value.trim().toUpperCase();
  if (!code) return showToast("Введи код комнаты", "error");
  const response = await emitAck("join-room", { code, name: $("playerName").value });
  if (!response.ok) return showToast(response.error, "error");
  saveSession({ code: response.code, role: response.role, token: response.token, playerId: response.playerId });
  history.replaceState(null, "", `?room=${encodeURIComponent(response.code)}`);
  setView(true);
  if (state) renderState();
  showToast("Ты в комнате", "success");
}

async function resumeSaved() {
  const saved = savedSession();
  if (!saved?.code || !saved?.token) return false;
  const response = await emitAck("resume-session", { code: saved.code, token: saved.token });
  if (!response.ok) {
    saveSession(null);
    return false;
  }
  saveSession({ ...saved, role: response.role, playerId: response.playerId || saved.playerId || null });
  setView(true);
  if (state) renderState();
  return true;
}

function renderScoreboard() {
  if (!state) return;
  const board = $("scoreboard");
  board.innerHTML = "";
  $("emptyPlayers").classList.toggle("hidden", state.players.length > 0);
  $("playerCount").textContent = `${state.players.length} ${state.players.length === 1 ? "игрок" : state.players.length < 5 ? "игрока" : "игроков"}`;

  for (const player of state.players) {
    const card = document.createElement("div");
    card.className = "player-card";
    if (player.id === state.activePlayerId && ["playing", "paused"].includes(state.phase)) card.classList.add("active");
    if (session?.playerId === player.id) card.classList.add("me");

    const left = document.createElement("div");
    left.className = "player-main";
    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name + (session?.playerId === player.id ? " · ты" : "");
    const sub = document.createElement("div");
    sub.className = "player-sub";
    const bits = [];
    if (player.id === state.activePlayerId && ["playing", "paused"].includes(state.phase)) bits.push("сейчас угадывает");
    if (!player.connected) bits.push("не в сети");
    if (player.streak >= 2) bits.push(`серия ×${player.streak}`);
    sub.textContent = bits.join(" · ") || "готов";
    left.append(name, sub);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";
    const score = document.createElement("div");
    score.className = "player-score";
    score.textContent = player.score;
    right.appendChild(score);

    if (session?.role === "host" && ["lobby", "finished"].includes(state.phase)) {
      const kick = document.createElement("button");
      kick.className = "kick-btn";
      kick.title = "Удалить игрока";
      kick.textContent = "✕";
      kick.onclick = async () => {
        const response = await emitAck("remove-player", { playerId: player.id });
        if (!response.ok) showToast(response.error, "error");
      };
      right.appendChild(kick);
    }

    card.append(left, right);
    board.appendChild(card);
  }
}

function renderSecret() {
  const isHost = session?.role === "host";
  $("hostSecretPanel").classList.toggle("hidden", !isHost);
  $("playerMessagePanel").classList.toggle("hidden", isHost);
  if (!isHost) return;

  const hasSecret = Boolean(secret?.ability && ["playing", "paused"].includes(state?.phase));
  $("secretPlaceholder").classList.toggle("hidden", hasSecret);
  $("secretContent").classList.toggle("hidden", !hasSecret);
  $("lettersWrap").classList.toggle("hidden", !hasSecret);
  if (!hasSecret) return;

  const ability = secret.ability;
  $("abilityName").textContent = ability.name;
  $("abilityHero").textContent = ability.hero;
  const icon = $("abilityIcon");
  icon.src = ability.icon || "";
  icon.alt = `${ability.hero} — ${ability.name}`;
  icon.onerror = () => { icon.style.visibility = "hidden"; };
  icon.onload = () => { icon.style.visibility = "visible"; };

  const badges = [];
  if (ability.innate) badges.push("Врождённая");
  else if (ability.passive) badges.push("Пассивная");
  else badges.push("Способность");
  if (ability.shard) badges.push("Shard");
  if (ability.scepter) badges.push("Scepter / Aghanim");
  $("abilityBadges").innerHTML = badges.map(x => `<span class="badge">${x}</span>`).join("");
  $("letters").innerHTML = secret.letters.map(letter => `<div class="letter">${letter}</div>`).join("");
}

function renderPlayerMessage() {
  if (session?.role !== "player" || !state) return;
  const myTurn = session.playerId && session.playerId === state.activePlayerId;
  if (state.phase === "lobby") {
    $("playerMessageTitle").textContent = "Ждём старта";
    $("playerMessageText").textContent = "Хост запустит матч, когда все зайдут.";
  } else if (state.phase === "finished") {
    const sorted = state.players.slice().sort((a, b) => b.score - a.score);
    const top = sorted[0];
    $("playerMessageTitle").textContent = "Матч завершён";
    $("playerMessageText").textContent = top ? `Лидер: ${top.name} — ${top.score}` : "Спасибо за игру";
  } else if (state.phase === "paused") {
    $("playerMessageTitle").textContent = "Пауза";
    $("playerMessageText").textContent = myTurn ? "Твой ход сохранён." : `Сейчас ход игрока ${state.activePlayerName || "—"}.`;
  } else if (myTurn) {
    $("playerMessageTitle").textContent = "🎯 Твой ход — угадывай!";
    $("playerMessageText").textContent = "Хост видит способность и объясняет её. Ответ говори вслух.";
  } else {
    $("playerMessageTitle").textContent = `Сейчас угадывает ${state.activePlayerName || "игрок"}`;
    $("playerMessageText").textContent = "Секретный спелл и буквы видит только хост.";
  }
}

function renderControls() {
  const isHost = session?.role === "host";
  $("hostControls").classList.toggle("hidden", !isHost);
  $("settingsPanel").classList.toggle("hidden", !isHost);
  if (!isHost || !state) return;

  $("lobbyControls").classList.toggle("hidden", state.phase !== "lobby");
  $("gameControls").classList.toggle("hidden", !["playing", "paused"].includes(state.phase));
  $("finishedControls").classList.toggle("hidden", state.phase !== "finished");
  $("startGameBtn").disabled = state.players.length < 1 || state.registryCount < 1;
  $("correctBtn").disabled = state.phase !== "playing";
  $("skipBtn").disabled = !["playing", "paused"].includes(state.phase);
  $("pauseBtn").textContent = state.phase === "paused" ? "▶ Продолжить" : "⏸ Пауза";
  $("settingsPanel").querySelectorAll("button").forEach(btn => {
    if (!["lobby", "finished"].includes(state.phase) && btn.id !== "saveSettingsBtn") btn.disabled = true;
    else btn.disabled = false;
  });
  renderLetterPicker();
}

function renderLetterPicker() {
  if (!state || session?.role !== "host") return;
  const selected = new Set(state.allowedLetters || []);
  const root = $("letterPicker");
  root.innerHTML = "";
  for (const letter of allLetters) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "letter-toggle" + (selected.has(letter) ? " selected" : "");
    btn.textContent = letter;
    btn.dataset.letter = letter;
    btn.onclick = () => btn.classList.toggle("selected");
    root.appendChild(btn);
  }
}

function selectedLetters() {
  return [...$("letterPicker").querySelectorAll(".letter-toggle.selected")].map(el => el.dataset.letter);
}

function renderState() {
  if (!state || !session) return;
  setView(true);
  $("roomCode").textContent = state.code;
  $("roleText").textContent = session.role === "host" ? `Ты — хост · игроки не видят твою секретную карточку` : `Ты — игрок · хост: ${state.hostName}`;
  $("registryChip").textContent = `База: ${state.registryCount} способностей`;
  $("phaseChip").textContent = phaseLabel(state.phase);
  $("timer").textContent = formatTime(state.remaining);
  $("timer").classList.toggle("warning", state.remaining <= 30 && state.phase === "playing");
  const percent = state.roundSeconds ? Math.max(0, Math.min(100, state.remaining / state.roundSeconds * 100)) : 0;
  $("timerBar").style.width = `${percent}%`;
  $("eventText").textContent = state.lastEvent || "";

  if (state.phase === "lobby") $("turnLabel").textContent = state.players.length ? "Все готовы?" : "Ждём игроков";
  else if (state.phase === "finished") {
    const sorted = state.players.slice().sort((a,b) => b.score - a.score);
    const max = sorted[0]?.score;
    const winners = sorted.filter(p => p.score === max);
    $("turnLabel").textContent = winners.length ? `🏆 ${winners.map(p => p.name).join(" и ")}` : "Матч завершён";
  } else if (state.phase === "paused") $("turnLabel").textContent = `⏸ Пауза · ход: ${state.activePlayerName || "—"}`;
  else $("turnLabel").textContent = `Ход: ${state.activePlayerName || "—"}`;

  renderScoreboard();
  renderSecret();
  renderPlayerMessage();
  renderControls();
}

async function copyInvite() {
  const code = state?.code || session?.code;
  if (!code) return;
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast("Ссылка на комнату скопирована", "success");
  } catch (_) {
    window.prompt("Скопируй ссылку:", url);
  }
}

function leaveRoom() {
  saveSession(null);
  state = null;
  secret = null;
  history.replaceState(null, "", location.pathname);
  location.reload();
}

$("createRoomBtn").onclick = createRoom;
$("joinRoomBtn").onclick = joinRoom;
$("copyInviteBtn").onclick = copyInvite;
$("leaveBtn").onclick = leaveRoom;
$("startGameBtn").onclick = async () => {
  const response = await emitAck("start-game");
  if (!response.ok) showToast(response.error, "error");
};
$("correctBtn").onclick = async () => {
  const response = await emitAck("mark-correct");
  if (!response.ok) showToast(response.error, "error");
};
$("skipBtn").onclick = async () => {
  const response = await emitAck("skip-turn");
  if (!response.ok) showToast(response.error, "error");
};
$("pauseBtn").onclick = async () => {
  const event = state?.phase === "paused" ? "resume-game" : "pause-game";
  const response = await emitAck(event);
  if (!response.ok) showToast(response.error, "error");
};
$("finishBtn").onclick = async () => {
  const response = await emitAck("finish-game");
  if (!response.ok) showToast(response.error, "error");
};
$("backLobbyBtn").onclick = async () => {
  const response = await emitAck("back-to-lobby");
  if (!response.ok) showToast(response.error, "error");
};
$("easyLettersBtn").onclick = () => {
  const wanted = new Set(DEFAULT_LETTERS);
  $("letterPicker").querySelectorAll(".letter-toggle").forEach(btn => btn.classList.toggle("selected", wanted.has(btn.dataset.letter)));
};
$("allLettersBtn").onclick = () => {
  $("letterPicker").querySelectorAll(".letter-toggle").forEach(btn => btn.classList.add("selected"));
};
$("saveSettingsBtn").onclick = async () => {
  const letters = selectedLetters();
  if (letters.length < 3) return showToast("Оставь минимум три буквы", "error");
  const response = await emitAck("update-settings", { letters, roundSeconds: 300 });
  if (!response.ok) showToast(response.error, "error");
  else showToast("Буквы сохранены", "success");
};
$("joinCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 5); });
$("joinCode").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom(); });
$("playerName").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom(); });
$("hostName").addEventListener("keydown", e => { if (e.key === "Enter") createRoom(); });

socket.on("connect", async () => {
  setConnection(true, "Онлайн");
  const resumed = await resumeSaved();
  if (!resumed) setView(false);
});
socket.on("disconnect", () => setConnection(false, "Переподключение…"));
socket.on("server-status", info => {
  if (Array.isArray(info.allLetters)) allLetters = info.allLetters;
  $("registryLine").textContent = `Серверная база: ${info.registryCount || 0} способностей · ${info.registrySource || "загрузка…"}`;
});
socket.on("room-state", next => {
  state = next;
  renderState();
});
socket.on("host-secret", next => {
  secret = next;
  renderSecret();
});
socket.on("removed-from-room", payload => {
  saveSession(null);
  showToast(payload?.reason || "Ты больше не в комнате", "error");
  setTimeout(() => location.href = location.pathname, 800);
});

const roomFromUrl = new URLSearchParams(location.search).get("room");
if (roomFromUrl) $("joinCode").value = roomFromUrl.toUpperCase().slice(0, 5);
