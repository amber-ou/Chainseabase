import { Suspense } from 'react';
import { AdminShell } from '@/features/admin/shell';
import { SettingsPage } from '@/features/settings/settings-page';

/**
 * Setting with no product selected (checklist A04): the sidebar account entry always opens Setting.
 * Only the account's own settings are shown here; tags and Person tags still need a product.
 */
export default function Page() {
  return <AdminShell><Suspense><SettingsPage /></Suspense></AdminShell>;
}
