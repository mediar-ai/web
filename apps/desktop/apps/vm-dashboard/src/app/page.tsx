"use client";

import { useEffect, useState, useCallback } from "react";

interface VM {
  name: string;
  state: string;
  cpuUsage: number;
  memoryAssigned: number;
  uptime: string;
  ip: string | null;
}

export default function Dashboard() {
  const [vms, setVms] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchVMs = useCallback(async () => {
    try {
      const res = await fetch("/api/vms");
      const data = await res.json();
      if (Array.isArray(data)) {
        setVms(data);
      }
    } catch (err) {
      console.error("Failed to fetch VMs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVMs();
    const interval = setInterval(fetchVMs, 5000);
    return () => clearInterval(interval);
  }, [fetchVMs]);

  const startVM = async (name: string) => {
    setActionLoading(name);
    try {
      await fetch(`/api/vms/${name}/start`, { method: "POST" });
      await fetchVMs();
    } finally {
      setActionLoading(null);
    }
  };

  const stopVM = async (name: string) => {
    setActionLoading(name);
    try {
      await fetch(`/api/vms/${name}/stop`, { method: "POST" });
      await fetchVMs();
    } finally {
      setActionLoading(null);
    }
  };

  const deleteVM = async (name: string) => {
    if (!confirm(`Delete ${name}? This will stop and remove the VM.`)) return;
    setActionLoading(name);
    try {
      const res = await fetch(`/api/vms/${name}/delete`, { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        alert(`Failed to delete: ${data.error}`);
      }
      await fetchVMs();
    } catch (err) {
      alert(`Delete failed: ${err}`);
    } finally {
      setActionLoading(null);
    }
  };

  const startAll = async () => {
    setActionLoading("all");
    for (const vm of vms.filter(v => v.state === "Off")) {
      await fetch(`/api/vms/${vm.name}/start`, { method: "POST" });
    }
    await fetchVMs();
    setActionLoading(null);
  };

  const stopAll = async () => {
    setActionLoading("all");
    for (const vm of vms.filter(v => v.state === "Running")) {
      await fetch(`/api/vms/${vm.name}/stop`, { method: "POST" });
    }
    await fetchVMs();
    setActionLoading(null);
  };

  const openVNC = (ip: string) => {
    window.open(`/vnc.html?target=${ip}:5900`, "_blank");
  };

  const runningCount = vms.filter(v => v.state === "Running").length;

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Agents</h1>
          <p style={styles.subtitle}>
            {runningCount}/{vms.length} running
          </p>
        </div>
        <div style={styles.headerActions}>
          <a href="/all" style={styles.btn}>
            All Screens
          </a>
          <button onClick={startAll} disabled={actionLoading !== null} style={styles.btn}>
            Start All
          </button>
          <button onClick={stopAll} disabled={actionLoading !== null} style={styles.btn}>
            Stop All
          </button>
        </div>
      </header>

      <div style={styles.grid}>
        {vms.map(vm => (
          <div key={vm.name} style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.vmName}>{vm.name}</span>
              <span
                style={{
                  ...styles.badge,
                  backgroundColor: vm.state === "Running" ? "#000" : "#e5e5e5",
                  color: vm.state === "Running" ? "#fff" : "#666",
                }}
              >
                {vm.state}
              </span>
            </div>

            <div style={styles.stats}>
              <div style={styles.stat}>
                <span style={styles.statLabel}>IP</span>
                <span style={styles.statValue}>{vm.ip || "—"}</span>
              </div>
              <div style={styles.stat}>
                <span style={styles.statLabel}>Memory</span>
                <span style={styles.statValue}>{vm.memoryAssigned} MB</span>
              </div>
              <div style={styles.stat}>
                <span style={styles.statLabel}>CPU</span>
                <span style={styles.statValue}>{vm.cpuUsage}%</span>
              </div>
              <div style={styles.stat}>
                <span style={styles.statLabel}>Uptime</span>
                <span style={styles.statValue}>{vm.uptime}</span>
              </div>
            </div>

            <div style={styles.cardActions}>
              {vm.state === "Running" ? (
                <>
                  <button onClick={() => stopVM(vm.name)} disabled={actionLoading !== null} style={styles.btnSmall}>
                    {actionLoading === vm.name ? "..." : "Stop"}
                  </button>
                  {vm.ip && (
                    <button onClick={() => openVNC(vm.ip!)} style={styles.btnSmallPrimary}>
                      VNC
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => startVM(vm.name)}
                  disabled={actionLoading !== null}
                  style={styles.btnSmallPrimary}
                >
                  {actionLoading === vm.name ? "..." : "Start"}
                </button>
              )}
              <button onClick={() => deleteVM(vm.name)} disabled={actionLoading !== null} style={styles.btnSmallDanger}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: "100vh",
    padding: "40px",
    maxWidth: "1200px",
    margin: "0 auto",
    backgroundColor: "#fff",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  },
  loading: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100vh",
    fontSize: "14px",
    color: "#999",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "40px",
    paddingBottom: "20px",
    borderBottom: "1px solid #000",
  },
  title: {
    fontSize: "32px",
    fontWeight: 700,
    color: "#000",
    margin: 0,
    letterSpacing: "-0.5px",
  },
  subtitle: {
    fontSize: "14px",
    color: "#666",
    marginTop: "4px",
    fontFamily: "ui-monospace, monospace",
  },
  headerActions: {
    display: "flex",
    gap: "8px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "20px",
  },
  card: {
    backgroundColor: "#fff",
    padding: "24px",
    border: "1px solid #000",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  vmName: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#000",
    fontFamily: "ui-monospace, monospace",
  },
  badge: {
    padding: "4px 12px",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    marginBottom: "20px",
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  statLabel: {
    fontSize: "11px",
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  statValue: {
    fontSize: "14px",
    color: "#000",
    fontFamily: "ui-monospace, monospace",
  },
  cardActions: {
    display: "flex",
    gap: "8px",
    paddingTop: "20px",
    borderTop: "1px solid #e5e5e5",
  },
  btn: {
    padding: "10px 20px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    backgroundColor: "#fff",
    color: "#000",
    border: "1px solid #000",
    textDecoration: "none",
    display: "inline-block",
  },
  btnSmall: {
    padding: "8px 16px",
    fontSize: "12px",
    fontWeight: 500,
    cursor: "pointer",
    backgroundColor: "#fff",
    color: "#000",
    border: "1px solid #000",
  },
  btnSmallPrimary: {
    padding: "8px 16px",
    fontSize: "12px",
    fontWeight: 500,
    cursor: "pointer",
    backgroundColor: "#000",
    color: "#fff",
    border: "1px solid #000",
  },
  btnSmallDanger: {
    padding: "8px 16px",
    fontSize: "12px",
    fontWeight: 500,
    cursor: "pointer",
    backgroundColor: "#fff",
    color: "#999",
    border: "1px solid #e5e5e5",
    marginLeft: "auto",
  },
};
