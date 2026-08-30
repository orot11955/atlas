import { ResourceDetail } from '../../../../features/resource-member/resource-detail';

export default async function ResourceDetailPage({
  params,
}: Readonly<{ params: Promise<{ resourceId: string }> }>) {
  const { resourceId } = await params;
  return <ResourceDetail resourceId={resourceId} />;
}
