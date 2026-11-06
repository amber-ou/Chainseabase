import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSql, type Sql } from '@/server/db';
import { migrate } from '../../scripts/migrate-lib';

/**
 * Phase 2 SC02/SC05 (2026-11-06): migration 0005 removes Schedule with its data, and only that.
 *
 * Runs in its own schema of the isolated test database (never a real database): the migrations up
 * to 0004 build the schema as an installed release has it, Schedule data and data of every other
 * kind is written, then the remaining migrations are applied. Also checks that a fresh database
 * ends with no Schedule table.
 */
const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_test';
const MIGRATIONS = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
const SCHEMA = `sc_check_${process.pid}`;
const FRESH = `sc_fresh_${process.pid}`;
let sql: Sql;
let before: string;

async function onSchema(schema: string) {
  const s = createSql(URL_, 1); // one connection, so the search_path applies to every statement
  await s.unsafe(`drop schema if exists ${schema} cascade; create schema ${schema}; set search_path to ${schema}`);
  return s;
}

beforeAll(async () => {
  if (!/test/.test(new URL(URL_).pathname)) throw new Error('Refusing to run against a database whose name does not contain "test".');
  // the migrations of the release before this change (0001-0004)
  before = await mkdtemp(path.join(os.tmpdir(), 'csb-mig-'));
  for (const f of (await readdir(MIGRATIONS)).filter((n) => /^000[1-4]_.*\.sql$/.test(n))) await copyFile(path.join(MIGRATIONS, f), path.join(before, f));
  sql = await onSchema(SCHEMA);
  expect(await migrate(sql, before)).toHaveLength(4);
});

afterAll(async () => {
  await sql?.unsafe(`drop schema if exists ${SCHEMA} cascade; drop schema if exists ${FRESH} cascade`);
  await sql?.end();
  await rm(before, { recursive: true, force: true });
});

const tablesLike = async (s: Sql, schema: string, pattern: string) =>
  (await s<{ t: string }[]>`select table_name as t from information_schema.tables where table_schema = ${schema} and table_name like ${pattern} order by 1`).map((r) => r.t);

