import { ApiClientDetail } from '../../../../features/api-clients/api-client-detail';

export default async function ApiClientDetailPage({
  params,
}: Readonly<{
  params: Promise<{ apiClientId: string }>;
}>) {
  const { apiClientId } = await params;
  return <ApiClientDetail apiClientId={apiClientId} />;
}
