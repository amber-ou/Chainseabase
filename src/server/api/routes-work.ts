import { z } from 'zod';
import type { Ctx, Router } from '../http';
import { uuidParam } from '../http';
import { getSql } from '../db';
import { AppError } from '../errors';
import { hasProductInteraction, requireProduct, requireProductReader, requireReader, requireTeam, requireUser } from '../authz';
import { addRow, getSchedule, getScheduleHistory, hideOperation, postScheduleComment } from '@/modules/schedule/service';
import { getCommentDto, listComments } from '@/modules/feedback/comments';
import {
  createRoadmap, deleteRoadmap, getBoard, getColumnPage, listRoadmaps, moveCard as moveRoadmapCard, reorderColumns as reorderRoadmapColumns,
  reorderRoadmaps, updateColumnLabel, updateRoadmap,
} from '@/modules/roadmap/service';
import * as personal from '@/modules/personal/service';
import { listNotifications, markAllRead, markRead } from '@/modules/notifications/service';
import { text, zLimit, zRevision, zUuid } from '@/modules/shared/text';
import { mutate } from './helpers';

async function teamProduct(ctx: Ctx) {
  const user = requireTeam(ctx);
  const productId = uuidParam(ctx, 'p');
  await requireProduct(getSql(), productId);
  return { user, productId };
}

const zMove = {
  feedbackId: zUuid,
  targetColumnId: zUuid,
  beforeFeedbackId: zUuid.nullable().default(null),
  afterFeedbackId: zUuid.nullable().default(null),
};

