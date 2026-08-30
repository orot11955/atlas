import { DeploymentList } from '../../../features/project-deployment/deployment-list';

export default async function DeploymentsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ projectId?: string }>;
}>) {
  const { projectId } = await searchParams;
  return <DeploymentList initialProjectId={projectId} />;
}
