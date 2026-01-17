import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface VM {
  name: string;
  state: string;
  cpuUsage: number;
  memoryAssigned: number;
  uptime: string;
  ip: string | null;
  mcpUrl: string | null;
  vncUrl: string | null;
}

async function getVMs(): Promise<VM[]> {
  try {
    const { stdout, stderr } = await execAsync(`powershell -NoProfile -Command "
      Get-VM | ForEach-Object {
        $ip = (Get-VMNetworkAdapter -VMName $_.Name | Select-Object -ExpandProperty IPAddresses | Where-Object { $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' } | Select-Object -First 1)
        [PSCustomObject]@{
          Name = $_.Name
          State = $_.State.ToString()
          CPUUsage = $_.CPUUsage
          MemoryAssigned = [math]::Round($_.MemoryAssigned / 1MB)
          Uptime = $_.Uptime.ToString()
          IP = $ip
        }
      } | ConvertTo-Json -Compress
    "`);

    if (stderr) {
      console.error("PowerShell stderr:", stderr);
    }
    console.log("PowerShell stdout:", stdout);

    if (!stdout || stdout.trim() === "") {
      console.error("Empty stdout from PowerShell");
      return [];
    }

    const vms = JSON.parse(stdout);
    const vmArray = Array.isArray(vms) ? vms : [vms];

    return vmArray.map((vm: any) => ({
      name: vm.Name,
      state: vm.State,
      cpuUsage: vm.CPUUsage || 0,
      memoryAssigned: vm.MemoryAssigned || 0,
      uptime: vm.Uptime || "00:00:00",
      ip: vm.IP || null,
      mcpUrl: vm.IP ? `http://${vm.IP}:8080` : null,
      vncUrl: vm.IP ? `${vm.IP}:5900` : null,
    }));
  } catch (error: any) {
    console.error("Failed to get VMs:", error.message);
    console.error("stderr:", error.stderr);
    console.error("stdout:", error.stdout);
    return [];
  }
}

export async function GET() {
  try {
    const { stdout, stderr } = await execAsync(`powershell -NoProfile -Command "Get-VM | ConvertTo-Json -Compress"`);

    if (!stdout || stdout.trim() === "") {
      return NextResponse.json({ error: "Empty response", stderr }, { status: 500 });
    }

    const vms = JSON.parse(stdout);
    const vmArray = Array.isArray(vms) ? vms : [vms];

    // State enum: 1=Other, 2=Running, 3=Off, 6=Paused, etc.
    const stateMap: Record<number, string> = {
      1: "Other",
      2: "Running",
      3: "Off",
      4: "Stopping",
      5: "Saved",
      6: "Paused",
      7: "Starting",
      8: "Reset",
      9: "Saving",
      10: "PausedCritical",
    };

    // Get IPs for each VM
    const vmsWithIps = await Promise.all(
      vmArray.map(async (vm: any) => {
        try {
          const { stdout: ipOut } = await execAsync(
            `powershell -NoProfile -Command "(Get-VMNetworkAdapter -VMName '${vm.Name}').IPAddresses | Where-Object { $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' } | Select-Object -First 1"`
          );
          const ip = ipOut.trim() || null;
          const stateNum = typeof vm.State === "number" ? vm.State : parseInt(vm.State) || 3;
          const uptime = vm.Uptime
            ? `${vm.Uptime.Days || 0}d ${vm.Uptime.Hours || 0}h ${vm.Uptime.Minutes || 0}m`
            : "0d 0h 0m";
          return {
            name: vm.Name,
            state: stateMap[stateNum] || "Unknown",
            cpuUsage: vm.CPUUsage || 0,
            memoryAssigned: Math.round((vm.MemoryAssigned || 0) / 1048576),
            uptime,
            ip,
            mcpUrl: ip ? `http://${ip}:8080` : null,
            vncUrl: ip ? `${ip}:5900` : null,
          };
        } catch {
          return {
            name: vm.Name,
            state: stateMap[vm.State] || "Unknown",
            cpuUsage: 0,
            memoryAssigned: 0,
            uptime: "0d 0h 0m",
            ip: null,
            mcpUrl: null,
            vncUrl: null,
          };
        }
      })
    );

    return NextResponse.json(vmsWithIps);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message,
        stderr: error.stderr?.toString(),
        stdout: error.stdout?.toString(),
      },
      { status: 500 }
    );
  }
}
