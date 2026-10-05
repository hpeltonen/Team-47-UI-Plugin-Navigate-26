/**
 * Access Arena: a tiny real-time stick figure fighting engine.
 *
 * Pure TypeScript, no Angular. The component owns the canvas and the
 * requestAnimationFrame loop; this file owns the rules, the physics, the bot
 * and the drawing. Everything about a fighter that comes from Identity
 * Security Cloud arrives through `FighterStats`, so the fight is a (silly)
 * visualisation of how entrenched someone's access is.
 */

/** Live identity data that shapes a fighter. All numbers are optional-safe. */
export interface FighterStats {
  id: string;
  name: string;
  /** Seeds the procedural avatar. Email is stable; name is the fallback. */
  seed: string;
  /** Health. One entitlement is one hit point (floored at a minimum). */
  entitlementCount: number;
  /** Armour. Every role absorbs one hit before health is touched. */
  roleCount: number;
  /** Weapon. Privileged access swings a longer, harder weapon and charges faster. */
  privilegedCount: number;
  /** Minions for the manager. Each direct report is a tiny helper. */
  directReports: number;
  /** Label under the health bar. */
  subtitle: string;
  /** Real entitlement names, knocked loose one per hit. */
  entitlementNames: string[];
}

export type FighterAction =
  | 'idle'
  | 'walk'
  | 'punch'
  | 'charge'
  | 'heavy'
  | 'jump'
  | 'kick'
  | 'block'
  | 'hit'
  | 'down'
  | 'win';
export type Side = 'left' | 'right';

export interface Input {
  left: boolean;
  right: boolean;
  /** Jump, edge-triggered. */
  up: boolean;
  /** Attack button pressed this frame (edge). */
  punch: boolean;
  /** Attack button currently held (level). Holding charges a heavy attack. */
  punchHeld: boolean;
  block: boolean;
}

export const NO_INPUT: Input = { left: false, right: false, up: false, punch: false, punchHeld: false, block: false };

export type SoundName = 'whoosh' | 'hit' | 'heavy' | 'block' | 'jump' | 'kick' | 'charge' | 'armour' | 'ko' | 'bell' | 'combo';

export interface Fighter {
  stats: FighterStats;
  side: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  action: FighterAction;
  /** Seconds remaining in the current timed action. */
  actionTimer: number;
  /** Set once per attack when the hit frame has been applied. */
  attackLanded: boolean;
  /** Seconds the attack button has been held during a charge. */
  chargeTime: number;
  hp: number;
  maxHp: number;
  armour: number;
  maxArmour: number;
  reach: number;
  damage: number;
  /** Seconds of holding before a punch becomes a heavy. Shorter with privilege. */
  chargeThreshold: number;
  /** Walk cycle phase. */
  phase: number;
  /** Landed hits in the current combo and how long until it drops. */
  combo: number;
  comboTimer: number;
  /** Highest combo this round, for the verdict. */
  bestCombo: number;
  /** Set once the fighter has been hurt this round, for the PERFECT call. */
  tookDamage: boolean;
  /** Next entitlement name to knock loose. */
  nextEntitlement: number;
  /** Bot only: seconds until the next decision. */
  thinkTimer: number;
  /** Bot only: the current plan. */
  plan: 'approach' | 'retreat' | 'wait';
}

export interface Minion {
  x: number;
  y: number;
  vx: number;
  phase: number;
  seed: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  text?: string;
  color: string;
  size?: number;
  spin?: number;
}

export type Outcome = 'manager' | 'report' | null;

export interface GameEvents {
  onHit(target: Side, amount: number, armour: boolean): void;
  onEnd(winner: Outcome): void;
  onSound?(name: SoundName): void;
}

export const ARENA_W = 960;
export const ARENA_H = 420;
const FLOOR_Y = ARENA_H - 60;
const WALK_SPEED = 260;
const JUMP_V = 640;
const GRAVITY = 1900;
const PUNCH_TIME = 0.32;
const PUNCH_HIT_AT = 0.14;
const HEAVY_TIME = 0.6;
const HEAVY_HIT_AT = 0.34;
const KICK_TIME = 0.45;
const KICK_HIT_AT = 0.08;
const HIT_STUN = 0.35;
const HEAVY_STUN = 0.6;
const BLOCK_DAMAGE_MULT = 0.2;
const COMBO_WINDOW = 1.3;
const MIN_HP = 8;
const MAX_HP = 60;
const ROUND_SECONDS = 60;

/** Deterministic hash so the same identity always gets the same face. */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/** Caps a raw count into a playable stat range. */
function clampHp(entitlements: number): number {
  return Math.max(MIN_HP, Math.min(MAX_HP, entitlements));
}

