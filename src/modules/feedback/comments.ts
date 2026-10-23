import type { Db } from '@/server/db';
import { AppError, assertRevision, invalid } from '@/server/errors';
import { emitNotificationEvent } from '@/server/events';
import { iso } from '@/modules/shared/text';
import { userRef, type UserRef } from '@/modules/shared/users';
import { coordinate } from '@/modules/schedule/parser';
import { recordScheduleCommentOperation, type ScheduleActor } from '@/modules/schedule/service';

export interface CommentDto {
  id: string;
  feedbackId: string;
  stream: 'general' | 'schedule';
  kind: 'normal' | 'command';
  body: string;
  author: UserRef;
  createdAt: string;
  editedAt: string | null;
  revision: number;
  likeCount: number;
  likedByMe: boolean;
  replyTo: null | { id: string; author: string; excerpt: string | null; removed: boolean };
  command: null | {
    operationId: string; action: 'append' | 'clear'; coordinate: string; historyRemoved: boolean; contentCleared: boolean; affectedCount: number;
  };
}

interface Row {
  id: string; feedbackId: string; stream: 'general' | 'schedule'; kind: 'normal' | 'command'; body: string;
  authorId: string; displayName: string; avatarPath: string | null; googlePictureUrl: string | null; userRevision: number;
  createdAt: Date; editedAt: Date | null; revision: number; likeCount: number; likedByMe: boolean;
  replyToId: string | null; parentDeleted: Date | null; parentBody: string | null; parentAuthor: string | null;
  opId: string | null; opType: string | null; opHidden: Date | null; opAffected: string[] | null; displayRow: number | null; columnIndex: number | null;
  entryRemovedReason: string | null;
  seq: number;
}

function toDto(r: Row): CommentDto {
  return {
    id: r.id,
    feedbackId: r.feedbackId,
    stream: r.stream,
    kind: r.kind,
    body: r.body,
    author: userRef({ id: r.authorId, displayName: r.displayName, avatarPath: r.avatarPath, googlePictureUrl: r.googlePictureUrl, revision: r.userRevision }),
    createdAt: iso(r.createdAt)!,
    editedAt: iso(r.editedAt),
    revision: r.revision,
    likeCount: r.likeCount,
    likedByMe: r.likedByMe,
    replyTo: r.replyToId
      ? { id: r.replyToId, author: r.parentAuthor ?? '', removed: Boolean(r.parentDeleted), excerpt: r.parentDeleted ? null : (r.parentBody ?? '').slice(0, 120) }
      : null,
    command: r.kind === 'command' && r.opId
      ? {
          operationId: r.opId,
          action: r.opType === 'command.clear' ? 'clear' : 'append',
          coordinate: r.displayRow && r.columnIndex ? coordinate(r.displayRow, r.columnIndex) : '',
          historyRemoved: Boolean(r.opHidden),
          contentCleared: r.opType === 'command.append' && r.entryRemovedReason === 'clear',
          affectedCount: r.opAffected?.length ?? 0,
        }
      : null,
  };
}

async function queryComments(db: Db, where: ReturnType<Db>, viewerId: string | null, cursor: string | undefined, limit: number) {
  // server acceptance order (insertion sequence), ascending
  const afterSeq = cursor && /^\d{1,15}$/.test(cursor) ? Number(cursor) : null;
  const rows = await db<Row[]>`
    select c.id, c.feedback_id, c.stream, c.kind, c.body, c.author_id, u.display_name, u.avatar_path, u.google_picture_url,
           u.revision as user_revision, c.created_at, c.edited_at, c.revision, c.reply_to_id, c.seq,
           (select count(*)::int from comment_likes l where l.comment_id = c.id) as like_count,
           exists (select 1 from comment_likes l where l.comment_id = c.id and l.user_id = ${viewerId}) as liked_by_me,
           p.deleted_at as parent_deleted, p.body as parent_body, pu.display_name as parent_author,
           o.id as op_id, o.type as op_type, o.hidden_at as op_hidden, o.affected_entry_ids as op_affected,
           r.display_row, o.column_index,
           (select e.removed_reason from schedule_entries e where e.operation_id = o.id) as entry_removed_reason
    from comments c
    join users u on u.id = c.author_id
    left join comments p on p.id = c.reply_to_id
    left join users pu on pu.id = p.author_id
    left join schedule_operations o on o.comment_id = c.id and o.type in ('command.append', 'command.clear')
    left join schedule_rows r on r.id = o.row_id
    where ${where} and c.deleted_at is null
    ${afterSeq !== null ? db`and c.seq > ${afterSeq}` : db``}
    order by c.seq
    limit ${limit + 1}
  `;
  const page = rows.slice(0, limit);
  return {
    items: page.map(toDto),
    nextCursor: rows.length > limit ? String(page[page.length - 1].seq) : null,
  };
}

