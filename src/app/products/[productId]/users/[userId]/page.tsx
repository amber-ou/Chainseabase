import { Suspense } from 'react';
import { UserProfilePage } from '@/features/users/user-profile';

export default function Page() {
  return <Suspense><UserProfilePage /></Suspense>;
}
