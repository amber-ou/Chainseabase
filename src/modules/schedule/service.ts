import type { Db } from '@/server/db';
import { AppError, assertRevision, invalid } from '@/server/errors';
import { emitNotificationEvent } from '@/server/events';
import { avatarUrlFor, userRef } from '@/modules/shared/users';
import { iso } from '@/modules/shared/text';
import { coordinate, parseScheduleInput, SCHEDULE_COLUMNS } from './parser';
import type { DraftAction } from './draft';

export type { DraftAction } from './draft';

export interface ScheduleActor { id: string; displayName: string; avatarPath: string | null; googlePictureUrl: string | null; revision: number }

export async function createScheduleForFeedback(tx: Db, productId: string, feedbackId: string, actorId: string) {
  await tx`insert into schedules (feedback_id, product_id) values (${feedbackId}, ${productId})`;
  await tx`insert into schedule_rows (feedback_id, product_id, display_row, created_by) values (${feedbackId}, ${productId}, 2, ${actorId})`;
}

/** Lock the schedule (feedback must be live in this product). */
export async function lockSchedule(tx: Db, productId: string, feedbackId: string) {
  const [row] = await tx<{ revision: number; authorId: string }[]>`
    select s.revision, f.author_id from schedules s join feedback f on f.id = s.feedback_id
    where s.feedback_id = ${feedbackId} and s.product_id = ${productId} and f.deleted_at is null
    for update of s
  `;
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}

async function bump(tx: Db, feedbackId: string): Promise<number> {
  const [r] = await tx<{ revision: number }[]>`update schedules set revision = revision + 1 where feedback_id = ${feedbackId} returning revision`;
  return r.revision;
}

async function insertOp(
  tx: Db, op: {
    feedbackId: string; productId: string; actorId: string; type: string; rowId?: string | null; column?: number | null;
    commentId?: string | null; targetOperationId?: string | null; affected?: string[]; payload?: Record<string, unknown>;
  },
): Promise<string> {
  const [r] = await tx<{ id: string }[]>`
    insert into schedule_operations (feedback_id, product_id, actor_id, type, row_id, column_index, comment_id, target_operation_id, affected_entry_ids, payload)
    values (${op.feedbackId}, ${op.productId}, ${op.actorId}, ${op.type}, ${op.rowId ?? null}, ${op.column ?? null},
            ${op.commentId ?? null}, ${op.targetOperationId ?? null}, ${op.affected ?? []}::uuid[], ${tx.json((op.payload ?? {}) as never)})
    returning id
  `;
  return r.id;
}

export async function addRowTx(tx: Db, actor: ScheduleActor, productId: string, feedbackId: string) {
  const [{ next }] = await tx<{ next: number }[]>`select max(display_row)::int + 1 as next from schedule_rows where feedback_id = ${feedbackId}`;
  const [row] = await tx<{ id: string; displayRow: number }[]>`
    insert into schedule_rows (feedback_id, product_id, display_row, created_by) values (${feedbackId}, ${productId}, ${next}, ${actor.id})
    returning id, display_row
  `;
  const operationId = await insertOp(tx, { feedbackId, productId, actorId: actor.id, type: 'row.add', rowId: row.id, payload: { displayRow: row.displayRow } });
  return { row, operationId };
}

export interface PostResult {
  commentId: string;
  operationId: string;
  kind: 'normal' | 'command';
  affectedCell: { row: number; column: number } | null;
  affectedEntryIds: string[];
  affectedCount: number;
  action: 'append' | 'clear' | null;
}

