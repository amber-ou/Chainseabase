-- Products can be deleted permanently (docs/change-requests/sidebar-position.md). A deleted product
-- that bootstrap provisions by system_key (the initial "產品1") leaves only its key here, so
-- re-running bootstrap does not recreate a product the team deleted on purpose.
create table product_tombstones (
  system_key text primary key,
  deleted_at timestamptz not null default now()
);
