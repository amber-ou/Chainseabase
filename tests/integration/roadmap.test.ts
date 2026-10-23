import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSql } from '@/server/db';
import { api, createFeedback, expectOk, installFakes, refreshTax, resetDb, seedWorld, type World } from '../helpers/harness';

let w: World;
beforeAll(() => { installFakes(); });
beforeEach(async () => {
  await resetDb();
  w = await seedWorld();
});

const P = () => `/products/${w.productA.id}`;
const statusId = (name: string) => w.tax.statuses.find((s: any) => s.name === name).id;

async function roadmaps() {
  return expectOk(await api.get(`${P()}/roadmaps`, { as: w.teamA }));
}
async function board(id: string) {
  return expectOk(await api.get(`${P()}/roadmaps/${id}/board`, { as: w.teamA }));
}
async function fb(id: string) {
  return expectOk(await api.get(`${P()}/feedback/${id}`, { as: w.teamA }));
}
function colOf(b: any, feedbackId: string) {
  const cols = b.columns.filter((c: any) => c.cards.some((x: any) => x.id === feedbackId));
  return cols;
}
async function move(rmId: string, feedbackId: string, targetColumnId: string, opts: { before?: string | null; after?: string | null; as?: any } = {}) {
  const b = await board(rmId);
  const f = await fb(feedbackId);
  return api.post(`${P()}/roadmaps/${rmId}/moves`, {
    as: opts.as ?? w.teamA, key: true,
    body: { feedbackId, targetColumnId, beforeFeedbackId: opts.before ?? null, afterFeedbackId: opts.after ?? null, expectedFeedbackRevision: f.revision, expectedRoadmapRevision: b.roadmap.revision },
  });
}

