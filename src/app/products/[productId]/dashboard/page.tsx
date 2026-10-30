import { Suspense } from 'react';
import { DashboardPage } from '@/features/dashboard/dashboard';

export default function Page() {
  return <Suspense><DashboardPage /></Suspense>;
}
