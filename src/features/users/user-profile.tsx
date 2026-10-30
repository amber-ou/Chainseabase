'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useResource } from '@/client/hooks';
import { relativeTime } from '@/client/format';
import { Avatar, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconChevronLeft } from '@/components/icons';
import { useProduct } from '@/features/admin/shell';
import type { Feedback } from '@/features/feedback/types';
import type { ProductUser } from './users-page';

interface UserComment { id: string; feedback: { id: string; title: string }; stream: 'general' | 'schedule'; kind: string; body: string; createdAt: string }

export function UserProfilePage() {
  const { product } = useProduct();
  const { userId } = useParams<{ userId: string }>();
  const user = useResource<ProductUser & { commentCount: number }>(`/products/${product.id}/users/${userId}`);
  const [tab, setTab] = useState('feedback');
  const feedback = useResource<Feedback[]>(tab === 'feedback' ? `/products/${product.id}/users/${userId}/feedback?limit=100` : null);
  const comments = useResource<UserComment[]>(tab === 'comments' ? `/products/${product.id}/users/${userId}/comments?limit=100` : null);
  if (user.loading) return <LoadingState />;
  if (user.error || !user.data) return <ErrorState title={user.error?.isNotFound ? '找不到成員' : '讀取失敗'} message={user.error?.isNotFound ? '此成員不在目前產品的名單中。' : user.error?.message} />;
  const u = user.data;
  return (
    <>
      <p style={{ marginBottom: 12 }}><Link className="btn btn-ghost btn-sm" href={`/products/${product.id}/users`}><IconChevronLeft />回到 User</Link></p>
      <div className="page-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar name={u.displayName} url={u.avatarUrl} id={u.id} size={48} />
          <div>
            <h1>{u.displayName}</h1>
            <p className="sub">{u.email} · {u.role === 'team' ? '團隊成員' : '測試成員'}{u.personTags.length ? ` · ${u.personTags.map((t) => t.name).join('、')}` : ''}</p>
          </div>
        </div>
      </div>
      <Tabs label="成員內容" value={tab} onChange={setTab} tabs={[{ id: 'feedback', label: `建立的 Feedback（${u.feedbackCount}）` }, { id: 'comments', label: `留言（${u.commentCount}）` }]}>
        {tab === 'feedback' ? (
          feedback.loading ? <LoadingState /> : feedback.error ? <ErrorState message={feedback.error.message} onRetry={feedback.reload} /> : (feedback.data ?? []).length === 0 ? <EmptyState title="在此產品沒有建立 Feedback" /> : (
            <div className="list">
              {(feedback.data ?? []).map((f) => (
                <Link key={f.id} className="list-row" href={`/products/${product.id}/feedback?item=${f.id}`}>
                  <span className="title">{f.title}</span>
                  <span className="meta"><span className="chip">{f.status.name}</span><span>{relativeTime(f.createdAt)}</span></span>
                </Link>
              ))}
            </div>
          )
        ) : (
          comments.loading ? <LoadingState /> : comments.error ? <ErrorState message={comments.error.message} onRetry={comments.reload} /> : (comments.data ?? []).length === 0 ? <EmptyState title="在此產品沒有留言" /> : (
            <div className="list">
              {(comments.data ?? []).map((c) => (
                <Link key={c.id} className="list-row" href={`/products/${product.id}/feedback?item=${c.feedback.id}`}>
                  <span className="chip">{c.stream === 'schedule' ? (c.kind === 'command' ? 'Schedule 指令' : 'Schedule') : '一般'}</span>
                  <span className="title" style={{ fontWeight: 400 }}>{c.body}</span>
                  <span className="meta"><span>{c.feedback.title}</span><span>{relativeTime(c.createdAt)}</span></span>
                </Link>
              ))}
            </div>
          )
        )}
      </Tabs>
    </>
  );
}
