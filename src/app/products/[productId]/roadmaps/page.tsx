import { Suspense } from 'react';
import { RoadmapPage } from '@/features/roadmap/roadmap-page';

export default function Page() {
  return <Suspense><RoadmapPage /></Suspense>;
}