export async function postScheduleCommentTx(
  tx: Db, actor: ScheduleActor, productId: string, feedbackId: string, input: { body: string; replyToId?: string | null },
): Promise<PostResult> {
  const parsed = parseScheduleInput(input.body);
  if (parsed.kind === 'error') {
    const code = parsed.code === 'INVALID_COORDINATE' ? 'INVALID_COORDINATE' : parsed.code === 'INVALID_COMMAND' ? 'INVALID_COMMAND' : 'INVALID_REQUEST';
    throw new AppError(code, parsed.message, { fieldErrors: { body: parsed.message } });
  }
  let quotedAuthorId: string | null = null;
  if (input.replyToId) {
    const [parent] = await tx<{ authorId: string }[]>`
      select author_id from comments where id = ${input.replyToId} and feedback_id = ${feedbackId} and stream = 'schedule'
    `;
    if (!parent) throw invalid('找不到要回覆的留言。', { replyToId: '留言不存在' });
    if (parsed.kind === 'command') throw invalid('回覆為普通留言，不能執行指令。', { body: '回覆不能包含指令' });
    quotedAuthorId = parent.authorId;
  }
  if (parsed.kind === 'normal') {
    const [c] = await tx<{ id: string }[]>`
      insert into comments (product_id, feedback_id, stream, kind, body, author_id, reply_to_id, quoted_author_id)
      values (${productId}, ${feedbackId}, 'schedule', 'normal', ${parsed.body}, ${actor.id}, ${input.replyToId ?? null}, ${quotedAuthorId})
      returning id
    `;
    const operationId = await insertOp(tx, { feedbackId, productId, actorId: actor.id, type: 'comment.create', commentId: c.id });
    return { commentId: c.id, operationId, kind: 'normal', affectedCell: null, affectedEntryIds: [], affectedCount: 0, action: null };
  }
  const [row] = await tx<{ id: string }[]>`select id from schedule_rows where feedback_id = ${feedbackId} and display_row = ${parsed.row}`;
  if (!row) throw new AppError('INVALID_COORDINATE', `第 ${parsed.row} 列不存在。`, { fieldErrors: { body: `第 ${parsed.row} 列不存在` } });
  const [c] = await tx<{ id: string }[]>`
    insert into comments (product_id, feedback_id, stream, kind, body, author_id)
    values (${productId}, ${feedbackId}, 'schedule', 'command', ${parsed.body}, ${actor.id})
    returning id
  `;
  if (parsed.action === 'append') {
    const operationId = await insertOp(tx, {
      feedbackId, productId, actorId: actor.id, type: 'command.append', rowId: row.id, column: parsed.column, commentId: c.id,
      payload: { displayRow: parsed.row, text: parsed.payload.slice(0, 80) },
    });
    const [entry] = await tx<{ id: string }[]>`
      insert into schedule_entries (feedback_id, row_id, column_index, author_id, author_name_snapshot, avatar_ref, body, operation_id)
      values (${feedbackId}, ${row.id}, ${parsed.column}, ${actor.id}, ${actor.displayName}, ${avatarUrlFor(actor)}, ${parsed.payload}, ${operationId})
      returning id
    `;
    await tx`update schedule_operations set affected_entry_ids = ${[entry.id]}::uuid[] where id = ${operationId}`;
    return { commentId: c.id, operationId, kind: 'command', affectedCell: { row: parsed.row, column: parsed.column }, affectedEntryIds: [entry.id], affectedCount: 1, action: 'append' };
  }
  const operationId = await insertOp(tx, {
    feedbackId, productId, actorId: actor.id, type: 'command.clear', rowId: row.id, column: parsed.column, commentId: c.id,
    payload: { displayRow: parsed.row },
  });
  // clear exactly the entries live at this moment (schedule row is locked)
  const cleared = await tx<{ id: string }[]>`
    update schedule_entries set removed_at = now(), removed_reason = 'clear', removed_by_operation_id = ${operationId}
    where row_id = ${row.id} and column_index = ${parsed.column} and removed_at is null
    returning id
  `;
  const ids = cleared.map((r) => r.id);
  await tx`update schedule_operations set affected_entry_ids = ${ids}::uuid[], payload = payload || ${tx.json({ affectedCount: ids.length } as never)} where id = ${operationId}`;
  return { commentId: c.id, operationId, kind: 'command', affectedCell: { row: parsed.row, column: parsed.column }, affectedEntryIds: ids, affectedCount: ids.length, action: 'clear' };
}

