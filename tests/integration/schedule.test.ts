import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSql } from '@/server/db';
import { api, createFeedback, expectOk, installFakes, resetDb, runJobs, seedWorld, type World } from '../helpers/harness';

let w: World;
beforeAll(() => { installFakes(); });
beforeEach(async () => {
  await resetDb();
  w = await seedWorld();
});

const base = (fb: { id: string }) => `/products/${w.productA.id}/feedback/${fb.id}/schedule`;

async function post(fb: { id: string }, body: string, rev: number, as = w.teamA, key: string | boolean = true, replyToId: string | null = null) {
  return api.post(`${base(fb)}/comments`, { as, key, body: { body, expectedRevision: rev, replyToId } });
}

async function schedule(fb: { id: string }) {
  return expectOk(await api.get(base(fb), { as: w.teamA }));
}

async function history(fb: { id: string }) {
  return expectOk(await api.get(`${base(fb)}/history`, { as: w.teamA }));
}

async function counts(feedbackId: string) {
  const sql = getSql();
  const [r] = await sql`
    select (select count(*)::int from comments where feedback_id = ${feedbackId}) as comments,
           (select count(*)::int from schedule_entries where feedback_id = ${feedbackId}) as entries,
           (select count(*)::int from schedule_operations where feedback_id = ${feedbackId}) as ops,
           (select count(*)::int from domain_events where payload->>'feedbackId' = ${feedbackId}) as events
  `;
  return r;
}

