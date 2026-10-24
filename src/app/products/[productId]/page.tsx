import { redirect } from 'next/navigation';

export default async function ProductRoot({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  redirect(`/products/${productId}/dashboard`);
}
