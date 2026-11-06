import { Suspense } from 'react';
import { PersonalPage } from '@/features/personal/personal-page';

export default function Page() {
  return <Suspense><PersonalPage /></Suspense>;
}
