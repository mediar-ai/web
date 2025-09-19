import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/lib/notification-service';

const notificationService = NotificationService.getInstance();

// GET all notification configs
export async function GET() {
  try {
    const configs = await notificationService.getConfigs();
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
    const config = await request.json();
    const newConfig = await notificationService.createConfig(config);
    return NextResponse.json({ success: true, config: newConfig });
  } catch (error) {
    console.error('Failed to create notification config:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create config' },
      { status: 500 }
    );
  }
}