-- Chainseabase initial schema.
-- All local IDs are UUID; timestamps are timestamptz (stored UTC).
-- Business rules that span tables are enforced by composite foreign keys,
-- constraint triggers and service-layer row locks.

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table users (
  id uuid primary key default gen_random_uuid(),
  google_sub text unique,
  verified_email text not null,
  display_name text not null check (char_length(display_name) between 1 and 100),
  google_picture_url text,
  avatar_path text,
  role text not null default 'none' check (role in ('team', 'tester', 'none')),
  membership_state text not null default 'active' check (membership_state in ('active', 'removed')),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index users_email_lower_idx on users (lower(verified_email));
create index users_role_idx on users (role) where membership_state = 'active';

create table sessions (
  id_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  site text not null check (site in ('admin', 'portal')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user_idx on sessions (user_id) where revoked_at is null;

create table bootstrap_team_grants (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by uuid references users (id)
);

-- ---------------------------------------------------------------------------
-- Products and taxonomy
-- ---------------------------------------------------------------------------

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  system_key text unique,
  created_at timestamptz not null default now(),
  revision integer not null default 1
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  role text not null check (role in ('team', 'tester')),
  token_hash text unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references users (id),
  revoked_at timestamptz,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  send_state text not null default 'pending' check (send_state in ('pending', 'sent', 'failed')),
  send_attempts integer not null default 0,
  last_sent_at timestamptz,
  last_error_code text,
  revision integer not null default 1
);
create index invitations_email_idx on invitations (email);

create table invitation_products (
  invitation_id uuid not null references invitations (id) on delete cascade,
  product_id uuid not null references products (id),
  primary key (invitation_id, product_id)
);

create table product_access (
  user_id uuid not null references users (id) on delete cascade,
  product_id uuid not null references products (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table statuses (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  name text not null check (char_length(name) between 1 and 50),
  position integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, name),
  unique (id, product_id)
);
create unique index statuses_one_default on statuses (product_id) where is_default;

create table categories (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  name text not null check (char_length(name) between 1 and 50),
  position integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, name),
  unique (id, product_id)
);
create unique index categories_one_default on categories (product_id) where is_default;

create table person_tags (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  name text not null check (char_length(name) between 1 and 50 and name <> '未安排'),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, name),
  unique (id, product_id)
);

create table user_person_tags (
  user_id uuid not null references users (id) on delete cascade,
  product_id uuid not null,
  person_tag_id uuid not null,
  primary key (user_id, person_tag_id),
  foreign key (person_tag_id, product_id) references person_tags (id, product_id) on delete cascade
);
create index user_person_tags_tag_idx on user_person_tags (person_tag_id);
create index user_person_tags_user_product_idx on user_person_tags (user_id, product_id);

create table tag_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  name text not null check (char_length(name) between 1 and 50),
  selection_mode text not null check (selection_mode in ('single', 'multiple')),
  system_key text check (system_key in ('version')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, name),
  unique (id, product_id),
  check (system_key is null or selection_mode = 'single')
);
create unique index tag_groups_one_version on tag_groups (product_id) where system_key = 'version';

create table tags (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  group_id uuid,
  name text not null check (char_length(name) between 1 and 50),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, product_id),
  unique nulls not distinct (product_id, group_id, name),
  foreign key (group_id, product_id) references tag_groups (id, product_id) on delete cascade
);
create index tags_group_idx on tags (group_id);

-- ---------------------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------------------

