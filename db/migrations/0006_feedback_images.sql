-- Phase 2 UI/UX checklist IM01-IM06 (2026-11-06): images on Feedback.
--
-- Additive only. An image is uploaded before its Feedback exists ("pending": feedback_id is null) and
-- is attached when the Feedback is created by the same person in the same product. Files live in the
-- existing private storage (IM05) under feedback-images/<product>/<image>-(original|thumb).<ext> and
-- are only served by API routes that check the Feedback's current access on every read (IM04).
-- Rows are removed together with their files (outbox job 'storage.delete'), never shared between
-- Feedback: each row owns its own two files.

create table feedback_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  feedback_id uuid,
  uploader_id uuid not null references users (id),
  position smallint check (position between 0 and 4),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  original_path text not null unique,
  thumb_path text not null unique,
  byte_size integer not null check (byte_size between 1 and 5242880),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default now(),
  attached_at timestamptz,
  foreign key (feedback_id, product_id) references feedback (id, product_id),
  -- attached images have a place (0-4); pending ones have neither
  check ((feedback_id is null) = (position is null) and (feedback_id is null) = (attached_at is null)),
  unique (feedback_id, position)
);
create index feedback_images_pending_idx on feedback_images (uploader_id, product_id, created_at) where feedback_id is null;
create index feedback_images_product_idx on feedback_images (product_id);