export function makeFighter(stats: FighterStats, side: Side): Fighter {
  const maxHp = clampHp(stats.entitlementCount);
  const armour = Math.min(8, stats.roleCount);
  const reach = 46 + Math.min(40, stats.privilegedCount * 6);
  const damage = 3 + Math.min(6, Math.floor(stats.privilegedCount / 2));
  return {
    stats,
    side,
    x: side === 'left' ? ARENA_W * 0.3 : ARENA_W * 0.7,
    y: FLOOR_Y,
    vx: 0,
    vy: 0,
    facing: side === 'left' ? 1 : -1,
    action: 'idle',
    actionTimer: 0,
    attackLanded: false,
    chargeTime: 0,
    hp: maxHp,
    maxHp,
    armour,
    maxArmour: armour,
    reach,
    damage,
    chargeThreshold: Math.max(0.25, 0.5 - Math.min(0.25, stats.privilegedCount * 0.04)),
    phase: 0,
    combo: 0,
    comboTimer: 0,
    bestCombo: 0,
    tookDamage: false,
    nextEntitlement: 0,
    thinkTimer: 0,
    plan: 'approach',
  };
}

interface Announcement {
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export class ArenaGame {
  readonly manager: Fighter;
  readonly report: Fighter;
  readonly minions: Minion[] = [];
  readonly particles: Particle[] = [];
  timeLeft = ROUND_SECONDS;
  winner: Outcome = null;
  /** Short "FIGHT!" banner at the start. */
  introTimer = 1.6;
  shake = 0;
  /** Seconds the simulation is frozen after a landed hit. */
  hitStop = 0;
  /** Seconds of white flash left to draw. */
  flash = 0;
  /** Slow motion factor during the K.O. */
  private slowMo = 1;
  private announcement: Announcement | null = null;
  private ended = false;
  private bellRung = false;

  constructor(
    managerStats: FighterStats,
    reportStats: FighterStats,
    private readonly events: GameEvents,
  ) {
    this.manager = makeFighter(managerStats, 'left');
    this.report = makeFighter(reportStats, 'right');
    const minionCount = Math.min(12, managerStats.directReports);
    for (let i = 0; i < minionCount; i++) {
      this.minions.push({
        x: 40 + i * 18,
        y: FLOOR_Y + 8,
        vx: 0,
        phase: i,
        seed: hashSeed(managerStats.seed + i),
      });
    }
  }

  /** Advance the simulation by `dt` seconds with the player's input. */
  step(dt: number, input: Input): void {
    dt = Math.min(dt, 0.05);

    // Cosmetic timers run on wall time so a freeze still feels like a freeze.
    this.flash = Math.max(0, this.flash - dt);
    this.shake = Math.max(0, this.shake - dt * 20);
    if (this.announcement) {
      this.announcement.life -= dt;
      if (this.announcement.life <= 0) this.announcement = null;
    }

    if (this.introTimer > 0) {
      this.introTimer -= dt;
      if (this.introTimer <= 0.8 && !this.bellRung) {
        this.bellRung = true;
        this.sound('bell');
      }
      this.updateParticles(dt);
      return;
    }

    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }

    dt *= this.slowMo;
    if (this.ended) {
      this.slowMo = Math.min(1, this.slowMo + dt * 0.8);
      this.updateParticles(dt);
      this.updateMinions(dt);
      this.applyPhysics(this.manager, dt);
      this.applyPhysics(this.report, dt);
      return;
    }

    this.timeLeft -= dt;
    this.applyInput(this.manager, input, dt);
    this.applyInput(this.report, this.botInput(dt), dt);

    this.applyPhysics(this.manager, dt);
    this.applyPhysics(this.report, dt);
    this.separate();

    this.resolveAttack(this.manager, this.report);
    this.resolveAttack(this.report, this.manager);

    this.tickCombo(this.manager, dt);
    this.tickCombo(this.report, dt);

    this.updateMinions(dt);
    this.updateParticles(dt);

    if (this.report.hp <= 0) {
      this.finish('manager');
    } else if (this.manager.hp <= 0) {
      this.finish('report');
    } else if (this.timeLeft <= 0) {
      // Time out: whoever has the larger share of health left keeps their job.
      const m = this.manager.hp / this.manager.maxHp;
      const r = this.report.hp / this.report.maxHp;
      this.finish(m > r ? 'manager' : 'report');
    }
  }

  private finish(winner: Outcome): void {
    this.ended = true;
    this.winner = winner;
    this.timeLeft = Math.max(0, this.timeLeft);
    const loser = winner === 'manager' ? this.report : this.manager;
    const victor = winner === 'manager' ? this.manager : this.report;
    loser.action = 'down';
    victor.action = 'win';
    victor.vx = 0;
    this.slowMo = 0.25;
    this.hitStop = 0.25;
    this.flash = 0.25;
    this.shake = 14;
    this.burst(loser.x, loser.y - 90, 40, '#f59e0b');
    // The rest of their access rains out on the floor.
    const names = loser.stats.entitlementNames;
    for (let i = 0; i < Math.min(14, Math.max(4, names.length)); i++) {
      const name = names.length ? names[(loser.nextEntitlement + i) % names.length] : 'entitlement';
      this.particles.push({
        x: loser.x,
        y: loser.y - 100,
        vx: (Math.random() - 0.5) * 520,
        vy: -300 - Math.random() * 300,
        life: 1.6 + Math.random() * 0.8,
        text: name,
        color: '#fde68a',
        size: 13,
        spin: (Math.random() - 0.5) * 6,
      });
    }
    this.announce(victor.tookDamage ? 'K.O.' : 'PERFECT K.O.', '#fbbf24', 2.5);
    this.sound('ko');
    this.events.onEnd(winner);
  }

