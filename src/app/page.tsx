import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { siteForHost } from '@/server/config';
import { PortalHome } from '@/features/portal/portal-home';

export default async function Home() {
  const h = await headers();
  const site = siteForHost(h.get('x-forwarded-host') ?? h.get('host'));
  if (site === 'admin') redirect('/products');
  return <PortalHome />;
}
