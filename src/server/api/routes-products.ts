import { z } from 'zod';
import type { Ctx, Router } from '../http';
import { uuidParam } from '../http';
import { getSql } from '../db';
import { requireProduct, requireTeam } from '../authz';
import { createProduct, listProducts, renameProduct } from '@/modules/products/service';
import {
  createOption, createPersonTag, createTag, createTagGroup, deleteOption, deletePersonTag, deleteTag, deleteTagGroup,
  getTaxonomy, optionUsage, personTagUsage, setUserPersonTags, tagUsage, updateOption, updatePersonTag, updateTag, updateTagGroup,
  type OptionKind,
} from '@/modules/products/taxonomy';
import { getProductUser, listProductUsers, listUserComments } from '@/modules/identity/users';
import { listFeedback } from '@/modules/feedback/service';
import { AppError } from '../errors';
import { text, zLimit, zRevision, zUuid } from '@/modules/shared/text';
import { mutate } from './helpers';

const zName = text(1, 50, '名稱');

async function teamProduct(ctx: Ctx) {
  requireTeam(ctx);
  const productId = uuidParam(ctx, 'p');
  await requireProduct(getSql(), productId);
  return productId;
}

const deleteBody = z.object({
  expectedRevision: zRevision,
  replacementId: zUuid.nullable().optional(),
  strategy: z.literal('detach').optional(),
}).strict();

