import { Suspense } from 'react';
import { UsersPage } from '@/features/users/users-page';

export default function Page() {
  return <Suspense><UsersPage /></Suspense>;
}
