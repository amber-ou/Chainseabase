import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSql } from '@/server/db';
import { api, createFeedback, expectOk, installFakes, resetDb, seedWorld, type World } from '../helpers/harness';

/**
 * Shared Feedback views (2026-11-10, LIST-01..15; migration 0008): persistence and sharing within one
 * product's team, product isolation, live membership (one Feedback in several views, leaving a view when
 * it no longer matches), manual row order per view (never across views), concurrency (stale revisions
 * refused, nothing changed) and removing a view never touching Feedback.
 */
let w: World;
beforeAll(() => { installFakes(); });
beforeEach(async () => { await resetDb(); w = await seedWorld(); });

const P = () => `/products/${w.productA.id}`;
const tax = async () => expectOk(await api.get(`${P()}/taxonomy`, { as: w.teamA }));
const views = async (as = w.teamA) => expectOk(await api.get(`${P()}/feedback-views`, { as }));
const items = async (viewId: string, query = '') => {
  const r = await api.get(`${P()}/feedback-views/${viewId}/items?limit=50${query}`, { as: w.teamA });
  return { titles: expectOk(r).map((f: { title: string }) => f.title) as string[], total: r.body.meta.total as number };
};
async function tagNamed(name: string) {
  const t = await tax();
  return expectOk(await api.post(`${P()}/tags`, { as: w.teamA, body: { name, groupId: null, expectedRevision: t.productRevision } }), 201).tag.id as string;
}

describe('LIST-02/06 the first view and shared persistence', () => {
  it('makes the 新貼文 view once (by the default status ID), shared by the team; a removed view is not added back', async () => {
    const a = await views();
    expect(a.views).toHaveLength(1);
    const t = await tax();
    const def = t.statuses.find((s: { isDefault: boolean }) => s.isDefault);
    expect(a.views[0]).toMatchObject({ kind: 'status', optionId: def.id, label: def.name, color: 'blue', sortMode: 'created' });
    // another team member sees the same view; visiting again creates nothing
    const b = await views(w.teamB);
    expect(b.views.map((v: { id: string }) => v.id)).toEqual(a.views.map((v: { id: string }) => v.id));
    await Promise.all([views(), views(w.teamB), views()]);
    expect((await getSql()`select count(*)::int as n from feedback_views where product_id = ${w.productA.id}`)[0].n).toBe(1);
    // removed: gone for everyone, and not re-created on the next visit
    const cur = await views();
    expectOk(await api.del(`${P()}/feedback-views/${cur.views[0].id}`, { as: w.teamA, ifMatch: cur.revision }));
    expect((await views(w.teamB)).views).toEqual([]);
    expect((await views()).views).toEqual([]);
  });

  it('views belong to their product and team: testers, outsiders and other products get nothing', async () => {
    const a = await views();
    expect((await api.get(`${P()}/feedback-views`, { as: w.tester })).status).toBe(403);
    expect((await api.get(`${P()}/feedback-views`, { as: w.outsider })).status).toBe(403);
    expect((await api.get(`${P()}/feedback-views`, { as: w.tester, site: 'portal' })).status).toBe(404);
    const viewId = a.views[0].id;
    // the same id under another product: not found (and nothing changed)
    const B = `/products/${w.productB.id}`;
    const bViews = expectOk(await api.get(`${B}/feedback-views`, { as: w.teamA }));
    expect(bViews.views.map((v: { id: string }) => v.id)).not.toContain(viewId);
    expect((await api.get(`${B}/feedback-views/${viewId}/items?limit=10`, { as: w.teamA })).status).toBe(404);
    expect((await api.del(`${B}/feedback-views/${viewId}`, { as: w.teamA, ifMatch: bViews.revision })).status).toBe(404);
    expect((await views()).views).toHaveLength(1);
    // another product's option cannot be used here
    const bTax = expectOk(await api.get(`${B}/taxonomy`, { as: w.teamA }));
    expect((await api.post(`${P()}/feedback-views`, { as: w.teamA, body: { kind: 'status', optionId: bTax.statuses[1].id, expectedRevision: a.revision } })).status).toBe(400);
  });
});

