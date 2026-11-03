import assert from 'node:assert/strict';
import test from 'node:test';
import { LOCATIONS } from '../src/exploration/locations';
import { canOccupy, getSolidRects, movePlayer } from '../src/exploration/movement';
import { castleSession, resetSession, TransitionManager } from '../src/exploration/TransitionManager';
import type { LocationDefinition } from '../src/exploration/types';

const courtyard = LOCATIONS.CastleCourtyard;
const armory = LOCATIONS.CastleArmory;

test('both locations have their required dimensions and every named spawn is collision-free', () => {
  assert.deepEqual([courtyard.width, courtyard.height], [1920, 1280]);
  assert.deepEqual([armory.width, armory.height], [1280, 960]);
  assert.deepEqual(courtyard.spawn, { x: 960, y: 640 });
  for (const location of Object.values(LOCATIONS)) {
    assert.ok(canOccupy(location.spawn, location), location.id + ' default spawn');
    for (const [name, point] of Object.entries(location.spawns)) assert.ok(canOccupy(point, location), location.id + ':' + name);
  }
});

test('the north courtyard and south armory doorways point to real reciprocal spawn points', () => {
  const outward = courtyard.doors[0], inward = armory.doors[0];
  assert.equal(outward.target, armory.id);
  assert.equal(outward.targetSpawn, 'entrance');
  assert.equal(inward.target, courtyard.id);
  assert.equal(inward.targetSpawn, 'armory-return');
  assert.deepEqual(armory.spawns.entrance, { x: 640, y: 820 });
  assert.deepEqual(courtyard.spawns['armory-return'], { x: 960, y: 160 });
  for (const location of Object.values(LOCATIONS)) for (const door of location.doors) {
    assert.ok(LOCATIONS[door.target].spawns[door.targetSpawn]);
  }
});

test('diagonal walking is normalized and analog input retains proportional speed', () => {
  const start = courtyard.spawn;
  const straight = movePlayer(start, { x: 1, y: 0 }, 0.2, courtyard);
  const diagonal = movePlayer(start, { x: 1, y: 1 }, 0.2, courtyard);
  const analog = movePlayer(start, { x: 0.5, y: 0 }, 0.2, courtyard);
  assert.ok(Math.abs(Math.hypot(straight.x - start.x, straight.y - start.y) - 38) < 1e-5);
  assert.ok(Math.abs(Math.hypot(diagonal.x - start.x, diagonal.y - start.y) - 38) < 1e-5);
  assert.ok(Math.abs(analog.x - start.x - 19) < 1e-5);
  assert.deepEqual(start, { x: 960, y: 640 }, 'the movement function must not mutate its input');
});

test('perimeter walls stop movement outside a door opening', () => {
  const stopped = movePlayer({ x: 850, y: 160 }, { x: 0, y: -1 }, 3, courtyard);
  assert.ok(Math.abs(stopped.y - 108) < 1e-5);
  assert.ok(canOccupy(stopped, courtyard));
  const east = movePlayer({ x: 1770, y: 760 }, { x: 1, y: 0 }, 3, courtyard);
  assert.ok(Math.abs(east.x - 1836) < 1e-5);
});

test('open door gaps remain reachable but movement alone cannot leave world bounds or change rooms', () => {
  const north = movePlayer({ x: 960, y: 160 }, { x: 0, y: -1 }, 10, courtyard);
  const south = movePlayer(armory.spawns.entrance, { x: 0, y: 1 }, 10, armory);
  assert.equal(north.y, 12);
  assert.equal(south.y, armory.height - 12);
  assert.ok(canOccupy(north, courtyard));
  assert.ok(canOccupy(south, armory));
});

test('furniture blocks the player and diagonal movement slides along its edge', () => {
  const table = armory.props.find(prop => prop.id === 'smith-workbench')!;
  const stopped = movePlayer({ x: table.x - 40, y: table.y + 40 }, { x: 1, y: 0 }, 3, armory);
  assert.ok(Math.abs(stopped.x - (table.x - 12)) < 1e-5);
  const slid = movePlayer(stopped, { x: 1, y: 1 }, 0.15, armory);
  assert.ok(Math.abs(slid.x - stopped.x) < 1e-5);
  assert.ok(slid.y > stopped.y + 10);
  assert.ok(canOccupy(slid, armory));
});

test('continuous collision cannot tunnel through a four-pixel wall during a long frame', () => {
  const thinWall: LocationDefinition = { ...courtyard, width: 1000, height: 800,
    spawn: { x: 100, y: 400 }, walls: [{ x: 500, y: 100, width: 4, height: 600 }], props: [], npc: undefined };
  const result = movePlayer({ x: 450, y: 400 }, { x: 1, y: 0 }, 10, thinWall);
  assert.ok(Math.abs(result.x - 488) < 1e-5);
  assert.ok(canOccupy(result, thinWall));
});

test('the courtyard caretaker is genuinely solid and decorative banners are not obstacles', () => {
  const npc = courtyard.npc!;
  assert.equal(canOccupy({ x: npc.x, y: npc.y }, courtyard), false);
  const result = movePlayer({ x: npc.x - 70, y: npc.y }, { x: 1, y: 0 }, 1, courtyard);
  assert.ok(Math.abs(result.x - (npc.x - 16 - 12)) < 1e-5);
  const banner = courtyard.props.find(prop => prop.kind === 'banner')!;
  assert.ok(canOccupy({ x: banner.x + banner.width / 2, y: banner.y + banner.height / 2 }, courtyard));
  assert.ok(getSolidRects(courtyard).length > courtyard.walls.length);
});

test('transition locking rejects a second request through fade-out and fade-in', () => {
  const transitions = new TransitionManager();
  assert.equal(transitions.request('CastleArmory', 'entrance'), true);
  assert.equal(transitions.busy, true);
  assert.equal(transitions.request('CastleArmory', 'entrance'), false);
  assert.deepEqual(transitions.consume(), { scene: 'CastleArmory', spawn: 'entrance' });
  assert.equal(transitions.consume(), null);
  assert.equal(transitions.busy, true);
  assert.equal(transitions.request('CastleCourtyard', 'armory-return'), false);
  transitions.complete();
  assert.equal(transitions.busy, false);
  assert.equal(transitions.request('CastleCourtyard', 'armory-return'), true);
  assert.deepEqual(transitions.pending, { scene: 'CastleCourtyard', spawn: 'armory-return' });
  transitions.complete();
  assert.equal(transitions.pending, null);
  assert.equal(transitions.request('CastleArmory', 'missing-spawn'), false);
  assert.equal(transitions.busy, false);
});

test('door requests preserve player health and inventory; explicit new game resets the same session object', () => {
  const reference = castleSession;
  resetSession();
  castleSession.health = 57;
  castleSession.inventory.push('Старый ключ');
  const transitions = new TransitionManager();
  transitions.request('CastleArmory', 'entrance'); transitions.consume(); transitions.complete();
  castleSession.currentLocation = 'CastleArmory';
  castleSession.position = { ...armory.spawns.entrance };
  castleSession.visited.push('CastleArmory');
  transitions.request('CastleCourtyard', 'armory-return'); transitions.consume(); transitions.complete();
  assert.equal(castleSession.health, 57);
  assert.deepEqual(castleSession.inventory, ['Старый ключ']);
  assert.equal(resetSession(), reference);
  assert.equal(castleSession.health, castleSession.maxHealth);
  assert.deepEqual(castleSession.inventory, []);
  assert.equal(castleSession.currentLocation, 'CastleCourtyard');
  assert.deepEqual(castleSession.position, courtyard.spawn);
});
