-- Phase 2 UI/UX checklist SC01-SC07 (2026-11-06): Schedule is removed permanently, with its data.
--
-- DESTRUCTIVE. Back up the database and check the backup before applying this to a real database.
-- After this migration an older release that still uses Schedule cannot run against the database;
-- going back means restoring the backup taken before it, not switching to the old release.
--
-- Only Schedule data is removed. Every statement names its rows explicitly; no cascade is used, and
-- the order follows the foreign keys:
--   schedule_entries -> schedule_operations -> schedule_rows -> schedules (Schedule-only tables)
--   schedule_operations.comment_id -> comments (so the Schedule tables go before the comments)
-- In shared tables only Schedule records are deleted:
--   comments with stream 'schedule' (their likes first), the notifications, outbox jobs and domain
--   events of Schedule comments, and idempotency records of Schedule routes.
-- Feedback, general comments, votes, products, accounts, Roadmap, Personal and Calendar are untouched.
-- The migration runner applies the file in one transaction: it either all applies or nothing does.

-- 1. Schedule-only tables (entries and operations reference rows, comments and each other)
drop table schedule_entries;
drop table schedule_operations;
drop table schedule_rows;
drop table schedules;

-- 2. Notifications, outbox jobs and domain events of Schedule comments
--    (events are written with payload.stream = 'schedule'; their notifications carry 'schedule_comment')
create temporary table schedule_event_ids on commit drop as
  select id from domain_events where payload->>'stream' = 'schedule'
  union
  select event_id from notifications where 'schedule_comment' = any(reason_codes);
delete from notifications where event_id in (select id from schedule_event_ids);
delete from outbox_jobs where event_id in (select id from schedule_event_ids);
delete from domain_events where id in (select id from schedule_event_ids);

-- 3. Schedule comments: likes first, then the comments (replies stay within one stream, enforced by
--    comments_reply_check, so no general comment replies to a Schedule comment)
delete from comment_likes where comment_id in (select id from comments where stream = 'schedule');
delete from comments where stream = 'schedule';

-- 4. Comments are general only from now on (the stream and kind columns stay, fixed to one value)
alter table comments drop constraint comments_check;
alter table comments drop constraint comments_kind_check;
alter table comments drop constraint comments_stream_check;
alter table comments add constraint comments_stream_check check (stream = 'general');
alter table comments add constraint comments_kind_check check (kind = 'normal');

-- 5. Idempotency records of Schedule routes (short-lived replay data of removed endpoints)
delete from idempotency_records where scope like '% /products/:p/feedback/:f/schedule%';
