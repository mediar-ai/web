//! Browser Extension Registry Setup
//!
//! Registers the Terminator Bridge extension as an external extension for Chrome and Edge.
//! Browsers will auto-install it, but user must enable it once.

use log::{error, info};

/// Chrome Web Store extension ID for Terminator Bridge
const EXTENSION_ID: &str = "ajnnhmahjbbohenflacjkbdeohicnbmg";

/// Chrome Web Store update URL (works for both Chrome and Edge)
const UPDATE_URL: &str = "https://clients2.google.com/service/update2/crx";

/// Register the extension for auto-install in both Chrome and Edge.
#[cfg(target_os = "windows")]
pub fn register_chrome_extension() {
    info!("[browser_extension] registering extension for Chrome and Edge");

    // Register for Chrome
    register_for_browser("Google\\Chrome", "Chrome");

    // Register for Edge (Chromium-based, supports Chrome Web Store extensions)
    register_for_browser("Microsoft\\Edge", "Edge");
}

#[cfg(target_os = "windows")]
fn register_for_browser(browser_path: &str, browser_name: &str) {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = format!(r"SOFTWARE\{}\Extensions\{}", browser_path, EXTENSION_ID);

    match hkcu.create_subkey(&path) {
        Ok((key, disposition)) => {
            let action = if disposition == REG_CREATED_NEW_KEY {
                "created"
            } else {
                "opened existing"
            };
            info!("[browser_extension] {} {} registry key", action, browser_name);

            match key.set_value("update_url", &UPDATE_URL) {
                Ok(()) => {
                    info!("[browser_extension] {} extension registered for auto-install", browser_name);
                }
                Err(e) => {
                    error!("[browser_extension] {} failed to set update_url: {}", browser_name, e);
                }
            }
        }
        Err(e) => {
            // This is normal if the browser isn't installed
            info!("[browser_extension] {} not found or registry error: {}", browser_name, e);
        }
    }
}

/// No-op on non-Windows platforms
#[cfg(not(target_os = "windows"))]
pub fn register_chrome_extension() {
    info!("[browser_extension] skipping extension registration (non-Windows platform)");
}
