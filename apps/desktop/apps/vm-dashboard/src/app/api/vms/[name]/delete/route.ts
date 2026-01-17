import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name: vmName } = await params;
  console.log("DELETE API called for VM:", vmName);

  try {
    // Stop VM first
    console.log("Stopping VM:", vmName);
    try {
      await execAsync(`powershell -NoProfile -Command "Stop-VM -Name '${vmName}' -Force -TurnOff"`);
    } catch (e: any) {
      console.log("Stop VM error (may be already off):", e.message);
    }

    // Get VHD path before removing VM
    console.log("Getting VHD path...");
    let vhdPath = "";
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "(Get-VMHardDiskDrive -VMName '${vmName}').Path"`
      );
      vhdPath = stdout.trim();
      console.log("VHD path:", vhdPath);
    } catch (e: any) {
      console.log("Get VHD error:", e.message);
    }

    // Remove VM
    console.log("Removing VM...");
    const { stdout, stderr } = await execAsync(`powershell -NoProfile -Command "Remove-VM -Name '${vmName}' -Force"`);
    console.log("Remove VM stdout:", stdout);
    console.log("Remove VM stderr:", stderr);

    // Delete VHD
    if (vhdPath) {
      console.log("Deleting VHD:", vhdPath);
      try {
        await execAsync(`powershell -NoProfile -Command "Remove-Item '${vhdPath}' -Force"`);
      } catch (e: any) {
        console.log("Delete VHD error:", e.message);
      }
    }

    return NextResponse.json({ success: true, message: `Deleted ${vmName}` });
  } catch (error: any) {
    console.error("Delete VM error:", error);
    return NextResponse.json({ success: false, error: error.message, stderr: error.stderr }, { status: 500 });
  }
}
