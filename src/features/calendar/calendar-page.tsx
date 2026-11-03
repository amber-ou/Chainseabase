'use client';

import { useProduct } from '@/features/admin/shell';
import { CalendarPanel } from '@/features/calendar/calendar';

/** Calendar: the selected product's Google calendar (moved from the Product page, same panel and rules). */
export function CalendarPage() {
  const { product } = useProduct();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="sub">目前產品：{product.name}</p>
        </div>
      </div>
      <section className="section" aria-label="產品日曆">
        <div className="section-title"><h2>產品日曆</h2></div>
        <CalendarPanel productId={product.id} />
      </section>
    </>
  );
}
