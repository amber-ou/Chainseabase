export interface Option { id: string; name: string; position: number; isDefault?: boolean }
export interface TagDef { id: string; name: string; groupId: string | null; position: number }
export interface TagGroup { id: string; name: string; selectionMode: 'single' | 'multiple'; systemKey: 'version' | null; position: number; tags: TagDef[] }
export interface Taxonomy {
  productRevision: number;
  statuses: Option[];
  categories: Option[];
  tagGroups: TagGroup[];
  ungroupedTags: TagDef[];
  personTags: { id: string; name: string; position: number }[];
}
export interface UserRef { id: string; displayName: string; avatarUrl: string | null }
export interface FeedbackTag { id: string; name: string; groupId: string | null; groupName: string | null; isVersion: boolean }
export interface Feedback {
  id: string; productId: string; title: string; description: string;
  status: { id: string; name: string }; category: { id: string; name: string };
  priority: 'P0' | 'P1' | 'P2' | 'P3'; visibility: 'internal' | 'public'; source: 'admin' | 'portal';
  author: UserRef; createdAt: string; updatedAt: string; revision: number;
  version: { id: string; name: string } | null; tags: FeedbackTag[]; personTags: { id: string; name: string }[];
  voteCount: number; commentCount: number;
}
export interface CommentItem {
  id: string; feedbackId: string; stream: 'general' | 'schedule'; kind: 'normal' | 'command'; body: string;
  author: UserRef; createdAt: string; editedAt: string | null; revision: number; likeCount: number; likedByMe: boolean;
  replyTo: null | { id: string; author: string; excerpt: string | null; removed: boolean };
  command: null | { operationId: string; action: 'append' | 'clear'; coordinate: string; historyRemoved: boolean; contentCleared: boolean; affectedCount: number };
}

export function versionGroup(t: Taxonomy) {
  return t.tagGroups.find((g) => g.systemKey === 'version')!;
}

/** Options for the general tag picker (version is edited by its own dropdown). */
export function tagOptions(t: Taxonomy) {
  return [
    ...t.tagGroups.filter((g) => g.systemKey !== 'version').flatMap((g) => g.tags.map((tag) => ({ id: tag.id, label: tag.name, group: g.name, single: g.selectionMode === 'single' }))),
    ...t.ungroupedTags.map((tag) => ({ id: tag.id, label: tag.name, group: null })),
  ];
}
