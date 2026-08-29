import { SiteDetail } from '../../../../features/sites/site-detail';

export default async function SiteDetailPage({
  params,
}: Readonly<{
  params: Promise<{ siteId: string }>;
}>) {
  const { siteId } = await params;
  return <SiteDetail siteId={siteId} />;
}
