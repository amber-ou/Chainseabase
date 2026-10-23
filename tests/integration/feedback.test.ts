import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSql } from '@/server/db';
import { api, createFeedback, expectOk, installFakes, refreshTax, resetDb, runJobs, seedWorld, type Fakes, type World } from '../helpers/harness';

let fakes: Fakes;
let w: World;

beforeAll(() => { fakes = installFakes(); void fakes; });
beforeEach(async () => {
  await resetDb();
  w = await seedWorld();
});

const statusId = (name: string) => w.tax.statuses.find((s: any) => s.name === name).id;

describe('Feedback defaults, versions and tags', () => {
  it('F01 creation defaults and server-generated author/time (cannot be supplied)', async () => {
    const fb = await createFeedback(w, { title: '鍵盤操作' });
    expect(fb.status.name).toBe('新貼文');
    expect(fb.category.name).toBe('需求討論');
    expect(fb.personTags).toEqual([]);
    expect(fb.priority).toBe('P0');
    expect(fb.version).toBeNull();
    expect(fb.visibility).toBe('internal');
    expect(fb.author.id).toBe(w.teamA.id);
    const forged = await api.post(`/products/${w.productA.id}/feedback`, { as: w.teamA, key: true, body: { title: 'x', authorId: w.teamB.id, createdAt: '2020-01-01T00:00:00Z' } });
    expect(forged.status).toBe(400);
    expect(Object.keys(forged.body.error.fieldErrors).join()).toMatch(/authorId|createdAt|_/);
    expect((await api.post(`/products/${w.productA.id}/feedback`, { as: w.teamA, body: { title: 'no key' } })).status).toBe(400);
    expect((await api.post(`/products/${w.productA.id}/feedback`, { as: w.teamA, key: true, body: { title: '   ' } })).status).toBe(400);
    const long = 'あ'.repeat(201);
    expect((await api.post(`/products/${w.productA.id}/feedback`, { as: w.teamA, key: true, body: { title: long } })).status).toBe(400);
    expect((await api.post(`/products/${w.productA.id}/feedback`, { as: w.teamA, key: true, body: { title: '😀'.repeat(200) } })).status).toBe(201);
  });

  it('F02 (API part) idempotent create: same key returns the same feedback, different body conflicts', async () => {
    const body = { title: '冪等' };
    const r1 = await api.post(`/products/${w.productA.id}/feedback`, { as: w.teamA, key: 'key-create-1', body });
    const r2 = await api.post(`/products/${w.productA.id}/feedback`, { as: w.teamA, key: 'key-create-1', body });
    expect(r1.body.data.id).toBe(r2.body.data.id);
    expect(r2.body.meta.idempotentReplay).toBe(true);
    const r3 = await api.post(`/products/${w.productA.id}/feedback`, { as: w.teamA, key: 'key-create-1', body: { title: '不同' } });
    expect(r3.status).toBe(409);
    expect(r3.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const [{ count }] = await getSql()`select count(*)::int as count from feedback where title = '冪等'`;
    expect(count).toBe(1);
  });

  it('F03 version from dropdown, tag control and roadmap all write the same single source', async () => {
    const fb = await createFeedback(w, { versionTagId: w.v10 });
    expect(fb.version.name).toBe('v1.0');
    // dropdown (versionTagId)
    let u = expectOk(await api.patch(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA, body: { versionTagId: w.v11, expectedRevision: fb.revision } }));
    expect(u.version.name).toBe('v1.1');
    expect(u.tags.filter((t: any) => t.isVersion).map((t: any) => t.name)).toEqual(['v1.1']);
    // tag control (tagIds containing the version tag)
    u = expectOk(await api.patch(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA, body: { tagIds: [w.v10, w.perf], expectedRevision: u.revision } }));
    expect(u.version.name).toBe('v1.0');
    // roadmap on the version group
    const rm = expectOk(await api.post(`/products/${w.productA.id}/roadmaps`, { as: w.teamA, body: { name: '版本規畫', dimension: 'tag_group', tagGroupId: w.versionGroup } }), 201);
    const board = expectOk(await api.get(`/products/${w.productA.id}/roadmaps/${rm.id}/board`, { as: w.teamA }));
    const col11 = board.columns.find((c: any) => c.label === 'v1.1');
    expectOk(await api.post(`/products/${w.productA.id}/roadmaps/${rm.id}/moves`, { as: w.teamA, key: true, body: {
      feedbackId: fb.id, targetColumnId: col11.id, expectedFeedbackRevision: u.revision, expectedRoadmapRevision: board.roadmap.revision,
    } }));
    const after = expectOk(await api.get(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA }));
    expect(after.version.name).toBe('v1.1');
    expect(after.tags.filter((t: any) => t.isVersion)).toHaveLength(1);
    expect(after.tags.map((t: any) => t.name).sort()).toEqual(['v1.1', '效能'].sort());
    // conflicting inputs are rejected, not guessed
    const bad = await api.patch(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA, body: { tagIds: [w.v10], versionTagId: w.v11, expectedRevision: after.revision } });
    expect(bad.status).toBe(422);
  });

  it('F04 single-select groups reject two tags (also under concurrency), multiple groups accept them', async () => {
    const bad = await api.post(`/products/${w.productA.id}/feedback`, { as: w.teamA, key: true, body: { title: 'x', tagIds: [w.v10, w.v11] } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('SINGLE_SELECT_CONFLICT');
    const ok = await createFeedback(w, { tagIds: [w.perf, w.ui, w.loose] });
    expect(ok.tags).toHaveLength(3);
    // two concurrent requests that each add a different version tag from the same revision
    const fb = await createFeedback(w, {});
    const [a, b] = await Promise.all([
      api.patch(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA, body: { versionTagId: w.v10, expectedRevision: fb.revision } }),
      api.patch(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamB, body: { versionTagId: w.v11, expectedRevision: fb.revision } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [{ count }] = await getSql()`select count(*)::int as count from feedback_tags where feedback_id = ${fb.id} and group_id = ${w.versionGroup}`;
    expect(count).toBe(1);
    // the database itself refuses a second single-select tag even if the service were bypassed
    await expect(getSql().begin(async (tx) => {
      await tx`insert into feedback_tags (feedback_id, tag_id, product_id) values (${fb.id}, ${w.v10}, ${w.productA.id}) on conflict do nothing`;
      await tx`insert into feedback_tags (feedback_id, tag_id, product_id) values (${fb.id}, ${w.v11}, ${w.productA.id}) on conflict do nothing`;
    })).rejects.toThrow(/single-select/);
  });

  it('F05 choosing 未安排 ([]) clears real person tags and sends no assignment notification', async () => {
    const fb = await createFeedback(w, { personTagIds: [w.ptBack] });
    const u = expectOk(await api.patch(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA, body: { personTagIds: [], expectedRevision: fb.revision } }));
    expect(u.personTags).toEqual([]);
    await runJobs();
    expect(await getSql()`select 1 from notifications`).toHaveLength(0);
    // '未安排' cannot be created as a real person tag
    const reserved = await api.post(`/products/${w.productA.id}/person-tags`, { as: w.teamA, body: { name: '未安排', expectedRevision: w.tax.productRevision } });
    expect(reserved.status).toBe(400);
  });

  it('F06 deleting a used status shows impact and needs a replacement; migration and columns update together', async () => {
    const pending = statusId('待討論');
    const fb = await createFeedback(w, { statusId: pending });
    const usage = expectOk(await api.get(`/products/${w.productA.id}/taxonomy/statuses/${pending}/usage`, { as: w.teamA }));
    expect(usage.feedbackCount).toBe(1);
    expect(usage.roadmaps.map((r: any) => r.name)).toEqual(['產品進度']);
    const refused = await api.del(`/products/${w.productA.id}/statuses/${pending}`, { as: w.teamA, body: { expectedRevision: w.tax.productRevision } });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('REFERENCE_IN_USE');
    const target = statusId('延後');
    expectOk(await api.del(`/products/${w.productA.id}/statuses/${pending}`, { as: w.teamA, body: { expectedRevision: w.tax.productRevision, replacementId: target } }));
    const after = expectOk(await api.get(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA }));
    expect(after.status.id).toBe(target);
    const rms = expectOk(await api.get(`/products/${w.productA.id}/roadmaps`, { as: w.teamA }));
    const board = expectOk(await api.get(`/products/${w.productA.id}/roadmaps/${rms[0].id}/board`, { as: w.teamA }));
    expect(board.columns.map((c: any) => c.label)).toEqual(['需求池', '進行中', '已完成', '延後']);
    expect(board.columns.find((c: any) => c.label === '延後').cards.map((c: any) => c.id)).toContain(fb.id);
    // the default status cannot disappear without a replacement
    await refreshTax(w);
    const def = await api.del(`/products/${w.productA.id}/statuses/${statusId('新貼文')}`, { as: w.teamA, body: { expectedRevision: w.tax.productRevision } });
    expect(def.status).toBe(409);
  });

  it('F07 multiple→single requires cleaning conflicts; a single group used by a roadmap cannot become multiple', async () => {
    await createFeedback(w, { tagIds: [w.perf, w.ui] });
    const r1 = await api.patch(`/products/${w.productA.id}/tag-groups/${w.usageGroup}`, { as: w.teamA, body: { selectionMode: 'single', expectedRevision: w.tax.productRevision } });
    expect(r1.status).toBe(422);
    expect(r1.body.error.details.conflictCount).toBe(1);
    const g = expectOk(await api.post(`/products/${w.productA.id}/tag-groups`, { as: w.teamA, body: { name: '階段', selectionMode: 'single', expectedRevision: w.tax.productRevision } }), 201);
    expectOk(await api.post(`/products/${w.productA.id}/roadmaps`, { as: w.teamA, body: { name: '階段看板', dimension: 'tag_group', tagGroupId: g.group.id } }), 201);
    await refreshTax(w);
    const r2 = await api.patch(`/products/${w.productA.id}/tag-groups/${g.group.id}`, { as: w.teamA, body: { selectionMode: 'multiple', expectedRevision: w.tax.productRevision } });
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('REFERENCE_IN_USE');
    const r3 = await api.patch(`/products/${w.productA.id}/tag-groups/${w.versionGroup}`, { as: w.teamA, body: { selectionMode: 'multiple', expectedRevision: w.tax.productRevision } });
    expect(r3.status).toBe(403);
  });
});

