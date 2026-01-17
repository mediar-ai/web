//! Edge glow notification system for recording state changes
//! Shows a colored border around the screen when recording starts/stops

use std::sync::Arc;
use std::time::{Duration, Instant};

use log::{debug, error, info};
use tokio::sync::RwLock;

// Anti-spam notification tracking
static LAST_NOTIFICATION: once_cell::sync::Lazy<Arc<RwLock<Option<Instant>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(None)));

// Minimum time between notifications (5 minutes)
const NOTIFICATION_COOLDOWN: Duration = Duration::from_secs(300);

/// Show edge glow notification with anti-spam protection
pub async fn show_edge_glow_notification(is_recording: bool) -> Result<(), String> {
    // Check anti-spam cooldown
    {
        let last_notif = LAST_NOTIFICATION.read().await;
        if let Some(last) = *last_notif {
            if last.elapsed() < NOTIFICATION_COOLDOWN {
                debug!(
                    "Skipping edge glow notification - cooldown active ({:.1}s remaining)",
                    (NOTIFICATION_COOLDOWN - last.elapsed()).as_secs_f32()
                );
                return Ok(());
            }
        }
    }

    // Update last notification time
    {
        let mut last_notif = LAST_NOTIFICATION.write().await;
        *last_notif = Some(Instant::now());
    }

    let color_value = if is_recording {
        0x00FF00 // Green for recording
    } else {
        0xFF0000 // Red for stopped
    };

    info!(
        "🌊 Creating edge glow notification - Recording: {} (color: 0x{:06X})",
        if is_recording { "STARTED" } else { "STOPPED" },
        color_value
    );

    // Spawn the edge glow effect
    tauri::async_runtime::spawn_blocking(move || show_edge_glow_effect(color_value, Duration::from_secs(3)));

    Ok(())
}

/// Platform-specific edge glow implementation
#[cfg(target_os = "windows")]
fn show_edge_glow_effect(color: u32, duration: Duration) {
    use std::thread;

    // Create the glow effect in a separate thread
    thread::spawn(move || {
        if let Err(e) = create_windows_edge_glow(color, duration) {
            error!("Failed to create edge glow: {}", e);
        }
    });
}

