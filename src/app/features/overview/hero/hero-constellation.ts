/**
 * Data and motion model for the hero's "identity constellation".
 *
 * The artwork is a small graph: a set of nodes and the edges between them. Both
 * the SVG skeleton (rendered once by the template) and the drift animation
 * (driven imperatively by the component, outside Angular change detection) read
 * from this single source so the connecting lines always track their nodes.
 *
 * Coordinates live in the SVG viewBox space (600 x 320).
 */

export interface ConstellationNode {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly variant?: 'magenta' | 'teal';
}

/** An edge is a pair of indices into {@link CONSTELLATION_NODES}. */
export type ConstellationEdge = readonly [from: number, to: number];

export const CONSTELLATION_NODES: readonly ConstellationNode[] = [
  { x: 560, y: 50, r: 2.2 }, // 0
  { x: 520, y: 95, r: 1.7 }, // 1
  { x: 585, y: 120, r: 2, variant: 'magenta' }, // 2
  { x: 545, y: 160, r: 1.7 }, // 3
  { x: 590, y: 210, r: 2.2 }, // 4
  { x: 500, y: 140, r: 1.7 }, // 5
  { x: 470, y: 60, r: 1.7 }, // 6
  { x: 510, y: 235, r: 1.7 }, // 7
  { x: 460, y: 190, r: 2, variant: 'teal' }, // 8
  { x: 430, y: 110, r: 1.7 }, // 9
  { x: 440, y: 255, r: 1.5 }, // 10
  { x: 400, y: 80, r: 1.7 }, // 11
  { x: 390, y: 150, r: 1.7 }, // 12
  { x: 350, y: 210, r: 1.7 }, // 13
  { x: 330, y: 110, r: 2 }, // 14
  { x: 300, y: 170, r: 1.7 }, // 15
  { x: 360, y: 270, r: 1.5 }, // 16
  { x: 290, y: 60, r: 1.7, variant: 'magenta' }, // 17
  { x: 250, y: 120, r: 1.7 }, // 18
  { x: 240, y: 215, r: 1.5 }, // 19
  { x: 200, y: 80, r: 1.5 }, // 20
  { x: 190, y: 165, r: 1.7, variant: 'teal' }, // 21
  { x: 150, y: 230, r: 1.3 }, // 22
  { x: 140, y: 120, r: 1.5 }, // 23
  { x: 100, y: 180, r: 1.3 }, // 24
  { x: 90, y: 90, r: 1.3 }, // 25
];

export const CONSTELLATION_EDGES: readonly ConstellationEdge[] = [
  [0, 1], [0, 2], [0, 6], [0, 17],
  [1, 2], [1, 3], [1, 5], [1, 6],
  [2, 3], [2, 4],
  [3, 4], [3, 5], [3, 7], [3, 8],
  [4, 7],
  [5, 6], [5, 8], [5, 9],
  [6, 9], [6, 11], [6, 17],
  [7, 8], [7, 10],
  [8, 9], [8, 10], [8, 12], [8, 13],
  [9, 11], [9, 12],
  [10, 13], [10, 16],
  [11, 12], [11, 14], [11, 17],
  [12, 13], [12, 14], [12, 15],
  [13, 15], [13, 16], [13, 19],
  [14, 15], [14, 17], [14, 18],
  [15, 18], [15, 19],
  [16, 19], [16, 22],
  [17, 18], [17, 20], [17, 25],
  [18, 19], [18, 20], [18, 21],
  [19, 21], [19, 22],
  [20, 21], [20, 23], [20, 25],
  [21, 22], [21, 23], [21, 24],
  [22, 24],
  [23, 24], [23, 25],
  [24, 25],
];

/**
 * Per-node drift is the sum of two sine waves on each axis. Two waves with
 * different, low frequencies produce a slow, quasi-periodic wander that never
 * traces a circle or a straight line, and independent per-axis phases keep each
 * node's path distinct from its neighbours'.
 */
interface NodeMotion {
  readonly ampX1: number;
  readonly freqX1: number;
  readonly phaseX1: number;
  readonly ampX2: number;
  readonly freqX2: number;
  readonly phaseX2: number;
  readonly ampY1: number;
  readonly freqY1: number;
  readonly phaseY1: number;
  readonly ampY2: number;
  readonly freqY2: number;
  readonly phaseY2: number;
}

