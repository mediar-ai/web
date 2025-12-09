import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/lib/notification-service';

const notificationService = NotificationService.getInstance();

// GET specific notification config
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const config = await notificationService.getConfig(parseInt(id));
    if (!config) {
      return NextResponse.json(
        { success: false, error: 'Config not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error('Failed to fetch notification config:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch config' },
      { status: 500 }
    );
  }
}

// PUT update notification config
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const updates = await request.json();
    const updatedConfig = await notificationService.updateConfig(
      parseInt(id),
      updates
    );
    return NextResponse.json({ success: true, config: updatedConfig });
  } catch (error) {
    console.error('Failed to update notification config:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update config' },
      { status: 500 }
    );
  }
}

// DELETE notification config
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await notificationService.deleteConfig(parseInt(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete notification config:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete config' },
      { status: 500 }
    );
  }
}