describe('LIST-05/07/14 membership follows the live Feedback', () => {
  it('one Feedback in several views; an edit moves it out of a view at once; search and filters intersect', async () => {
    const t = await tax();
    const uiux = await tagNamed('UIUX');
    const a = await views();
    const newView = a.views[0].id;
    const tagView = expectOk(await api.post(`${P()}/feedback-views`, { as: w.teamA, body: { kind: 'tag', optionId: uiux, expectedRevision: a.revision } }), 201);
    expect(tagView.view).toMatchObject({ kind: 'tag', label: 'UIUX', color: 'sand' });
    const both = await createFeedback(w, { title: '兩邊都有', tagIds: [uiux] });
    await createFeedback(w, { title: '只有新貼文' });
    expect((await items(newView)).titles).toEqual(['只有新貼文', '兩邊都有']); // newest first
    expect((await items(tagView.view.id)).titles).toEqual(['兩邊都有']);
    // search intersects with the view's own condition (the view's stored condition is unchanged)
    expect(await items(newView, `&q=${encodeURIComponent('兩邊')}`)).toEqual({ titles: ['兩邊都有'], total: 1 });
    // a status change elsewhere: out of 新貼文, still in UIUX
    const other = t.statuses.find((s: { isDefault: boolean }) => !s.isDefault);
    const cur = expectOk(await api.get(`${P()}/feedback/${both.id}`, { as: w.teamA }));
    expectOk(await api.patch(`${P()}/feedback/${both.id}`, { as: w.teamA, body: { statusId: other.id, expectedRevision: cur.revision } }));
    expect((await items(newView)).titles).toEqual(['只有新貼文']);
    expect((await items(tagView.view.id)).titles).toEqual(['兩邊都有']);
    // a deleted Feedback leaves every view
    const c2 = expectOk(await api.get(`${P()}/feedback/${both.id}`, { as: w.teamA }));
    expectOk(await api.del(`${P()}/feedback/${both.id}`, { as: w.teamA, ifMatch: c2.revision }));
    expect((await items(tagView.view.id)).titles).toEqual([]);
  });

  it('duplicate conditions and stale revisions are refused; deleting the tag removes its view, not Feedback', async () => {
    const uiux = await tagNamed('設計');
    const a = await views();
    const body = { kind: 'tag', optionId: uiux, expectedRevision: a.revision };
    const created = expectOk(await api.post(`${P()}/feedback-views`, { as: w.teamA, body }), 201);
    // the same list revision again: refused, nothing added
    expect((await api.post(`${P()}/feedback-views`, { as: w.teamB, body: { ...body, kind: 'status', optionId: a.views[0].optionId } })).status).toBe(409);
    expect((await api.post(`${P()}/feedback-views`, { as: w.teamA, body: { ...body, expectedRevision: created.revision } })).status).toBe(400);
    const f = await createFeedback(w, { title: '有標籤', tagIds: [uiux] });
    const t = await tax();
    expectOk(await api.del(`${P()}/tags/${uiux}`, { as: w.teamA, body: { strategy: 'detach', expectedRevision: t.productRevision } }));
    const after = await views();
    expect(after.views.map((v: { id: string }) => v.id)).not.toContain(created.view.id);
    expect((await api.get(`${P()}/feedback/${f.id}`, { as: w.teamA })).status).toBe(200);
  });
});

describe('LIST-08/09 removing and ordering views', () => {
  it('removing a view only removes the view and its order; the Feedback keep their status and tags', async () => {
    const uiux = await tagNamed('留存');
    const a = await views();
    const v = expectOk(await api.post(`${P()}/feedback-views`, { as: w.teamA, body: { kind: 'tag', optionId: uiux, expectedRevision: a.revision } }), 201);
    const f1 = await createFeedback(w, { title: '甲', tagIds: [uiux] });
    const f2 = await createFeedback(w, { title: '乙', tagIds: [uiux] });
    const tv = (await views()).views.find((x: { id: string }) => x.id === v.view.id);
    expectOk(await api.post(`${P()}/feedback-views/${v.view.id}/move`, { as: w.teamA, body: { feedbackId: f1.id, beforeId: f2.id, expectedRevision: tv.revision } }));
    const before = (await getSql()`select id, status_id, revision from feedback where product_id = ${w.productA.id} order by id`);
    const cur = await views();
    expectOk(await api.del(`${P()}/feedback-views/${v.view.id}`, { as: w.teamA, ifMatch: cur.revision }));
    expect(await getSql()`select id, status_id, revision from feedback where product_id = ${w.productA.id} order by id`).toEqual(before);
    expect((await getSql()`select count(*)::int as n from feedback_tags where tag_id = ${uiux}`)[0].n).toBe(2);
    expect((await getSql()`select count(*)::int as n from feedback_view_ranks where view_id = ${v.view.id}`)[0].n).toBe(0);
    // a stale If-Match removes nothing
    const now = await views();
    expect((await api.del(`${P()}/feedback-views/${now.views[0].id}`, { as: w.teamA, ifMatch: now.revision - 1 })).status).toBe(409);
    expect((await views()).views).toHaveLength(1);
  });

  it('reorders views for everyone; a stale or incomplete order is refused', async () => {
    const tagA = await tagNamed('A');
    const a = await views();
    const v = expectOk(await api.post(`${P()}/feedback-views`, { as: w.teamA, body: { kind: 'tag', optionId: tagA, expectedRevision: a.revision } }), 201);
    const ids = v.views.map((x: { id: string }) => x.id);
    const reversed = [...ids].reverse();
    expect((await api.put(`${P()}/feedback-views/order`, { as: w.teamA, body: { viewIds: reversed, expectedRevision: a.revision } })).status).toBe(409);
    expect((await api.put(`${P()}/feedback-views/order`, { as: w.teamA, body: { viewIds: [ids[0]], expectedRevision: v.revision } })).status).toBe(400);
    expectOk(await api.put(`${P()}/feedback-views/order`, { as: w.teamA, body: { viewIds: reversed, expectedRevision: v.revision } }));
    expect((await views(w.teamB)).views.map((x: { id: string }) => x.id)).toEqual(reversed);
  });
});