  private airborne(f: Fighter): boolean {
    return f.y < FLOOR_Y - 0.5 || f.vy < 0;
  }

  private applyInput(f: Fighter, input: Input, dt: number): void {
    if (f.actionTimer > 0) {
      f.actionTimer -= dt;
      if (f.actionTimer <= 0) {
        f.action = this.airborne(f) ? 'jump' : 'idle';
        f.actionTimer = 0;
      }
    }

    // In the air you can only kick, once.
    if (this.airborne(f)) {
      if (f.action === 'jump' && input.punch) {
        f.action = 'kick';
        f.actionTimer = KICK_TIME;
        f.attackLanded = false;
        this.sound('kick');
      }
      return;
    }

    // Holding the attack button winds up a heavy. Releasing decides which one fires.
    if (f.action === 'charge') {
      f.vx = 0;
      if (input.punchHeld) {
        f.chargeTime += dt;
        return;
      }
      if (f.chargeTime >= f.chargeThreshold) {
        f.action = 'heavy';
        f.actionTimer = HEAVY_TIME;
        this.sound('heavy');
      } else {
        f.action = 'punch';
        f.actionTimer = PUNCH_TIME;
        this.sound('whoosh');
      }
      f.attackLanded = false;
      return;
    }

    const busy = f.action === 'punch' || f.action === 'heavy' || f.action === 'hit' || f.action === 'kick';
    if (busy) {
      f.vx = 0;
      return;
    }

    if (input.block) {
      f.action = 'block';
      f.vx = 0;
      return;
    }
    if (f.action === 'block') {
      f.action = 'idle';
    }

    if (input.punch) {
      f.action = 'charge';
      f.chargeTime = 0;
      f.vx = 0;
      return;
    }

    if (input.up) {
      f.vy = -JUMP_V;
      f.action = 'jump';
      f.actionTimer = 0;
      f.vx = (input.left ? -WALK_SPEED : 0) + (input.right ? WALK_SPEED : 0);
      this.sound('jump');
      return;
    }

    f.vx = 0;
    if (input.left) f.vx -= WALK_SPEED;
    if (input.right) f.vx += WALK_SPEED;
    f.action = f.vx !== 0 ? 'walk' : 'idle';
  }

  private applyPhysics(f: Fighter, dt: number): void {
    f.x += f.vx * dt;
    f.x = Math.max(40, Math.min(ARENA_W - 40, f.x));

    if (this.airborne(f) || f.vy !== 0) {
      f.vy += GRAVITY * dt;
      f.y += f.vy * dt;
      if (f.y >= FLOOR_Y) {
        f.y = FLOOR_Y;
        f.vy = 0;
        if (f.action === 'jump' || f.action === 'kick') {
          f.action = 'idle';
          f.actionTimer = 0;
        }
      }
    }

    if (f.action === 'walk') {
      f.phase += dt * 10;
    }
    const other = f === this.manager ? this.report : this.manager;
    if (f.action !== 'down') {
      f.facing = other.x >= f.x ? 1 : -1;
    }
  }

  /** Keep the two bodies from overlapping. */
  private separate(): void {
    const minGap = 36;
    const gap = Math.abs(this.manager.x - this.report.x);
    const verticalGap = Math.abs(this.manager.y - this.report.y);
    if (gap < minGap && verticalGap < 60) {
      const push = (minGap - gap) / 2;
      if (this.manager.x < this.report.x) {
        this.manager.x -= push;
        this.report.x += push;
      } else {
        this.manager.x += push;
        this.report.x -= push;
      }
    }
  }

