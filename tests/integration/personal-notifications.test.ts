import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSql } from '@/server/db';
import { api, createFeedback, expectOk, installFakes, makeUser, refreshTax, resetDb, runJobs, seedWorld, type World } from '../helpers/harness';

let w: World;
beforeAll(() => { installFakes(); });
beforeEach(async () => {
  await resetDb();
  w = await seedWorld();
});

const P = () => `/products/${w.productA.id}`;

async function view(as = w.teamA, subject = as) {
  return expectOk(await api.post(`${P()}/personal/views`, { as, body: { subjectUserId: subject.id } }));
}
function titles(v: any) {
  return v.columns.map((c: any) => [c.name, c.cards.map((x: any) => x.title)]);
}
async function snapshot(id: string) {
  const f = expectOk(await api.get(`${P()}/feedback/${id}`, { as: w.teamA }));
  return { status: f.status.id, category: f.category.id, tags: f.tags.map((t: any) => t.id).sort(), people: f.personTags.map((p: any) => p.id).sort(), revision: f.revision, priority: f.priority };
}

describe('Personal', () => {
  it('P01 a member holding UIUX and 前端 sees a feedback tagged with both exactly once', async () => {
    await createFeedback(w, { title: '雙職掌', personTagIds: [w.ptUiux, w.ptFront] });
    await createFeedback(w, { title: '未安排' });
    await createFeedback(w, { title: '後端', personTagIds: [w.ptBack] });
    const v = await view();
    expect(titles(v)).toEqual([['負責的 Feedback', ['雙職掌']]]);
    expect(v.subject.personTags.map((t: any) => t.name).sort()).toEqual(['UIUX', '前端'].sort());
    // a member without any person tag sees an empty list (未安排 is not "responsible")
    const plain = await makeUser('team', 'Plain');
    expect(titles(await view(plain))).toEqual([['負責的 Feedback', []]]);
  });

  it('P02 owner+product+subject views are private and independent', async () => {
    await createFeedback(w, { title: 'UIUX 工作', personTagIds: [w.ptUiux] });
    const aOfB = await view(w.teamA, w.teamB);
    const bOfB = await view(w.teamB, w.teamB);
    expect(aOfB.view.id).not.toBe(bOfB.view.id);
    expectOk(await api.post(`${P()}/personal/views/${aOfB.view.id}/columns`, { as: w.teamA, body: { name: 'A 私人欄', expectedRevision: aOfB.view.revision } }), 201);
    const again = expectOk(await api.get(`${P()}/personal?subjectUserId=${w.teamB.id}`, { as: w.teamB }));
    expect(again.columns.map((c: any) => c.name)).toEqual(['負責的 Feedback']);
    const aAgain = expectOk(await api.get(`${P()}/personal?subjectUserId=${w.teamB.id}`, { as: w.teamA }));
    expect(aAgain.columns.map((c: any) => c.name)).toEqual(['負責的 Feedback', 'A 私人欄']);
    // ownerId in the body is never accepted
    expect((await api.post(`${P()}/personal/views`, { as: w.teamA, body: { subjectUserId: w.teamB.id, ownerId: w.teamB.id } })).status).toBe(400);
    // subject must be an active team member
    expect((await api.post(`${P()}/personal/views`, { as: w.teamA, body: { subjectUserId: w.tester.id } })).status).toBe(404);
  });

  it('P03 any private move updates only placements, never Feedback fields; no filter editor exists', async () => {
    const f = await createFeedback(w, { title: '整理我', personTagIds: [w.ptUiux], versionTagId: w.v10, tagIds: [w.perf] });
    let v = await view();
    const col = expectOk(await api.post(`${P()}/personal/views/${v.view.id}/columns`, { as: w.teamA, body: { name: '本週', expectedRevision: v.view.revision } }), 201);
    const before = await snapshot(f.id);
    expectOk(await api.post(`${P()}/personal/views/${v.view.id}/moves`, { as: w.teamA, body: { feedbackId: f.id, targetColumnId: col.column.id, expectedRevision: col.revision } }));
    v = await view();
    expect(titles(v)).toEqual([['負責的 Feedback', []], ['本週', ['整理我']]]);
    expect(v.view.sortMode).toBe('freedom');
    expect(await snapshot(f.id)).toEqual(before);
    const withFilter = await api.post(`${P()}/personal/views/${v.view.id}/columns`, { as: w.teamA, body: { name: '條件欄', filter: { statusId: 'x' }, expectedRevision: v.view.revision } });
    expect(withFilter.status).toBe(400);
    const sneaky = await api.post(`${P()}/personal/views/${v.view.id}/moves`, { as: w.teamA, body: { feedbackId: f.id, targetColumnId: col.column.id, statusId: w.tax.statuses[2].id, expectedRevision: v.view.revision } });
    expect(sneaky.status).toBe(400);
  });

  it('P04 a stale revision (another tab) conflicts instead of overwriting', async () => {
    const f = await createFeedback(w, { title: 'X', personTagIds: [w.ptUiux] });
    const v = await view();
    const c1 = expectOk(await api.post(`${P()}/personal/views/${v.view.id}/columns`, { as: w.teamA, body: { name: '分頁一', expectedRevision: v.view.revision } }), 201);
    const stale = await api.post(`${P()}/personal/views/${v.view.id}/moves`, { as: w.teamA, body: { feedbackId: f.id, targetColumnId: c1.column.id, expectedRevision: v.view.revision } });
    expect(stale.status).toBe(409);
    expect(titles(await view())[0][1]).toEqual(['X']);
  });

  it('P05 deleting a custom column returns its cards to the default column; the default cannot be deleted', async () => {
    const f = await createFeedback(w, { title: 'Y', personTagIds: [w.ptFront] });
    let v = await view();
    const c = expectOk(await api.post(`${P()}/personal/views/${v.view.id}/columns`, { as: w.teamA, body: { name: '暫存', expectedRevision: v.view.revision } }), 201);
    const m = expectOk(await api.post(`${P()}/personal/views/${v.view.id}/moves`, { as: w.teamA, body: { feedbackId: f.id, targetColumnId: c.column.id, expectedRevision: c.revision } }));
    const def = v.columns[0];
    expect((await api.del(`${P()}/personal/views/${v.view.id}/columns/${def.id}`, { as: w.teamA, ifMatch: m.revision })).status).toBe(403);
    const del = expectOk(await api.del(`${P()}/personal/views/${v.view.id}/columns/${c.column.id}`, { as: w.teamA, ifMatch: m.revision }));
    expect(del.movedCount).toBe(1);
    v = await view();
    expect(titles(v)).toEqual([['負責的 Feedback', ['Y']]]);
    expect((await snapshot(f.id)).status).toBeTruthy();
  });

  it('P06 newly assigned → default column; unassigned → removed; reassigned → default column again', async () => {
    const f = await createFeedback(w, { title: 'Z' });
    let v = await view();
    const c = expectOk(await api.post(`${P()}/personal/views/${v.view.id}/columns`, { as: w.teamA, body: { name: '進行', expectedRevision: v.view.revision } }), 201);
    let cur = await snapshot(f.id);
    expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { personTagIds: [w.ptFront], expectedRevision: cur.revision } }));
    v = await view();
    expect(titles(v)).toEqual([['負責的 Feedback', ['Z']], ['進行', []]]);
    expectOk(await api.post(`${P()}/personal/views/${v.view.id}/moves`, { as: w.teamA, body: { feedbackId: f.id, targetColumnId: c.column.id, expectedRevision: v.view.revision } }));
    cur = await snapshot(f.id);
    expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { personTagIds: [], expectedRevision: cur.revision } }));
    v = await view();
    expect(titles(v)).toEqual([['負責的 Feedback', []], ['進行', []]]);
    expect(await getSql()`select 1 from personal_placements where feedback_id = ${f.id}`).toHaveLength(0);
    cur = await snapshot(f.id);
    expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { personTagIds: [w.ptUiux], expectedRevision: cur.revision } }));
    expect(titles(await view())).toEqual([['負責的 Feedback', ['Z']], ['進行', []]]);
  });

  it('P07 personal tags belong to the owner: others viewing the same card never see them', async () => {
    const f = await createFeedback(w, { title: '共用卡', personTagIds: [w.ptUiux] });
    const t = expectOk(await api.post(`${P()}/personal/tags`, { as: w.teamA, body: { name: '我的優先' } }), 201);
    const set = expectOk(await api.put(`${P()}/personal/feedback/${f.id}/tags`, { as: w.teamA, body: { personalTagIds: [t.id], expectedRevision: 0 } }));
    expect(set.tags.map((x: any) => x.name)).toEqual(['我的優先']);
    expect(set.revision).toBe(1);
    const bSees = expectOk(await api.get(`${P()}/personal/feedback/${f.id}/tags`, { as: w.teamB }));
    expect(bSees).toEqual({ revision: 0, tags: [] });
    expect((await api.put(`${P()}/personal/feedback/${f.id}/tags`, { as: w.teamB, body: { personalTagIds: [t.id], expectedRevision: 0 } })).status).toBe(404);
    expect(JSON.stringify(expectOk(await api.get(`${P()}/feedback/${f.id}`, { as: w.teamB })))).not.toContain('我的優先');
    expect((await api.put(`${P()}/personal/feedback/${f.id}/tags`, { as: w.teamA, body: { personalTagIds: [], expectedRevision: 0 } })).status).toBe(409);
  });

  it('P08 switching freedom ↔ create_time keeps column membership and freedom order', async () => {
    const a = await createFeedback(w, { title: 'A', personTagIds: [w.ptUiux] });
    await createFeedback(w, { title: 'B', personTagIds: [w.ptUiux] });
    const c = await createFeedback(w, { title: 'C', personTagIds: [w.ptUiux] });
    let v = await view();
    expect(titles(v)[0][1]).toEqual(['C', 'B', 'A']);
    const r = expectOk(await api.post(`${P()}/personal/views/${v.view.id}/moves`, { as: w.teamA, body: { feedbackId: a.id, targetColumnId: v.columns[0].id, beforeFeedbackId: c.id, expectedRevision: v.view.revision } }));
    v = await view();
    expect(titles(v)[0][1]).toEqual(['A', 'C', 'B']);
    const t1 = expectOk(await api.patch(`${P()}/personal/views/${v.view.id}`, { as: w.teamA, body: { sortMode: 'create_time', expectedRevision: r.revision } }));
    expect(titles(await view())[0][1]).toEqual(['C', 'B', 'A']);
    expectOk(await api.patch(`${P()}/personal/views/${v.view.id}`, { as: w.teamA, body: { sortMode: 'freedom', expectedRevision: t1.revision } }));
    expect(titles(await view())[0][1]).toEqual(['A', 'C', 'B']);
  });
});

