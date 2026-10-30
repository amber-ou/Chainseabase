import { z } from 'zod';
import type { Ctx, Router } from '../http';
import { uuidParam } from '../http';
import { getSql } from '../db';
import { AppError } from '../errors';
import { listReadableProducts, requireMember, requirePortalMember, requireProduct, requireProductReader, requireTeam, requireUser } from '../authz';
import { createFeedback, listFeedback, listFeedbackIds, softDeleteFeedback, updateFeedback } from '@/modules/feedback/service';
import { loadFeedbackDto, loadPublicFeedbackDtos, lockFeedback } from '@/modules/feedback/repo';
import {
  createGeneralComment, deleteComment, editComment, getCommentDto, listComments, listPublicComments, setCommentLike, setVote,
} from '@/modules/feedback/comments';
import { text, zLimit, zRevision, zUuid } from '@/modules/shared/text';
import { mutate } from './helpers';

const zTitle = text(1, 200, '標題');
const zDescription = text(0, 20000, '描述');
const zBody = text(1, 5000, '留言');
const zPriority = z.enum(['P0', 'P1', 'P2', 'P3']);
const zClientId = z.string().min(1).max(64);

export const zDraftAction = z.discriminatedUnion('type', [
  z.object({ clientActionId: zClientId, type: z.literal('row.add') }).strict(),
  z.object({ clientActionId: zClientId, type: z.literal('comment.create'), body: z.string().max(5000), replyToClientActionId: zClientId.nullable().optional() }).strict(),
  z.object({ clientActionId: zClientId, type: z.literal('comment.edit'), targetClientActionId: zClientId, body: z.string().max(5000) }).strict(),
  z.object({ clientActionId: zClientId, type: z.literal('history.hide'), targetClientActionId: zClientId }).strict(),
]);

// Explicit allowlists: author, timestamps, source and ids can never be mass-assigned.
const classification = {
  statusId: zUuid.optional(),
  categoryId: zUuid.optional(),
  personTagIds: z.array(zUuid).max(50).optional(),
  priority: zPriority.optional(),
  versionTagId: zUuid.nullable().optional(),
  tagIds: z.array(zUuid).max(100).optional(),
  visibility: z.enum(['internal', 'public']).optional(),
};

const createSchema = z.object({
  title: zTitle,
  description: zDescription.default(''),
  ...classification,
  scheduleDraft: z.object({ actions: z.array(zDraftAction).max(200) }).strict().optional(),
}).strict();

const patchSchema = z.object({
  title: zTitle.optional(),
  description: zDescription.optional(),
  ...classification,
  expectedRevision: zRevision,
}).strict();

const listQuery = z.object({
  q: z.string().max(200).optional(),
  statusId: zUuid.optional(),
  categoryId: zUuid.optional(),
  tagIds: z.union([zUuid, z.array(zUuid)]).optional().transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  cursor: z.string().max(200).optional(),
  limit: zLimit,
});

async function teamProduct(ctx: Ctx) {
  const user = requireTeam(ctx);
  const productId = uuidParam(ctx, 'p');
  await requireProduct(getSql(), productId);
  return { user, productId };
}

/** WIN-04: the tester-visible projection is read only by invited members (see requireProductReader). */
async function reader(ctx: Ctx) {
  const { user, product, isTeam } = await requireProductReader(ctx, getSql(), ctx.params.slug);
  // a reader is always a member who may interact with this product
  return { p: product, v: { viewerId: user.id, canInteract: true, isTeam } };
}

