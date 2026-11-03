import { LOCATIONS } from './locations';
import type { CastleSession, LocationId } from './types';

export interface PendingTransition { scene: LocationId; spawn: string }

/** A transition remains locked from fade-out through the destination's fade-in. */
export class TransitionManager {
  private next: PendingTransition | null = null;
  private locked = false;

  get busy(): boolean { return this.locked; }
  get pending(): PendingTransition | null { return this.next ? { ...this.next } : null; }

  request(target: LocationId, spawn: string): boolean {
    if (this.locked || !LOCATIONS[target]?.spawns[spawn]) return false;
    this.next = { scene: target, spawn };
    this.locked = true;
    return true;
  }

  /** Retrieve once. Keep busy until the receiving scene has finished its fade-in. */
  consume(): PendingTransition | null {
    const pending = this.next;
    this.next = null;
    return pending ? { ...pending } : null;
  }

  complete(): void { this.next = null; this.locked = false; }
}

export const castleTransitions = new TransitionManager();

/** Shared by both Phaser scenes. A doorway must never construct a fresh player state. */
export const castleSession: CastleSession = {
  health: 100, maxHealth: 100, inventory: [], currentLocation: 'CastleCourtyard',
  position: { ...LOCATIONS.CastleCourtyard.spawn }, visited: ['CastleCourtyard'],
};

/** Call only for an explicit new game. Preserve the exported object's identity. */
export function resetSession(): CastleSession {
  Object.assign(castleSession, {
    health: 100, maxHealth: 100, inventory: [], currentLocation: 'CastleCourtyard',
    position: { ...LOCATIONS.CastleCourtyard.spawn }, visited: ['CastleCourtyard'],
  } satisfies CastleSession);
  castleTransitions.complete();
  return castleSession;
}
