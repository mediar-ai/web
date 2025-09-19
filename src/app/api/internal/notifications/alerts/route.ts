import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/lib/notification-service';

const notificationService = NotificationService.getInstance();

// GET alerts with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filters = {
      configId: searchParams.get('configId') ? parseInt(searchParams.get('configId')!) : undefined,
      workflowId: searchParams.get('workflowId') ? parseInt(searchParams.get('workflowId')!) : undefined,
      severity: searchParams.get('severity') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100,
    };

    const alerts = await notificationService.getAlerts(filters);
    return NextResponse.json({ success: true, alerts });
  } catch (error) {
    console.error('Failed to fetch alerts:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch alerts' },
      { status: 500 }
    );
  }
}

// POST create new alert (mainly for testing)
export async function POST(request: NextRequest) {
  try {
    const alert = await request.json();
    const newAlert = await notificationService.createAlert(alert);
    return NextResponse.json({ success: true, alert: newAlert });
  } catch (error) {
    console.error('Failed to create alert:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create alert' },
      { status: 500 }
    );
  }
}