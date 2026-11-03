import { Suspense } from 'react';
import { ProductListPage } from '@/features/dashboard/dashboard';

export default function Page() {
  return <Suspense><ProductListPage /></Suspense>;
}
