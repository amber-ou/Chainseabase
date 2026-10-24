import type { Db } from '@/server/db';
import { iso } from '@/modules/shared/text';
import { userRef, type UserRef } from '@/modules/shared/users';

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export const PRIORITY_LABELS: Record<Priority, string> = { P0: '非常重要', P1: '重要', P2: '一般', P3: '低' };

export interface FeedbackTagDto { id: string; name: string; groupId: string | null; groupName: string | null; isVersion: boolean }

export interface FeedbackDto {
  id: string;
  productId: string;
  title: string;
  description: string;
  status: { id: string; name: string };
  category: { id: string; name: string };
  priority: Priority;
  visibility: 'internal' | 'public';
  source: 'admin' | 'portal';
  author: UserRef;
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** Read-only projection of the version group's single tag. */
  version: { id: string; name: string } | null;
  tags: FeedbackTagDto[];
  personTags: { id: string; name: string }[];
  voteCount: number;
  commentCount: number;
}

interface Row {
  id: string; productId: string; title: string; description: string;
  statusId: string; statusName: string; categoryId: string; categoryName: string;
  priority: Priority; visibility: 'internal' | 'public'; source: 'admin' | 'portal';
  authorId: string; authorName: string; authorAvatarPath: string | null; authorPicture: string | null; authorRevision: number;
  createdAt: Date; updatedAt: Date; revision: number; voteCount: number; commentCount: number;
}

export async function loadFeedbackDtos(db: Db, productId: string, ids: string[]): Promise<FeedbackDto[]> {
  if (ids.length === 0) return [];
  const rows = await db<Row[]>`
    select f.id, f.product_id, f.title, f.description, f.status_id, s.name as status_name,
           f.category_id, c.name as category_name, f.priority, f.visibility, f.source,
           f.author_id, u.display_name as author_name, u.avatar_path as author_avatar_path,
           u.google_picture_url as author_picture, u.revision as author_revision,
           f.created_at, f.updated_at, f.revision,
           (select count(*)::int from feedback_votes v where v.feedback_id = f.id) as vote_count,
           (select count(*)::int from comments cm where cm.feedback_id = f.id and cm.stream = 'general' and cm.deleted_at is null) as comment_count
    from feedback f
    join statuses s on s.id = f.status_id
    join categories c on c.id = f.category_id
    join users u on u.id = f.author_id
    where f.product_id = ${productId} and f.deleted_at is null and f.id in ${db(ids)}
  `;
  const tags = await db<{ feedbackId: string; id: string; name: string; groupId: string | null; groupName: string | null; systemKey: string | null }[]>`
    select ft.feedback_id, t.id, t.name, t.group_id, g.name as group_name, g.system_key
    from feedback_tags ft join tags t on t.id = ft.tag_id left join tag_groups g on g.id = t.group_id
    where ft.feedback_id in ${db(ids)}
    order by g.position nulls last, t.position, t.name
  `;
  const personTags = await db<{ feedbackId: string; id: string; name: string }[]>`
    select fpt.feedback_id, p.id, p.name from feedback_person_tags fpt join person_tags p on p.id = fpt.person_tag_id
    where fpt.feedback_id in ${db(ids)} order by p.position, p.name
  `;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.filter((id) => byId.has(id)).map((id) => {
    const r = byId.get(id)!;
    const ftags = tags.filter((t) => t.feedbackId === id).map((t) => ({
      id: t.id, name: t.name, groupId: t.groupId, groupName: t.groupName, isVersion: t.systemKey === 'version',
    }));
    const versionTags = ftags.filter((t) => t.isVersion);
    return {
      id: r.id,
      productId: r.productId,
      title: r.title,
      description: r.description,
      status: { id: r.statusId, name: r.statusName },
      category: { id: r.categoryId, name: r.categoryName },
      priority: r.priority,
      visibility: r.visibility,
      source: r.source,
      author: userRef({ id: r.authorId, displayName: r.authorName, avatarPath: r.authorAvatarPath, googlePictureUrl: r.authorPicture, revision: r.authorRevision }),
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
      revision: r.revision,
      version: versionTags.length === 1 ? { id: versionTags[0].id, name: versionTags[0].name } : null,
      tags: ftags,
      personTags: personTags.filter((p) => p.feedbackId === id).map((p) => ({ id: p.id, name: p.name })),
      voteCount: r.voteCount,
      commentCount: r.commentCount,
    };
  });
}

export async function loadFeedbackDto(db: Db, productId: string, id: string): Promise<FeedbackDto | null> {
  const [dto] = await loadFeedbackDtos(db, productId, [id]);
  return dto ?? null;
}

/** Public projection: allowlisted fields only (no tags, versions, priority, person tags, email). */
export interface PublicFeedbackDto {
  id: string;
  title: string;
  description: string;
  status: { id: string; name: string };
  author: UserRef;
  createdAt: string;
  voteCount: number;
  commentCount: number;
  myVote: boolean;
  canEdit: boolean;
  revision: number;
}

export async function loadPublicFeedbackDtos(db: Db, productId: string, ids: string[], viewerId: string | null, viewerCanInteract: boolean, viewerIsTeam: boolean): Promise<PublicFeedbackDto[]> {
  if (ids.length === 0) return [];
  const rows = await db<{
    id: string; title: string; description: string; statusId: string; statusName: string; authorId: string; authorName: string;
    authorAvatarPath: string | null; authorPicture: string | null; authorRevision: number; createdAt: Date; revision: number;
    voteCount: number; commentCount: number; myVote: boolean;
  }[]>`
    select f.id, f.title, f.description, f.status_id, s.name as status_name, f.author_id,
           u.display_name as author_name, u.avatar_path as author_avatar_path, u.google_picture_url as author_picture,
           u.revision as author_revision, f.created_at, f.revision,
           (select count(*)::int from feedback_votes v where v.feedback_id = f.id) as vote_count,
           (select count(*)::int from comments cm where cm.feedback_id = f.id and cm.stream = 'general' and cm.deleted_at is null) as comment_count,
           exists (select 1 from feedback_votes v where v.feedback_id = f.id and v.user_id = ${viewerId}) as my_vote
    from feedback f join statuses s on s.id = f.status_id join users u on u.id = f.author_id
    where f.product_id = ${productId} and f.deleted_at is null and f.visibility = 'public' and f.id in ${db(ids)}
  `;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.filter((id) => byId.has(id)).map((id) => {
    const r = byId.get(id)!;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: { id: r.statusId, name: r.statusName },
      author: userRef({ id: r.authorId, displayName: r.authorName, avatarPath: r.authorAvatarPath, googlePictureUrl: r.authorPicture, revision: r.authorRevision }),
      createdAt: iso(r.createdAt)!,
      voteCount: r.voteCount,
      commentCount: r.commentCount,
      myVote: r.myVote,
      canEdit: viewerCanInteract && (viewerIsTeam || r.authorId === viewerId),
      revision: r.revision,
    };
  });
}

export async function lockFeedback(tx: Db, productId: string, feedbackId: string) {
  const [row] = await tx<{
    id: string; productId: string; authorId: string; statusId: string; categoryId: string; visibility: string; revision: number; deletedAt: Date | null;
  }[]>`
    select id, product_id, author_id, status_id, category_id, visibility, revision, deleted_at
    from feedback where id = ${feedbackId} and product_id = ${productId} for update
  `;
  if (!row || row.deletedAt) return null;
  return row;
}
