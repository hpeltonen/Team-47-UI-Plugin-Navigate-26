import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ARENA_H, ARENA_W, ArenaGame, NO_INPUT, type FighterStats, type Input, type Outcome } from './game';
import { Sfx } from './sfx';

/**
 * Canvas host for the arena. Owns the requestAnimationFrame loop and the
 * keyboard, both of which run outside Angular's zone so sixty frames a second
 * never trigger change detection. Only the outcome crosses back into Angular.
 */
@Component({
  selector: 'app-arena',
  template: `
    <div class="arena">
      <canvas
        #canvas
        [width]="w"
        [height]="h"
        tabindex="0"
        aria-label="Access Arena. Arrow keys move, up jumps, space punches or kicks in the air, hold space for a heavy, shift blocks."
      ></canvas>
      <div class="arena__controls">
        <span><kbd>←</kbd> <kbd>→</kbd> move</span>
        <span><kbd>↑</kbd> jump</span>
        <span><kbd>Space</kbd> punch · in the air: kick · hold: heavy</span>
        <span><kbd>Shift</kbd> block</span>
        <button type="button" class="arena__mute" (click)="toggleMute()">{{ muted() ? 'Sound off' : 'Sound on' }}</button>
        @if (!focused()) {
          <span class="arena__focus-hint">Click the arena to take control</span>
        }
      </div>
    </div>
  `,
  styles: `
    .arena {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    canvas {
      width: 100%;
      max-width: ${ARENA_W}px;
      aspect-ratio: ${ARENA_W} / ${ARENA_H};
      border-radius: 12px;
      outline: 3px solid transparent;
      cursor: crosshair;
      background: #0f172a;
    }
    canvas:focus {
      outline-color: #38bdf8;
    }
    .arena__controls {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      color: var(--spds-text-muted-color);
      font-size: 0.9rem;
    }
    .arena__mute {
      margin-left: auto;
      padding: 0.1rem 0.6rem;
      border: 1px solid var(--spds-content-border-color);
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 0.85em;
      cursor: pointer;
    }
    .arena__focus-hint {
      color: #f59e0b;
      font-weight: 600;
    }
    kbd {
      display: inline-block;
      padding: 0.05rem 0.4rem;
      border: 1px solid var(--spds-content-border-color);
      border-bottom-width: 2px;
      border-radius: 4px;
      font-family: inherit;
      font-size: 0.85em;
    }
  `,
})
export class ArenaComponent implements AfterViewInit, OnDestroy {
  readonly manager = input.required<FighterStats>();
  readonly report = input.required<FighterStats>();
  /** Fires once, when the round ends. */
  readonly ended = output<Outcome>();

  protected readonly w = ARENA_W;
  protected readonly h = ARENA_H;
  protected readonly focused = signal(false);
  protected readonly muted = signal(false);
  private readonly sfx = new Sfx();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private game: ArenaGame | null = null;
  private raf = 0;
  private last = 0;
  private readonly keys: Input = { ...NO_INPUT };
  private punchQueued = false;
  private jumpQueued = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly zone: NgZone) {
    // Restart whenever the fighters change (a rematch with new stats).
    effect(() => {
      const m = this.manager();
      const r = this.report();
      if (this.canvasReady) {
        this.start(m, r);
      }
    });
  }

  private canvasReady = false;

  ngAfterViewInit(): void {
    this.canvasReady = true;
    const el = this.canvas().nativeElement;
    el.focus();
    this.start(this.manager(), this.report());
  }

  ngOnDestroy(): void {
    this.stop();
  }

  protected toggleMute(): void {
    this.muted.update((m) => !m);
    this.sfx.muted = this.muted();
    if (!this.sfx.muted) this.sfx.unlock();
    this.canvas().nativeElement.focus();
  }

  private start(manager: FighterStats, report: FighterStats): void {
    this.stop();
    const el = this.canvas().nativeElement;
    const ctx = el.getContext('2d');
    if (!ctx) {
      return;
    }

    this.game = new ArenaGame(manager, report, {
      onHit: () => {},
      onEnd: (winner) => this.zone.run(() => this.ended.emit(winner)),
      onSound: (name) => this.sfx.play(name),
    });

    this.zone.runOutsideAngular(() => {
      const onKey = (down: boolean) => (ev: KeyboardEvent) => {
        if (document.activeElement !== el) {
          return;
        }
        if (down) this.sfx.unlock();
        let handled = true;
        switch (ev.key) {
          case 'ArrowLeft':
          case 'a':
          case 'A':
            this.keys.left = down;
            break;
          case 'ArrowRight':
          case 'd':
          case 'D':
            this.keys.right = down;
            break;
          case 'ArrowUp':
          case 'w':
          case 'W':
            if (down && !ev.repeat) this.jumpQueued = true;
            break;
          case ' ':
          case 'j':
          case 'J':
            if (down && !ev.repeat) this.punchQueued = true;
            this.keys.punchHeld = down;
            break;
          case 'Shift':
          case 'k':
          case 'K':
            this.keys.block = down;
            break;
          default:
            handled = false;
        }
        if (handled) {
          ev.preventDefault();
        }
      };
      const keydown = onKey(true);
      const keyup = onKey(false);
      const onFocus = () => {
        this.sfx.unlock();
        this.zone.run(() => this.focused.set(true));
      };
      const onBlur = () => {
        this.keys.left = this.keys.right = this.keys.block = this.keys.punchHeld = false;
        this.zone.run(() => this.focused.set(false));
      };
      window.addEventListener('keydown', keydown);
      window.addEventListener('keyup', keyup);
      el.addEventListener('focus', onFocus);
      el.addEventListener('blur', onBlur);
      this.cleanups.push(
        () => window.removeEventListener('keydown', keydown),
        () => window.removeEventListener('keyup', keyup),
        () => el.removeEventListener('focus', onFocus),
        () => el.removeEventListener('blur', onBlur),
      );
      if (document.activeElement === el) {
        this.zone.run(() => this.focused.set(true));
      }

      this.last = performance.now();
      const frame = (now: number) => {
        const dt = (now - this.last) / 1000;
        this.last = now;
        const game = this.game;
        if (!game) {
          return;
        }
        const input: Input = { ...this.keys, punch: this.punchQueued, up: this.jumpQueued };
        this.punchQueued = false;
        this.jumpQueued = false;
        game.step(dt, input);
        game.draw(ctx);
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    });
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.game = null;
    for (const c of this.cleanups.splice(0)) c();
  }
}
