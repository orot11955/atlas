import { DeploymentDetail } from '../../../../features/project-deployment/deployment-detail';

export default async function DeploymentDetailPage({
  params,
}: Readonly<{
  params: Promise<{ deploymentId: string }>;
}>) {
  const { deploymentId } = await params;
  return <DeploymentDetail deploymentId={deploymentId} />;
}
