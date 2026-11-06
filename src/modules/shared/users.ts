export interface UserRef { id: string; displayName: string; avatarUrl: string | null }

export function avatarUrlFor(u: { id: string; avatarPath?: string | null; googlePictureUrl?: string | null; revision?: number }): string | null {
  if (u.avatarPath) return `/api/v1/avatars/${u.id}?v=${u.revision ?? 1}`;
  return u.googlePictureUrl ?? null;
}

export function userRef(u: { id: string; displayName: string; avatarPath?: string | null; googlePictureUrl?: string | null; revision?: number }): UserRef {
  return { id: u.id, displayName: u.displayName, avatarUrl: avatarUrlFor(u) };
}