export function registerProductRoutes(r: Router) {
  r.get('/products', ['admin'], async (ctx) => {
    requireTeam(ctx);
    return { data: await listProducts(getSql()) };
  });

  r.post('/products', ['admin'], async (ctx) => {
    requireTeam(ctx);
    const body = await ctx.body(z.object({ name: text(1, 100, '產品名稱') }).strict());
    return mutate(ctx, { body }, async (tx) => ({ status: 201, data: await createProduct(tx, { name: body.name }) }));
  });

  r.patch('/products/:p', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const body = await ctx.body(z.object({ name: text(1, 100, '產品名稱'), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await renameProduct(tx, productId, body.name, body.expectedRevision) }));
  });

  // ---- Users in product ----
  r.get('/products/:p/users', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    return { data: await listProductUsers(getSql(), productId) };
  });

  r.get('/products/:p/users/:u', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    return { data: await getProductUser(getSql(), productId, uuidParam(ctx, 'u')) };
  });

  r.get('/products/:p/users/:u/feedback', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const userId = uuidParam(ctx, 'u');
    await getProductUser(getSql(), productId, userId);
    const q = ctx.query(z.object({ cursor: z.string().max(200).optional(), limit: zLimit }));
    const res = await listFeedback(getSql(), productId, { authorId: userId, cursor: q.cursor, limit: q.limit });
    return { data: res.items, meta: { nextCursor: res.nextCursor, total: res.total } };
  });

  r.get('/products/:p/users/:u/comments', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const userId = uuidParam(ctx, 'u');
    await getProductUser(getSql(), productId, userId);
    const q = ctx.query(z.object({ limit: zLimit }));
    return { data: await listUserComments(getSql(), productId, userId, q.limit) };
  });

  r.put('/products/:p/users/:u/person-tags', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const userId = uuidParam(ctx, 'u');
    const body = await ctx.body(z.object({ personTagIds: z.array(zUuid).max(50), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await setUserPersonTags(tx, productId, userId, body.personTagIds, body.expectedRevision) }));
  });

  // ---- Taxonomy (all settings mutations use the product revision) ----
  r.get('/products/:p/taxonomy', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    return { data: await getTaxonomy(getSql(), productId) };
  });

  for (const [kind, path] of [['status', 'statuses'], ['category', 'categories']] as [OptionKind, string][]) {
    r.post(`/products/:p/${path}`, ['admin'], async (ctx) => {
      const productId = await teamProduct(ctx);
      const body = await ctx.body(z.object({ name: zName, expectedRevision: zRevision }).strict());
      return mutate(ctx, { body }, async (tx) => ({ status: 201, data: await createOption(tx, productId, kind, body.name, body.expectedRevision) }));
    });
    r.patch(`/products/:p/${path}/:id`, ['admin'], async (ctx) => {
      const productId = await teamProduct(ctx);
      const id = uuidParam(ctx, 'id');
      const body = await ctx.body(z.object({
        name: zName.optional(), position: z.number().int().min(0).max(10000).optional(), isDefault: z.boolean().optional(), expectedRevision: zRevision,
      }).strict());
      return mutate(ctx, { body }, async (tx) => ({ data: await updateOption(tx, productId, kind, id, body, body.expectedRevision) }));
    });
    r.delete(`/products/:p/${path}/:id`, ['admin'], async (ctx) => {
      const productId = await teamProduct(ctx);
      const id = uuidParam(ctx, 'id');
      const body = await ctx.body(deleteBody);
      return mutate(ctx, { body }, async (tx) => ({ data: await deleteOption(tx, productId, kind, id, body, body.expectedRevision) }));
    });
  }

  r.post('/products/:p/tag-groups', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const body = await ctx.body(z.object({ name: zName, selectionMode: z.enum(['single', 'multiple']), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ status: 201, data: await createTagGroup(tx, productId, body, body.expectedRevision) }));
  });
  r.patch('/products/:p/tag-groups/:id', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const id = uuidParam(ctx, 'id');
    const body = await ctx.body(z.object({ name: zName.optional(), selectionMode: z.enum(['single', 'multiple']).optional(), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await updateTagGroup(tx, productId, id, body, body.expectedRevision) }));
  });
  r.delete('/products/:p/tag-groups/:id', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const id = uuidParam(ctx, 'id');
    const body = await ctx.body(deleteBody);
    return mutate(ctx, { body }, async (tx) => ({ data: await deleteTagGroup(tx, productId, id, body, body.expectedRevision) }));
  });

  r.post('/products/:p/tags', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const body = await ctx.body(z.object({ name: zName, groupId: zUuid.nullable().default(null), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ status: 201, data: await createTag(tx, productId, body, body.expectedRevision) }));
  });
  r.patch('/products/:p/tags/:id', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const id = uuidParam(ctx, 'id');
    const body = await ctx.body(z.object({ name: zName.optional(), position: z.number().int().min(0).max(10000).optional(), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await updateTag(tx, productId, id, body, body.expectedRevision) }));
  });
  r.delete('/products/:p/tags/:id', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const id = uuidParam(ctx, 'id');
    const body = await ctx.body(deleteBody);
    return mutate(ctx, { body }, async (tx) => ({ data: await deleteTag(tx, productId, id, body, body.expectedRevision) }));
  });

  r.post('/products/:p/person-tags', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const body = await ctx.body(z.object({ name: zName, expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ status: 201, data: await createPersonTag(tx, productId, body.name, body.expectedRevision) }));
  });
  r.patch('/products/:p/person-tags/:id', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const id = uuidParam(ctx, 'id');
    const body = await ctx.body(z.object({ name: zName, expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await updatePersonTag(tx, productId, id, body.name, body.expectedRevision) }));
  });
  r.delete('/products/:p/person-tags/:id', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const id = uuidParam(ctx, 'id');
    const body = await ctx.body(deleteBody);
    return mutate(ctx, { body }, async (tx) => ({ data: await deletePersonTag(tx, productId, id, body, body.expectedRevision) }));
  });

  r.get('/products/:p/taxonomy/:kind/:id/usage', ['admin'], async (ctx) => {
    const productId = await teamProduct(ctx);
    const id = uuidParam(ctx, 'id');
    const db = getSql();
    switch (ctx.params.kind) {
      case 'statuses': return { data: await optionUsage(db, productId, 'status', id) };
      case 'categories': return { data: await optionUsage(db, productId, 'category', id) };
      case 'tags': return { data: await tagUsage(db, productId, id) };
      case 'person-tags': return { data: await personTagUsage(db, productId, id) };
      default: throw new AppError('NOT_FOUND');
    }
  });
}
