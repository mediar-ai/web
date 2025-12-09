import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/lib/notification-service';
import { auth, currentUser } from '@clerk/nextjs/server';

const notificationService = NotificationService.getInstance();

// GET all notification configs
// - @mediar.ai admins: returns ALL configs (global + all orgs)
// - Regular users: returns configs for their organization only
export async function GET() {
  try {
    const { orgId } = await auth();
    const user = await currentUser();

    // Check if user is a Mediar admin
    const isMediarAdmin = user?.emailAddresses?.some(
      email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    ) || false;

    let configs;
    if (isMediarAdmin) {
      // Mediar admins see ALL configs across all organizations
      configs = await notificationService.getConfigs();
    } else {
      // Regular users see only their org's configs
      if (!orgId) {
        return NextResponse.json(
          { success: false, error: 'Organization not found' },
          { status: 401 }
        );
      }
      configs = await notificationService.getConfigsByOrg(orgId);
    }

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