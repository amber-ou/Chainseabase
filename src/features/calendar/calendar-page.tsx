'use client';

import { useProduct, PageTitle } from '@/features/admin/shell';
import { CalendarPanel } from '@/features/calendar/calendar';

/**
 * Calendar: the selected product's Google calendar (moved from the Product page, same panel and rules).
 * CAL-01 (2026-11-10): no 「目前產品」 line under the title; the sidebar switcher names the product.
 */
export function CalendarPage() {
  const { product } = useProduct();
  return (
    <>
      <div className="page-head">
        <div>
          <PageTitle><h1>Calendar</h1></PageTitle>
        </div>
      </div>
      <section className="section" aria-label="產品日曆">
        <div className="section-title"><h2>產品日曆</h2></div>
        <CalendarPanel productId={product.id} />
      </section>
    </>
  );
}
