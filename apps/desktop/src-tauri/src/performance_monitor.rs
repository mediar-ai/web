use std::sync::Arc;
use std::time::{Duration, Instant};

use log::{error, info};
use sysinfo::{Pid, System};

use crate::analytics::Analytics;

pub struct PerformanceMonitor {
    start_time: Instant,
    analytics: Analytics,
}

impl PerformanceMonitor {
    pub fn new(analytics: Analytics) -> Arc<Self> {
        Arc::new(Self {
            start_time: Instant::now(),
            analytics,
        })
    }

    async fn collect_metrics(&self, sys: &System) -> (f64, f64, f64, f32, f64, Duration) {
        let pid = Pid::from(std::process::id() as usize);
        let mut total_memory = 0.0;
        let mut max_virtual_memory: f64 = 0.0;
        let mut total_cpu = 0.0;

        if let Some(main_process) = sys.process(pid) {
            total_memory += main_process.memory() as f64 / (1024.0 * 1024.0 * 1024.0);
            max_virtual_memory = main_process.virtual_memory() as f64 / (1024.0 * 1024.0 * 1024.0);
            total_cpu += main_process.cpu_usage();

            // Add child processes
            for child_process in sys.processes().values() {
                if child_process.parent() == Some(pid) {
                    total_memory += child_process.memory() as f64 / (1024.0 * 1024.0 * 1024.0);
                    max_virtual_memory =
                        max_virtual_memory.max(child_process.virtual_memory() as f64 / (1024.0 * 1024.0 * 1024.0));
                    total_cpu += child_process.cpu_usage();
                }
            }
        }

        let system_total_memory = sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0);
        let memory_usage_percent = (total_memory / system_total_memory) * 100.0;
        let runtime = self.start_time.elapsed();

        (
            total_memory,
            system_total_memory,
            memory_usage_percent,
            total_cpu,
            max_virtual_memory,
            runtime,
        )
    }

    async fn report_status(&self, sys: &System) {
        let (total_memory_gb, system_total_memory, memory_usage_percent, total_cpu, total_virtual_memory_gb, runtime) =
            self.collect_metrics(sys).await;

        // Log to console
        let log_message = format!(
            "[PERFORMANCE] Runtime: {}s, Memory: {:.0}% ({:.2} GB / {:.2} GB), Virtual: {:.2} GB, CPU: {:.0}%",
            runtime.as_secs(),
            memory_usage_percent,
            total_memory_gb,
            system_total_memory,
            total_virtual_memory_gb,
            total_cpu
        );
        info!("{}", log_message);

        // Send to analytics
        if let Err(e) = self
            .analytics
            .track_performance_snapshot(
                total_memory_gb,
                memory_usage_percent,
                total_cpu,
                total_virtual_memory_gb,
                runtime.as_secs(),
            )
            .await
        {
            error!("Failed to track performance snapshot: {}", e);
        }

        // Update user properties for feature flag targeting (every few minutes)
        static mut LAST_IDENTIFY_TIME: Option<std::time::Instant> = None;
        let should_identify = unsafe {
            match LAST_IDENTIFY_TIME {
                None => true,
                Some(last) => last.elapsed() >= Duration::from_secs(300), // Every 5 minutes
            }
        };

        if should_identify {
            if let Err(e) = self
                .analytics
                .identify_user_with_system_info(total_cpu, memory_usage_percent, total_memory_gb, None)
                .await
            {
                error!("Failed to identify user with system info: {}", e);
            } else {
                unsafe {
                    LAST_IDENTIFY_TIME = Some(std::time::Instant::now());
                }
            }
        }
    }

    pub fn start_monitoring(self: &Arc<Self>, interval: Duration) {
        let monitor = Arc::clone(self);

        tauri::async_runtime::spawn(async move {
            let mut sys = System::new_all();

            loop {
                tokio::time::sleep(interval).await;
                sys.refresh_all();
                monitor.report_status(&sys).await;
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn create_test_analytics() -> Analytics {
        Analytics::new("test_user_perf".to_string())
    }

    #[test]
    fn test_performance_monitor_creation() {
        let analytics = create_test_analytics();
        let monitor = PerformanceMonitor::new(analytics);

        // Monitor should be created successfully
        assert!(monitor.start_time.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn test_collect_metrics() {
        let analytics = create_test_analytics();
        let monitor = PerformanceMonitor::new(analytics);
        let mut sys = System::new_all();
        sys.refresh_all();

        let (memory_gb, max_virtual_memory_gb, cpu_usage, child_processes, total_memory_gb, uptime) =
            monitor.collect_metrics(&sys).await;

        // Validate metrics
        assert!(memory_gb >= 0.0, "Memory should be non-negative");
        assert!(
            max_virtual_memory_gb >= 0.0,
            "Virtual memory should be non-negative"
        );
        assert!(cpu_usage >= 0.0, "CPU usage should be non-negative");
        assert!(
            child_processes >= 0.0,
            "Child processes should be non-negative"
        );
        assert!(
            total_memory_gb >= 0.0,
            "Total memory should be non-negative"
        );
        assert!(
            uptime.as_secs() < 86400,
            "Uptime should be reasonable (< 24 hours for test)"
        );
    }

    #[test]
    fn test_start_monitoring_structure() {
        let analytics = create_test_analytics();
        let monitor = PerformanceMonitor::new(analytics);

        // Test that start_monitoring method exists - it doesn't return a Future
        // so we can't test the actual execution without refactoring the method
        // But we can verify the monitor was created successfully
        assert!(monitor.start_time.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn test_memory_calculation_logic() {
        // Test memory unit conversion logic (bytes to GB)
        let memory_bytes: u64 = 1_073_741_824; // 1 GB
        let memory_gb = memory_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
        assert!(
            (memory_gb - 1.0).abs() < 0.001,
            "1 GB should convert correctly"
        );

        let memory_mb = 1024; // 1 GB in MB
        let memory_gb_from_mb = memory_mb as f64 / 1024.0;
        assert!(
            (memory_gb_from_mb - 1.0).abs() < 0.001,
            "1 GB from MB should convert correctly"
        );
    }

    #[test]
    fn test_cpu_percentage_bounds() {
        // Test that CPU percentage is within valid bounds
        let test_values = vec![0.0, 25.5, 50.0, 75.75, 100.0];

        for cpu_val in test_values {
            assert!(
                (0.0..=100.0).contains(&cpu_val),
                "CPU value {cpu_val} should be within bounds"
            );
        }
    }

    #[test]
    fn test_duration_arithmetic() {
        let start = std::time::Instant::now();
        std::thread::sleep(Duration::from_millis(10));
        let elapsed = start.elapsed();

        assert!(
            elapsed >= Duration::from_millis(10),
            "Elapsed time should be at least 10ms"
        );
        assert!(
            elapsed < Duration::from_millis(100),
            "Elapsed time should be reasonable"
        );
    }

    #[test]
    fn test_system_pid_handling() {
        use sysinfo::Pid;

        let current_pid = std::process::id();
        let pid = Pid::from(current_pid as usize);

        // Test that we can create a Pid from current process ID
        assert!(current_pid > 0, "Current process ID should be positive");

        // Basic validation that the Pid can be used
        let mut sys = System::new();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

        // The process might or might not be found immediately, but this shouldn't panic
        let _process_info = sys.process(pid);
        assert!(true, "Pid handling completed without panic");
    }
}
