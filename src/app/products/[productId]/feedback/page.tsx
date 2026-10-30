import { Suspense } from 'react';
import { FeedbackPage } from '@/features/feedback/feedback-page';

export default function Page() {
  return <Suspense><FeedbackPage /></Suspense>;
}