  private resolveAttack(attacker: Fighter, target: Fighter): void {
    let total: number;
    let hitAt: number;
    let kind: 'punch' | 'heavy' | 'kick';
    switch (attacker.action) {
      case 'punch':
        total = PUNCH_TIME; hitAt = PUNCH_HIT_AT; kind = 'punch';
        break;
      case 'heavy':
        total = HEAVY_TIME; hitAt = HEAVY_HIT_AT; kind = 'heavy';
        break;
      case 'kick':
        total = KICK_TIME; hitAt = KICK_HIT_AT; kind = 'kick';
        break;
      default:
        return;
    }
    if (attacker.attackLanded) {
      return;
    }
    const elapsed = total - attacker.actionTimer;
    if (elapsed < hitAt) {
      return;
    }
    attacker.attackLanded = true;

    const dist = Math.abs(target.x - attacker.x);
    const inFront = Math.sign(target.x - attacker.x) === attacker.facing;
    const reach = kind === 'kick' ? attacker.reach + 10 : kind === 'heavy' ? attacker.reach + 16 : attacker.reach;
    const vertical = Math.abs(target.y - attacker.y);
    if (!inFront || dist > reach + 20 || vertical > 90) {
      return;
    }

    let amount = attacker.damage;
    if (kind === 'heavy') amount = Math.round(amount * 2.5);
    if (kind === 'kick') amount += 1;

    // Blocks stop punches. Heavies break through; jump kicks come in over the top.
    const guarding = target.action === 'block' && target.facing === -attacker.facing;
    const blocked = guarding && kind === 'punch';
    const guardBroken = guarding && !blocked;
    if (blocked) {
      amount = Math.max(1, Math.round(amount * BLOCK_DAMAGE_MULT));
    }

    // Catching someone mid wind-up is a counter.
    const counter = target.action === 'charge' || target.action === 'punch' || target.action === 'heavy';

    if (target.armour > 0 && !blocked) {
      target.armour -= 1;
      this.events.onHit(target.side, 0, true);
      this.spawnText(target.x, target.y - 130, 'ROLE ABSORBED', '#60a5fa');
      this.burst(target.x, target.y - 80, 8, '#60a5fa');
      this.sound('armour');
      this.hitStop = 0.05;
    } else {
      target.hp = Math.max(0, target.hp - amount);
      target.tookDamage = true;
      this.events.onHit(target.side, amount, false);
      this.spawnText(target.x, target.y - 130, `-${amount}`, blocked ? '#9ca3af' : '#ef4444');
      this.burst(target.x, target.y - 80, blocked ? 4 : kind === 'heavy' ? 20 : 12, blocked ? '#9ca3af' : '#ef4444');
      this.shake = blocked ? 2 : kind === 'heavy' ? 12 : 6;
      if (!blocked) {
        this.knockEntitlementLoose(target, kind === 'heavy' ? 3 : 1);
        this.hitStop = kind === 'heavy' ? 0.12 : 0.06;
        this.flash = kind === 'heavy' ? 0.1 : 0.04;
      }
      this.sound(blocked ? 'block' : kind === 'heavy' ? 'heavy' : 'hit');
    }

    if (!blocked) {
      target.action = 'hit';
      target.actionTimer = kind === 'heavy' ? HEAVY_STUN : HIT_STUN;
      target.x += attacker.facing * (kind === 'heavy' ? 40 : 18);
      if (kind === 'heavy') {
        target.vy = -260;
      }
      // Getting hit drops your own combo.
      target.combo = 0;
      target.comboTimer = 0;
    } else {
      this.sound('block');
    }

    // Combo bookkeeping and announcer calls.
    attacker.combo += 1;
    attacker.comboTimer = COMBO_WINDOW;
    attacker.bestCombo = Math.max(attacker.bestCombo, attacker.combo);
    if (guardBroken) {
      this.announce('GUARD BREAK', '#f97316', 0.9);
    } else if (counter) {
      this.announce('COUNTER', '#a78bfa', 0.9);
    } else if (attacker.combo >= 2) {
      this.announce(`${attacker.combo} HIT COMBO`, attacker.combo >= 4 ? '#fbbf24' : '#f8fafc', 0.9);
      if (attacker.combo >= 3) this.sound('combo');
    }
  }

  private tickCombo(f: Fighter, dt: number): void {
    if (f.comboTimer > 0) {
      f.comboTimer -= dt;
      if (f.comboTimer <= 0) {
        f.combo = 0;
      }
    }
  }

  /** Pops real entitlement names off the target so the hits read as access being stripped. */
  private knockEntitlementLoose(target: Fighter, count: number): void {
    const names = target.stats.entitlementNames;
    if (!names.length) return;
    for (let i = 0; i < count; i++) {
      const name = names[target.nextEntitlement % names.length];
      target.nextEntitlement += 1;
      this.particles.push({
        x: target.x,
        y: target.y - 100,
        vx: -target.facing * (160 + Math.random() * 200) + (Math.random() - 0.5) * 120,
        vy: -260 - Math.random() * 200,
        life: 1.4 + Math.random() * 0.4,
        text: name,
        color: '#fde68a',
        size: 13,
        spin: (Math.random() - 0.5) * 5,
      });
    }
  }