export function registerFeedbackRoutes(r: Router) {
  // ---------------- internal (team, admin host) ----------------
  r.get('/products/:p/feedback', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const q = ctx.query(listQuery);
    const res = await listFeedback(getSql(), productId, q);
    return { data: res.items, meta: { nextCursor: res.nextCursor, total: res.total, statusCounts: res.statusCounts } };
  });

  r.post('/products/:p/feedback', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const body = await ctx.body(createSchema);
    return mutate(ctx, { keyRequired: true, body }, async (tx) => ({ status: 201, data: await createFeedback(tx, user, productId, body, 'admin') }));
  });

  r.get('/products/:p/feedback/:f', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const dto = await loadFeedbackDto(getSql(), productId, uuidParam(ctx, 'f'));
    if (!dto) throw new AppError('NOT_FOUND');
    return { data: dto };
  });

  r.patch('/products/:p/feedback/:f', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const feedbackId = uuidParam(ctx, 'f');
    const body = await ctx.body(patchSchema);
    return mutate(ctx, { body }, async (tx) => ({ data: await updateFeedback(tx, user, productId, feedbackId, body) }));
  });

  r.delete('/products/:p/feedback/:f', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const feedbackId = uuidParam(ctx, 'f');
    const rev = ctx.ifMatchRevision();
    return mutate(ctx, { body: { rev } }, async (tx) => {
      await softDeleteFeedback(tx, user, productId, feedbackId, rev);
      return { data: { id: feedbackId, deleted: true } };
    });
  });

  r.get('/products/:p/feedback/:f/comments', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const q = ctx.query(z.object({ cursor: z.string().max(200).optional(), limit: zLimit }));
    const res = await listComments(getSql(), productId, uuidParam(ctx, 'f'), 'general', user.id, q);
    return { data: res.items, meta: { nextCursor: res.nextCursor } };
  });

  r.post('/products/:p/feedback/:f/comments', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const feedbackId = uuidParam(ctx, 'f');
    const body = await ctx.body(z.object({ body: zBody, replyToId: zUuid.nullable().optional() }).strict());
    return mutate(ctx, { body }, async (tx) => {
      const id = await createGeneralComment(tx, user, productId, feedbackId, body, 'team');
      return { status: 201, data: await getCommentDto(tx, id, user.id) };
    });
  });

  r.patch('/products/:p/comments/:c', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const commentId = uuidParam(ctx, 'c');
    const body = await ctx.body(z.object({ body: zBody, expectedRevision: zRevision, expectedScheduleRevision: zRevision.optional() }).strict());
    return mutate(ctx, { body }, async (tx) => {
      const res = await editComment(tx, user, productId, commentId, body, 'team');
      return { data: { comment: await getCommentDto(tx, commentId, user.id), ...res } };
    });
  });

  r.delete('/products/:p/comments/:c', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const commentId = uuidParam(ctx, 'c');
    const rev = ctx.ifMatchRevision();
    const sched = ctx.url.searchParams.get('scheduleRevision');
    const scheduleRevision = sched === null ? undefined : Number(sched);
    if (scheduleRevision !== undefined && !Number.isInteger(scheduleRevision)) throw new AppError('INVALID_REQUEST');
    return mutate(ctx, { body: { rev, scheduleRevision } }, async (tx) => ({ data: { id: commentId, deleted: true, ...(await deleteComment(tx, user, productId, commentId, rev, scheduleRevision)) } }));
  });

  for (const method of ['put', 'delete'] as const) {
    r[method]('/products/:p/comments/:c/like', ['admin'], async (ctx) => {
      const { user, productId } = await teamProduct(ctx);
      const commentId = uuidParam(ctx, 'c');
      return mutate(ctx, { body: { method } }, async (tx) => ({ data: await setCommentLike(tx, user, productId, commentId, method === 'put', 'team') }));
    });
  }

  // ---------------- tester-visible projection (invited members only, WIN-04) ----------------
  r.get('/public/products', ['admin', 'portal'], async (ctx) => {
    // signed in: the products this account may read (none for uninvited or removed accounts)
    const user = requireUser(ctx);
    const products = await listReadableProducts(getSql(), user);
    return { data: products.map((p) => ({ id: p.id, name: p.name, slug: p.slug })) };
  });

  r.get('/public/products/:slug', ['admin', 'portal'], async (ctx) => {
    const { p, v } = await reader(ctx);
    return { data: { id: p.id, name: p.name, slug: p.slug, viewer: { loggedIn: true, canInteract: v.canInteract, isTeam: v.isTeam } } };
  });

  r.get('/public/products/:slug/feedback', ['admin', 'portal'], async (ctx) => {
    const { p, v } = await reader(ctx);
    const q = ctx.query(z.object({ q: z.string().max(200).optional(), cursor: z.string().max(200).optional(), limit: zLimit }));
    const res = await listFeedbackIds(getSql(), p.id, { ...q, publicOnly: true });
    const items = await loadPublicFeedbackDtos(getSql(), p.id, res.ids, v.viewerId, v.canInteract, v.isTeam);
    return { data: items, meta: { nextCursor: res.nextCursor, total: res.total } };
  });

  r.get('/public/products/:slug/feedback/:f', ['admin', 'portal'], async (ctx) => {
    const { p, v } = await reader(ctx);
    const [dto] = await loadPublicFeedbackDtos(getSql(), p.id, [uuidParam(ctx, 'f')], v.viewerId, v.canInteract, v.isTeam);
    if (!dto) throw new AppError('NOT_FOUND');
    return { data: dto };
  });

  r.get('/public/products/:slug/feedback/:f/comments', ['admin', 'portal'], async (ctx) => {
    const { p, v } = await reader(ctx);
    const q = ctx.query(z.object({ cursor: z.string().max(200).optional(), limit: zLimit }));
    const res = await listPublicComments(getSql(), p.id, uuidParam(ctx, 'f'), v.viewerId, q);
    return { data: res.items, meta: { nextCursor: res.nextCursor } };
  });

  // ---------------- portal interactions (team or invited tester) ----------------
  async function portalMember(ctx: Ctx) {
    // membership first, so a non-member cannot tell which product IDs exist
    requireMember(ctx);
    const productId = uuidParam(ctx, 'p');
    await requireProduct(getSql(), productId);
    const user = await requirePortalMember(ctx, getSql(), productId);
    return { user, productId };
  }

  r.post('/portal/products/:p/feedback', ['portal'], async (ctx) => {
    const { user, productId } = await portalMember(ctx);
    // only title/description are accepted; classification comes from server defaults
    const body = await ctx.body(z.object({ title: zTitle, description: zDescription.default('') }).strict());
    return mutate(ctx, { keyRequired: true, body }, async (tx) => {
      const dto = await createFeedback(tx, user, productId, { title: body.title, description: body.description }, 'portal');
      const [pub] = await loadPublicFeedbackDtos(tx, productId, [dto.id], user.id, true, user.role === 'team');
      return { status: 201, data: pub };
    });
  });

  r.patch('/portal/products/:p/feedback/:f', ['portal'], async (ctx) => {
    const { user, productId } = await portalMember(ctx);
    const feedbackId = uuidParam(ctx, 'f');
    const body = await ctx.body(z.object({ title: zTitle.optional(), description: zDescription.optional(), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => {
      const current = await lockFeedback(tx, productId, feedbackId);
      // internal (or unpublished) content is invisible on the portal, even to its author
      if (!current || current.visibility !== 'public') throw new AppError('NOT_FOUND');
      if (user.role !== 'team' && current.authorId !== user.id) throw new AppError('ACTION_FORBIDDEN', '只能編輯自己建立的 Feedback。');
      await updateFeedback(tx, user, productId, feedbackId, { title: body.title, description: body.description, expectedRevision: body.expectedRevision });
      const [pub] = await loadPublicFeedbackDtos(tx, productId, [feedbackId], user.id, true, user.role === 'team');
      return { data: pub };
    });
  });

  for (const method of ['put', 'delete'] as const) {
    r[method]('/portal/products/:p/feedback/:f/vote', ['portal'], async (ctx) => {
      const { user, productId } = await portalMember(ctx);
      const feedbackId = uuidParam(ctx, 'f');
      return mutate(ctx, { body: { method } }, async (tx) => ({ data: await setVote(tx, user.id, productId, feedbackId, method === 'put') }));
    });
    r[method]('/portal/products/:p/comments/:c/like', ['portal'], async (ctx) => {
      const { user, productId } = await portalMember(ctx);
      const commentId = uuidParam(ctx, 'c');
      return mutate(ctx, { body: { method } }, async (tx) => ({ data: await setCommentLike(tx, user, productId, commentId, method === 'put', 'portal') }));
    });
  }

  r.post('/portal/products/:p/feedback/:f/comments', ['portal'], async (ctx) => {
    const { user, productId } = await portalMember(ctx);
    const feedbackId = uuidParam(ctx, 'f');
    const body = await ctx.body(z.object({ body: zBody, replyToId: zUuid.nullable().optional() }).strict());
    return mutate(ctx, { body }, async (tx) => {
      const id = await createGeneralComment(tx, user, productId, feedbackId, body, 'portal');
      const dto = await getCommentDto(tx, id, user.id);
      return { status: 201, data: { ...dto, command: null } };
    });
  });

  r.patch('/portal/products/:p/comments/:c', ['portal'], async (ctx) => {
    const { user, productId } = await portalMember(ctx);
    const commentId = uuidParam(ctx, 'c');
    const body = await ctx.body(z.object({ body: zBody, expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => {
      await editComment(tx, user, productId, commentId, body, 'portal');
      return { data: { ...(await getCommentDto(tx, commentId, user.id)), command: null } };
    });
  });
}
