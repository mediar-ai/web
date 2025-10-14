import { PostHog } from 'posthog-node';

let posthogClient: PostHog | null = null;

export function getPostHogClient(): PostHog {
  if (!posthogClient) {
    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

    if (!posthogKey) {
      throw new Error('NEXT_PUBLIC_POSTHOG_KEY is not set');
    }

    posthogClient = new PostHog(posthogKey, {
      host: posthogHost,
    });
  }

  return posthogClient;
}

export async function shutdownPostHog() {
  if (posthogClient) {
    await posthogClient.shutdown();
  }
}
