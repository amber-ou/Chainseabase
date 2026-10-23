/** Rank helpers for freedom ordering (ascending rank = top first). */

export const RANK_STEP = 1024;

/**
 * Rank for an item placed between `above` (the item that will precede it) and
 * `below` (the item that will follow it). null means no neighbour on that side.
 * Returns null when the gap is exhausted and the column must be renumbered.
 */
export function rankBetween(above: number | null, below: number | null): number | null {
  if (above === null && below === null) return 0;
  if (above === null) return (below as number) - RANK_STEP;
  if (below === null) return above + RANK_STEP;
  if (below <= above) return null;
  const mid = (above + below) / 2;
  if (mid - above < 1e-6 || below - mid < 1e-6) return null;
  return mid;
}

/** Ranks for a full ordered list. */
export function sequentialRanks(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i * RANK_STEP);
}

export interface PlacementInput { beforeFeedbackId: string | null; afterFeedbackId: string | null }

/**
 * Resolve the insertion index in `orderedIds` (moved item already excluded).
 * before = the moved card goes immediately before that card;
 * after  = the moved card goes immediately after that card;
 * both null = top of the column. Clients send the pair that was adjacent in their view;
 * if other cards landed between them since, the drop still means "between the two"
 * and goes right after `after`. A pair that is no longer in that order is invalid.
 */
export function resolveInsertIndex(orderedIds: string[], p: PlacementInput, movedId: string): number | 'invalid' {
  if (p.beforeFeedbackId === movedId || p.afterFeedbackId === movedId) return 'invalid';
  const bi = p.beforeFeedbackId ? orderedIds.indexOf(p.beforeFeedbackId) : -1;
  const ai = p.afterFeedbackId ? orderedIds.indexOf(p.afterFeedbackId) : -1;
  if (p.beforeFeedbackId && bi < 0) return 'invalid';
  if (p.afterFeedbackId && ai < 0) return 'invalid';
  if (p.beforeFeedbackId && p.afterFeedbackId) return ai < bi ? ai + 1 : 'invalid';
  if (p.beforeFeedbackId) return bi;
  if (p.afterFeedbackId) return ai + 1;
  return 0;
}
