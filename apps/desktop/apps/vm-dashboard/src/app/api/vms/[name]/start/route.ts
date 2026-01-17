import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name: vmName } = await params;

  try {
    await execAsync(`powershell -NoProfile -Command "Start-VM -Name '${vmName}'"`);
    return NextResponse.json({ success: true, message: `Started ${vmName}` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
