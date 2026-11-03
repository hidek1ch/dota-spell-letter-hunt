import type { LocationDefinition, Point, Rect } from './types';

const EPSILON = 1e-7;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Walls, solid furniture and the NPC share exactly the same collision geometry. */
export function getSolidRects(location: LocationDefinition): Rect[] {
  const solids: Rect[] = [...location.walls, ...location.props.filter(prop => prop.solid)];
  if (location.npc) {
    const npc = location.npc, width = npc.width ?? 32, height = npc.height ?? 32;
    solids.push({ x: npc.x - width / 2, y: npc.y - height / 2, width, height });
  }
  return solids.filter(rect => rect.width > 0 && rect.height > 0);
}

function circleIntersectsRect(position: Point, radius: number, rect: Rect): boolean {
  const dx = position.x - clamp(position.x, rect.x, rect.x + rect.width);
  const dy = position.y - clamp(position.y, rect.y, rect.y + rect.height);
  return dx * dx + dy * dy < radius * radius - EPSILON;
}

export function canOccupy(position: Point, location: LocationDefinition, radius = 12): boolean {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
  if (position.x < radius - EPSILON || position.y < radius - EPSILON ||
    position.x > location.width - radius + EPSILON || position.y > location.height - radius + EPSILON) return false;
  return !getSolidRects(location).some(rect => circleIntersectsRect(position, radius, rect));
}

/** Continuous one-axis circle sweep: even a very thin rectangle cannot be skipped. */
function sweepAxis(position: Point, amount: number, horizontal: boolean, radius: number, solids: Rect[], limit: number): number {
  const current = horizontal ? position.x : position.y;
  const perpendicular = horizontal ? position.y : position.x;
  let next = clamp(current + amount, radius, limit - radius);
  for (const rect of solids) {
    const otherMin = horizontal ? rect.y : rect.x;
    const otherMax = otherMin + (horizontal ? rect.height : rect.width);
    const gap = Math.max(otherMin - perpendicular, perpendicular - otherMax, 0);
    if (gap >= radius) continue;
    const reach = Math.sqrt(Math.max(0, radius * radius - gap * gap));
    const near = (horizontal ? rect.x : rect.y) - reach;
    const far = (horizontal ? rect.x + rect.width : rect.y + rect.height) + reach;
    if (amount > 0 && current <= near + EPSILON && next > near) next = near;
    else if (amount < 0 && current >= far - EPSILON && next < far) next = far;
  }
  return clamp(next, radius, limit - radius);
}

/**
 * Smooth normalized movement with circle-vs-rectangle collision and wall sliding.
 * The function is pure: position, location, inventory and session are never modified.
 * dt is elapsed seconds. Small substeps retain diagonal path geometry, while each
 * axis uses a continuous sweep rather than testing only the destination point.
 * Doors never change scenes here: their open wall gap still ends at world bounds.
 */
export function movePlayer(position: Point, input: Point, dt: number, location: LocationDefinition, radius = 12, speed = 190): Point {
  const r = clamp(Number.isFinite(radius) ? radius : 12, 0.01, Math.min(location.width, location.height) / 2);
  const result = {
    x: clamp(Number.isFinite(position.x) ? position.x : location.spawn.x, r, location.width - r),
    y: clamp(Number.isFinite(position.y) ? position.y : location.spawn.y, r, location.height - r),
  };
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(speed) || speed <= 0) return result;
  const ix = Number.isFinite(input.x) ? input.x : 0, iy = Number.isFinite(input.y) ? input.y : 0;
  const magnitude = Math.hypot(ix, iy);
  if (magnitude < EPSILON) return result;
  const normalization = Math.max(1, magnitude);
  // A constant direction reaches a world boundary before twice its diagonal.
  const travel = Math.min(speed * dt, Math.hypot(location.width, location.height) * 2);
  const dx = ix / normalization * travel, dy = iy / normalization * travel;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, r * 0.45)));
  const solids = getSolidRects(location);
  for (let step = 0; step < steps; step++) {
    result.x = sweepAxis(result, dx / steps, true, r, solids, location.width);
    result.y = sweepAxis(result, dy / steps, false, r, solids, location.height);
  }
  return result;
}
