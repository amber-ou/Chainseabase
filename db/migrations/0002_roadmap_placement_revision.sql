-- Per-card placement version for Roadmap ordering.
-- roadmaps.revision now versions only the board structure (name, description, sort mode,
-- publication, column labels/order/set). Card moves bump the moved card's placement
-- revision instead, so moves of different cards no longer conflict with each other.
alter table roadmap_ranks add column placement_revision integer not null default 0;
