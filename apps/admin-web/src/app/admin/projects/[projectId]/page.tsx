import { ProjectDetail } from '../../../../features/project-deployment/project-detail';

export default async function ProjectDetailPage({
  params,
}: Readonly<{
  params: Promise<{ projectId: string }>;
}>) {
  const { projectId } = await params;
  return <ProjectDetail projectId={projectId} />;
}