/** Hide a history record. Only an append's own entry is removed; nothing is ever restored. */
export async function hideOperationTx(tx: Db, actor: ScheduleActor, productId: string, feedbackId: string, operationId: string) {
  const [op] = await tx<{ id: string; type: string; hiddenAt: Date | null; affectedEntryIds: string[] }[]>`
    select id, type, hidden_at, affected_entry_ids from schedule_operations where id = ${operationId} and feedback_id = ${feedbackId}
  `;
  if (!op || op.hiddenAt) throw new AppError('NOT_FOUND');
  const hideId = await insertOp(tx, { feedbackId, productId, actorId: actor.id, type: 'history.hide', targetOperationId: op.id, payload: { targetType: op.type } });
  let removedEntryIds: string[] = [];
  if (op.type === 'command.append') {
    const removed = await tx<{ id: string }[]>`
      update schedule_entries set removed_at = now(), removed_reason = 'history_hide', removed_by_operation_id = ${hideId}
      where operation_id = ${op.id} and removed_at is null
      returning id
    `;
    removedEntryIds = removed.map((r) => r.id);
  }
  await tx`update schedule_operations set hidden_at = now(), hidden_by = ${actor.id}, hidden_by_operation_id = ${hideId} where id = ${op.id}`;
  await tx`update schedule_operations set affected_entry_ids = ${removedEntryIds}::uuid[] where id = ${hideId}`;
  return { hideOperationId: hideId, removedEntryIds };
}

async function notifyScheduleComment(tx: Db, actor: ScheduleActor, productId: string, feedbackId: string, authorId: string, commentId: string) {
  await emitNotificationEvent(tx, {
    productId, actorId: actor.id, feedbackId, type: 'comment.created',
    intents: [{ recipientId: authorId, reason: 'schedule_comment' }],
    extra: { commentId, stream: 'schedule' },
  });
}

// ---------------------------------------------------------------------------
// Public entry points (revision-checked)
// ---------------------------------------------------------------------------

export async function addRow(tx: Db, actor: ScheduleActor, productId: string, feedbackId: string, expectedRevision: number) {
  const s = await lockSchedule(tx, productId, feedbackId);
  assertRevision(s.revision, expectedRevision);
  const r = await addRowTx(tx, actor, productId, feedbackId);
  const revision = await bump(tx, feedbackId);
  return { scheduleRevision: revision, row: r.row, operationId: r.operationId };
}

export async function postScheduleComment(
  tx: Db, actor: ScheduleActor, productId: string, feedbackId: string, input: { body: string; replyToId?: string | null; expectedRevision: number },
) {
  const s = await lockSchedule(tx, productId, feedbackId);
  assertRevision(s.revision, input.expectedRevision);
  const result = await postScheduleCommentTx(tx, actor, productId, feedbackId, input);
  const revision = await bump(tx, feedbackId);
  await notifyScheduleComment(tx, actor, productId, feedbackId, s.authorId, result.commentId);
  return { scheduleRevision: revision, ...result };
}

export async function hideOperation(tx: Db, actor: ScheduleActor, productId: string, feedbackId: string, operationId: string, expectedRevision: number) {
  const s = await lockSchedule(tx, productId, feedbackId);
  assertRevision(s.revision, expectedRevision);
  const r = await hideOperationTx(tx, actor, productId, feedbackId, operationId);
  const revision = await bump(tx, feedbackId);
  return { scheduleRevision: revision, ...r };
}

/** Normal schedule comment edit/delete/like: same schedule lock + history record. */
export async function recordScheduleCommentOperation(
  tx: Db, actor: ScheduleActor, productId: string, feedbackId: string, type: 'comment.edit' | 'comment.delete' | 'comment.like' | 'comment.unlike',
  commentId: string, expectedRevision: number | null,
) {
  const s = await lockSchedule(tx, productId, feedbackId);
  if (expectedRevision !== null) assertRevision(s.revision, expectedRevision);
  const operationId = await insertOp(tx, { feedbackId, productId, actorId: actor.id, type, commentId });
  const revision = await bump(tx, feedbackId);
  return { scheduleRevision: revision, operationId };
}