describe('LIST-10/11 manual order within one view', () => {
  it('moves within a view only; other views keep their order; back to creation time drops the manual order', async () => {
    const tagX = await tagNamed('X');
    const a = await views();
    const newView = a.views[0];
    const tv = expectOk(await api.post(`${P()}/feedback-views`, { as: w.teamA, body: { kind: 'tag', optionId: tagX, expectedRevision: a.revision } }), 201).view;
    const one = await createFeedback(w, { title: '一', tagIds: [tagX] });
    const two = await createFeedback(w, { title: '二', tagIds: [tagX] });
    const three = await createFeedback(w, { title: '三' });
    expect((await items(newView.id)).titles).toEqual(['三', '二', '一']);
    // move 一 to the top of 新貼文
    const moved = expectOk(await api.post(`${P()}/feedback-views/${newView.id}/move`, { as: w.teamA, body: { feedbackId: one.id, beforeId: three.id, expectedRevision: newView.revision } }));
    expect(moved.sortMode).toBe('manual');
    expect((await items(newView.id)).titles).toEqual(['一', '三', '二']);
    // the other view is unchanged
    expect((await items(tv.id)).titles).toEqual(['二', '一']);
    // a Feedback that is not in the view cannot be moved into it (no cross-table move), nor placed by an outside row
    expect((await api.post(`${P()}/feedback-views/${tv.id}/move`, { as: w.teamA, body: { feedbackId: three.id, beforeId: null, expectedRevision: tv.revision } })).status).toBe(400);
    expect((await api.post(`${P()}/feedback-views/${tv.id}/move`, { as: w.teamA, body: { feedbackId: one.id, beforeId: three.id, expectedRevision: tv.revision } })).status).toBe(400);
    // a stale view revision is refused and changes nothing
    expect((await api.post(`${P()}/feedback-views/${newView.id}/move`, { as: w.teamB, body: { feedbackId: two.id, beforeId: one.id, expectedRevision: newView.revision } })).status).toBe(409);
    expect((await items(newView.id)).titles).toEqual(['一', '三', '二']);
    // a newer Feedback comes first in a manual view; then back to creation time, newest first
    await createFeedback(w, { title: '四' });
    expect((await items(newView.id)).titles).toEqual(['四', '一', '三', '二']);
    expectOk(await api.put(`${P()}/feedback-views/${newView.id}/sort`, { as: w.teamA, body: { mode: 'created', expectedRevision: moved.revision } }));
    expect((await items(newView.id)).titles).toEqual(['四', '三', '二', '一']);
    expect((await views()).views[0].sortMode).toBe('created');
  });

  it('a move under a search keeps the rows that are not shown, and pages count every match', async () => {
    const a = await views();
    const v = a.views[0];
    const made = [];
    for (const t of ['蘋果一', '香蕉', '蘋果二', '橘子']) made.push(await createFeedback(w, { title: t }));
    // with a search for 蘋果 only two are shown; moving one keeps 香蕉 and 橘子 in the view
    expectOk(await api.post(`${P()}/feedback-views/${v.id}/move`, { as: w.teamA, body: { feedbackId: made[0].id, beforeId: made[2].id, expectedRevision: v.revision } }));
    expect((await items(v.id, `&q=${encodeURIComponent('蘋果')}`)).titles).toEqual(['蘋果一', '蘋果二']);
    expect((await items(v.id)).titles).toEqual(['橘子', '蘋果一', '蘋果二', '香蕉']);
    const page = await api.get(`${P()}/feedback-views/${v.id}/items?limit=2`, { as: w.teamA });
    expect(page.body.meta).toMatchObject({ total: 4, nextCursor: '2' });
    const next = await api.get(`${P()}/feedback-views/${v.id}/items?limit=2&cursor=2`, { as: w.teamA });
    expect(expectOk(next).map((f: { title: string }) => f.title)).toEqual(['蘋果二', '香蕉']);
  });
});