describe('0005_remove_schedule', () => {
  it('deletes Schedule tables and records, keeps every other row, and refuses new Schedule rows', async () => {
    const one = async <T>(q: Promise<T[]>) => (await q)[0];
    const u = await one(sql<{ id: string }[]>`insert into users (verified_email, display_name, role) values ('a@example.com', '甲', 'team') returning id`);
    const v = await one(sql<{ id: string }[]>`insert into users (verified_email, display_name, role) values ('b@example.com', '乙', 'team') returning id`);
    const p = await one(sql<{ id: string }[]>`insert into products (name, slug) values ('產品', 'sc-product') returning id`);
    const st = await one(sql<{ id: string }[]>`insert into statuses (product_id, name, is_default) values (${p.id}, '新貼文', true) returning id`);
    const ca = await one(sql<{ id: string }[]>`insert into categories (product_id, name, is_default) values (${p.id}, '需求討論', true) returning id`);
    const f = await one(sql<{ id: string }[]>`
      insert into feedback (product_id, author_id, title, status_id, category_id, visibility, source)
      values (${p.id}, ${u.id}, '保留的回饋', ${st.id}, ${ca.id}, 'public', 'admin') returning id`);
    await sql`insert into feedback_votes (feedback_id, user_id) values (${f.id}, ${v.id})`;
    // general comments (kept): one with a reply and a like
    const g = await one(sql<{ id: string }[]>`insert into comments (product_id, feedback_id, stream, kind, body, author_id) values (${p.id}, ${f.id}, 'general', 'normal', '一般留言', ${v.id}) returning id`);
    const gr = await one(sql<{ id: string }[]>`insert into comments (product_id, feedback_id, stream, kind, body, author_id, reply_to_id) values (${p.id}, ${f.id}, 'general', 'normal', '一般回覆', ${u.id}, ${g.id}) returning id`);
    await sql`insert into comment_likes (comment_id, user_id) values (${g.id}, ${u.id})`;
    // Schedule (removed): the schedule, a row, a command comment with its operation and entry, a normal
    // schedule comment with a reply and a like, a hidden-history operation
    await sql`insert into schedules (feedback_id, product_id) values (${f.id}, ${p.id})`;
    const row = await one(sql<{ id: string }[]>`insert into schedule_rows (feedback_id, product_id, display_row, created_by) values (${f.id}, ${p.id}, 2, ${u.id}) returning id`);
    const sc = await one(sql<{ id: string }[]>`insert into comments (product_id, feedback_id, stream, kind, body, author_id) values (${p.id}, ${f.id}, 'schedule', 'command', '/2-3 內部工作', ${u.id}) returning id`);
    const sn = await one(sql<{ id: string }[]>`insert into comments (product_id, feedback_id, stream, kind, body, author_id) values (${p.id}, ${f.id}, 'schedule', 'normal', '排程說明', ${v.id}) returning id`);
    await sql`insert into comments (product_id, feedback_id, stream, kind, body, author_id, reply_to_id) values (${p.id}, ${f.id}, 'schedule', 'normal', '排程回覆', ${u.id}, ${sn.id})`;
    await sql`insert into comment_likes (comment_id, user_id) values (${sn.id}, ${u.id})`;
    const op = await one(sql<{ id: string }[]>`insert into schedule_operations (feedback_id, product_id, actor_id, type, row_id, column_index, comment_id) values (${f.id}, ${p.id}, ${u.id}, 'command.append', ${row.id}, 3, ${sc.id}) returning id`);
    await sql`insert into schedule_entries (feedback_id, row_id, column_index, author_id, author_name_snapshot, body, operation_id) values (${f.id}, ${row.id}, 3, ${u.id}, '甲', '內部工作', ${op.id})`;
    await sql`insert into schedule_operations (feedback_id, product_id, actor_id, type, target_operation_id) values (${f.id}, ${p.id}, ${u.id}, 'history.hide', ${op.id})`;
    // events, jobs and notifications: one for a Schedule comment (removed) and one for a general comment (kept)
    const se = await one(sql<{ id: string }[]>`insert into domain_events (product_id, actor_id, type, payload) values (${p.id}, ${v.id}, 'comment.created', ${sql.json({ feedbackId: f.id, commentId: sn.id, stream: 'schedule' } as never)}) returning id`);
    const ge = await one(sql<{ id: string }[]>`insert into domain_events (product_id, actor_id, type, payload) values (${p.id}, ${v.id}, 'comment.created', ${sql.json({ feedbackId: f.id, commentId: g.id, stream: 'general' } as never)}) returning id`);
    await sql`insert into outbox_jobs (event_id, job_type) values (${se.id}, 'notifications.fanout'), (${ge.id}, 'notifications.fanout')`;
    await sql`insert into notifications (event_id, recipient_id, product_id, feedback_id, actor_id, reason_codes) values (${se.id}, ${u.id}, ${p.id}, ${f.id}, ${v.id}, '{schedule_comment}'), (${ge.id}, ${u.id}, ${p.id}, ${f.id}, ${v.id}, '{comment}')`;
    await sql`insert into idempotency_records (actor_id, scope, key, body_hash, expires_at) values
      (${u.id}, ${`POST /products/:p/feedback/:f/schedule/comments ${p.id} p=${p.id},f=${f.id}`}, 'schedule-key-1', 'h', now() + interval '1 day'),
      (${u.id}, ${`POST /products/:p/feedback/:f/comments ${p.id} p=${p.id},f=${f.id}`}, 'comment-key-1', 'h', now() + interval '1 day')`;

    const count = async (table: string) => (await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`))[0].n;
    const kept = ['users', 'products', 'statuses', 'categories', 'feedback', 'feedback_votes'];
    const keptBefore = Object.fromEntries(await Promise.all(kept.map(async (t) => [t, await count(t)])));

    const applied = await migrate(sql, MIGRATIONS);
    expect(applied).toContain('0005_remove_schedule.sql');

    // SC02: the Schedule-only tables are gone
    expect(await tablesLike(sql, SCHEMA, 'schedule%')).toEqual([]);
    // shared tables: only the Schedule records are gone
    expect((await sql<{ id: string }[]>`select id from comments order by seq`).map((r) => r.id)).toEqual([g.id, gr.id]);
    expect(await sql`select comment_id, user_id from comment_likes`).toEqual([{ commentId: g.id, userId: u.id }]);
    expect((await sql<{ id: string }[]>`select id from domain_events`).map((r) => r.id)).toEqual([ge.id]);
    expect((await sql<{ eventId: string }[]>`select event_id from outbox_jobs`).map((r) => r.eventId)).toEqual([ge.id]);
    expect((await sql<{ reasonCodes: string[] }[]>`select reason_codes from notifications`).map((r) => r.reasonCodes)).toEqual([['comment']]);
    expect((await sql<{ key: string }[]>`select key from idempotency_records`).map((r) => r.key)).toEqual(['comment-key-1']);
    // nothing else changed
    expect(Object.fromEntries(await Promise.all(kept.map(async (t) => [t, await count(t)])))).toEqual(keptBefore);
    // comments are general and normal from now on
    await expect(sql`insert into comments (product_id, feedback_id, stream, kind, body, author_id) values (${p.id}, ${f.id}, 'schedule', 'normal', 'x', ${u.id})`).rejects.toThrow(/comments_stream_check/);
    await expect(sql`insert into comments (product_id, feedback_id, stream, kind, body, author_id) values (${p.id}, ${f.id}, 'general', 'command', 'x', ${u.id})`).rejects.toThrow(/comments_kind_check/);
    // and running the migrations again changes nothing
    expect(await migrate(sql, MIGRATIONS)).toEqual([]);
  });

  it('a fresh database ends without any Schedule table, with the images table (SC05)', async () => {
    const fresh = await onSchema(FRESH);
    try {
      await migrate(fresh, MIGRATIONS);
      expect(await tablesLike(fresh, FRESH, 'schedule%')).toEqual([]);
      expect(await tablesLike(fresh, FRESH, 'feedback_images')).toEqual(['feedback_images']);
    } finally {
      await fresh.end();
    }
  });
});