  /** The report's brain: approach, poke, occasionally block, jump or wind up a heavy. */
  private botInput(dt: number): Input {
    const bot = this.report;
    const me = this.manager;
    bot.thinkTimer -= dt;
    const dist = Math.abs(me.x - bot.x);
    const towards = me.x > bot.x ? 'right' : 'left';
    const away = towards === 'right' ? 'left' : 'right';

    // Keep holding while a heavy winds up, then let go.
    if (bot.action === 'charge') {
      return { ...NO_INPUT, punchHeld: bot.chargeTime < bot.chargeThreshold + 0.05 };
    }

    if (bot.thinkTimer <= 0) {
      bot.thinkTimer = 0.25 + Math.random() * 0.45;
      const roll = Math.random();
      // A bot with privileged access is bolder; a plain intern hangs back more.
      const aggression = 0.5 + Math.min(0.35, bot.stats.privilegedCount * 0.05);
      bot.plan = roll < aggression ? 'approach' : roll < aggression + 0.25 ? 'wait' : 'retreat';
    }

    // Block when the player is winding up in range, unless it is a heavy, then hop away.
    const playerWindingUp = me.action === 'punch' || me.action === 'charge' || me.action === 'heavy';
    if (playerWindingUp && dist < me.reach + 40) {
      if (me.action === 'charge' && me.chargeTime > 0.2 && Math.random() < 0.5) {
        return { ...NO_INPUT, up: true, [away]: true };
      }
      if (Math.random() < 0.6) {
        return { ...NO_INPUT, block: true };
      }
    }

    if (dist <= bot.reach - 4 && bot.action !== 'punch' && bot.action !== 'heavy') {
      const roll = Math.random();
      if (roll < 0.08) return { ...NO_INPUT, punch: true, punchHeld: false };
      // The bot winds up a heavy now and then when the player is blocking a lot.
      if (roll < 0.1 && me.action === 'block') return { ...NO_INPUT, punch: true, punchHeld: true };
    }

    // Occasional jump kick from mid range.
    if (dist > bot.reach && dist < 200 && bot.action === 'idle' && Math.random() < 0.01) {
      return { ...NO_INPUT, up: true, [towards]: true, punch: true };
    }

    switch (bot.plan) {
      case 'approach':
        return dist > bot.reach - 10 ? { ...NO_INPUT, [towards]: true } : NO_INPUT;
      case 'retreat':
        return dist < 180 ? { ...NO_INPUT, [away]: true } : NO_INPUT;
      default:
        return NO_INPUT;
    }
  }

  private updateMinions(dt: number): void {
    const target = this.report.x - this.report.facing * -30;
    const swarming = this.manager.action === 'punch' || this.manager.action === 'heavy' || this.manager.action === 'kick';
    for (const m of this.minions) {
      if (this.ended) {
        m.vx = 0;
        continue;
      }
      // They jog toward the report, bump them, then scurry back.
      const goal = swarming ? target : 40 + this.minions.indexOf(m) * 18;
      const dir = Math.sign(goal - m.x);
      m.vx = dir * 160;
      m.x += m.vx * dt;
      m.phase += dt * 14;
    }
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      p.life -= dt;
      // Text lands on the floor and slides to a stop.
      if (p.text && p.size && p.y > FLOOR_Y + 30) {
        p.y = FLOOR_Y + 30;
        p.vy = -Math.abs(p.vy) * 0.3;
        p.vx *= 0.6;
        p.spin = 0;
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (this.particles[i].life <= 0) this.particles.splice(i, 1);
    }
  }

  private spawnText(x: number, y: number, text: string, color: string): void {
    this.particles.push({ x, y, vx: 0, vy: -90, life: 0.9, text, color });
  }

