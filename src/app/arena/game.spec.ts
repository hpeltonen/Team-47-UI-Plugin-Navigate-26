import { ArenaGame, NO_INPUT, hashSeed, makeFighter, type FighterStats, type Input, type Outcome } from './game';

const NONE: Input = NO_INPUT;

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
    entitlementNames: ['Slack Member', 'VPN Users', 'Jira Developer'],
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

  it('fires a heavy when the attack button is held past the threshold, and it breaks a block', () => {
    const game = new ArenaGame(stats({ privilegedCount: 2 }), stats({ entitlementCount: 40 }), events);
    const sounds: string[] = [];
    (game as unknown as { events: { onSound: (n: string) => void } }).events.onSound = (n) => sounds.push(n);
    let holding = 0;
    simulate(game, (g, t) => {
      const dist = Math.abs(g.report.x - g.manager.x);
      if (hits.length >= 1) return NONE;
      if (dist > g.manager.reach - 6) return { ...NONE, right: true };
      // Press once, hold for 0.7s, release.
      if (holding === 0) { holding = t; return { ...NONE, punch: true, punchHeld: true }; }
      return { ...NONE, punchHeld: t - holding < 0.7 };
    }, 15);
    expect(sounds).toContain('heavy');
    expect(hits.length).toBe(1);
    // Heavy damage is 2.5x the base damage (4 for two privileged entitlements).
    expect(hits[0].amount).toBe(10);
  });

  it('lets a jump kick land over a block for full damage', () => {
    const game = new ArenaGame(stats(), stats({ entitlementCount: 40 }), events);
    // Force the bot to block forever.
    (game as unknown as { botInput: () => Input }).botInput = () => ({ ...NONE, block: true });
    let jumped = false;
    simulate(game, (g) => {
      const dist = Math.abs(g.report.x - g.manager.x);
      if (hits.length >= 1) return NONE;
      if (dist > 70) return { ...NONE, right: true };
      if (!jumped) { jumped = true; return { ...NONE, up: true, right: true }; }
      return g.manager.action === 'jump' ? { ...NONE, punch: true } : NONE;
    }, 10);
    expect(hits.length).toBe(1);
    expect(hits[0].amount).toBe(4);
  });

  it('knocks real entitlement names loose and freezes the frame on a hit', () => {
    const game = new ArenaGame(stats({ privilegedCount: 4 }), stats({ entitlementCount: 40 }), events);
    let hitStopAfterHit = 0;
    let namesAfterHit: string[] = [];
    simulate(game, (g) => {
      const dist = Math.abs(g.report.x - g.manager.x);
      if (hits.length >= 1) {
        // First controller call after the landing frame: the freeze has not ticked yet.
        if (!hitStopAfterHit) {
          hitStopAfterHit = g.hitStop;
          namesAfterHit = g.particles.filter((p) => p.size).map((p) => p.text ?? '');
        }
        return NONE;
      }
      return dist > g.manager.reach - 6 ? { ...NONE, right: true } : { ...NONE, punch: true };
    }, 10);
    expect(hitStopAfterHit).toBeGreaterThan(0);
    expect(namesAfterHit).toContain('Slack Member');
  });

  it('counts consecutive hits as a combo and drops it once the window passes', () => {
    const game = new ArenaGame(stats({ privilegedCount: 2 }), stats({ entitlementCount: 60 }), events);
    simulate(game, (g) => {
      const dist = Math.abs(g.report.x - g.manager.x);
      if (hits.length >= 3) return NONE;
      return dist > g.manager.reach - 6 ? { ...NONE, right: true } : { ...NONE, punch: true };
    }, 10);
    expect(game.manager.bestCombo).toBeGreaterThanOrEqual(2);
    // Ten seconds of standing still is well past the combo window.
    expect(game.manager.combo).toBe(0);
  });

  it('hashes seeds stably so the same person always gets the same face', () => {
    expect(hashSeed('ada@example.com')).toBe(hashSeed('ada@example.com'));
    expect(hashSeed('ada@example.com')).not.toBe(hashSeed('bob@example.com'));
  });
});