create table feedback (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  author_id uuid not null references users (id),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 20000),
  status_id uuid not null,
  category_id uuid not null,
  priority text not null default 'P0' check (priority in ('P0', 'P1', 'P2', 'P3')),
  visibility text not null check (visibility in ('internal', 'public')),
  source text not null check (source in ('admin', 'portal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  deleted_at timestamptz,
  deleted_by uuid references users (id),
  unique (id, product_id),
  foreign key (status_id, product_id) references statuses (id, product_id),
  foreign key (category_id, product_id) references categories (id, product_id)
);
create index feedback_list_idx on feedback (product_id, created_at desc, id desc) where deleted_at is null;
create index feedback_status_idx on feedback (product_id, status_id);
create index feedback_category_idx on feedback (product_id, category_id);
create index feedback_public_idx on feedback (product_id, created_at desc, id desc)
  where deleted_at is null and visibility = 'public';
create index feedback_author_idx on feedback (product_id, author_id);

create table feedback_tags (
  feedback_id uuid not null,
  tag_id uuid not null,
  product_id uuid not null,
  group_id uuid,
  primary key (feedback_id, tag_id),
  foreign key (feedback_id, product_id) references feedback (id, product_id) on delete cascade,
  foreign key (tag_id, product_id) references tags (id, product_id) on delete cascade
);
create index feedback_tags_tag_idx on feedback_tags (tag_id);
create index feedback_tags_group_idx on feedback_tags (feedback_id, group_id);

-- group_id is always copied from the tag's real group and the feedback row is
-- locked so concurrent writers to the same feedback serialize.
create function feedback_tags_before_write() returns trigger language plpgsql as $$
declare
  real_group uuid;
begin
  select group_id into real_group from tags where id = new.tag_id and product_id = new.product_id;
  new.group_id := real_group;
  perform 1 from feedback where id = new.feedback_id for update;
  if real_group is not null then
    perform 1 from tag_groups where id = real_group for share;
  end if;
  return new;
end;
$$;
create trigger feedback_tags_before_write
  before insert or update on feedback_tags
  for each row execute function feedback_tags_before_write();

create function feedback_tags_single_check() returns trigger language plpgsql as $$
declare
  conflict_count integer;
begin
  if new.group_id is null then
    return null;
  end if;
  select count(*) into conflict_count
  from feedback_tags ft
  join tag_groups g on g.id = ft.group_id
  where ft.feedback_id = new.feedback_id
    and ft.group_id = new.group_id
    and g.selection_mode = 'single';
  if conflict_count > 1 then
    raise exception 'single-select group % has % tags on feedback %', new.group_id, conflict_count, new.feedback_id
      using errcode = '23514', constraint = 'feedback_tags_single_select';
  end if;
  return null;
end;
$$;
create constraint trigger feedback_tags_single_check
  after insert or update on feedback_tags
  deferrable initially deferred
  for each row execute function feedback_tags_single_check();

create table feedback_person_tags (
  feedback_id uuid not null,
  person_tag_id uuid not null,
  product_id uuid not null,
  primary key (feedback_id, person_tag_id),
  foreign key (feedback_id, product_id) references feedback (id, product_id) on delete cascade,
  foreign key (person_tag_id, product_id) references person_tags (id, product_id) on delete cascade
);
create index feedback_person_tags_tag_idx on feedback_person_tags (person_tag_id);

create table comments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  feedback_id uuid not null,
  stream text not null check (stream in ('general', 'schedule')),
  kind text not null check (kind in ('normal', 'command')),
  body text not null check (char_length(body) between 1 and 5000),
  author_id uuid not null references users (id),
  reply_to_id uuid references comments (id),
  quoted_author_id uuid references users (id),
  seq bigserial not null,
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz,
  deleted_at timestamptz,
  revision integer not null default 1,
  foreign key (feedback_id, product_id) references feedback (id, product_id),
  check (stream = 'schedule' or kind = 'normal')
);
create index comments_stream_idx on comments (feedback_id, stream, seq);
create index comments_author_idx on comments (product_id, author_id);

create function comments_reply_check() returns trigger language plpgsql as $$
declare
  parent record;
begin
  if new.reply_to_id is null then
    return new;
  end if;
  select feedback_id, stream into parent from comments where id = new.reply_to_id;
  if parent.feedback_id is distinct from new.feedback_id or parent.stream is distinct from new.stream then
    raise exception 'reply must target the same feedback and stream'
      using errcode = '23514', constraint = 'comments_reply_scope';
  end if;
  return new;
end;
$$;
create trigger comments_reply_check
  before insert or update of reply_to_id on comments
  for each row execute function comments_reply_check();

