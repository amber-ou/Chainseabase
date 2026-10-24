import { AdminShell } from '@/features/admin/shell';

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
