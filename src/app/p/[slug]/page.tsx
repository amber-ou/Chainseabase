import { redirect } from 'next/navigation';

export default async function PortalProductRoot({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/p/${slug}/feedback`);
}
