"use client";

import { useEffect, useState, useCallback } from "react";

interface VM {
  name: string;
  state: string;
  ip: string | null;
}

export default function AllAgents() {
  const [vms, setVms] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVMs = useCallback(async () => {
    try {
      const res = await fetch("/api/vms");
      const data = await res.json();
      if (Array.isArray(data)) {
        setVms(data.filter((vm: VM) => vm.state === "Running" && vm.ip));
      }
    } catch (err) {
      console.error("Failed to fetch VMs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVMs();
    const interval = setInterval(fetchVMs, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, [fetchVMs]);

  const runningVms = vms.filter(vm => vm.ip);
  const cols = runningVms.length === 1 ? 1 : runningVms.length <= 4 ? 2 : 3;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <a href="/" style={styles.backLink}>
          ← Back
        </a>
        <h1 style={styles.title}>All Screens</h1>
        <span style={styles.count}>{runningVms.length} agents</span>
      </header>

      {loading ? (
        <div style={styles.loading}>Loading...</div>
      ) : runningVms.length === 0 ? (
        <div style={styles.empty}>No running agents</div>
      ) : (
        <div
          style={{
            ...styles.grid,
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
          }}
        >
          {runningVms.map(vm => (
            <div key={vm.name} style={styles.panel}>
              <div style={styles.panelHeader}>
                <span style={styles.vmName}>{vm.name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={styles.ip}>{vm.ip}</span>
                  <button
                    onClick={() => window.open(`/vnc.html?target=${vm.ip}:5900`, "_blank")}
                    style={styles.openBtn}
                  >
                    Open
                  </button>
                </div>
              </div>
              <iframe
                src={`/vnc.html?target=${vm.ip}:5900`}
                style={styles.iframe}
                allow="clipboard-read; clipboard-write"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#fff",
    padding: "20px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "24px",
    marginBottom: "20px",
    paddingBottom: "16px",
    borderBottom: "1px solid #000",
  },
  backLink: {
    color: "#000",
    fontSize: "14px",
    fontWeight: 500,
  },
  title: {
    color: "#000",
    fontSize: "24px",
    fontWeight: 700,
    margin: 0,
    letterSpacing: "-0.5px",
  },
  count: {
    color: "#666",
    fontSize: "14px",
    fontFamily: "ui-monospace, monospace",
    marginLeft: "auto",
  },
  loading: {
    color: "#999",
    textAlign: "center",
    marginTop: "50px",
    fontSize: "14px",
  },
  empty: {
    color: "#999",
    textAlign: "center",
    marginTop: "50px",
    fontSize: "14px",
  },
  grid: {
    display: "grid",
    gap: "20px",
    flex: 1,
    minHeight: 0,
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#fff",
    overflow: "hidden",
    border: "1px solid #000",
    minHeight: 0,
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    backgroundColor: "#fff",
    borderBottom: "1px solid #000",
  },
  vmName: {
    color: "#000",
    fontWeight: 600,
    fontSize: "14px",
    fontFamily: "ui-monospace, monospace",
  },
  ip: {
    color: "#666",
    fontSize: "12px",
    fontFamily: "ui-monospace, monospace",
  },
  openBtn: {
    padding: "4px 10px",
    background: "#000",
    color: "#fff",
    border: "none",
    fontSize: "11px",
    cursor: "pointer",
    fontFamily: "ui-monospace, monospace",
  },
  iframe: {
    flex: 1,
    border: "none",
    backgroundColor: "#000",
    minHeight: "300px",
  },
};