create table comment_likes (
  comment_id uuid not null references comments (id),
  user_id uuid not null references users (id),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table feedback_votes (
  feedback_id uuid not null references feedback (id),
  user_id uuid not null references users (id),
  created_at timestamptz not null default now(),
  primary key (feedback_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------

create table schedules (
  feedback_id uuid primary key,
  product_id uuid not null,
  revision integer not null default 1,
  foreign key (feedback_id, product_id) references feedback (id, product_id)
);

create table schedule_rows (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references schedules (feedback_id),
  product_id uuid not null,
  display_row integer not null check (display_row >= 2),
  created_by uuid not null references users (id),
  created_at timestamptz not null default clock_timestamp(),
  unique (feedback_id, display_row)
);

create table schedule_operations (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references schedules (feedback_id),
  product_id uuid not null,
  actor_id uuid not null references users (id),
  type text not null check (type in (
    'row.add', 'command.append', 'command.clear',
    'comment.create', 'comment.edit', 'comment.delete', 'comment.like', 'comment.unlike',
    'history.hide'
  )),
  row_id uuid references schedule_rows (id),
  column_index integer check (column_index between 1 and 5),
  comment_id uuid references comments (id),
  target_operation_id uuid references schedule_operations (id),
  affected_entry_ids uuid[] not null default '{}',
  payload jsonb not null default '{}',
  seq bigserial not null,
  created_at timestamptz not null default clock_timestamp(),
  hidden_at timestamptz,
  hidden_by uuid references users (id),
  hidden_by_operation_id uuid references schedule_operations (id)
);
create index schedule_operations_feedback_idx on schedule_operations (feedback_id, seq desc);
create index schedule_operations_comment_idx on schedule_operations (comment_id);

create table schedule_entries (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references schedules (feedback_id),
  row_id uuid not null references schedule_rows (id),
  column_index integer not null check (column_index between 1 and 5),
  author_id uuid not null references users (id),
  author_name_snapshot text not null,
  avatar_ref text,
  body text not null check (char_length(body) between 1 and 5000),
  operation_id uuid not null unique references schedule_operations (id),
  seq bigserial not null,
  created_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  removed_reason text check (removed_reason in ('clear', 'history_hide')),
  removed_by_operation_id uuid references schedule_operations (id),
  check ((removed_at is null) = (removed_reason is null))
);
create index schedule_entries_cell_idx on schedule_entries (row_id, column_index, created_at, id);

-- ---------------------------------------------------------------------------
-- Roadmap
-- ---------------------------------------------------------------------------

create table roadmaps (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 500),
  dimension text not null check (dimension in ('status', 'category', 'tag_group')),
  tag_group_id uuid,
  sort_mode text not null default 'create_time' check (sort_mode in ('create_time', 'freedom')),
  ranks_initialized boolean not null default false,
  is_default boolean not null default false,
  portal_published boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (id, product_id),
  foreign key (tag_group_id, product_id) references tag_groups (id, product_id),
  check ((dimension = 'tag_group') = (tag_group_id is not null)),
  check (not portal_published or dimension = 'status')
);
create unique index roadmaps_one_default on roadmaps (product_id) where is_default;

-- dimension is immutable once created
create function roadmaps_dimension_immutable() returns trigger language plpgsql as $$
begin
  if new.dimension is distinct from old.dimension or new.tag_group_id is distinct from old.tag_group_id then
    raise exception 'roadmap dimension is immutable' using errcode = '23514', constraint = 'roadmaps_dimension_immutable';
  end if;
  return new;
end;
$$;
create trigger roadmaps_dimension_immutable
  before update on roadmaps
  for each row execute function roadmaps_dimension_immutable();

create table roadmap_columns (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid not null references roadmaps (id) on delete cascade,
  product_id uuid not null,
  label text not null check (char_length(label) between 1 and 50),
  position integer not null default 0,
  status_id uuid,
  category_id uuid,
  tag_id uuid,
  is_unclassified boolean not null default false,
  foreign key (status_id, product_id) references statuses (id, product_id) on delete cascade,
  foreign key (category_id, product_id) references categories (id, product_id) on delete cascade,
  foreign key (tag_id, product_id) references tags (id, product_id) on delete cascade,
  check (
    (status_id is not null)::int + (category_id is not null)::int + (tag_id is not null)::int + is_unclassified::int = 1
  ),
  unique (roadmap_id, status_id),
  unique (roadmap_id, category_id),
  unique (roadmap_id, tag_id)
);
create unique index roadmap_columns_one_unclassified on roadmap_columns (roadmap_id) where is_unclassified;

-- the column option type must match the roadmap dimension (and tag group)
create function roadmap_columns_dimension_check() returns trigger language plpgsql as $$
declare
  rm record;
  tag_group uuid;
begin
  select dimension, tag_group_id, product_id into rm from roadmaps where id = new.roadmap_id;
  if rm.product_id is distinct from new.product_id then
    raise exception 'roadmap column product mismatch' using errcode = '23514', constraint = 'roadmap_columns_dimension';
  end if;
  if rm.dimension = 'status' and new.status_id is null then
    raise exception 'status roadmap requires status column' using errcode = '23514', constraint = 'roadmap_columns_dimension';
  elsif rm.dimension = 'category' and new.category_id is null then
    raise exception 'category roadmap requires category column' using errcode = '23514', constraint = 'roadmap_columns_dimension';
  elsif rm.dimension = 'tag_group' then
    if new.tag_id is null and not new.is_unclassified then
      raise exception 'tag roadmap requires tag column' using errcode = '23514', constraint = 'roadmap_columns_dimension';
    end if;
    if new.tag_id is not null then
      select group_id into tag_group from tags where id = new.tag_id;
      if tag_group is distinct from rm.tag_group_id then
        raise exception 'tag column must belong to roadmap group' using errcode = '23514', constraint = 'roadmap_columns_dimension';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger roadmap_columns_dimension_check
  before insert or update on roadmap_columns
  for each row execute function roadmap_columns_dimension_check();

create table roadmap_ranks (
  roadmap_id uuid not null references roadmaps (id) on delete cascade,
  feedback_id uuid not null references feedback (id),
  column_id uuid not null references roadmap_columns (id) on delete cascade,
  rank double precision not null,
  primary key (roadmap_id, feedback_id)
);
create index roadmap_ranks_column_idx on roadmap_ranks (column_id, rank);

-- ---------------------------------------------------------------------------
-- Personal (private per owner)
-- ---------------------------------------------------------------------------

create table personal_views (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users (id),
  product_id uuid not null references products (id),
  subject_user_id uuid not null references users (id),
  sort_mode text not null default 'create_time' check (sort_mode in ('create_time', 'freedom')),
  ranks_initialized boolean not null default false,
  created_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (owner_id, product_id, subject_user_id)
);

create table personal_columns (
  id uuid primary key default gen_random_uuid(),
  view_id uuid not null references personal_views (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  position integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, view_id)
);
create unique index personal_columns_one_default on personal_columns (view_id) where is_default;

create table personal_placements (
  view_id uuid not null references personal_views (id) on delete cascade,
  feedback_id uuid not null references feedback (id),
  column_id uuid not null,
  rank double precision,
  primary key (view_id, feedback_id),
  foreign key (column_id, view_id) references personal_columns (id, view_id) on delete cascade
);
create index personal_placements_feedback_idx on personal_placements (feedback_id);

create table personal_tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users (id),
  product_id uuid not null references products (id),
  name text not null check (char_length(name) between 1 and 50),
  created_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (owner_id, product_id, name),
  unique (id, owner_id, product_id)
);

create table personal_feedback_metadata (
  owner_id uuid not null references users (id),
  product_id uuid not null,
  feedback_id uuid not null,
  revision integer not null default 1,
  primary key (owner_id, feedback_id),
  foreign key (feedback_id, product_id) references feedback (id, product_id)
);

create table personal_feedback_tags (
  owner_id uuid not null,
  product_id uuid not null,
  feedback_id uuid not null,
  personal_tag_id uuid not null,
  primary key (owner_id, feedback_id, personal_tag_id),
  foreign key (personal_tag_id, owner_id, product_id) references personal_tags (id, owner_id, product_id) on delete cascade,
  foreign key (feedback_id, product_id) references feedback (id, product_id)
);

-- ---------------------------------------------------------------------------
-- Events, jobs and notifications
-- ---------------------------------------------------------------------------

create table domain_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products (id),
  actor_id uuid references users (id),
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references domain_events (id),
  job_type text not null,
  payload jsonb not null default '{}',
  state text not null default 'pending' check (state in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index outbox_jobs_ready_idx on outbox_jobs (next_attempt_at) where state in ('pending', 'processing');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references domain_events (id),
  recipient_id uuid not null references users (id),
  product_id uuid not null references products (id),
  feedback_id uuid references feedback (id),
  actor_id uuid references users (id),
  reason_codes text[] not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, recipient_id)
);
create index notifications_recipient_idx on notifications (recipient_id, product_id, read_at, created_at desc);

