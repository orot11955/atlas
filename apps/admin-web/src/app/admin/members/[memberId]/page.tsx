import { MemberDetail } from '../../../../features/resource-member/member-detail';

export default async function MemberDetailPage({
  params,
}: Readonly<{ params: Promise<{ memberId: string }> }>) {
  const { memberId } = await params;
  return <MemberDetail memberId={memberId} />;
}