export function registerWorkRoutes(r: Router) {
  // ---------------- Schedule ----------------
  r.get('/products/:p/feedback/:f/schedule', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    return { data: await getSchedule(getSql(), productId, uuidParam(ctx, 'f')) };
  });

  r.post('/products/:p/feedback/:f/schedule/rows', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const feedbackId = uuidParam(ctx, 'f');
    const body = await ctx.body(z.object({ expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ status: 201, data: await addRow(tx, user, productId, feedbackId, body.expectedRevision) }));
  });

  r.get('/products/:p/feedback/:f/schedule/comments', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const q = ctx.query(z.object({ cursor: z.string().max(200).optional(), limit: zLimit }));
    const res = await listComments(getSql(), productId, uuidParam(ctx, 'f'), 'schedule', user.id, q);
    return { data: res.items, meta: { nextCursor: res.nextCursor } };
  });

  r.post('/products/:p/feedback/:f/schedule/comments', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const feedbackId = uuidParam(ctx, 'f');
    // body is parsed by the schedule grammar; failures leave no comment, entry, history or notification
    const body = await ctx.body(z.object({ body: z.string().max(6000), replyToId: zUuid.nullable().optional(), expectedRevision: zRevision }).strict());
    return mutate(ctx, { keyRequired: true, body }, async (tx) => {
      const res = await postScheduleComment(tx, user, productId, feedbackId, body);
      return { status: 201, data: { ...res, comment: await getCommentDto(tx, res.commentId, user.id), schedule: await getSchedule(tx, productId, feedbackId) } };
    });
  });

  r.get('/products/:p/feedback/:f/schedule/history', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const q = ctx.query(z.object({ cursor: z.string().regex(/^\d+$/).optional(), limit: zLimit }));
    const res = await getScheduleHistory(getSql(), productId, uuidParam(ctx, 'f'), { limit: q.limit, beforeSeq: q.cursor ? Number(q.cursor) : undefined });
    return { data: res.items, meta: { nextCursor: res.nextCursor } };
  });

  r.delete('/products/:p/feedback/:f/schedule/history/:op', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const feedbackId = uuidParam(ctx, 'f');
    const opId = uuidParam(ctx, 'op');
    const rev = ctx.ifMatchRevision();
    return mutate(ctx, { body: { rev } }, async (tx) => {
      const res = await hideOperation(tx, user, productId, feedbackId, opId, rev);
      return { data: { ...res, schedule: await getSchedule(tx, productId, feedbackId) } };
    });
  });

  // ---------------- Roadmap ----------------
  r.get('/products/:p/roadmaps', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const [p] = await getSql()<{ revision: number }[]>`select revision from products where id = ${productId}`;
    return { data: await listRoadmaps(getSql(), productId), meta: { productRevision: p.revision } };
  });

  r.post('/products/:p/roadmaps', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const body = await ctx.body(z.object({
      name: text(1, 60, '名稱'), description: text(0, 500, '描述').default(''),
      dimension: z.enum(['status', 'category', 'tag_group'], { error: '只能選擇狀態、類別或單選 Tag 群組' }),
      tagGroupId: zUuid.nullable().default(null),
    }).strict());
    return mutate(ctx, { body }, async (tx) => ({ status: 201, data: await createRoadmap(tx, productId, body) }));
  });

  r.put('/products/:p/roadmaps/order', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const body = await ctx.body(z.object({ roadmapIds: z.array(zUuid).max(200), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await reorderRoadmaps(tx, productId, body.roadmapIds, body.expectedRevision) }));
  });

  r.patch('/products/:p/roadmaps/:r', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const roadmapId = uuidParam(ctx, 'r');
    const raw = (await ctx.rawBody()) as Record<string, unknown>;
    if (raw && typeof raw === 'object' && ('dimension' in raw || 'tagGroupId' in raw)) {
      throw new AppError('INVALID_REQUEST', '看板建立後不能修改分欄維度，請另建看板。', { fieldErrors: { dimension: '維度不可修改' } });
    }
    const body = await ctx.body(z.object({
      name: text(1, 60, '名稱').optional(), description: text(0, 500, '描述').optional(),
      sortMode: z.enum(['create_time', 'freedom']).optional(), portalPublished: z.boolean().optional(), expectedRevision: zRevision,
    }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await updateRoadmap(tx, productId, roadmapId, body, body.expectedRevision) }));
  });

  r.delete('/products/:p/roadmaps/:r', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const roadmapId = uuidParam(ctx, 'r');
    const rev = ctx.ifMatchRevision();
    return mutate(ctx, { body: { rev } }, async (tx) => {
      await deleteRoadmap(tx, productId, roadmapId, rev);
      return { data: { id: roadmapId, deleted: true } };
    });
  });

  r.get('/products/:p/roadmaps/:r/board', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const q = ctx.query(z.object({ limit: zLimit }));
    return { data: await getBoard(getSql(), productId, uuidParam(ctx, 'r'), { limitPerColumn: q.limit }) };
  });

  r.get('/products/:p/roadmaps/:r/columns', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const board = await getBoard(getSql(), productId, uuidParam(ctx, 'r'), { limitPerColumn: 0 });
    return { data: board.columns.map(({ cards: _cards, nextCursor: _n, ...c }) => c), meta: { revision: board.roadmap.revision } };
  });

  r.patch('/products/:p/roadmaps/:r/columns/:c', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const roadmapId = uuidParam(ctx, 'r');
    const columnId = uuidParam(ctx, 'c');
    const body = await ctx.body(z.object({ label: text(1, 50, '欄位名稱'), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await updateColumnLabel(tx, productId, roadmapId, columnId, body.label, body.expectedRevision) }));
  });

  r.put('/products/:p/roadmaps/:r/columns/order', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const roadmapId = uuidParam(ctx, 'r');
    const body = await ctx.body(z.object({ columnIds: z.array(zUuid).max(500), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await reorderRoadmapColumns(tx, productId, roadmapId, body.columnIds, body.expectedRevision) }));
  });

  r.get('/products/:p/roadmaps/:r/columns/:c/feedback', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const q = ctx.query(z.object({ cursor: z.string().max(100).optional(), limit: zLimit }));
    const res = await getColumnPage(getSql(), productId, uuidParam(ctx, 'r'), uuidParam(ctx, 'c'), q);
    return { data: res.items, meta: { nextCursor: res.nextCursor, total: res.total } };
  });

  r.post('/products/:p/roadmaps/:r/moves', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const roadmapId = uuidParam(ctx, 'r');
    // no extra fields: a move can never sneak in category/tag changes. The board (structure)
    // revision is not part of a move; the card's own versions scope the conflict check.
    const body = await ctx.body(z.object({ ...zMove, expectedFeedbackRevision: zRevision, expectedPlacementRevision: zRevision }).strict());
    return mutate(ctx, { keyRequired: true, body }, async (tx) => ({ data: await moveRoadmapCard(tx, user, productId, roadmapId, body) }));
  });

  // tester-visible projection: invited members only (WIN-04)
  r.get('/public/products/:slug/roadmaps', ['admin', 'portal'], async (ctx) => {
    const { product: p } = await requireProductReader(ctx, getSql(), ctx.params.slug);
    const list = await listRoadmaps(getSql(), p.id, { publicOnly: true });
    return { data: list.map((rm) => ({ id: rm.id, name: rm.name, description: rm.description })) };
  });

  r.get('/public/products/:slug/roadmaps/:r', ['admin', 'portal'], async (ctx) => {
    const { user, product: p, isTeam } = await requireProductReader(ctx, getSql(), ctx.params.slug);
    const board = await getBoard(getSql(), p.id, uuidParam(ctx, 'r'), {
      limitPerColumn: 50, publicOnly: true, viewerId: user.id, viewerCanInteract: true, viewerIsTeam: isTeam,
    });
    return {
      data: {
        roadmap: { id: board.roadmap.id, name: board.roadmap.name, description: board.roadmap.description },
        columns: board.columns.map((c) => ({ id: c.id, label: c.label, count: c.count, cards: c.cards, nextCursor: c.nextCursor })),
      },
    };
  });

  r.get('/public/products/:slug/roadmaps/:r/columns/:c/feedback', ['admin', 'portal'], async (ctx) => {
    const { user, product: p, isTeam } = await requireProductReader(ctx, getSql(), ctx.params.slug);
    const q = ctx.query(z.object({ cursor: z.string().max(100).optional(), limit: zLimit }));
    const res = await getColumnPage(getSql(), p.id, uuidParam(ctx, 'r'), uuidParam(ctx, 'c'), {
      ...q, publicOnly: true, viewerId: user.id, viewerCanInteract: true, viewerIsTeam: isTeam,
    });
    return { data: res.items, meta: { nextCursor: res.nextCursor, total: res.total } };
  });

  // ---------------- Personal (owner is always the session user) ----------------
  r.get('/products/:p/personal', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const q = ctx.query(z.object({ subjectUserId: zUuid.optional() }));
    return { data: await personal.getPersonalView(getSql(), user.id, productId, q.subjectUserId ?? user.id) };
  });

  r.post('/products/:p/personal/views', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const body = await ctx.body(z.object({ subjectUserId: zUuid }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await personal.createOrGetView(tx, user.id, productId, body.subjectUserId) }));
  });

  r.patch('/products/:p/personal/views/:v', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const viewId = uuidParam(ctx, 'v');
    const body = await ctx.body(z.object({ sortMode: z.enum(['create_time', 'freedom']), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await personal.setSortMode(tx, user.id, productId, viewId, body.sortMode, body.expectedRevision) }));
  });

  r.post('/products/:p/personal/views/:v/columns', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const viewId = uuidParam(ctx, 'v');
    const body = await ctx.body(z.object({ name: text(1, 50, '欄位名稱'), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ status: 201, data: await personal.addColumn(tx, user.id, productId, viewId, body.name, body.expectedRevision) }));
  });

  r.put('/products/:p/personal/views/:v/columns/order', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const viewId = uuidParam(ctx, 'v');
    const body = await ctx.body(z.object({ columnIds: z.array(zUuid).max(200), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await personal.reorderColumns(tx, user.id, productId, viewId, body.columnIds, body.expectedRevision) }));
  });

  r.patch('/products/:p/personal/views/:v/columns/:c', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const viewId = uuidParam(ctx, 'v');
    const columnId = uuidParam(ctx, 'c');
    const body = await ctx.body(z.object({ name: text(1, 50, '欄位名稱'), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await personal.renameColumn(tx, user.id, productId, viewId, columnId, body.name, body.expectedRevision) }));
  });

  r.delete('/products/:p/personal/views/:v/columns/:c', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const viewId = uuidParam(ctx, 'v');
    const columnId = uuidParam(ctx, 'c');
    const rev = ctx.ifMatchRevision();
    return mutate(ctx, { body: { rev } }, async (tx) => ({ data: await personal.deleteColumn(tx, user.id, productId, viewId, columnId, rev) }));
  });

  r.post('/products/:p/personal/views/:v/moves', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const viewId = uuidParam(ctx, 'v');
    // no Feedback business fields accepted here
    const body = await ctx.body(z.object({ ...zMove, expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await personal.moveCard(tx, user.id, productId, viewId, body) }));
  });

  r.get('/products/:p/personal/tags', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    return { data: await personal.listPersonalTags(getSql(), user.id, productId) };
  });

  r.post('/products/:p/personal/tags', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const body = await ctx.body(z.object({ name: text(1, 50, '名稱') }).strict());
    return mutate(ctx, { body }, async (tx) => ({ status: 201, data: await personal.createPersonalTag(tx, user.id, productId, body.name) }));
  });

  r.patch('/products/:p/personal/tags/:t', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const tagId = uuidParam(ctx, 't');
    const body = await ctx.body(z.object({ name: text(1, 50, '名稱'), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await personal.renamePersonalTag(tx, user.id, productId, tagId, body.name, body.expectedRevision) }));
  });

  r.delete('/products/:p/personal/tags/:t', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const tagId = uuidParam(ctx, 't');
    const rev = ctx.ifMatchRevision();
    return mutate(ctx, { body: { rev } }, async (tx) => {
      await personal.deletePersonalTag(tx, user.id, productId, tagId, rev);
      return { data: { id: tagId, deleted: true } };
    });
  });

  r.get('/products/:p/personal/feedback/:f/tags', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    return { data: await personal.getPersonalFeedbackTags(getSql(), user.id, productId, uuidParam(ctx, 'f')) };
  });

  r.put('/products/:p/personal/feedback/:f/tags', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const feedbackId = uuidParam(ctx, 'f');
    const body = await ctx.body(z.object({ personalTagIds: z.array(zUuid).max(100), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await personal.setPersonalFeedbackTags(tx, user.id, productId, feedbackId, body.personalTagIds, body.expectedRevision) }));
  });

  // ---------------- Notifications (own only; admin and portal) ----------------
  for (const [prefix, sites] of [['/products/:p', ['admin']], ['/portal/products/:p', ['portal']]] as const) {
    r.get(`${prefix}/notifications`, [...sites], async (ctx) => {
      // membership before the product lookup: non-members get the 404 of an unknown product
      const user = requireReader(ctx);
      const productId = uuidParam(ctx, 'p');
      await requireProduct(getSql(), productId);
      if (!(await hasProductInteraction(getSql(), user, productId))) throw new AppError('NOT_FOUND');
      if (prefix === '/products/:p') requireTeam(ctx);
      const q = ctx.query(z.object({ unread: z.enum(['true', 'false']).optional(), cursor: z.string().max(200).optional(), limit: zLimit }));
      const res = await listNotifications(getSql(), user, productId, { unreadOnly: q.unread === 'true', cursor: q.cursor, limit: q.limit });
      return { data: res.items, meta: { unreadCount: res.unreadCount, nextCursor: res.nextCursor } };
    });
    r.put(`${prefix}/notifications/read`, [...sites], async (ctx) => {
      const user = requireUser(ctx);
      const productId = uuidParam(ctx, 'p');
      const body = await ctx.body(z.object({ before: z.iso.datetime({ offset: true }).nullable().default(null) }).strict());
      return mutate(ctx, { body }, async (tx) => ({ data: await markAllRead(tx, user.id, productId, body.before) }));
    });
    r.put(`${prefix}/notifications/:n/read`, [...sites], async (ctx) => {
      const user = requireUser(ctx);
      const productId = uuidParam(ctx, 'p');
      const id = uuidParam(ctx, 'n');
      return mutate(ctx, { body: {} }, async (tx) => {
        await markRead(tx, user.id, productId, id);
        return { data: { id, read: true } };
      });
    });
  }
}