export async function listComments(
  db: Db, productId: string, feedbackId: string, stream: 'general' | 'schedule', viewerId: string | null, opts: { cursor?: string; limit: number },
) {
  const [f] = await db`select 1 from feedback where id = ${feedbackId} and product_id = ${productId} and deleted_at is null`;
  if (!f) throw new AppError('NOT_FOUND');
  return queryComments(db, db`c.feedback_id = ${feedbackId} and c.stream = ${stream}`, viewerId, opts.cursor, opts.limit);
}

/** Public projection: general normal comments of a public feedback only. */
export async function listPublicComments(db: Db, productId: string, feedbackId: string, viewerId: string | null, opts: { cursor?: string; limit: number }) {
  const [f] = await db`select 1 from feedback where id = ${feedbackId} and product_id = ${productId} and deleted_at is null and visibility = 'public'`;
  if (!f) throw new AppError('NOT_FOUND');
  const res = await queryComments(db, db`c.feedback_id = ${feedbackId} and c.stream = 'general' and c.kind = 'normal'`, viewerId, opts.cursor, opts.limit);
  // allowlist: drop command metadata (never present for general) and keep public fields only
  return { ...res, items: res.items.map((i) => ({ ...i, command: null })) };
}

async function lockLiveFeedback(tx: Db, productId: string, feedbackId: string) {
  const [f] = await tx<{ authorId: string; visibility: string }[]>`
    select author_id, visibility from feedback where id = ${feedbackId} and product_id = ${productId} and deleted_at is null for share
  `;
  if (!f) throw new AppError('NOT_FOUND');
  return f;
}

export async function createGeneralComment(
  tx: Db, actor: ScheduleActor, productId: string, feedbackId: string, input: { body: string; replyToId?: string | null }, mode: 'team' | 'portal',
) {
  const f = await lockLiveFeedback(tx, productId, feedbackId);
  if (mode === 'portal' && f.visibility !== 'public') throw new AppError('NOT_FOUND');
  let quotedAuthorId: string | null = null;
  if (input.replyToId) {
    const [parent] = await tx<{ authorId: string }[]>`
      select author_id from comments where id = ${input.replyToId} and feedback_id = ${feedbackId} and stream = 'general' and deleted_at is null
    `;
    if (!parent) throw invalid('找不到要回覆的留言。', { replyToId: '留言不存在' });
    quotedAuthorId = parent.authorId;
  }
  const [c] = await tx<{ id: string }[]>`
    insert into comments (product_id, feedback_id, stream, kind, body, author_id, reply_to_id, quoted_author_id)
    values (${productId}, ${feedbackId}, 'general', 'normal', ${input.body}, ${actor.id}, ${input.replyToId ?? null}, ${quotedAuthorId})
    returning id
  `;
  await emitNotificationEvent(tx, {
    productId, actorId: actor.id, feedbackId, type: 'comment.created',
    intents: [{ recipientId: f.authorId, reason: 'comment' }],
    extra: { commentId: c.id, stream: 'general' },
  });
  return c.id;
}

export async function getCommentDto(db: Db, commentId: string, viewerId: string | null): Promise<CommentDto> {
  const res = await queryComments(db, db`c.id = ${commentId}`, viewerId, undefined, 1);
  if (!res.items[0]) throw new AppError('NOT_FOUND');
  return res.items[0];
}

async function lockComment(tx: Db, productId: string, commentId: string) {
  const [c] = await tx<{ id: string; feedbackId: string; stream: string; kind: string; authorId: string; revision: number; visibility: string }[]>`
    select c.id, c.feedback_id, c.stream, c.kind, c.author_id, c.revision, f.visibility
    from comments c join feedback f on f.id = c.feedback_id
    where c.id = ${commentId} and c.product_id = ${productId} and c.deleted_at is null and f.deleted_at is null
    for update of c
  `;
  if (!c) throw new AppError('NOT_FOUND');
  return c;
}