describe('Roadmap single-dimension boards', () => {
  it('R01 default board: five status columns in order, 需求池 bound to 新貼文', async () => {
    const [def] = await roadmaps();
    expect(def.isDefault).toBe(true);
    expect(def.dimension).toBe('status');
    const b = await board(def.id);
    expect(b.columns.map((c: any) => c.label)).toEqual(['需求池', '進行中', '待討論', '已完成', '延後']);
    expect(b.columns[0].optionId).toBe(statusId('新貼文'));
  });

  it('R02 status/category/single-tag boards get one column per option (+ 未歸類 for tags), no AND/OR fields', async () => {
    const cat = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '類別', dimension: 'category' } }), 201);
    expect((await board(cat.id)).columns.map((c: any) => c.label)).toEqual(['需求討論']);
    const ver = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '版本', dimension: 'tag_group', tagGroupId: w.versionGroup } }), 201);
    const vb = await board(ver.id);
    expect(vb.columns.map((c: any) => c.label)).toEqual(['未歸類', 'v1.0', 'v1.1']);
    expect(vb.columns.filter((c: any) => c.isUnclassified)).toHaveLength(1);
    const andOr = await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: 'x', dimension: 'status', rules: [{ op: 'AND' }] } });
    expect(andOr.status).toBe(400);
  });

  it('R03 multiple groups, ungrouped tags, person tags and priority are rejected as dimensions', async () => {
    expect((await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: 'x', dimension: 'tag_group', tagGroupId: w.usageGroup } })).status).toBe(400);
    expect((await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: 'x', dimension: 'tag_group', tagGroupId: null } })).status).toBe(400);
    expect((await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: 'x', dimension: 'person_tag' } })).status).toBe(400);
    expect((await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: 'x', dimension: 'priority' } })).status).toBe(400);
    expect((await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: 'x', dimension: 'tag_group', tagGroupId: w.ptUiux } })).status).toBe(400);
  });

  it('R04 binding an option twice or changing a dimension is rejected', async () => {
    const [def] = await roadmaps();
    const r = await api.patch(`${P()}/roadmaps/${def.id}`, { as: w.teamA, body: { dimension: 'category', expectedRevision: def.revision } });
    expect(r.status).toBe(400);
    const b = await board(def.id);
    const rebind = await api.patch(`${P()}/roadmaps/${def.id}/columns/${b.columns[0].id}`, { as: w.teamA, body: { label: 'x', statusId: statusId('延後'), expectedRevision: def.revision } });
    expect(rebind.status).toBe(400);
    await expect(getSql()`insert into roadmap_columns (roadmap_id, product_id, label, status_id) values (${def.id}, ${w.productA.id}, 'dup', ${statusId('延後')})`).rejects.toThrow();
    await expect(getSql()`update roadmaps set dimension = 'category' where id = ${def.id}`).rejects.toThrow(/immutable/);
  });

  it('R05 every live feedback lands in exactly one column of every board (enumeration)', async () => {
    const ver = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '版本', dimension: 'tag_group', tagGroupId: w.versionGroup } }), 201);
    const cat = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '類別', dimension: 'category' } }), 201);
    const ids: string[] = [];
    const names = ['新貼文', '進行中', '待討論', '已完成', '延後'];
    for (let i = 0; i < 15; i++) {
      const f = await createFeedback(w, { title: `卡片 ${i}`, statusId: statusId(names[i % 5]), versionTagId: i % 3 === 0 ? null : i % 3 === 1 ? w.v10 : w.v11, tagIds: i % 2 ? [w.perf, w.ui] : [] });
      ids.push(f.id);
    }
    for (const rm of [...(await roadmaps())]) {
      const b = await board(rm.id);
      for (const id of ids) expect(colOf(b, id), `${rm.name} ${id}`).toHaveLength(1);
      expect(b.columns.reduce((s: number, c: any) => s + c.count, 0)).toBe(ids.length);
    }
    void ver; void cat;
  });

  it('R06 dragging across status columns changes only the status', async () => {
    const f = await createFeedback(w, { personTagIds: [w.ptUiux], versionTagId: w.v10, tagIds: [w.perf, w.loose], priority: 'P2' });
    const [def] = await roadmaps();
    const b = await board(def.id);
    const target = b.columns.find((c: any) => c.label === '進行中');
    expectOk(await move(def.id, f.id, target.id));
    const after = await fb(f.id);
    expect(after.status.name).toBe('進行中');
    expect(after.category).toEqual(f.category);
    expect(after.priority).toBe('P2');
    expect(after.version).toEqual(f.version);
    expect(after.tags.map((t: any) => t.id).sort()).toEqual(f.tags.map((t: any) => t.id).sort());
    expect(after.personTags).toEqual(f.personTags);
  });

  it('R07/R08 version board: moving replaces only the version tag; 未歸類 only clears it', async () => {
    const f = await createFeedback(w, { versionTagId: w.v10, tagIds: [w.perf, w.loose], statusId: statusId('待討論') });
    const ver = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '版本', dimension: 'tag_group', tagGroupId: w.versionGroup } }), 201);
    const b = await board(ver.id);
    expectOk(await move(ver.id, f.id, b.columns.find((c: any) => c.label === 'v1.1').id));
    let after = await fb(f.id);
    expect(after.version.name).toBe('v1.1');
    expect(after.tags.map((t: any) => t.name).sort()).toEqual(['v1.1', '效能', '未分組標籤'].sort());
    expectOk(await move(ver.id, f.id, b.columns.find((c: any) => c.isUnclassified).id));
    after = await fb(f.id);
    expect(after.version).toBeNull();
    expect(after.tags.map((t: any) => t.name).sort()).toEqual(['效能', '未分組標籤'].sort());
    expect(after.status.name).toBe('待討論');
    expect(after.category.name).toBe('需求討論');
  });

  it('R09 a new status/tag adds the column to every board of that dimension in the same transaction', async () => {
    const f = await createFeedback(w, {});
    const second = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '第二張狀態', dimension: 'status' } }), 201);
    const ver = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '版本', dimension: 'tag_group', tagGroupId: w.versionGroup } }), 201);
    await refreshTax(w);
    const created = expectOk(await api.post(`${P()}/statuses`, { as: w.teamA, body: { name: '測試中', expectedRevision: w.tax.productRevision } }), 201);
    await refreshTax(w);
    expectOk(await api.post(`${P()}/tags`, { as: w.teamA, body: { name: 'v2.0', groupId: w.versionGroup, expectedRevision: w.tax.productRevision } }), 201);
    const [def] = await roadmaps();
    for (const id of [def.id, second.id]) expect((await board(id)).columns.at(-1).optionId).toBe(created.option.id);
    expect((await board(ver.id)).columns.map((c: any) => c.label)).toEqual(['未歸類', 'v1.0', 'v1.1', 'v2.0']);
    expect(colOf(await board(def.id), f.id)).toHaveLength(1);
  });

  it('R10 manual reorder switches to freedom; time order is stable; freedom order survives a round trip', async () => {
    const [def] = await roadmaps();
    const a = await createFeedback(w, { title: 'A' });
    const b = await createFeedback(w, { title: 'B' });
    const c = await createFeedback(w, { title: 'C' });
    let bd = await board(def.id);
    const pool = bd.columns[0];
    expect(pool.cards.map((x: any) => x.title)).toEqual(['C', 'B', 'A']);
    const before = await fb(a.id);
    // move A to the top: before C
    expectOk(await move(def.id, a.id, pool.id, { before: c.id }));
    bd = await board(def.id);
    expect(bd.roadmap.sortMode).toBe('freedom');
    expect(bd.columns[0].cards.map((x: any) => x.title)).toEqual(['A', 'C', 'B']);
    expect((await fb(a.id)).revision).toBe(before.revision);
    // between C and B
    expectOk(await move(def.id, a.id, pool.id, { after: c.id, before: b.id }));
    expect((await board(def.id)).columns[0].cards.map((x: any) => x.title)).toEqual(['C', 'A', 'B']);
    // non-adjacent neighbours are rejected
    expect((await move(def.id, a.id, pool.id, { after: b.id, before: c.id })).status).toBe(400);
    bd = await board(def.id);
    expectOk(await api.patch(`${P()}/roadmaps/${def.id}`, { as: w.teamA, body: { sortMode: 'create_time', expectedRevision: bd.roadmap.revision } }));
    bd = await board(def.id);
    expect(bd.columns[0].cards.map((x: any) => x.title)).toEqual(['C', 'B', 'A']);
    expectOk(await api.patch(`${P()}/roadmaps/${def.id}`, { as: w.teamA, body: { sortMode: 'freedom', expectedRevision: bd.roadmap.revision } }));
    expect((await board(def.id)).columns[0].cards.map((x: any) => x.title)).toEqual(['C', 'A', 'B']);
  });

  it('R11 first freedom move initializes the full order server-side, beyond loaded pages', async () => {
    const [def] = await roadmaps();
    const created = [];
    for (let i = 0; i < 6; i++) created.push(await createFeedback(w, { title: `T${i}`, statusId: statusId('進行中') }));
    const small = expectOk(await api.get(`${P()}/roadmaps/${def.id}/board?limit=2`, { as: w.teamA }));
    const col = small.columns.find((c: any) => c.label === '進行中');
    expect(col.count).toBe(6);
    expect(col.cards).toHaveLength(2);
    const f = await fb(created[0].id);
    expectOk(await api.post(`${P()}/roadmaps/${def.id}/moves`, { as: w.teamA, key: true, body: {
      feedbackId: created[0].id, targetColumnId: col.id, beforeFeedbackId: null, afterFeedbackId: null, expectedFeedbackRevision: f.revision, expectedRoadmapRevision: small.roadmap.revision,
    } }));
    const full = await board(def.id);
    expect(full.columns.find((c: any) => c.label === '進行中').cards.map((x: any) => x.title)).toEqual(['T0', 'T5', 'T4', 'T3', 'T2', 'T1']);
    const ranks = await getSql()`select count(*)::int as c from roadmap_ranks where roadmap_id = ${def.id}`;
    expect(ranks[0].c).toBe(6);
    const page2 = await api.get(`${P()}/roadmaps/${def.id}/columns/${col.id}/feedback?limit=4&cursor=${Buffer.from('2').toString('base64url')}`, { as: w.teamA });
    expect(page2.body.data.map((x: any) => x.title)).toEqual(['T4', 'T3', 'T2', 'T1']);
  });

  it('R12 changing status in the modal moves the card on every board; stale ranks never keep it in the old column', async () => {
    const [def] = await roadmaps();
    const second = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '第二張', dimension: 'status' } }), 201);
    const a = await createFeedback(w, { title: 'A' });
    await createFeedback(w, { title: 'B', statusId: statusId('已完成') });
    // make both boards freedom with explicit ranks
    for (const id of [def.id, second.id]) {
      const b = await board(id);
      expectOk(await api.patch(`${P()}/roadmaps/${id}`, { as: w.teamA, body: { sortMode: 'freedom', expectedRevision: b.roadmap.revision } }));
    }
    const cur = await fb(a.id);
    expectOk(await api.patch(`${P()}/feedback/${a.id}`, { as: w.teamA, body: { statusId: statusId('已完成'), expectedRevision: cur.revision } }));
    for (const id of [def.id, second.id]) {
      const b = await board(id);
      const cols = colOf(b, a.id);
      expect(cols).toHaveLength(1);
      expect(cols[0].label).toBe('已完成');
      // moved card goes to the top of the target column in freedom mode
      expect(cols[0].cards[0].id).toBe(a.id);
    }
  });

  it('R13 concurrent drags of the same card: one succeeds, the other gets a visible conflict', async () => {
    const [def] = await roadmaps();
    const f = await createFeedback(w, {});
    const b = await board(def.id);
    const target1 = b.columns.find((c: any) => c.label === '進行中').id;
    const target2 = b.columns.find((c: any) => c.label === '延後').id;
    const body = (t: string) => ({ feedbackId: f.id, targetColumnId: t, beforeFeedbackId: null, afterFeedbackId: null, expectedFeedbackRevision: f.revision, expectedRoadmapRevision: b.roadmap.revision });
    const [x, y] = await Promise.all([
      api.post(`${P()}/roadmaps/${def.id}/moves`, { as: w.teamA, key: true, body: body(target1) }),
      api.post(`${P()}/roadmaps/${def.id}/moves`, { as: w.teamB, key: true, body: body(target2) }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(colOf(await board(def.id), f.id)).toHaveLength(1);
    // a corrupt row (two single-select tags) stops the drag with an explicit error
    const ver = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '版本', dimension: 'tag_group', tagGroupId: w.versionGroup } }), 201);
    await getSql().unsafe(`alter table feedback_tags disable trigger feedback_tags_single_check`);
    await getSql()`insert into feedback_tags (feedback_id, tag_id, product_id) values (${f.id}, ${w.v10}, ${w.productA.id}), (${f.id}, ${w.v11}, ${w.productA.id})`;
    await getSql().unsafe(`alter table feedback_tags enable trigger feedback_tags_single_check`);
    const vb = await api.get(`${P()}/roadmaps/${ver.id}/board`, { as: w.teamA });
    expect(vb.status).toBe(409);
    expect(vb.body.error.code).toBe('DATA_INCONSISTENCY');
  });

  it('R14 portal shows only published status boards with public cards and public counts; it is read-only', async () => {
    const [def] = await roadmaps();
    const pub = await createFeedback(w, { title: '公開卡', visibility: 'public' });
    await createFeedback(w, { title: '內部卡', visibility: 'internal' });
    const ver = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '版本', dimension: 'tag_group', tagGroupId: w.versionGroup } }), 201);
    expect((await api.get(`/public/products/${w.productA.slug}/roadmaps/${def.id}`, { site: 'portal' })).status).toBe(404);
    expect((await api.patch(`${P()}/roadmaps/${ver.id}`, { as: w.teamA, body: { portalPublished: true, expectedRevision: ver.revision } })).status).toBe(400);
    expectOk(await api.patch(`${P()}/roadmaps/${def.id}`, { as: w.teamA, body: { portalPublished: true, expectedRevision: def.revision } }));
    const list = expectOk(await api.get(`/public/products/${w.productA.slug}/roadmaps`, { site: 'portal' }));
    expect(list.map((r: any) => r.id)).toEqual([def.id]);
    const b = expectOk(await api.get(`/public/products/${w.productA.slug}/roadmaps/${def.id}`, { site: 'portal' }));
    expect(b.columns[0].count).toBe(1);
    expect(b.columns[0].cards.map((c: any) => c.title)).toEqual(['公開卡']);
    expect(JSON.stringify(b)).not.toContain('內部卡');
    expect((await api.get(`/public/products/${w.productA.slug}/roadmaps/${ver.id}`, { site: 'portal' })).status).toBe(404);
    // no write endpoint on the portal host
    const write = await api.post(`/products/${w.productA.id}/roadmaps/${def.id}/moves`, { site: 'portal', as: w.teamA, key: true, body: {} });
    expect(write.status).toBe(404);
    void pub;
  });

  it('only non-default boards can be deleted; feedback stays', async () => {
    const [def] = await roadmaps();
    const extra = expectOk(await api.post(`${P()}/roadmaps`, { as: w.teamA, body: { name: '暫時', dimension: 'category' } }), 201);
    const f = await createFeedback(w, {});
    expect((await api.del(`${P()}/roadmaps/${def.id}`, { as: w.teamA, ifMatch: def.revision })).status).toBe(403);
    expectOk(await api.del(`${P()}/roadmaps/${extra.id}`, { as: w.teamA, ifMatch: extra.revision }));
    expect((await fb(f.id)).id).toBe(f.id);
    const list = await roadmaps();
    const [p] = await getSql()`select revision from products where id = ${w.productA.id}`;
    const order = expectOk(await api.put(`${P()}/roadmaps/order`, { as: w.teamA, body: { roadmapIds: list.map((r: any) => r.id), expectedRevision: p.revision } }));
    expect(order.productRevision).toBe(p.revision + 1);
    expect((await api.put(`${P()}/roadmaps/order`, { as: w.teamA, body: { roadmapIds: [], expectedRevision: order.productRevision } })).status).toBe(400);
  });
});
