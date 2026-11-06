'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingState } from '@/components/ui';
import { AdminShell, readLastProduct, useProductList } from '@/features/admin/shell';
import { ProductListPage } from '@/features/dashboard/dashboard';

/**
 * /products: opens the product last used (or the first one on a first visit). After the selected
 * product was deleted, or when there is no product at all, it shows the product list with nothing
 * selected (docs/change-requests/sidebar-position.md, phase 4). Login and access states come from the shell.
 */
export default function ProductsIndex() {
  return <AdminShell><ProductsLanding /></AdminShell>;
}

function ProductsLanding() {
  const { products } = useProductList();
  const router = useRouter();
  // decided once, from the list as loaded: never selected → the first product; a remembered product
  // that still exists → that one; cleared ('') or a product that no longer exists → no selection
  const [target] = useState(() => {
    const last = readLastProduct();
    if (last) return products.find((p) => p.id === last)?.id ?? null;
    return last === null ? products[0]?.id ?? null : null;
  });
  useEffect(() => {
    if (target) router.replace(`/products/${target}/dashboard`);
  }, [target, router]);
  if (target) return <LoadingState label="正在開啟產品…" />;
  return <ProductListPage />;
}
