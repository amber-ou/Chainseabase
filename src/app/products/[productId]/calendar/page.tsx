import { Suspense } from 'react';
import { CalendarPage } from '@/features/calendar/calendar-page';

export default function Page() {
  return <Suspense><CalendarPage /></Suspense>;
}