  private burst(x: number, y: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 220;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 100, life: 0.5 + Math.random() * 0.5, color });
    }
  }

  private announce(text: string, color: string, life: number): void {
    this.announcement = { text, color, life, maxLife: life };
  }

  private sound(name: SoundName): void {
    this.events.onSound?.(name);
  }

  // ───────────────────────────── Drawing ─────────────────────────────

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    this.drawBackground(ctx);
    for (const m of this.minions) this.drawMinion(ctx, m);
    this.drawShadow(ctx, this.manager);
    this.drawShadow(ctx, this.report);
    this.drawFighter(ctx, this.manager);
    this.drawFighter(ctx, this.report);
    this.drawParticles(ctx);
    ctx.restore();
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.85, this.flash * 8)})`;
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    }
    this.drawHud(ctx);
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const sky = ctx.createLinearGradient(0, 0, 0, ARENA_H);
    sky.addColorStop(0, '#0f172a');
    sky.addColorStop(1, '#1e293b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);

    // Office skyline: identity governance happens in buildings.
    ctx.fillStyle = '#111827';
    const r = rng(7);
    for (let x = 0; x < ARENA_W; x += 54) {
      const h = 60 + r() * 140;
      ctx.fillRect(x, FLOOR_Y - h, 44, h);
      ctx.fillStyle = '#fbbf24';
      for (let wy = FLOOR_Y - h + 10; wy < FLOOR_Y - 10; wy += 16) {
        for (let wx = x + 6; wx < x + 40; wx += 12) {
          if (r() > 0.55) ctx.fillRect(wx, wy, 6, 8);
        }
      }
      ctx.fillStyle = '#111827';
    }

    ctx.fillStyle = '#334155';
    ctx.fillRect(0, FLOOR_Y, ARENA_W, ARENA_H - FLOOR_Y);
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, FLOOR_Y, ARENA_W, 4);
  }

  private drawShadow(ctx: CanvasRenderingContext2D, f: Fighter): void {
    const height = FLOOR_Y - f.y;
    const scale = Math.max(0.4, 1 - height / 400);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
    ctx.beginPath();
    ctx.ellipse(f.x, FLOOR_Y + 4, 26 * scale, 7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFighter(ctx: CanvasRenderingContext2D, f: Fighter): void {
    const { x, y } = f;
    const color = f.side === 'left' ? '#38bdf8' : '#fb7185';
    const down = f.action === 'down';
    ctx.save();
    ctx.translate(x, y);
    if (down) {
      ctx.rotate(f.facing * Math.PI / 2);
      ctx.translate(0, 20);
    }
    ctx.scale(f.facing, 1);
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = color;

    const walk = f.action === 'walk' ? Math.sin(f.phase) : 0;
    const bob = f.action === 'win' ? Math.abs(Math.sin(performance.now() / 120)) * 10 : 0;
    const charging = f.action === 'charge';
    const chargeFrac = charging ? Math.min(1, f.chargeTime / f.chargeThreshold) : 0;
    const crouch = charging ? chargeFrac * 10 : 0;
    const hipY = -60 - bob + crouch;
    const shoulderY = -105 - bob + crouch;
    const headY = -128 - bob + crouch;

    // Legs
    ctx.beginPath();
    if (f.action === 'jump' || f.action === 'kick') {
      const kick = f.action === 'kick';
      ctx.moveTo(0, hipY);
      ctx.lineTo(kick ? 26 : 10, kick ? hipY + 6 : hipY + 24);
      ctx.lineTo(kick ? 56 : 18, kick ? hipY - 2 : hipY + 14);
      ctx.moveTo(0, hipY);
      ctx.lineTo(-12, hipY + 22);
      ctx.lineTo(-4, hipY + 40);
    } else {
      ctx.moveTo(0, hipY);
      ctx.lineTo(-14 + walk * 14, -30 - bob + crouch);
      ctx.lineTo(-18 + walk * 18, 0);
      ctx.moveTo(0, hipY);
      ctx.lineTo(14 - walk * 14, -30 - bob + crouch);
      ctx.lineTo(18 - walk * 18, 0);
    }
    ctx.stroke();

    // Torso
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(0, shoulderY);
    ctx.stroke();

    // Arms
    ctx.beginPath();
    if (f.action === 'punch' || f.action === 'heavy') {
      const heavy = f.action === 'heavy';
      const total = heavy ? HEAVY_TIME : PUNCH_TIME;
      const t = 1 - f.actionTimer / total;
      // Heavies wind back first, then swing through.
      const swing = heavy ? (t < 0.5 ? -0.5 * (t / 0.5) : Math.sin(((t - 0.5) / 0.5) * Math.PI)) : Math.sin(Math.min(1, t * 1.6) * Math.PI);
      const ext = swing * (f.reach + (heavy ? 16 : 0));
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(ext * 0.5, shoulderY + 2);
      ctx.lineTo(ext, shoulderY);
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(-16, shoulderY + 24);
      ctx.lineTo(-6, shoulderY + 40);
      ctx.stroke();
      // Weapon: scales with privileged access.
      if (ext > 0) this.drawWeapon(ctx, f, ext, shoulderY, heavy);
    } else if (charging) {
      // Fist pulled back, shaking harder the longer it is held.
      const jitter = (Math.random() - 0.5) * chargeFrac * 6;
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(-18, shoulderY + 10 + jitter);
      ctx.lineTo(-30, shoulderY - 2 + jitter);
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(14, shoulderY + 24);
      ctx.lineTo(10, shoulderY + 10);
      ctx.stroke();
      // Charge glow
      ctx.fillStyle = `rgba(251, 191, 36, ${0.2 + chargeFrac * 0.6})`;
      ctx.beginPath();
      ctx.arc(-30, shoulderY - 2 + jitter, 6 + chargeFrac * 10, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.action === 'block') {
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(16, shoulderY + 20);
      ctx.lineTo(14, shoulderY - 14);
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(20, shoulderY + 30);
      ctx.lineTo(20, shoulderY);
      ctx.stroke();
      ctx.strokeStyle = '#a5b4fc';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(22, shoulderY + 10, 22, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    } else if (f.action === 'win') {
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(-18, shoulderY - 20);
      ctx.lineTo(-22, shoulderY - 44);
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(18, shoulderY - 20);
      ctx.lineTo(22, shoulderY - 44);
      ctx.stroke();
    } else if (f.action === 'jump' || f.action === 'kick') {
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(-16, shoulderY - 10);
      ctx.lineTo(-24, shoulderY - 30);
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(16, shoulderY + 10);
      ctx.lineTo(24, shoulderY - 6);
      ctx.stroke();
    } else {
      const swing = walk * 12;
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(14 + swing, shoulderY + 24);
      ctx.lineTo(22 + swing, shoulderY + 12);
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(-14 - swing, shoulderY + 24);
      ctx.lineTo(-8 - swing, shoulderY + 44);
      ctx.stroke();
    }

    // Head: the avatar. Undo the facing flip so faces are not mirrored.
    // Squash on impact, stretch in the air.
    ctx.save();
    ctx.translate(0, headY);
    ctx.scale(f.facing, 1);
    if (f.action === 'hit') {
      ctx.scale(1.2, 0.85);
    } else if (f.action === 'jump' || f.action === 'kick') {
      ctx.scale(0.9, 1.12);
    }
    drawAvatar(ctx, f.stats, 24, f.action === 'hit' || down, charging || f.action === 'heavy');
    ctx.restore();

    ctx.restore();
  }

  private drawWeapon(ctx: CanvasRenderingContext2D, f: Fighter, ext: number, shoulderY: number, heavy: boolean): void {
    const priv = f.stats.privilegedCount;
    ctx.save();
    ctx.translate(ext, shoulderY);
    if (heavy) ctx.scale(1.3, 1.3);
    if (priv === 0) {
      // A wet noodle.
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(14, 10, 10, 26);
      ctx.stroke();
    } else if (priv < 4) {
      // A rolled-up policy document.
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(0, -4, 34, 8);
    } else {
      // A two-handed sword of privilege.
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(f.reach * 0.9, -2);
      ctx.lineTo(f.reach, 0);
      ctx.lineTo(f.reach * 0.9, 2);
      ctx.lineTo(0, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#b45309';
      ctx.fillRect(-4, -10, 6, 20);
    }
    ctx.restore();
  }

  private drawMinion(ctx: CanvasRenderingContext2D, m: Minion): void {
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.scale(Math.sign(m.vx) || 1, 1);
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const w = Math.sin(m.phase) * 5;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(0, -8);
    ctx.lineTo(-4 + w, 0);
    ctx.moveTo(0, -8);
    ctx.lineTo(4 - w, 0);
    ctx.moveTo(0, -17);
    ctx.lineTo(5, -12);
    ctx.moveTo(0, -17);
    ctx.lineTo(-5, -12);
    ctx.stroke();
    ctx.fillStyle = '#bae6fd';
    ctx.beginPath();
    ctx.arc(0, -25, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      if (p.text) {
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.spin) ctx.rotate(p.spin * p.life);
        ctx.font = `bold ${p.size ?? 20}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        if (p.size) {
          // Entitlement tags get a little chip behind them so they read on any background.
          const w = ctx.measureText(p.text).width + 12;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
          ctx.fillRect(-w / 2, -p.size, w, p.size + 6);
        }
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    this.drawBar(ctx, this.manager, 24, false);
    this.drawBar(ctx, this.report, ARENA_W - 24, true);

    // Timer
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(String(Math.ceil(this.timeLeft)), ARENA_W / 2, 46);

    if (this.announcement) {
      const a = this.announcement;
      const t = 1 - a.life / a.maxLife;
      const scale = t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : 1.1 - Math.min(0.1, (t - 0.15) * 0.3);
      ctx.save();
      ctx.translate(ARENA_W / 2, 110);
      ctx.scale(scale, scale);
      ctx.globalAlpha = a.life < 0.25 ? a.life / 0.25 : 1;
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#0f172a';
      ctx.strokeText(a.text, 0, 0);
      ctx.fillStyle = a.color;
      ctx.fillText(a.text, 0, 0);
      ctx.restore();
    }

    if (this.introTimer > 0) {
      const t = this.introTimer;
      ctx.font = 'bold 64px system-ui, sans-serif';
      ctx.fillStyle = t > 0.8 ? '#fbbf24' : '#f87171';
      ctx.fillText(t > 0.8 ? 'READY' : 'FIGHT!', ARENA_W / 2, ARENA_H / 2);
    }

    if (this.winner) {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
      ctx.fillRect(0, ARENA_H / 2 - 60, ARENA_W, 120);
      ctx.font = 'bold 44px system-ui, sans-serif';
      ctx.fillStyle = this.winner === 'manager' ? '#4ade80' : '#f87171';
      const line = this.winner === 'manager' ? 'K.O. — OFFBOARDED' : 'ACCESS RETAINED';
      ctx.fillText(line, ARENA_W / 2, ARENA_H / 2 + 8);
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillStyle = '#e2e8f0';
      const victor = this.winner === 'manager' ? this.manager : this.report;
      const sub = this.winner === 'manager'
        ? `${this.report.stats.name} has been bested in single combat. Best combo: ${victor.bestCombo}.`
        : `${this.report.stats.name} keeps their job. Try again next quarter.`;
      ctx.fillText(sub, ARENA_W / 2, ARENA_H / 2 + 40);
    }
  }

  private drawBar(ctx: CanvasRenderingContext2D, f: Fighter, edgeX: number, rightAligned: boolean): void {
    const w = 340;
    const h = 18;
    const x = rightAligned ? edgeX - w : edgeX;
    const y = 24;
    const frac = f.hp / f.maxHp;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = frac > 0.5 ? '#22c55e' : frac > 0.25 ? '#eab308' : '#ef4444';
    const fillW = w * frac;
    ctx.fillRect(rightAligned ? x + w - fillW : x, y, fillW, h);

    // Armour pips
    for (let i = 0; i < f.maxArmour; i++) {
      const px = rightAligned ? x + w - 12 - i * 14 : x + i * 14;
      ctx.fillStyle = i < f.armour ? '#60a5fa' : '#1e3a8a';
      ctx.fillRect(px, y + h + 6, 10, 6);
    }

    // Charge meter while winding up a heavy.
    if (f.action === 'charge') {
      const frac2 = Math.min(1, f.chargeTime / f.chargeThreshold);
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(x, y + h + 16, w, 4);
      ctx.fillStyle = frac2 >= 1 ? '#fbbf24' : '#f97316';
      ctx.fillRect(rightAligned ? x + w - w * frac2 : x, y + h + 16, w * frac2, 4);
    }

    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = rightAligned ? 'right' : 'left';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(f.stats.name, rightAligned ? x + w : x, y + h + 36);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`${f.hp}/${f.maxHp} HP · ${f.stats.subtitle}`, rightAligned ? x + w : x, y + h + 52);

    if (f.combo >= 2) {
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`${f.combo} HIT`, rightAligned ? x + w : x, y + h + 70);
    }
  }
}