#[cfg(target_os = "windows")]
fn create_windows_edge_glow(color: u32, duration: Duration) -> Result<(), Box<dyn std::error::Error>> {
    use std::mem;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::*;

    unsafe {
        // Helper function to create wide string
        fn to_wide_string(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }

        // Register window class
        let class_name = to_wide_string("MediarEdgeGlow");
        let h_instance = GetModuleHandleW(None)?;

        let wc = WNDCLASSEXW {
            cbSize: mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(edge_glow_proc),
            hInstance: HINSTANCE(h_instance.0),
            hCursor: LoadCursorW(None, IDC_ARROW)?,
            hbrBackground: HBRUSH((COLOR_WINDOW.0 + 1) as _),
            lpszClassName: PCWSTR::from_raw(class_name.as_ptr()),
            ..Default::default()
        };

        let atom = RegisterClassExW(&wc);
        if atom == 0 {
            // Class might already be registered, that's okay
            debug!("Window class already registered or registration failed");
        }

        // Get screen dimensions
        let screen_width = GetSystemMetrics(SM_CXSCREEN);
        let screen_height = GetSystemMetrics(SM_CYSCREEN);

        // Create four windows for each edge (top, bottom, left, right)
        let edge_width = 4; // 4px wide glow

        let window_name_top = to_wide_string("MediarEdgeGlowTop");
        let window_name_bottom = to_wide_string("MediarEdgeGlowBottom");
        let window_name_left = to_wide_string("MediarEdgeGlowLeft");
        let window_name_right = to_wide_string("MediarEdgeGlowRight");

        // Create windows
        let color_ptr = Box::into_raw(Box::new(color));

        // Top edge
        let hwnd_top = CreateWindowExW(
            WINDOW_EX_STYLE(
                WS_EX_TOPMOST.0 | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0 | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0,
            ),
            PCWSTR::from_raw(class_name.as_ptr()),
            PCWSTR::from_raw(window_name_top.as_ptr()),
            WINDOW_STYLE(WS_POPUP.0),
            0,
            0,
            screen_width,
            edge_width,
            None,
            None,
            Some(HINSTANCE(h_instance.0)),
            Some(color_ptr as *const _),
        );

        // Bottom edge
        let hwnd_bottom = CreateWindowExW(
            WINDOW_EX_STYLE(
                WS_EX_TOPMOST.0 | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0 | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0,
            ),
            PCWSTR::from_raw(class_name.as_ptr()),
            PCWSTR::from_raw(window_name_bottom.as_ptr()),
            WINDOW_STYLE(WS_POPUP.0),
            0,
            screen_height - edge_width,
            screen_width,
            edge_width,
            None,
            None,
            Some(HINSTANCE(h_instance.0)),
            Some(color_ptr as *const _),
        );

        // Left edge
        let hwnd_left = CreateWindowExW(
            WINDOW_EX_STYLE(
                WS_EX_TOPMOST.0 | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0 | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0,
            ),
            PCWSTR::from_raw(class_name.as_ptr()),
            PCWSTR::from_raw(window_name_left.as_ptr()),
            WINDOW_STYLE(WS_POPUP.0),
            0,
            0,
            edge_width,
            screen_height,
            None,
            None,
            Some(HINSTANCE(h_instance.0)),
            Some(color_ptr as *const _),
        );

        // Right edge
        let hwnd_right = CreateWindowExW(
            WINDOW_EX_STYLE(
                WS_EX_TOPMOST.0 | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0 | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0,
            ),
            PCWSTR::from_raw(class_name.as_ptr()),
            PCWSTR::from_raw(window_name_right.as_ptr()),
            WINDOW_STYLE(WS_POPUP.0),
            screen_width - edge_width,
            0,
            edge_width,
            screen_height,
            None,
            None,
            Some(HINSTANCE(h_instance.0)),
            Some(color_ptr as *const _),
        )?;

        // Clean up the color pointer
        let _ = Box::from_raw(color_ptr);

        // Show all windows with animation
        let windows = vec![hwnd_top, hwnd_bottom, hwnd_left, Ok(hwnd_right)];

        // Skip if any window creation failed
        if windows.iter().any(|w| w.is_err()) {
            error!("Failed to create one or more edge glow windows");
            return Err("Window creation failed".into());
        }

        // Animate the glow
        let start_time = Instant::now();
        let _animation_duration = Duration::from_millis(500); // Fade in over 500ms

        for window in windows.iter().flatten() {
            let _ = ShowWindow(*window, SW_SHOWNOACTIVATE);
        }

        // Pulse animation loop
        while start_time.elapsed() < duration {
            let elapsed = start_time.elapsed().as_millis() as f32;

            // Create pulsing effect (sine wave)
            let pulse = ((elapsed / 300.0).sin() * 0.3 + 0.7) * 255.0;
            let alpha = pulse as u8;

            for window in windows.iter().flatten() {
                let _ = SetLayeredWindowAttributes(*window, COLORREF(0), alpha, LWA_ALPHA);
            }

            std::thread::sleep(Duration::from_millis(16)); // ~60 FPS
        }

        // Fade out
        let fade_duration = Duration::from_millis(300);
        let fade_start = Instant::now();

        while fade_start.elapsed() < fade_duration {
            let progress = fade_start.elapsed().as_millis() as f32 / fade_duration.as_millis() as f32;
            let alpha = ((1.0 - progress) * 255.0) as u8;

            for window in windows.iter().flatten() {
                let _ = SetLayeredWindowAttributes(*window, COLORREF(0), alpha, LWA_ALPHA);
            }

            std::thread::sleep(Duration::from_millis(16));
        }

        // Destroy windows
        for window in windows.into_iter().flatten() {
            let _ = DestroyWindow(window);
        }

        Ok(())
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn edge_glow_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    match msg {
        WM_CREATE => {
            let create_struct = lparam.0 as *const CREATESTRUCTW;
            if !create_struct.is_null() {
                let color_ptr = (*create_struct).lpCreateParams;
                if !color_ptr.is_null() {
                    let color = *(color_ptr as *const u32);
                    SetWindowLongPtrW(hwnd, GWLP_USERDATA, color as _);
                }
            }
            LRESULT(0)
        }
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            let hdc = BeginPaint(hwnd, &mut ps);

            let color = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as u32;
            let r = (color >> 16) & 0xFF;
            let g = (color >> 8) & 0xFF;
            let b = color & 0xFF;

            let brush = CreateSolidBrush(COLORREF(
                ((r as u32) | ((g as u32) << 8) | ((b as u32) << 16)) as _,
            ));
            FillRect(hdc, &ps.rcPaint, brush);
            let _ = DeleteObject(brush.into());

            let _ = EndPaint(hwnd, &ps);
            LRESULT(0)
        }
        WM_DESTROY => LRESULT(0),
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

#[cfg(not(target_os = "windows"))]
fn show_edge_glow_effect(_color: u32, _duration: Duration) {
    info!("Edge glow notification is only supported on Windows");
}
