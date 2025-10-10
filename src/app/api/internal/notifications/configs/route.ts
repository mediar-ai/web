import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/lib/notification-service';
import { auth } from '@clerk/nextjs/server';

const notificationService = NotificationService.getInstance();

// GET all notification configs for the user's organization
export async function GET() {
  try {
    const { orgId } = await auth();

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 401 }
      );
    }

    const configs = await notificationService.getConfigsByOrg(orgId);
    return NextResponse.json({ success: true, configs });
  } catch (error) {
    console.error('Failed to fetch notification configs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch configs' },
      { status: 500 }
    );
  }
}

// POST create new notification config
export async function POST(request: NextRequest) {
  try {
    const { orgId } = await auth();

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 401 }
      );
    }

    const config = await request.json();
    // Add organization_id to the config
    const configWithOrg = {
      ...config,
      organization_id: orgId
    };

    const newConfig = await notificationService.createConfig(configWithOrg);
    return NextResponse.json({ success: true, config: newConfig });
  } catch (error) {
    console.error('Failed to create notification config:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create config' },
      { status: 500 }
    );
  }
}