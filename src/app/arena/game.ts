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
  /** Weapon. Privileged access swings a longer, harder weapon. */
  privilegedCount: number;
  /** Minions for the manager. Each direct report is a tiny helper. */
  directReports: number;
  /** Label under the health bar. */
  subtitle: string;
}

export type FighterAction = 'idle' | 'walk' | 'punch' | 'block' | 'hit' | 'down' | 'win';
export type Side = 'left' | 'right';

export interface Input {
  left: boolean;
  right: boolean;
  punch: boolean;
  block: boolean;
}

export interface Fighter {
  stats: FighterStats;
  side: Side;
  x: number;
  y: number;
  vx: number;
  facing: 1 | -1;
  action: FighterAction;
  /** Seconds remaining in the current timed action. */
  actionTimer: number;
  /** Set once per punch when the hit frame has been applied. */
  punchLanded: boolean;
  hp: number;
  maxHp: number;
  armour: number;
  maxArmour: number;
  reach: number;
  damage: number;
  /** Walk cycle phase. */
  phase: number;
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
}

export type Outcome = 'manager' | 'report' | null;

export interface GameEvents {
  onHit(target: Side, amount: number, armour: boolean): void;
  onEnd(winner: Outcome): void;
}

export const ARENA_W = 960;
export const ARENA_H = 420;
const FLOOR_Y = ARENA_H - 60;
const WALK_SPEED = 260;
const PUNCH_TIME = 0.32;
const PUNCH_HIT_AT = 0.14;
const HIT_STUN = 0.35;
const BLOCK_DAMAGE_MULT = 0.2;
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
    facing: side === 'left' ? 1 : -1,
    action: 'idle',
    actionTimer: 0,
    punchLanded: false,
    hp: maxHp,
    maxHp,
    armour,
    maxArmour: armour,
    reach,
    damage,
    phase: 0,
    thinkTimer: 0,
    plan: 'approach',
  };
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
  private ended = false;

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
    if (this.introTimer > 0) {
      this.introTimer -= dt;
      this.updateParticles(dt);
      return;
    }
    if (this.ended) {
      this.updateParticles(dt);
      this.updateMinions(dt);
      this.shake = Math.max(0, this.shake - dt * 20);
      return;
    }

    this.timeLeft -= dt;
    this.applyInput(this.manager, input, dt);
    this.applyInput(this.report, this.botInput(dt), dt);

    this.move(this.manager, dt);
    this.move(this.report, dt);
    this.separate();

    this.resolvePunch(this.manager, this.report);
    this.resolvePunch(this.report, this.manager);

    this.updateMinions(dt);
    this.updateParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 20);

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
    this.burst(loser.x, loser.y - 90, 40, '#f59e0b');
    this.events.onEnd(winner);
  }

  private applyInput(f: Fighter, input: Input, dt: number): void {
    if (f.actionTimer > 0) {
      f.actionTimer -= dt;
      if (f.actionTimer <= 0) {
        f.action = 'idle';
        f.actionTimer = 0;
      }
    }
    const busy = f.action === 'punch' || f.action === 'hit';
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
      f.action = 'punch';
      f.actionTimer = PUNCH_TIME;
      f.punchLanded = false;
      f.vx = 0;
      return;
    }

    f.vx = 0;
    if (input.left) f.vx -= WALK_SPEED;
    if (input.right) f.vx += WALK_SPEED;
    f.action = f.vx !== 0 ? 'walk' : 'idle';
  }

  private move(f: Fighter, dt: number): void {
    f.x += f.vx * dt;
    f.x = Math.max(40, Math.min(ARENA_W - 40, f.x));
    if (f.action === 'walk') {
      f.phase += dt * 10;
    }
    const other = f === this.manager ? this.report : this.manager;
    f.facing = other.x >= f.x ? 1 : -1;
  }

  /** Keep the two bodies from overlapping. */
  private separate(): void {
    const minGap = 36;
    const gap = Math.abs(this.manager.x - this.report.x);
    if (gap < minGap) {
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

  private resolvePunch(attacker: Fighter, target: Fighter): void {
    if (attacker.action !== 'punch' || attacker.punchLanded) {
      return;
    }
    const elapsed = PUNCH_TIME - attacker.actionTimer;
    if (elapsed < PUNCH_HIT_AT) {
      return;
    }
    attacker.punchLanded = true;

    const dist = Math.abs(target.x - attacker.x);
    const inFront = Math.sign(target.x - attacker.x) === attacker.facing;
    if (!inFront || dist > attacker.reach + 20) {
      return;
    }

    let amount = attacker.damage;
    const blocked = target.action === 'block' && target.facing === -attacker.facing;
    if (blocked) {
      amount = Math.max(1, Math.round(amount * BLOCK_DAMAGE_MULT));
    }

    if (target.armour > 0 && !blocked) {
      target.armour -= 1;
      this.events.onHit(target.side, 0, true);
      this.spawnText(target.x, target.y - 120, 'ROLE ABSORBED', '#60a5fa');
      this.burst(target.x, target.y - 80, 8, '#60a5fa');
    } else {
      target.hp = Math.max(0, target.hp - amount);
      this.events.onHit(target.side, amount, false);
      this.spawnText(target.x, target.y - 120, `-${amount}`, blocked ? '#9ca3af' : '#ef4444');
      this.burst(target.x, target.y - 80, blocked ? 4 : 12, blocked ? '#9ca3af' : '#ef4444');
      this.shake = blocked ? 2 : 6;
    }

    if (!blocked) {
      target.action = 'hit';
      target.actionTimer = HIT_STUN;
      target.x += attacker.facing * 18;
    }
  }

  /** The report's brain: approach, poke, occasionally block, occasionally back off. */
  private botInput(dt: number): Input {
    const bot = this.report;
    const me = this.manager;
    const none: Input = { left: false, right: false, punch: false, block: false };
    bot.thinkTimer -= dt;
    const dist = Math.abs(me.x - bot.x);
    const towards = me.x > bot.x ? 'right' : 'left';
    const away = towards === 'right' ? 'left' : 'right';

    if (bot.thinkTimer <= 0) {
      bot.thinkTimer = 0.25 + Math.random() * 0.45;
      const roll = Math.random();
      // A bot with privileged access is bolder; a plain intern hangs back more.
      const aggression = 0.5 + Math.min(0.35, bot.stats.privilegedCount * 0.05);
      bot.plan = roll < aggression ? 'approach' : roll < aggression + 0.25 ? 'wait' : 'retreat';
    }

    // Block when the player is winding up in range.
    if (me.action === 'punch' && dist < me.reach + 30 && Math.random() < 0.6) {
      return { ...none, block: true };
    }

    if (dist <= bot.reach - 4 && bot.action !== 'punch' && Math.random() < 0.08) {
      return { ...none, punch: true };
    }

    switch (bot.plan) {
      case 'approach':
        return dist > bot.reach - 10 ? { ...none, [towards]: true } : none;
      case 'retreat':
        return dist < 180 ? { ...none, [away]: true } : none;
      default:
        return none;
    }
  }

  private updateMinions(dt: number): void {
    const target = this.report.x - this.report.facing * -30;
    for (const m of this.minions) {
      if (this.ended) {
        m.vx = 0;
        continue;
      }
      // They jog toward the report, bump them, then scurry back.
      const goal = this.manager.action === 'punch' ? target : 40 + this.minions.indexOf(m) * 18;
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

  // ───────────────────────────── Drawing ─────────────────────────────

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    this.drawBackground(ctx);
    for (const m of this.minions) this.drawMinion(ctx, m);
    this.drawFighter(ctx, this.manager);
    this.drawFighter(ctx, this.report);
    this.drawParticles(ctx);
    ctx.restore();
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
    const hipY = -60 - bob;
    const shoulderY = -105 - bob;
    const headY = -128 - bob;

    // Legs
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(-14 + walk * 14, -30 - bob);
    ctx.lineTo(-18 + walk * 18, 0);
    ctx.moveTo(0, hipY);
    ctx.lineTo(14 - walk * 14, -30 - bob);
    ctx.lineTo(18 - walk * 18, 0);
    ctx.stroke();

    // Torso
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(0, shoulderY);
    ctx.stroke();

    // Arms
    ctx.beginPath();
    if (f.action === 'punch') {
      const t = 1 - f.actionTimer / PUNCH_TIME;
      const ext = Math.sin(Math.min(1, t * 1.6) * Math.PI) * f.reach;
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(ext * 0.5, shoulderY + 2);
      ctx.lineTo(ext, shoulderY);
      ctx.moveTo(0, shoulderY + 4);
      ctx.lineTo(-16, shoulderY + 24);
      ctx.lineTo(-6, shoulderY + 40);
      ctx.stroke();
      // Weapon: scales with privileged access.
      this.drawWeapon(ctx, f, ext, shoulderY);
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
    ctx.save();
    ctx.translate(0, headY);
    ctx.scale(f.facing, 1);
    drawAvatar(ctx, f.stats, 24, f.action === 'hit' || down);
    ctx.restore();

    ctx.restore();
  }

  private drawWeapon(ctx: CanvasRenderingContext2D, f: Fighter, ext: number, shoulderY: number): void {
    const priv = f.stats.privilegedCount;
    ctx.save();
    ctx.translate(ext, shoulderY);
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
        ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
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
      const sub = this.winner === 'manager'
        ? `${this.report.stats.name} has been bested in single combat.`
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

    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = rightAligned ? 'right' : 'left';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(f.stats.name, rightAligned ? x + w : x, y + h + 30);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`${f.hp}/${f.maxHp} HP · ${f.stats.subtitle}`, rightAligned ? x + w : x, y + h + 46);
  }
}

/**
 * Procedural avatar head: ISC stores no photos, so the head is generated from
 * a stable seed (email). Skin, hair, glasses and expression are all derived
 * from it, which also means the same person always looks the same.
 */
export function drawAvatar(ctx: CanvasRenderingContext2D, stats: FighterStats, r: number, hurt: boolean): void {
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
