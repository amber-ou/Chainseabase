-- Product deletion (docs/change-requests/sidebar-position.md, phase 4 follow-up): a tester invitation
-- left without any product is revoked in the same transaction, and keeps why. Its queued invitation
-- e-mail jobs are cancelled (not failed): nothing went wrong, there is just nothing to send any more.
alter table invitations add column revoked_reason text
  check (revoked_reason in ('manual', 'superseded', 'product_deleted'));
alter table outbox_jobs drop constraint outbox_jobs_state_check;
alter table outbox_jobs add constraint outbox_jobs_state_check
  check (state in ('pending', 'processing', 'done', 'failed', 'cancelled'));