describe('Notifications', () => {
  async function notes(as: any, site: 'admin' | 'portal' = 'admin') {
    const path = site === 'admin' ? `${P()}/notifications` : `/portal/products/${w.productA.id}/notifications`;
    return api.get(path, { as, site });
  }

  it('N01 adding UIUX notifies both new holders once each, excluding the actor', async () => {
    const teamC = await makeUser('team', 'Team C');
    await refreshTax(w);
    expectOk(await api.put(`${P()}/users/${teamC.id}/person-tags`, { as: w.teamA, body: { personTagIds: [w.ptUiux], expectedRevision: w.tax.productRevision } }));
    const f = await createFeedback(w, { title: '指派', personTagIds: [w.ptUiux] });
    await runJobs();
    await runJobs();
    for (const u of [w.teamB, teamC]) {
      const n = expectOk(await notes(u));
      expect(n).toHaveLength(1);
      expect(n[0].reasons).toEqual(['assigned']);
      expect(n[0].feedback.id).toBe(f.id);
    }
    expect(expectOk(await notes(w.teamA))).toHaveLength(0);
  });

  it('N02 adding a second tag of someone already responsible does not notify them again', async () => {
    const f = await createFeedback(w, { title: '已負責', personTagIds: [w.ptFront] }, w.teamB);
    await runJobs();
    expect(expectOk(await notes(w.teamA))).toHaveLength(1);
    const cur = expectOk(await api.get(`${P()}/feedback/${f.id}`, { as: w.teamB }));
    expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamB, body: { personTagIds: [w.ptFront, w.ptUiux], expectedRevision: cur.revision } }));
    await runJobs();
    expect(expectOk(await notes(w.teamA))).toHaveLength(1);
  });

  it('N03 author gets one notification per comment (general or schedule), never for own comments; worker retries do not duplicate', async () => {
    const f = await createFeedback(w, { title: '我的回饋' }, w.teamB);
    expectOk(await api.post(`${P()}/feedback/${f.id}/comments`, { as: w.teamA, body: { body: '一般留言' } }), 201);
    expectOk(await api.post(`${P()}/feedback/${f.id}/schedule/comments`, { as: w.teamA, key: true, body: { body: '/2-3 指令留言', expectedRevision: 1 } }), 201);
    expectOk(await api.post(`${P()}/feedback/${f.id}/comments`, { as: w.teamB, body: { body: '自己留言' } }), 201);
    // simulate a crashed worker: force every job back to pending and run again
    await getSql()`update outbox_jobs set state = 'pending', next_attempt_at = now()`;
    await runJobs();
    const n = expectOk(await notes(w.teamB));
    expect(n.map((x: any) => x.reasons[0]).sort()).toEqual(['comment', 'schedule_comment']);
    const [{ c }] = await getSql()`select count(*)::int as c from notifications where recipient_id = ${w.teamB.id}`;
    expect(c).toBe(2);
  });

  it('N04 a tester author never receives schedule notifications or content', async () => {
    const f = expectOk(await api.post(`/portal/products/${w.productA.id}/feedback`, { site: 'portal', as: w.tester, key: true, body: { title: '測試者的' } }), 201);
    expectOk(await api.post(`${P()}/feedback/${f.id}/schedule/comments`, { as: w.teamA, key: true, body: { body: '內部機密排程', expectedRevision: 1 } }), 201);
    await runJobs();
    const n = expectOk(await notes(w.tester, 'portal'));
    expect(n).toHaveLength(0);
    expect(JSON.stringify(await getSql()`select * from notifications`)).not.toContain('內部機密排程');
    expectOk(await api.post(`${P()}/feedback/${f.id}/comments`, { as: w.teamA, body: { body: '公開回覆' } }), 201);
    await runJobs();
    const n2 = expectOk(await notes(w.tester, 'portal'));
    expect(n2.map((x: any) => x.reasons)).toEqual([['comment']]);
    expect(JSON.stringify(n2)).not.toContain('公開回覆');
  });

  it('N05 later tag holders are not notified retroactively; losing access hides old notifications', async () => {
    await createFeedback(w, { title: '既有', personTagIds: [w.ptBack] });
    await runJobs();
    const teamC = await makeUser('team', 'Late');
    await refreshTax(w);
    expectOk(await api.put(`${P()}/users/${teamC.id}/person-tags`, { as: w.teamA, body: { personTagIds: [w.ptBack], expectedRevision: w.tax.productRevision } }));
    await runJobs();
    expect(expectOk(await notes(teamC))).toHaveLength(0);
    const v = expectOk(await api.post(`${P()}/personal/views`, { as: teamC, body: { subjectUserId: teamC.id } }));
    expect(v.columns[0].cards.map((c: any) => c.title)).toEqual(['既有']);
    // tester loses product access → old notification is no longer readable
    const f = expectOk(await api.post(`/portal/products/${w.productA.id}/feedback`, { site: 'portal', as: w.tester, key: true, body: { title: 'T' } }), 201);
    expectOk(await api.post(`${P()}/feedback/${f.id}/comments`, { as: w.teamA, body: { body: '回覆' } }), 201);
    await runJobs();
    expect(expectOk(await notes(w.tester, 'portal'))).toHaveLength(1);
    await getSql()`delete from product_access where user_id = ${w.tester.id}`;
    expect((await notes(w.tester, 'portal')).status).toBe(403);
  });

  it('N06 notifications are scoped to product and recipient; read marks are idempotent', async () => {
    await createFeedback(w, { title: '甲', personTagIds: [w.ptUiux] });
    await runJobs();
    const listB = await notes(w.teamB);
    expect(listB.body.meta.unreadCount).toBe(1);
    expect(expectOk(await api.get(`/products/${w.productB.id}/notifications`, { as: w.teamB }))).toHaveLength(0);
    const id = listB.body.data[0].id;
    expect((await api.put(`${P()}/notifications/${id}/read`, { as: w.teamA })).status).toBe(404);
    expectOk(await api.put(`${P()}/notifications/${id}/read`, { as: w.teamB }));
    expectOk(await api.put(`${P()}/notifications/${id}/read`, { as: w.teamB }));
    expect((await notes(w.teamB)).body.meta.unreadCount).toBe(0);
    await createFeedback(w, { title: '乙', personTagIds: [w.ptUiux] });
    await runJobs();
    expect((await notes(w.teamB)).body.meta.unreadCount).toBe(1);
    expectOk(await api.put(`${P()}/notifications/read`, { as: w.teamB, body: { before: null } }));
    expect((await notes(w.teamB)).body.meta.unreadCount).toBe(0);
  });
});
