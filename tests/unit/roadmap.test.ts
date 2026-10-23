import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { columnFor, type ColumnDef, type Dimension } from '@/modules/roadmap/columns';
import { rankBetween, resolveInsertIndex, sequentialRanks } from '@/modules/roadmap/rank';

const statuses = ['s1', 's2', 's3', 's4'];
const categories = ['c1', 'c2'];
const tags = ['t1', 't2', 't3'];

function columnsFor(dim: Dimension): ColumnDef[] {
  if (dim === 'status') return statuses.map((s, i) => ({ id: `col-s${i}`, statusId: s, categoryId: null, tagId: null, isUnclassified: false }));
  if (dim === 'category') return categories.map((c, i) => ({ id: `col-c${i}`, statusId: null, categoryId: c, tagId: null, isUnclassified: false }));
  return [{ id: 'col-u', statusId: null, categoryId: null, tagId: null, isUnclassified: true }, ...tags.map((t, i) => ({ id: `col-t${i}`, statusId: null, categoryId: null, tagId: t, isUnclassified: false }))];
}

const card = fc.record({
  id: fc.uuid(),
  statusId: fc.constantFrom(...statuses),
  categoryId: fc.constantFrom(...categories),
  groupTagIds: fc.subarray(tags, { maxLength: 1 }),
});

describe('unique column function (property based)', () => {
  it('every valid card maps to exactly one column whose value matches the data (independent oracle)', () => {
    fc.assert(fc.property(card, fc.constantFrom<Dimension>('status', 'category', 'tag_group'), (c, dim) => {
      const cols = columnsFor(dim);
      const r = columnFor(c, dim, cols);
      if (!r.ok) return false;
      const col = cols.find((x) => x.id === r.columnId)!;
      // oracle written from the rule, not by calling the implementation
      if (dim === 'status') return col.statusId === c.statusId;
      if (dim === 'category') return col.categoryId === c.categoryId;
      return c.groupTagIds.length === 0 ? col.isUnclassified : col.tagId === c.groupTagIds[0];
    }));
  });
  it('corrupt data (two single-select tags) is reported instead of picking one', () => {
    expect(columnFor({ id: 'x', statusId: 's1', categoryId: 'c1', groupTagIds: ['t1', 't2'] }, 'tag_group', columnsFor('tag_group'))).toEqual({ ok: false, reason: 'multiple_single_tags' });
    expect(columnFor({ id: 'x', statusId: 'missing', categoryId: 'c1', groupTagIds: [] }, 'status', columnsFor('status'))).toEqual({ ok: false, reason: 'missing_column' });
  });
  it('a move only changes the selected dimension: simulated move keeps the other dimensions intact', () => {
    fc.assert(fc.property(card, fc.constantFrom<Dimension>('status', 'category', 'tag_group'), fc.nat(10), (c, dim, pick) => {
      const cols = columnsFor(dim);
      const target = cols[pick % cols.length];
      const moved = {
        ...c,
        statusId: dim === 'status' ? target.statusId! : c.statusId,
        categoryId: dim === 'category' ? target.categoryId! : c.categoryId,
        groupTagIds: dim === 'tag_group' ? (target.tagId ? [target.tagId] : []) : c.groupTagIds,
      };
      const r = columnFor(moved, dim, cols);
      const others = (['status', 'category', 'tag_group'] as Dimension[]).filter((d) => d !== dim);
      return r.ok && r.columnId === target.id && others.every((d) => {
        const before = columnFor(c, d, columnsFor(d));
        const after = columnFor(moved, d, columnsFor(d));
        return before.ok && after.ok && before.columnId === after.columnId;
      });
    }));
  });
});

describe('rank helpers', () => {
  it('rankBetween produces strictly ordered ranks and signals exhaustion', () => {
    expect(rankBetween(null, null)).toBe(0);
    expect(rankBetween(null, 0)).toBeLessThan(0);
    expect(rankBetween(0, null)).toBeGreaterThan(0);
    const m = rankBetween(0, 1024)!;
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1024);
    expect(rankBetween(1, 1 + 1e-7)).toBeNull();
    expect(rankBetween(5, 5)).toBeNull();
    expect(sequentialRanks(3)).toEqual([0, 1024, 2048]);
  });
  it('resolveInsertIndex follows before/after semantics and rejects non-adjacent or self neighbours', () => {
    const ids = ['a', 'b', 'c'];
    expect(resolveInsertIndex(ids, { beforeFeedbackId: null, afterFeedbackId: null }, 'x')).toBe(0);
    expect(resolveInsertIndex(ids, { beforeFeedbackId: 'b', afterFeedbackId: null }, 'x')).toBe(1);
    expect(resolveInsertIndex(ids, { beforeFeedbackId: null, afterFeedbackId: 'c' }, 'x')).toBe(3);
    expect(resolveInsertIndex(ids, { beforeFeedbackId: 'c', afterFeedbackId: 'b' }, 'x')).toBe(2);
    expect(resolveInsertIndex(ids, { beforeFeedbackId: 'b', afterFeedbackId: 'c' }, 'x')).toBe('invalid');
    expect(resolveInsertIndex(ids, { beforeFeedbackId: 'zz', afterFeedbackId: null }, 'x')).toBe('invalid');
    expect(resolveInsertIndex(ids, { beforeFeedbackId: 'x', afterFeedbackId: null }, 'x')).toBe('invalid');
  });
  it('repeated midpoint insertion keeps order until renumbering is requested (property)', () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 60 }), (sides) => {
      let lo = 0;
      let hi = 1024;
      for (const left of sides) {
        const r = rankBetween(lo, hi);
        if (r === null) return true;
        if (!(r > lo && r < hi)) return false;
        if (left) hi = r; else lo = r;
      }
      return true;
    }));
  });
});
