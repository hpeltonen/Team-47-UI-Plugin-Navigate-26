import { ArenaGame, hashSeed, makeFighter, type FighterStats, type Input, type Outcome } from './game';

const NONE: Input = { left: false, right: false, punch: false, block: false };

function stats(overrides: Partial<FighterStats> = {}): FighterStats {
  return {
    id: 'x',
    name: 'Test Person',
    seed: 'test@example.com',
    entitlementCount: 20,
    roleCount: 0,
    privilegedCount: 0,
    directReports: 0,
    subtitle: '',
    ...overrides,
  };
}

/** Runs the simulation at a fixed 60 Hz until it ends or `maxSeconds` pass. */
function simulate(game: ArenaGame, controller: (game: ArenaGame, t: number) => Input, maxSeconds = 70): number {
  const dt = 1 / 60;
  let t = 0;
  while (!game.winner && t < maxSeconds) {
    game.step(dt, controller(game, t));
    t += dt;
  }
  return t;
}

describe('ArenaGame', () => {
  let ended: Outcome[];
  let hits: Array<{ target: string; amount: number; armour: boolean }>;
  const events = {
    onHit: (target: string, amount: number, armour: boolean) => hits.push({ target, amount, armour }),
    onEnd: (winner: Outcome) => ended.push(winner),
  };

  beforeEach(() => {
    ended = [];
    hits = [];
    // Make the bot deterministic and passive so the player's behaviour is what we test.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
  });

  afterEach(() => vi.restoreAllMocks());

  it('derives health, armour and reach from identity data', () => {
    const f = makeFighter(stats({ entitlementCount: 35, roleCount: 4, privilegedCount: 6 }), 'left');
    expect(f.maxHp).toBe(35);
    expect(f.armour).toBe(4);
    expect(f.reach).toBeGreaterThan(makeFighter(stats(), 'left').reach);
    expect(f.damage).toBeGreaterThan(makeFighter(stats(), 'left').damage);
  });

  it('floors and caps health so interns and admins are both playable', () => {
    expect(makeFighter(stats({ entitlementCount: 0 }), 'left').maxHp).toBe(8);
    expect(makeFighter(stats({ entitlementCount: 900 }), 'left').maxHp).toBe(60);
  });

  it('lets a manager who walks in and keeps punching win, and fires onEnd once', () => {
    const game = new ArenaGame(stats({ name: 'Boss', privilegedCount: 4 }), stats({ name: 'Report', entitlementCount: 12 }), events);
    const t = simulate(game, (g) => {
      const dist = Math.abs(g.report.x - g.manager.x);
      return dist > g.manager.reach - 6 ? { ...NONE, right: true } : { ...NONE, punch: true };
    });
    expect(game.winner).toBe('manager');
    expect(ended).toEqual(['manager']);
    expect(t).toBeLessThan(60);
    expect(game.report.hp).toBe(0);
    expect(game.report.action).toBe('down');
    expect(game.manager.action).toBe('win');
  });

  it('spends roles as armour before touching health', () => {
    const game = new ArenaGame(stats({ privilegedCount: 2 }), stats({ roleCount: 3, entitlementCount: 30 }), events);
    simulate(game, (g) => {
      const dist = Math.abs(g.report.x - g.manager.x);
      if (hits.length >= 3) return NONE;
      return dist > g.manager.reach - 6 ? { ...NONE, right: true } : { ...NONE, punch: true };
    }, 20);
    expect(hits.slice(0, 3).every((h) => h.armour)).toBe(true);
    expect(game.report.hp).toBe(game.report.maxHp);
    expect(game.report.armour).toBe(0);
  });

  it('ends the round on the clock and the healthier fighter keeps their job', () => {
    const game = new ArenaGame(stats(), stats(), events);
    const t = simulate(game, () => NONE);
    expect(game.winner).not.toBeNull();
    expect(t).toBeGreaterThan(60);
    expect(ended.length).toBe(1);
  });

  it('keeps the fighters inside the arena and apart', () => {
    const game = new ArenaGame(stats(), stats(), events);
    simulate(game, () => ({ ...NONE, right: true }), 10);
    expect(game.manager.x).toBeLessThan(game.report.x);
    expect(game.report.x - game.manager.x).toBeGreaterThanOrEqual(36);
  });

  it('hashes seeds stably so the same person always gets the same face', () => {
    expect(hashSeed('ada@example.com')).toBe(hashSeed('ada@example.com'));
    expect(hashSeed('ada@example.com')).not.toBe(hashSeed('bob@example.com'));
  });
});
