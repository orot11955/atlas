import { ContentEditor } from '../../../../features/content/content-editor';

export default async function ContentEditorPage({
  params,
}: Readonly<{
  params: Promise<{ contentId: string }>;
}>) {
  const { contentId } = await params;
  return <ContentEditor contentId={contentId} />;
}
