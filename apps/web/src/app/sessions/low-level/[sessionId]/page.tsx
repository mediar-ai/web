import LowLevelSessionClient from './LowLevelSessionClient';

export default async function LowLevelSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const resolvedParams = await params;
  return <LowLevelSessionClient sessionId={resolvedParams.sessionId} />;
} 