/**
 * Procedural avatar head: ISC stores no photos, so the head is generated from
 * a stable seed (email). Skin, hair, glasses and expression are all derived
 * from it, which also means the same person always looks the same.
 */
export function drawAvatar(ctx: CanvasRenderingContext2D, stats: FighterStats, r: number, hurt: boolean, angry = false): void {
  const rand = rng(hashSeed(stats.seed));
  const skins = ['#f5d0b5', '#e8b894', '#c68642', '#8d5524', '#ffdbac', '#a0673d'];
  const hairs = ['#111827', '#3f2a14', '#b45309', '#eab308', '#9ca3af', '#7c2d12', '#dc2626'];
  const skin = skins[Math.floor(rand() * skins.length)];
  const hair = hairs[Math.floor(rand() * hairs.length)];
  const hairStyle = Math.floor(rand() * 4);
  const glasses = rand() > 0.6;
  const beard = rand() > 0.7;

  // Face
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = hair;
  ctx.beginPath();
  switch (hairStyle) {
    case 0: // cap
      ctx.arc(0, -2, r, Math.PI, 0);
      break;
    case 1: // side part
      ctx.arc(0, -4, r, Math.PI * 0.95, Math.PI * 0.05);
      ctx.lineTo(r * 0.6, -r * 0.2);
      break;
    case 2: // mohawk
      ctx.rect(-4, -r - 10, 8, 14);
      break;
    default: // bald with a little fringe
      ctx.arc(0, -8, r * 0.8, Math.PI * 1.2, Math.PI * 1.8);
      break;
  }
  ctx.closePath();
  ctx.fill();

  if (beard) {
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(0, 6, r * 0.75, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.fill();
  }

  // A crown for the truly privileged.
  if (stats.privilegedCount >= 4) {
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(-14, -r + 2);
    ctx.lineTo(-14, -r - 12);
    ctx.lineTo(-7, -r - 4);
    ctx.lineTo(0, -r - 14);
    ctx.lineTo(7, -r - 4);
    ctx.lineTo(14, -r - 12);
    ctx.lineTo(14, -r + 2);
    ctx.closePath();
    ctx.fill();
  }

  // Eyebrows: angled down when angry.
  if (angry && !hurt) {
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-13, -11);
    ctx.lineTo(-4, -7);
    ctx.moveTo(13, -11);
    ctx.lineTo(4, -7);
    ctx.stroke();
  }

  // Eyes
  ctx.fillStyle = '#111827';
  if (hurt) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111827';
    for (const ex of [-8, 8]) {
      ctx.beginPath();
      ctx.moveTo(ex - 3, -5);
      ctx.lineTo(ex + 3, 1);
      ctx.moveTo(ex + 3, -5);
      ctx.lineTo(ex - 3, 1);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(-8, -3, 2.5, 0, Math.PI * 2);
    ctx.arc(8, -3, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (glasses) {
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-8, -3, 6, 0, Math.PI * 2);
    ctx.moveTo(14, -3);
    ctx.arc(8, -3, 6, 0, Math.PI * 2);
    ctx.moveTo(-2, -3);
    ctx.lineTo(2, -3);
    ctx.stroke();
  }

  // Mouth
  ctx.strokeStyle = '#7f1d1d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (hurt) {
    ctx.arc(0, 12, 5, 0, Math.PI * 2);
  } else if (angry) {
    ctx.moveTo(-7, 10);
    ctx.lineTo(7, 10);
  } else {
    ctx.arc(0, 6, 7, 0.15 * Math.PI, 0.85 * Math.PI);
  }
  ctx.stroke();

  // Initials badge so you can still tell who it is at a glance.
  const initials = stats.name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(-14, r - 4, 28, 14);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(initials, 0, r + 7);
}
