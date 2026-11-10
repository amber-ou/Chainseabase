-- Feedback views (2026-11-10, LIST-01..15): the admin Feedback list is a set of filter tables shared by
-- every team member of a product. Additive only; no existing row is changed.
--
-- - feedback_view_lists: one row per product. `revision` guards the set and order of its views (create,
--   reorder, remove); `seeded_at` records that the initial 新貼文 view was made once, so a view a team
--   member removed is never added back; `next_color` hands out the header colours in a fixed order.
-- - feedback_views: one filter each, a status OR a tag (never both, never changed after creation), with
--   its colour, position, sort mode and own `revision` (guards its sort mode and row order). Removing a
--   status or tag removes its views (cascade): a view never silently changes what it filters.
-- - feedback_view_ranks: the manual row order of one view. Only Feedback ids and positions: removing a
--   view (cascade) or a Feedback never changes the Feedback itself, its status or tags, or other views.

create table feedback_view_lists (
  product_id uuid primary key references products (id),
  revision integer not null default 1,
  next_color integer not null default 0,
  seeded_at timestamptz
);

create table feedback_views (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references feedback_view_lists (product_id),
  status_id uuid references statuses (id) on delete cascade,
  tag_id uuid references tags (id) on delete cascade,
  color text not null check (color in ('blue', 'sand', 'green', 'lilac', 'rose', 'teal')),
  position integer not null,
  sort_mode text not null default 'created' check (sort_mode in ('created', 'manual')),
  revision integer not null default 1,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  check ((status_id is null) <> (tag_id is null))
);
create index feedback_views_product_idx on feedback_views (product_id, position);
-- one view per condition in a product
create unique index feedback_views_status_uq on feedback_views (product_id, status_id) where status_id is not null;
create unique index feedback_views_tag_uq on feedback_views (product_id, tag_id) where tag_id is not null;

create table feedback_view_ranks (
  view_id uuid not null references feedback_views (id) on delete cascade,
  feedback_id uuid not null references feedback (id) on delete cascade,
  rank integer not null,
  primary key (view_id, feedback_id)
);
create index feedback_view_ranks_order_idx on feedback_view_ranks (view_id, rank);