/** Replay a create-modal draft inside the Feedback creation transaction. */
export async function replayScheduleDraft(tx: Db, actor: ScheduleActor, productId: string, feedbackId: string, actions: DraftAction[]) {
  const commentIds = new Map<string, string>();
  const operationIds = new Map<string, string>();
  const seen = new Set<string>();
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (seen.has(a.clientActionId)) throw invalid('草稿動作識別碼重複。', { [`scheduleDraft.actions.${i}`]: '重複的 clientActionId' });
    seen.add(a.clientActionId);
    const fail = (message: string) => invalid(message, { [`scheduleDraft.actions.${i}`]: message });
    try {
      if (a.type === 'row.add') {
        const r = await addRowTx(tx, actor, productId, feedbackId);
        operationIds.set(a.clientActionId, r.operationId);
      } else if (a.type === 'comment.create') {
        const replyToId = a.replyToClientActionId ? commentIds.get(a.replyToClientActionId) : null;
        if (a.replyToClientActionId && !replyToId) throw fail('找不到要回覆的草稿留言。');
        const r = await postScheduleCommentTx(tx, actor, productId, feedbackId, { body: a.body, replyToId });
        commentIds.set(a.clientActionId, r.commentId);
        operationIds.set(a.clientActionId, r.operationId);
      } else if (a.type === 'comment.edit') {
        const commentId = commentIds.get(a.targetClientActionId);
        if (!commentId) throw fail('找不到要編輯的草稿留言。');
        const body = a.body.trim();
        const parsed = parseScheduleInput(body);
        if (parsed.kind !== 'normal') throw fail('編輯後仍須為普通留言。');
        const [c] = await tx<{ kind: string }[]>`select kind from comments where id = ${commentId}`;
        if (c.kind !== 'normal') throw fail('指令留言不能編輯。');
        await tx`update comments set body = ${parsed.body}, edited_at = now(), revision = revision + 1 where id = ${commentId}`;
        operationIds.set(a.clientActionId, await insertOp(tx, { feedbackId, productId, actorId: actor.id, type: 'comment.edit', commentId }));
      } else if (a.type === 'history.hide') {
        const target = operationIds.get(a.targetClientActionId);
        if (!target) throw fail('找不到要移除的草稿操作紀錄。');
        const r = await hideOperationTx(tx, actor, productId, feedbackId, target);
        operationIds.set(a.clientActionId, r.hideOperationId);
      } else {
        throw fail('不支援的草稿動作。');
      }
    } catch (e) {
      if (e instanceof AppError && e.code !== 'INVALID_REQUEST') {
        throw new AppError(e.code, `草稿第 ${i + 1} 個動作失敗：${e.message}`, { fieldErrors: { [`scheduleDraft.actions.${i}`]: e.message } });
      }
      throw e;
    }
  }
  if (actions.length) await bump(tx, feedbackId);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getSchedule(db: Db, productId: string, feedbackId: string) {
  const [s] = await db<{ revision: number }[]>`
    select s.revision from schedules s join feedback f on f.id = s.feedback_id
    where s.feedback_id = ${feedbackId} and s.product_id = ${productId} and f.deleted_at is null
  `;
  if (!s) throw new AppError('NOT_FOUND');
  const rows = await db<{ id: string; displayRow: number }[]>`select id, display_row from schedule_rows where feedback_id = ${feedbackId} order by display_row`;
  const entries = await db<{ id: string; rowId: string; columnIndex: number; authorId: string; authorNameSnapshot: string; avatarRef: string | null; body: string; createdAt: Date; operationId: string }[]>`
    select id, row_id, column_index, author_id, author_name_snapshot, avatar_ref, body, created_at, operation_id
    from schedule_entries where feedback_id = ${feedbackId} and removed_at is null
    order by seq
  `;
  return {
    feedbackId,
    revision: s.revision,
    columns: SCHEDULE_COLUMNS,
    rows: rows.map((r) => ({
      id: r.id,
      displayRow: r.displayRow,
      cells: [1, 2, 3, 4, 5].map((col) => entries.filter((e) => e.rowId === r.id && e.columnIndex === col).map((e) => ({
        id: e.id, body: e.body, createdAt: iso(e.createdAt), operationId: e.operationId,
        author: { id: e.authorId, displayName: e.authorNameSnapshot, avatarUrl: e.avatarRef },
      }))),
    })),
  };
}