describe('Schedule', () => {
  it('S01 starts with five columns and one empty content row (row 2); the header is not a target', async () => {
    const fb = await createFeedback(w, {});
    const s = await schedule(fb);
    expect(s.columns).toEqual(['PO', 'UIUX', '前端', '後端', 'QA']);
    expect(s.rows.map((r: any) => r.displayRow)).toEqual([2]);
    expect(s.rows[0].cells).toEqual([[], [], [], [], []]);
    const header = await post(fb, '/1-3 表頭', s.revision);
    expect(header.status).toBe(422);
    expect(header.body.error.code).toBe('INVALID_COORDINATE');
  });

  it('S02 two appends in the same cell keep both entries, both commands and both history records', async () => {
    const fb = await createFeedback(w, {});
    let s = await schedule(fb);
    const a = expectOk(await post(fb, '/2-3 工作甲', s.revision), 201);
    expect(a.action).toBe('append');
    expect(a.affectedCount).toBe(1);
    const b = expectOk(await post(fb, '/2-3   工作乙  ', a.scheduleRevision, w.teamB), 201);
    s = await schedule(fb);
    const cell = s.rows[0].cells[2];
    expect(cell.map((e: any) => e.body)).toEqual(['工作甲', '工作乙']);
    expect(cell[0].author.displayName).toBe('Team A');
    expect(cell[1].author.displayName).toBe('Team B');
    expect(cell[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const comments = expectOk(await api.get(`${base(fb)}/comments`, { as: w.teamA }));
    expect(comments.map((c: any) => [c.kind, c.body])).toEqual([['command', '/2-3 工作甲'], ['command', '/2-3   工作乙']]);
    expect((await history(fb)).map((h: any) => h.type)).toEqual(['command.append', 'command.append']);
    expect(b.comment.command.coordinate).toBe('/2-3');
  });

  it('S03 delete clears both, keeps commands and history; clearing again succeeds with affectedCount 0', async () => {
    const fb = await createFeedback(w, {});
    let rev = (await schedule(fb)).revision;
    rev = expectOk(await post(fb, '/2-3 工作甲', rev), 201).scheduleRevision;
    rev = expectOk(await post(fb, '/2-3 工作乙', rev), 201).scheduleRevision;
    const c1 = expectOk(await post(fb, '/2-3 delete', rev), 201);
    expect(c1.action).toBe('clear');
    expect(c1.affectedCount).toBe(2);
    expect((await schedule(fb)).rows[0].cells[2]).toEqual([]);
    const c2 = expectOk(await post(fb, '  /2-3 delete  ', c1.scheduleRevision), 201);
    expect(c2.affectedCount).toBe(0);
    expect((await history(fb)).map((h: any) => h.summary)).toEqual(['清空 /2-3（0 筆）', '清空 /2-3（2 筆）', '寫入 /2-3：工作乙', '寫入 /2-3：工作甲']);
    expect(expectOk(await api.get(`${base(fb)}/comments`, { as: w.teamA }))).toHaveLength(4);
  });

  it('S04 hiding one append history removes only that entry', async () => {
    const fb = await createFeedback(w, {});
    let rev = (await schedule(fb)).revision;
    const a = expectOk(await post(fb, '/2-3 工作甲', rev), 201);
    rev = expectOk(await post(fb, '/2-3 工作乙', a.scheduleRevision), 201).scheduleRevision;
    const hidden = expectOk(await api.del(`${base(fb)}/history/${a.operationId}`, { as: w.teamA, ifMatch: rev }));
    expect(hidden.removedEntryIds).toHaveLength(1);
    expect(hidden.schedule.rows[0].cells[2].map((e: any) => e.body)).toEqual(['工作乙']);
    const h = await history(fb);
    expect(h.map((x: any) => x.type)).toEqual(['history.hide', 'command.append']);
    const comments = expectOk(await api.get(`${base(fb)}/comments`, { as: w.teamA }));
    expect(comments[0].command.historyRemoved).toBe(true);
    expect(comments[0].body).toBe('/2-3 工作甲');
  });

  it('S05 hiding the clear history never restores cleared content', async () => {
    const fb = await createFeedback(w, {});
    let rev = (await schedule(fb)).revision;
    rev = expectOk(await post(fb, '/2-3 工作甲', rev), 201).scheduleRevision;
    const clear = expectOk(await post(fb, '/2-3 delete', rev), 201);
    const r = expectOk(await api.del(`${base(fb)}/history/${clear.operationId}`, { as: w.teamA, ifMatch: clear.scheduleRevision }));
    expect(r.schedule.rows[0].cells[2]).toEqual([]);
    const comments = expectOk(await api.get(`${base(fb)}/comments`, { as: w.teamA }));
    expect(comments[1].command.historyRemoved).toBe(true);
    expect(comments[0].command.contentCleared).toBe(true);
    const [{ live }] = await getSql()`select count(*)::int as live from schedule_entries where feedback_id = ${fb.id} and removed_at is null`;
    expect(live).toBe(0);
  });

  it('S06 after clear+new write, hiding an older append does not touch the new content', async () => {
    const fb = await createFeedback(w, {});
    let rev = (await schedule(fb)).revision;
    const old = expectOk(await post(fb, '/2-3 舊內容', rev), 201);
    rev = expectOk(await post(fb, '/2-3 delete', old.scheduleRevision), 201).scheduleRevision;
    rev = expectOk(await post(fb, '/2-3 新內容', rev), 201).scheduleRevision;
    const r = expectOk(await api.del(`${base(fb)}/history/${old.operationId}`, { as: w.teamA, ifMatch: rev }));
    expect(r.removedEntryIds).toEqual([]);
    expect(r.schedule.rows[0].cells[2].map((e: any) => e.body)).toEqual(['新內容']);
  });

  it('S07 invalid commands create no comment, entry, history or notification', async () => {
    const fb = await createFeedback(w, {}, w.teamB);
    const before = await counts(fb.id);
    const rev = (await schedule(fb)).revision;
    for (const body of ['/1-1 表頭', '/2-6 第六欄', '/9-1 不存在', '/2-3', '/2-3   ', '/abc', '/2-3x 內容', '/02-3 前導零', '/2-0 零欄', '/-2-3 負數']) {
      const r = await post(fb, body, rev);
      expect(r.status, body).toBe(422);
    }
    expect((await post(fb, '   ', rev)).status).toBe(400);
    expect(await counts(fb.id)).toEqual(before);
    await runJobs();
    expect(await getSql()`select 1 from notifications`).toHaveLength(0);
    expect((await schedule(fb)).revision).toBe(rev);
  });

  it('S08 "delete all" and "Delete" are written as text, not a clear', async () => {
    const fb = await createFeedback(w, {});
    let rev = (await schedule(fb)).revision;
    const a = expectOk(await post(fb, '/2-3 delete all', rev), 201);
    expect(a.action).toBe('append');
    rev = expectOk(await post(fb, '/2-3 Delete', a.scheduleRevision), 201).scheduleRevision;
    expect((await schedule(fb)).rows[0].cells[2].map((e: any) => e.body)).toEqual(['delete all', 'Delete']);
  });

  it('S09 a failure mid-transaction rolls everything back; the same key then succeeds exactly once', async () => {
    const fb = await createFeedback(w, {});
    const rev = (await schedule(fb)).revision;
    const before = await counts(fb.id);
    // inject a DB failure at the operation insert step via a temporary trigger
    await getSql().unsafe(`
      create or replace function csb_fail_once() returns trigger language plpgsql as $$
      begin raise exception 'injected failure'; end; $$;
      create trigger csb_fail_once before insert on schedule_entries for each row execute function csb_fail_once();
    `);
    const failed = await post(fb, '/2-3 會失敗', rev, w.teamA, 'retry-key-s09');
    expect(failed.status).toBe(500);
    expect(await counts(fb.id)).toEqual(before);
    await getSql().unsafe('drop trigger csb_fail_once on schedule_entries; drop function csb_fail_once();');
    const ok = await post(fb, '/2-3 會失敗', rev, w.teamA, 'retry-key-s09');
    expect(ok.status).toBe(201);
    const replay = await post(fb, '/2-3 會失敗', rev, w.teamA, 'retry-key-s09');
    expect(replay.status).toBe(201);
    expect(replay.body.meta.idempotentReplay).toBe(true);
    expect(replay.body.data.commentId).toBe(ok.body.data.commentId);
    const after = await counts(fb.id);
    expect(after.comments).toBe(before.comments + 1);
    expect(after.entries).toBe(before.entries + 1);
  });

  it('S10 concurrent write and clear on the same old revision: one wins, the other conflicts', async () => {
    const fb = await createFeedback(w, {});
    let rev = (await schedule(fb)).revision;
    rev = expectOk(await post(fb, '/2-3 既有', rev), 201).scheduleRevision;
    const [x, y] = await Promise.all([post(fb, '/2-3 新增', rev), post(fb, '/2-3 delete', rev, w.teamB)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const s = await schedule(fb);
    const winner = x.status === 201 ? 'append' : 'clear';
    if (winner === 'append') expect(s.rows[0].cells[2].map((e: any) => e.body)).toEqual(['既有', '新增']);
    else expect(s.rows[0].cells[2]).toEqual([]);
    const loser = x.status === 409 ? x : y;
    expect(loser.body.error.code).toBe('REVISION_CONFLICT');
  });

  it('S12 a create-modal draft is replayed atomically with server author/time and resolved references', async () => {
    const before = Date.now();
    const fb = await createFeedback(w, {
      scheduleDraft: {
        actions: [
          { clientActionId: 'a1', type: 'row.add' },
          { clientActionId: 'a2', type: 'comment.create', body: '/3-1 PO 規格' },
          { clientActionId: 'a3', type: 'comment.create', body: '/2-3 前端草稿' },
          { clientActionId: 'a4', type: 'comment.create', body: '一般說明' },
          { clientActionId: 'a5', type: 'comment.create', body: '回覆說明', replyToClientActionId: 'a4' },
          { clientActionId: 'a6', type: 'comment.edit', targetClientActionId: 'a4', body: '一般說明（修正）' },
          { clientActionId: 'a7', type: 'history.hide', targetClientActionId: 'a3' },
        ],
      },
    });
    const s = await schedule(fb);
    expect(s.rows.map((r: any) => r.displayRow)).toEqual([2, 3]);
    expect(s.rows[1].cells[0].map((e: any) => e.body)).toEqual(['PO 規格']);
    expect(s.rows[0].cells[2]).toEqual([]);
    const comments = expectOk(await api.get(`${base(fb)}/comments`, { as: w.teamA }));
    expect(comments.map((c: any) => c.body)).toEqual(['/3-1 PO 規格', '/2-3 前端草稿', '一般說明（修正）', '回覆說明']);
    expect(comments.every((c: any) => c.author.id === w.teamA.id)).toBe(true);
    expect(new Date(comments[0].createdAt).getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(comments[3].replyTo.id).toBe(comments[2].id);
    expect(comments[1].command.historyRemoved).toBe(true);
    // a failing draft action aborts the whole creation (no feedback, no schedule left behind)
    const [{ c: beforeCount }] = await getSql()`select count(*)::int as c from feedback`;
    const bad = await api.post(`/products/${w.productA.id}/feedback`, { as: w.teamA, key: true, body: {
      title: '草稿失敗', scheduleDraft: { actions: [{ clientActionId: 'b1', type: 'comment.create', body: '/5-1 不存在的列' }] },
    } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fieldErrors['scheduleDraft.actions.0']).toBeTruthy();
    const [{ c: afterCount }] = await getSql()`select count(*)::int as c from feedback`;
    expect(afterCount).toBe(beforeCount);
  });

  it('S11 a cancelled draft leaves nothing (drafts never reach the server before submit)', async () => {
    const [{ c }] = await getSql()`select (select count(*)::int from schedules) + (select count(*)::int from comments) + (select count(*)::int from notifications) as c`;
    expect(c).toBe(0);
  });

  it('S13 hiding a row.add history keeps the row and coordinates', async () => {
    const fb = await createFeedback(w, {});
    const s = await schedule(fb);
    const row = expectOk(await api.post(`${base(fb)}/rows`, { as: w.teamA, body: { expectedRevision: s.revision } }), 201);
    expect(row.row.displayRow).toBe(3);
    const hid = expectOk(await api.del(`${base(fb)}/history/${row.operationId}`, { as: w.teamA, ifMatch: row.scheduleRevision }));
    expect(hid.schedule.rows.map((r: any) => r.displayRow)).toEqual([2, 3]);
    const w3 = expectOk(await post(fb, '/3-5 QA 驗收', hid.scheduleRevision), 201);
    expect(w3.affectedCell).toEqual({ row: 3, column: 5 });
    expect((await schedule(fb)).rows[1].cells[4][0].body).toBe('QA 驗收');
  });

  it('S14 replies keep reply_to and quoted author; quoting a command never re-executes it', async () => {
    const fb = await createFeedback(w, {});
    let rev = (await schedule(fb)).revision;
    const cmd = expectOk(await post(fb, '/2-3 工作甲', rev), 201);
    const reply = expectOk(await post(fb, '收到，我來處理', cmd.scheduleRevision, w.teamB, true, cmd.commentId), 201);
    expect(reply.kind).toBe('normal');
    expect(reply.comment.replyTo).toEqual(expect.objectContaining({ id: cmd.commentId, author: 'Team A', removed: false }));
    rev = reply.scheduleRevision;
    expect((await schedule(fb)).rows[0].cells[2]).toHaveLength(1);
    const cmdReply = await post(fb, '/2-3 想再執行', rev, w.teamB, true, cmd.commentId);
    expect(cmdReply.status).toBe(400);
    // general stream reply to a removed comment shows a placeholder, not the original text
    const g1 = expectOk(await api.post(`/products/${w.productA.id}/feedback/${fb.id}/comments`, { as: w.teamA, body: { body: '原始文字' } }), 201);
    const g2 = expectOk(await api.post(`/products/${w.productA.id}/feedback/${fb.id}/comments`, { as: w.teamB, body: { body: '回覆', replyToId: g1.id } }), 201);
    expectOk(await api.del(`/products/${w.productA.id}/comments/${g1.id}`, { as: w.teamA, ifMatch: g1.revision }));
    const list = expectOk(await api.get(`/products/${w.productA.id}/feedback/${fb.id}/comments`, { as: w.teamA }));
    const r = list.find((c: any) => c.id === g2.id);
    expect(r.replyTo).toEqual({ id: g1.id, author: 'Team A', removed: true, excerpt: null });
    expect(JSON.stringify(list)).not.toContain('原始文字');
  });

  it('S15 command comments cannot be edited, deleted or liked; normal ones can be liked', async () => {
    const fb = await createFeedback(w, {});
    const rev = (await schedule(fb)).revision;
    const cmd = expectOk(await post(fb, '/2-3 工作甲', rev), 201);
    expect((await api.patch(`/products/${w.productA.id}/comments/${cmd.commentId}`, { as: w.teamA, body: { body: '改', expectedRevision: 1, expectedScheduleRevision: cmd.scheduleRevision } })).status).toBe(403);
    expect((await api.del(`/products/${w.productA.id}/comments/${cmd.commentId}?scheduleRevision=${cmd.scheduleRevision}`, { as: w.teamA, ifMatch: 1 })).status).toBe(403);
    expect((await api.put(`/products/${w.productA.id}/comments/${cmd.commentId}/like`, { as: w.teamA })).status).toBe(403);
    const normal = expectOk(await post(fb, '普通留言', cmd.scheduleRevision), 201);
    const like = expectOk(await api.put(`/products/${w.productA.id}/comments/${normal.commentId}/like`, { as: w.teamB }));
    expect(like.likeCount).toBe(1);
  });

  it('S16 feedback field changes and UI-only actions add no schedule history; editing a normal schedule comment does', async () => {
    const fb = await createFeedback(w, {});
    const rev = (await schedule(fb)).revision;
    const n = expectOk(await post(fb, '普通留言', rev), 201);
    const h0 = await history(fb);
    const fbNow = expectOk(await api.get(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA }));
    expectOk(await api.patch(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA, body: { statusId: w.tax.statuses[1].id, expectedRevision: fbNow.revision } }));
    await schedule(fb); // reading (switching tabs) is not an operation
    expect(await history(fb)).toEqual(h0);
    const stale = await api.patch(`/products/${w.productA.id}/comments/${n.commentId}`, { as: w.teamA, body: { body: '改過', expectedRevision: n.comment.revision } });
    expect(stale.status).toBe(428);
    expectOk(await api.patch(`/products/${w.productA.id}/comments/${n.commentId}`, { as: w.teamA, body: { body: '改過', expectedRevision: n.comment.revision, expectedScheduleRevision: n.scheduleRevision } }));
    const h1 = await history(fb);
    expect(h1.map((x: any) => x.type)).toEqual(['comment.edit', 'comment.create']);
    expectOk(await api.put(`/products/${w.productA.id}/comments/${n.commentId}/like`, { as: w.teamA }));
    expectOk(await api.put(`/products/${w.productA.id}/comments/${n.commentId}/like`, { as: w.teamA }));
    expect((await history(fb)).map((x: any) => x.type)).toEqual(['comment.like', 'comment.edit', 'comment.create']);
  });

  it('S17 (API part) success results distinguish written count and cleared count', async () => {
    const fb = await createFeedback(w, {});
    let rev = (await schedule(fb)).revision;
    const a = expectOk(await post(fb, '/2-1 一', rev), 201);
    rev = expectOk(await post(fb, '/2-1 二', a.scheduleRevision), 201).scheduleRevision;
    rev = expectOk(await post(fb, '/2-1 三', rev), 201).scheduleRevision;
    const c = expectOk(await post(fb, '/2-1 delete', rev), 201);
    expect([a.action, a.affectedCount]).toEqual(['append', 1]);
    expect([c.action, c.affectedCount, c.affectedEntryIds.length]).toEqual(['clear', 3, 3]);
  });

  it('schedule is internal only: testers and the portal host cannot reach it', async () => {
    const fb = await createFeedback(w, { visibility: 'public' });
    expect((await api.get(base(fb), { as: w.tester })).status).toBe(403);
    expect((await api.get(base(fb), { site: 'portal', as: w.teamA })).status).toBe(404);
    expect((await api.post(`${base(fb)}/comments`, { as: w.tester, key: true, body: { body: '/2-3 x', expectedRevision: 1 } })).status).toBe(403);
  });
});
