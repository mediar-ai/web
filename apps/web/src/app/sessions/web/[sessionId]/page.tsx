import WebSessionClient from './WebSessionClient';

export default async function WebSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const resolvedParams = await params;
  return <WebSessionClient sessionId={resolvedParams.sessionId} />;
} 