const OP_SUMMARY: Record<string, (p: Record<string, unknown>, coord: string) => string> = {
  'row.add': (p) => `新增第 ${p.displayRow} 列`,
  'command.append': (p, c) => `寫入 ${c}：${String(p.text ?? '')}`,
  'command.clear': (p, c) => `清空 ${c}（${Number(p.affectedCount ?? 0)} 筆）`,
  'comment.create': () => '新增留言',
  'comment.edit': () => '編輯留言',
  'comment.delete': () => '移除留言',
  'comment.like': () => '按讚留言',
  'comment.unlike': () => '取消按讚',
  'history.hide': (p) => `移除操作紀錄（${OP_TYPE_LABEL[String(p.targetType)] ?? '操作'}）`,
};
const OP_TYPE_LABEL: Record<string, string> = {
  'row.add': '新增列', 'command.append': '寫入', 'command.clear': '清空', 'comment.create': '留言', 'comment.edit': '編輯留言',
  'comment.delete': '移除留言', 'comment.like': '按讚', 'comment.unlike': '取消按讚', 'history.hide': '移除紀錄',
};

export async function getScheduleHistory(db: Db, productId: string, feedbackId: string, opts: { limit: number; beforeSeq?: number }) {
  await getScheduleExists(db, productId, feedbackId);
  const rows = await db<{
    id: string; type: string; columnIndex: number | null; displayRow: number | null; payload: Record<string, unknown>;
    affectedEntryIds: string[]; createdAt: Date; seq: number; targetOperationId: string | null;
    actorId: string; displayName: string; avatarPath: string | null; googlePictureUrl: string | null; revision: number;
  }[]>`
    select o.id, o.type, o.column_index, r.display_row, o.payload, o.affected_entry_ids, o.created_at, o.seq, o.target_operation_id,
           u.id as actor_id, u.display_name, u.avatar_path, u.google_picture_url, u.revision
    from schedule_operations o join users u on u.id = o.actor_id left join schedule_rows r on r.id = o.row_id
    where o.feedback_id = ${feedbackId} and o.hidden_at is null
    ${opts.beforeSeq ? db`and o.seq < ${opts.beforeSeq}` : db``}
    order by o.seq desc limit ${opts.limit + 1}
  `;
  const page = rows.slice(0, opts.limit);
  return {
    items: page.map((o) => {
      const coord = o.displayRow && o.columnIndex ? coordinate(o.displayRow, o.columnIndex) : '';
      return {
        id: o.id,
        type: o.type,
        actor: userRef({ id: o.actorId, displayName: o.displayName, avatarPath: o.avatarPath, googlePictureUrl: o.googlePictureUrl, revision: o.revision }),
        coordinate: coord || null,
        columnName: o.columnIndex ? SCHEDULE_COLUMNS[o.columnIndex - 1] : null,
        summary: (OP_SUMMARY[o.type] ?? (() => o.type))(o.payload ?? {}, coord),
        affectedCount: o.affectedEntryIds.length,
        targetOperationId: o.targetOperationId,
        createdAt: iso(o.createdAt),
      };
    }),
    nextCursor: rows.length > opts.limit ? String(page[page.length - 1].seq) : null,
  };
}

async function getScheduleExists(db: Db, productId: string, feedbackId: string) {
  const [s] = await db`
    select 1 from schedules s join feedback f on f.id = s.feedback_id
    where s.feedback_id = ${feedbackId} and s.product_id = ${productId} and f.deleted_at is null
  `;
  if (!s) throw new AppError('NOT_FOUND');
}
