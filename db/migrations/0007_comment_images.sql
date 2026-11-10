-- Follow-up UI/UX batch (2026-11-10), COMMENT-05/06 and DETAIL-03.
--
-- Additive, plus one constraint made deferrable; no data is changed or removed.
--
-- 1. Comment images: at most 5 per comment, the same limits, storage and lifecycle as Feedback images
--    (migration 0006). An image is uploaded before its comment exists ("pending": comment_id is null)
--    and attached when the same person posts the comment in the same product. Files live in the
--    existing private storage under comment-images/<product>/<image>-(original|thumb).<ext> and are only
--    served by API routes that check the Feedback's current access on every read. Rows are removed
--    with their files (outbox job 'storage.delete') when the comment, its Feedback or the product goes.
-- 2. Editing a Feedback can reorder its images, so their unique (feedback_id, position) is checked at
--    the end of the transaction instead of row by row.

alter table feedback_images drop constraint feedback_images_feedback_id_position_key;
alter table feedback_images add constraint feedback_images_feedback_id_position_key
  unique (feedback_id, position) deferrable initially deferred;

create table comment_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  comment_id uuid references comments (id),
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
  -- attached images have a place (0-4); pending ones have neither
  check ((comment_id is null) = (position is null) and (comment_id is null) = (attached_at is null)),
  unique (comment_id, position)
);
create index comment_images_pending_idx on comment_images (uploader_id, product_id, created_at) where comment_id is null;
create index comment_images_product_idx on comment_images (product_id);