-- ---------------------------------------------------------------------------
-- Google Calendar
-- ---------------------------------------------------------------------------

create table google_credentials (
  user_id uuid primary key references users (id) on delete cascade,
  provider_sub text not null,
  encrypted_refresh_token text,
  key_version integer not null,
  granted_scopes text[] not null default '{}',
  needs_reauth boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table calendar_bindings (
  product_id uuid primary key references products (id),
  calendar_id text not null unique,
  calendar_summary text not null default '',
  calendar_timezone text not null,
  bound_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  revision integer not null default 1
);

create table calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  calendar_id text not null,
  event_id text not null,
  feedback_id uuid not null,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (calendar_id, event_id),
  foreign key (feedback_id, product_id) references feedback (id, product_id)
);

create table calendar_mutations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  product_id uuid not null references products (id),
  request_key text not null,
  operation text not null check (operation in ('create', 'update', 'delete')),
  calendar_id text not null,
  google_event_id text,
  body_hash text not null,
  state text not null check (state in ('pending', 'succeeded', 'failed', 'unknown')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_key)
);

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------

create table idempotency_records (
  actor_id uuid not null references users (id),
  scope text not null,
  key text not null check (char_length(key) between 8 and 200),
  body_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (actor_id, scope, key)
);
create index idempotency_records_expiry_idx on idempotency_records (expires_at);
