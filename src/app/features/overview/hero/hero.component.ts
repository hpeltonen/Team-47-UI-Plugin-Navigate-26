import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  inject,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import {
  CONSTELLATION_EDGES,
  CONSTELLATION_NODES,
  glowFill,
  motionOffset,
  NODE_GLOW,
  NODE_MOTION,
} from './hero-constellation';

// Cap the drift to ~30fps. The motion is slow enough that extra frames are
// imperceptible, and this halves the per-frame attribute writes.
const FRAME_INTERVAL_MS = 1000 / 30;

/**
 * Landing hero for the Overview page.
 *
 * Self-contained: inline SVG + CSS only, no third-party dependencies and no
 * external assets, so authors can delete this one component without touching
 * package.json. The connected-node "constellation" is described as data in the
 * sibling hero-constellation module; the template renders it once and this
 * component animates a slow per-node drift by writing SVG attributes directly,
 * deliberately outside Angular's change detection.
 */
@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.scss',
})
export class HeroComponent {
  protected readonly nodes = CONSTELLATION_NODES;
  protected readonly edges = CONSTELLATION_EDGES;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      // Honour the OS "reduce motion" setting: leave the static skeleton as-is.
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
      }

      const root = this.host.nativeElement;
      const circles = Array.from(
        root.querySelectorAll<SVGCircleElement>('.c-nodes circle'),
      );
      const lines = Array.from(
        root.querySelectorAll<SVGLineElement>('.c-edges line'),
      );
      if (!circles.length) {
        return;
      }

      const offsetX = new Array<number>(this.nodes.length);
      const offsetY = new Array<number>(this.nodes.length);
      let handle = 0;
      let last = 0;
      let start = 0;

      const tick = (now: number) => {
        handle = requestAnimationFrame(tick);
        if (now - last < FRAME_INTERVAL_MS) {
          return;
        }
        last = now;
        if (!start) {
          start = now;
        }
        const t = (now - start) / 1000;
        // Ease motion and glow in over the first ~2.5s (smoothstep) so nothing
        // snaps away from the statically rendered skeleton on the first frame.
        const ramp = Math.min(t / 2.5, 1);
        const eased = ramp * ramp * (3 - 2 * ramp);

        for (let i = 0; i < this.nodes.length; i++) {
          const { dx, dy } = motionOffset(NODE_MOTION[i], t);
          offsetX[i] = dx * eased;
          offsetY[i] = dy * eased;
          const circle = circles[i];
          circle.setAttribute('cx', (this.nodes[i].x + offsetX[i]).toFixed(2));
          circle.setAttribute('cy', (this.nodes[i].y + offsetY[i]).toFixed(2));

          const glow = NODE_GLOW[i];
          if (glow) {
            circle.style.fill = glowFill(glow, t, eased);
          }
        }

        for (let e = 0; e < this.edges.length; e++) {
          const [a, b] = this.edges[e];
          const line = lines[e];
          line.setAttribute('x1', (this.nodes[a].x + offsetX[a]).toFixed(2));
          line.setAttribute('y1', (this.nodes[a].y + offsetY[a]).toFixed(2));
          line.setAttribute('x2', (this.nodes[b].x + offsetX[b]).toFixed(2));
          line.setAttribute('y2', (this.nodes[b].y + offsetY[b]).toFixed(2));
        }
      };

      handle = requestAnimationFrame(tick);
      destroyRef.onDestroy(() => cancelAnimationFrame(handle));
    });
  }
}