describe('Portal, visibility and public projection', () => {
  it('F08 portal creation: invited tester ok (public by default); anonymous, uninvited and other-product testers rejected', async () => {
    const created = expectOk(await api.post(`/portal/products/${w.productA.id}/feedback`, { site: 'portal', as: w.tester, key: true, body: { title: '前台建議', description: '說明' } }), 201);
    const internal = expectOk(await api.get(`/products/${w.productA.id}/feedback/${created.id}`, { as: w.teamA }));
    expect(internal.visibility).toBe('public');
    expect(internal.source).toBe('portal');
    expect(internal.status.name).toBe('新貼文');
    expect((await api.post(`/portal/products/${w.productA.id}/feedback`, { site: 'portal', key: true, body: { title: 'x' } })).status).toBe(401);
    expect((await api.post(`/portal/products/${w.productA.id}/feedback`, { site: 'portal', as: w.outsider, key: true, body: { title: 'x' } })).status).toBe(403);
    expect((await api.post(`/portal/products/${w.productB.id}/feedback`, { site: 'portal', as: w.tester, key: true, body: { title: 'x' } })).status).toBe(403);
    // classification fields are not accepted from the portal
    expect((await api.post(`/portal/products/${w.productA.id}/feedback`, { site: 'portal', as: w.tester, key: true, body: { title: 'x', priority: 'P3' } })).status).toBe(400);
  });

  it('F09 anonymous responses contain only the allowlisted public fields', async () => {
    const fb = await createFeedback(w, { visibility: 'public', personTagIds: [w.ptUiux], versionTagId: w.v10, tagIds: [w.perf], priority: 'P1', title: '公開項目' });
    expectOk(await api.post(`/products/${w.productA.id}/feedback/${fb.id}/schedule/comments`, { as: w.teamA, key: true, body: { body: '/2-3 內部工作', expectedRevision: 1 } }), 201);
    expectOk(await api.post(`/products/${w.productA.id}/feedback/${fb.id}/comments`, { as: w.teamA, body: { body: '公開留言' } }), 201);
    const rms = expectOk(await api.get(`/products/${w.productA.id}/roadmaps`, { as: w.teamA }));
    expectOk(await api.patch(`/products/${w.productA.id}/roadmaps/${rms[0].id}`, { as: w.teamA, body: { portalPublished: true, expectedRevision: rms[0].revision } }));
    const responses = [
      await api.get(`/public/products/${w.productA.slug}/feedback`, { site: 'portal' }),
      await api.get(`/public/products/${w.productA.slug}/feedback/${fb.id}`, { site: 'portal' }),
      await api.get(`/public/products/${w.productA.slug}/feedback?q=${encodeURIComponent('公開')}`, { site: 'portal' }),
      await api.get(`/public/products/${w.productA.slug}/feedback/${fb.id}/comments`, { site: 'portal' }),
      await api.get(`/public/products/${w.productA.slug}/roadmaps/${rms[0].id}`, { site: 'portal' }),
    ];
    for (const r of responses) {
      expect(r.status).toBe(200);
      const text = JSON.stringify(r.body);
      for (const leak of ['UIUX', 'v1.0', '效能', 'P1', 'priority', 'personTags', 'version', 'email', '@example.com', '內部工作', 'schedule', 'visibility']) {
        expect(text).not.toContain(leak);
      }
    }
    expect(JSON.stringify(responses[3].body)).toContain('公開留言');
    expect(responses[1].body.data).toEqual(expect.objectContaining({ id: fb.id, title: '公開項目' }));
    expect(Object.keys(responses[1].body.data).sort()).toEqual(['author', 'canEdit', 'commentCount', 'createdAt', 'description', 'id', 'myVote', 'revision', 'status', 'title', 'voteCount'].sort());
  });

  it('F10 switching back to internal hides it everywhere, including from its author', async () => {
    const created = expectOk(await api.post(`/portal/products/${w.productA.id}/feedback`, { site: 'portal', as: w.tester, key: true, body: { title: '曾公開' } }), 201);
    expectOk(await api.post(`/products/${w.productA.id}/feedback/${created.id}/comments`, { as: w.teamA, body: { body: '團隊回覆' } }), 201);
    await runJobs();
    const notes = expectOk(await api.get(`/portal/products/${w.productA.id}/notifications`, { site: 'portal', as: w.tester }));
    expect(notes).toHaveLength(1);
    const internal = expectOk(await api.get(`/products/${w.productA.id}/feedback/${created.id}`, { as: w.teamA }));
    expectOk(await api.patch(`/products/${w.productA.id}/feedback/${created.id}`, { as: w.teamA, body: { visibility: 'internal', expectedRevision: internal.revision } }));
    expect((await api.get(`/public/products/${w.productA.slug}/feedback/${created.id}`, { site: 'portal', as: w.tester })).status).toBe(404);
    expect(expectOk(await api.get(`/public/products/${w.productA.slug}/feedback?q=${encodeURIComponent('曾公開')}`, { site: 'portal' }))).toEqual([]);
    expect(expectOk(await api.get(`/portal/products/${w.productA.id}/notifications`, { site: 'portal', as: w.tester }))).toEqual([]);
    const edit = await api.patch(`/portal/products/${w.productA.id}/feedback/${created.id}`, { site: 'portal', as: w.tester, body: { title: '改', expectedRevision: internal.revision + 1 } });
    expect(edit.status).toBe(404);
    expect((await api.get(`/public/products/${w.productA.slug}/feedback/${created.id}/comments`, { site: 'portal' })).status).toBe(404);
    const r = await api.get(`/public/products/${w.productA.slug}/feedback/${created.id}`, { site: 'portal' });
    expect(r.headers.get('cache-control')).toContain('no-store');
  });

  it('F11 general comments on public feedback are public; schedule comments never are', async () => {
    const fb = await createFeedback(w, { visibility: 'public' });
    expectOk(await api.post(`/products/${w.productA.id}/feedback/${fb.id}/comments`, { as: w.teamA, body: { body: '後台公開留言' } }), 201);
    expectOk(await api.post(`/products/${w.productA.id}/feedback/${fb.id}/schedule/comments`, { as: w.teamA, key: true, body: { body: '排程內部說明', expectedRevision: 1 } }), 201);
    const pub = expectOk(await api.get(`/public/products/${w.productA.slug}/feedback/${fb.id}/comments`, { site: 'portal' }));
    expect(pub.map((c: any) => c.body)).toEqual(['後台公開留言']);
  });

  it('F12 vote and like PUT are idempotent, DELETE removes; counts never exceed one per user', async () => {
    const fb = await createFeedback(w, { visibility: 'public' });
    const c = expectOk(await api.post(`/portal/products/${w.productA.id}/feedback/${fb.id}/comments`, { site: 'portal', as: w.tester, body: { body: '同意' } }), 201);
    for (let i = 0; i < 3; i++) {
      expectOk(await api.put(`/portal/products/${w.productA.id}/feedback/${fb.id}/vote`, { site: 'portal', as: w.tester }));
      expectOk(await api.put(`/portal/products/${w.productA.id}/comments/${c.id}/like`, { site: 'portal', as: w.tester }));
    }
    let pub = expectOk(await api.get(`/public/products/${w.productA.slug}/feedback/${fb.id}`, { site: 'portal', as: w.tester }));
    expect(pub.voteCount).toBe(1);
    expect(pub.myVote).toBe(true);
    let comments = expectOk(await api.get(`/public/products/${w.productA.slug}/feedback/${fb.id}/comments`, { site: 'portal', as: w.tester }));
    expect(comments[0].likeCount).toBe(1);
    expectOk(await api.del(`/portal/products/${w.productA.id}/feedback/${fb.id}/vote`, { site: 'portal', as: w.tester }));
    expectOk(await api.del(`/portal/products/${w.productA.id}/feedback/${fb.id}/vote`, { site: 'portal', as: w.tester }));
    expectOk(await api.del(`/portal/products/${w.productA.id}/comments/${c.id}/like`, { site: 'portal', as: w.tester }));
    pub = expectOk(await api.get(`/public/products/${w.productA.slug}/feedback/${fb.id}`, { site: 'portal', as: w.tester }));
    expect(pub.voteCount).toBe(0);
    comments = expectOk(await api.get(`/public/products/${w.productA.slug}/feedback/${fb.id}/comments`, { site: 'portal' }));
    expect(comments[0].likeCount).toBe(0);
  });

  it('F13 testers cannot edit others\' content or mass-assign internal fields', async () => {
    const team = await createFeedback(w, { visibility: 'public', title: '團隊的' });
    const own = expectOk(await api.post(`/portal/products/${w.productA.id}/feedback`, { site: 'portal', as: w.tester, key: true, body: { title: '我的' } }), 201);
    expect((await api.patch(`/portal/products/${w.productA.id}/feedback/${team.id}`, { site: 'portal', as: w.tester, body: { title: '竄改', expectedRevision: team.revision } })).status).toBe(403);
    for (const field of [{ statusId: w.tax.statuses[1].id }, { visibility: 'internal' }, { authorId: w.teamA.id }, { priority: 'P3' }]) {
      const r = await api.patch(`/portal/products/${w.productA.id}/feedback/${own.id}`, { site: 'portal', as: w.tester, body: { ...field, expectedRevision: own.revision } });
      expect(r.status).toBe(400);
    }
    const ok = expectOk(await api.patch(`/portal/products/${w.productA.id}/feedback/${own.id}`, { site: 'portal', as: w.tester, body: { title: '我的（已修正）', expectedRevision: own.revision } }));
    expect(ok.title).toBe('我的（已修正）');
    const teamComment = expectOk(await api.post(`/products/${w.productA.id}/feedback/${team.id}/comments`, { as: w.teamA, body: { body: '團隊留言' } }), 201);
    expect((await api.patch(`/portal/products/${w.productA.id}/comments/${teamComment.id}`, { site: 'portal', as: w.tester, body: { body: '改', expectedRevision: 1 } })).status).toBe(403);
  });

  it('F14 Traditional Chinese fragment search with special characters is parameterized and product/public scoped', async () => {
    await createFeedback(w, { title: '搜尋欄位支援繁體中文', visibility: 'public' });
    await createFeedback(w, { title: '內部：搜尋欄位權限', visibility: 'internal' });
    await createFeedback(w, { title: '100% 完成_率', description: "it's O'Reilly \\ path" });
    await createFeedback(w, { title: '搜尋欄位在乙' }, w.teamA, w.productB.id);
    const internal = expectOk(await api.get(`/products/${w.productA.id}/feedback?q=${encodeURIComponent('欄位')}`, { as: w.teamA }));
    expect(internal.map((f: any) => f.title).sort()).toEqual(['內部：搜尋欄位權限', '搜尋欄位支援繁體中文'].sort());
    const pub = expectOk(await api.get(`/public/products/${w.productA.slug}/feedback?q=${encodeURIComponent('欄位')}`, { site: 'portal' }));
    expect(pub.map((f: any) => f.title)).toEqual(['搜尋欄位支援繁體中文']);
    expect(expectOk(await api.get(`/products/${w.productA.id}/feedback?q=${encodeURIComponent('%')}`, { as: w.teamA })).map((f: any) => f.title)).toEqual(['100% 完成_率']);
    expect(expectOk(await api.get(`/products/${w.productA.id}/feedback?q=${encodeURIComponent('_')}`, { as: w.teamA })).map((f: any) => f.title)).toEqual(['100% 完成_率']);
    expect(expectOk(await api.get(`/products/${w.productA.id}/feedback?q=${encodeURIComponent("O'Reilly")}`, { as: w.teamA }))).toHaveLength(1);
    expect(expectOk(await api.get(`/products/${w.productA.id}/feedback?q=${encodeURIComponent("'; drop table feedback; --")}`, { as: w.teamA }))).toEqual([]);
    expect((await getSql()`select count(*)::int as c from feedback`)[0].c).toBe(4);
  });

  it('F15 (storage part) script/HTML are stored as text and returned verbatim for safe rendering', async () => {
    const payload = '<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>';
    const fb = await createFeedback(w, { title: '<b>粗體</b>', description: payload, visibility: 'public' });
    const pub = expectOk(await api.get(`/public/products/${w.productA.slug}/feedback/${fb.id}`, { site: 'portal' }));
    expect(pub.description).toBe(payload);
    expect(pub.title).toBe('<b>粗體</b>');
  });

  it('lists paginate with an opaque cursor in created_at DESC, id DESC order with server totals', async () => {
    for (let i = 0; i < 5; i++) await createFeedback(w, { title: `項目 ${i}` });
    const p1 = await api.get(`/products/${w.productA.id}/feedback?limit=2`, { as: w.teamA });
    expect(p1.body.meta.total).toBe(5);
    expect(p1.body.data.map((f: any) => f.title)).toEqual(['項目 4', '項目 3']);
    const p2 = await api.get(`/products/${w.productA.id}/feedback?limit=2&cursor=${p1.body.meta.nextCursor}`, { as: w.teamA });
    expect(p2.body.data.map((f: any) => f.title)).toEqual(['項目 2', '項目 1']);
    expect((await api.get(`/products/${w.productA.id}/feedback?limit=101`, { as: w.teamA })).status).toBe(400);
  });

  it('soft-deletes feedback with If-Match and hides it from every list', async () => {
    const fb = await createFeedback(w, { title: '將刪除', visibility: 'public' });
    expect((await api.del(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA })).status).toBe(428);
    expect((await api.del(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA, ifMatch: fb.revision + 5 })).status).toBe(409);
    expectOk(await api.del(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA, ifMatch: fb.revision }));
    expect((await api.get(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA })).status).toBe(404);
    expect(expectOk(await api.get(`/public/products/${w.productA.slug}/feedback`, { site: 'portal' }))).toEqual([]);
    expect((await getSql()`select deleted_at from feedback where id = ${fb.id}`)[0].deletedAt).not.toBeNull();
  });
});