export async function editComment(
  tx: Db, actor: ScheduleActor, productId: string, commentId: string,
  input: { body: string; expectedRevision: number; expectedScheduleRevision?: number }, mode: 'team' | 'portal',
) {
  const c = await lockComment(tx, productId, commentId);
  if (mode === 'portal' && (c.stream !== 'general' || c.visibility !== 'public')) throw new AppError('NOT_FOUND');
  if (c.kind === 'command') throw new AppError('ACTION_FORBIDDEN', '指令留言不能編輯，請透過操作歷史移除。');
  if (mode === 'portal' && c.authorId !== actor.id) throw new AppError('ACTION_FORBIDDEN', '只能編輯自己的留言。');
  assertRevision(c.revision, input.expectedRevision);
  if (c.stream === 'schedule' && input.body.trim().startsWith('/')) throw invalid('編輯後仍須為普通留言。', { body: '不能改成指令' });
  let scheduleRevision: number | undefined;
  if (c.stream === 'schedule') {
    if (input.expectedScheduleRevision === undefined) throw new AppError('REVISION_REQUIRED', '編輯 Schedule 留言需要 Schedule 版本。');
    scheduleRevision = (await recordScheduleCommentOperation(tx, actor, productId, c.feedbackId, 'comment.edit', commentId, input.expectedScheduleRevision)).scheduleRevision;
  }
  await tx`update comments set body = ${input.body}, edited_at = now(), revision = revision + 1 where id = ${commentId}`;
  return { scheduleRevision };
}

export async function deleteComment(tx: Db, actor: ScheduleActor, productId: string, commentId: string, expectedRevision: number, expectedScheduleRevision?: number) {
  const c = await lockComment(tx, productId, commentId);
  if (c.kind === 'command') throw new AppError('ACTION_FORBIDDEN', '指令留言不能直接刪除，請透過操作歷史移除。');
  assertRevision(c.revision, expectedRevision);
  let scheduleRevision: number | undefined;
  if (c.stream === 'schedule') {
    if (expectedScheduleRevision === undefined) throw new AppError('REVISION_REQUIRED', '移除 Schedule 留言需要 Schedule 版本。');
    scheduleRevision = (await recordScheduleCommentOperation(tx, actor, productId, c.feedbackId, 'comment.delete', commentId, expectedScheduleRevision)).scheduleRevision;
  }
  await tx`update comments set deleted_at = now(), revision = revision + 1 where id = ${commentId}`;
  return { scheduleRevision };
}

/** PUT/DELETE semantics: set the like to exist or not exist. */
export async function setCommentLike(tx: Db, actor: ScheduleActor, productId: string, commentId: string, liked: boolean, mode: 'team' | 'portal') {
  const c = await lockComment(tx, productId, commentId);
  if (mode === 'portal' && (c.stream !== 'general' || c.visibility !== 'public')) throw new AppError('NOT_FOUND');
  if (c.kind === 'command') throw new AppError('ACTION_FORBIDDEN', '指令留言不提供按讚。');
  const changed = liked
    ? (await tx`insert into comment_likes (comment_id, user_id) values (${commentId}, ${actor.id}) on conflict do nothing returning comment_id`).length > 0
    : (await tx`delete from comment_likes where comment_id = ${commentId} and user_id = ${actor.id} returning comment_id`).length > 0;
  let scheduleRevision: number | undefined;
  if (changed && c.stream === 'schedule') {
    scheduleRevision = (await recordScheduleCommentOperation(tx, actor, productId, c.feedbackId, liked ? 'comment.like' : 'comment.unlike', commentId, null)).scheduleRevision;
  }
  const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from comment_likes where comment_id = ${commentId}`;
  return { liked, likeCount: count, scheduleRevision };
}

export async function setVote(tx: Db, actorId: string, productId: string, feedbackId: string, voted: boolean) {
  const [f] = await tx`select 1 from feedback where id = ${feedbackId} and product_id = ${productId} and deleted_at is null and visibility = 'public' for share`;
  if (!f) throw new AppError('NOT_FOUND');
  if (voted) await tx`insert into feedback_votes (feedback_id, user_id) values (${feedbackId}, ${actorId}) on conflict do nothing`;
  else await tx`delete from feedback_votes where feedback_id = ${feedbackId} and user_id = ${actorId}`;
  const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from feedback_votes where feedback_id = ${feedbackId}`;
  return { voted, voteCount: count };
}
