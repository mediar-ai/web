'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect } from 'react';

export default function LowLevelUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const router = useRouter();
  const { userId } = use(params);

  useEffect(() => {
    if (userId) {
      router.replace(`/low-level/${userId}/raw-low-level-events`);
          }
  }, [userId, router]);

    return null;
} 