const TWO_PI = Math.PI * 2;

// Deterministic pseudo-random in [0, 1) seeded by node index + salt, so the
// motion is fixed per node across reloads (no reliance on Math.random).
function seeded(index: number, salt: number): number {
  const v = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function buildMotion(index: number): NodeMotion {
  // Amplitudes in viewBox units (~1.15px each once the SVG is scaled). A primary
  // wave plus a smaller, slower secondary wave give a per-axis excursion of
  // ~7-13px and a diagonal peak under 20px, so every node visibly wanders.
  const ampPrimary = (salt: number) => 4.5 + seeded(index, salt) * 3;
  const ampSecondary = (salt: number) => 2 + seeded(index, salt) * 2;
  // Low angular frequencies (rad/s): primary periods ~28-78s, secondary slower.
  const freq = (salt: number) => 0.08 + seeded(index, salt) * 0.14;
  const phase = (salt: number) => seeded(index, salt) * TWO_PI;

  return {
    ampX1: ampPrimary(1), freqX1: freq(2), phaseX1: phase(3),
    ampX2: ampSecondary(4), freqX2: freq(5) * 0.6, phaseX2: phase(6),
    ampY1: ampPrimary(7), freqY1: freq(8), phaseY1: phase(9),
    ampY2: ampSecondary(10), freqY2: freq(11) * 0.6, phaseY2: phase(12),
  };
}

/** Precomputed motion parameters, one entry per node (indexes align). */
export const NODE_MOTION: readonly NodeMotion[] = CONSTELLATION_NODES.map(
  (_, index) => buildMotion(index),
);

/** Drift offset (in viewBox units) for a node at elapsed time `t` seconds. */
export function motionOffset(
  m: NodeMotion,
  t: number,
): { dx: number; dy: number } {
  return {
    dx: m.ampX1 * Math.sin(m.freqX1 * t + m.phaseX1) +
      m.ampX2 * Math.sin(m.freqX2 * t + m.phaseX2),
    dy: m.ampY1 * Math.sin(m.freqY1 * t + m.phaseY1) +
      m.ampY2 * Math.sin(m.freqY2 * t + m.phaseY2),
  };
}

/**
 * Colour glow. A selected subset of the plain-blue nodes occasionally drifts to
 * a slightly lighter blue and back. A slow sine raised to a power spends most of
 * its time near zero (base colour) and only briefly rises toward one, so each
 * node lights up now and then rather than pulsing steadily.
 */
interface NodeGlow {
  readonly freq: number;
  readonly phase: number;
  readonly power: number;
}

// Base is $hero-blue-bright (#3d9bff); lit is ~20% lighter toward white.
const GLOW_BASE = [61, 155, 255] as const;
const GLOW_LIT = [115, 183, 255] as const;

/** Per-node glow parameters, or null for nodes that never brighten. */
export const NODE_GLOW: readonly (NodeGlow | null)[] = CONSTELLATION_NODES.map(
  (node, index) => {
    // Accent nodes keep their colour; only about half the blue nodes glow.
    if (node.variant || seeded(index, 20) < 0.5) {
      return null;
    }
    return {
      freq: 0.1 + seeded(index, 21) * 0.12, // periods ~29-63s
      phase: seeded(index, 22) * TWO_PI,
      power: 4 + Math.floor(seeded(index, 23) * 3), // 4-6: brief, occasional peaks
    };
  },
);

/**
 * Fill colour for a glowing node at elapsed time `t` seconds. `envelope` (0-1)
 * scales the glow so the effect can be eased in at startup, preventing a node
 * whose phase peaks near t=0 from snapping straight to the lit colour.
 */
export function glowFill(g: NodeGlow, t: number, envelope = 1): string {
  const s = Math.sin(g.freq * t + g.phase);
  const k = (s <= 0 ? 0 : Math.pow(s, g.power)) * envelope;
  const r = Math.round(GLOW_BASE[0] + (GLOW_LIT[0] - GLOW_BASE[0]) * k);
  const gc = Math.round(GLOW_BASE[1] + (GLOW_LIT[1] - GLOW_BASE[1]) * k);
  const b = Math.round(GLOW_BASE[2] + (GLOW_LIT[2] - GLOW_BASE[2]) * k);
  return `rgb(${r} ${gc} ${b})`;
}
