use std::fs;
use std::io::Read;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    // Download Bun binaries for all target platforms
    download_bun_binaries();

    // Add MCP binary as a resource if it exists
    #[cfg(target_os = "windows")]
    {
        #[cfg(target_arch = "x86_64")]
        check_mcp_binary("binaries/terminator-mcp-agent-x86_64-pc-windows-msvc.exe");
        #[cfg(target_arch = "aarch64")]
        check_mcp_binary("binaries/terminator-mcp-agent-aarch64-pc-windows-msvc.exe");
    }

    tauri_build::build()
}

fn check_mcp_binary(path: &str) {
    let mcp_binary = Path::new(path);
    if mcp_binary.exists() {
        println!("cargo:rerun-if-changed={}", mcp_binary.display());
        println!(
            "cargo:warning=MCP binary found at: {}",
            mcp_binary.display()
        );
    } else {
        println!(
            "cargo:warning=MCP binary not found at: {}",
            mcp_binary.display()
        );
    }
}

fn download_bun_binaries() {
    let binaries_dir = Path::new("binaries");

    // Create binaries directory if it doesn't exist
    if !binaries_dir.exists() {
        fs::create_dir_all(binaries_dir).expect("Failed to create binaries directory");
    }

    // Bun binary configurations for each platform (using Tauri target naming)
    let bun_configs = vec![
        // Windows x64
        (
            "bun-x86_64-pc-windows-msvc.exe",
            "https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64.zip",
            "bun.exe",
        ),
        // Windows ARM64 (baseline)
        (
            "bun-aarch64-pc-windows-msvc.exe",
            "https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64-baseline.zip",
            "bun.exe",
        ),
    ];

    for (binary_name, download_url, extract_path) in bun_configs {
        let binary_path = binaries_dir.join(binary_name);

        // Skip if binary already exists (for faster builds)
        if binary_path.exists() {
            println!("cargo:warning=Bun binary {binary_name} already exists, skipping download");
            continue;
        }

        println!("cargo:warning=Downloading Bun binary: {binary_name}");

        if let Err(e) = download_and_extract_bun(&binary_path, download_url, extract_path) {
            println!("cargo:warning=Failed to download {binary_name}: {e}. Continuing build without this binary.");
        } else {
            println!("cargo:warning=Successfully downloaded: {binary_name}");
        }
    }
}

fn download_and_extract_bun(
    output_path: &Path,
    url: &str,
    extract_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // Download the zip file
    let response = ureq::get(url).call()?;
    let mut zip_data = Vec::new();
    response.into_reader().read_to_end(&mut zip_data)?;

    // Extract the specific binary from zip
    let cursor = std::io::Cursor::new(zip_data);
    let mut archive = zip::ZipArchive::new(cursor)?;

    // For Windows, look for bun.exe directly in the root
    // For Unix systems, look for the nested path
    let mut found = false;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let file_name = file.name();

        // Check if this is the file we want
        let is_target_file = if extract_path == "bun.exe" {
            // For Windows, look for bun.exe in the root or nested
            file_name == "bun.exe" || file_name.ends_with("/bun.exe")
        } else {
            // For Unix systems, use the exact path
            file_name == extract_path || file_name.ends_with(&extract_path.replace("/", "\\"))
        };

        if is_target_file {
            let mut output_file = fs::File::create(output_path)?;
            std::io::copy(&mut file, &mut output_file)?;

            // Make executable on Unix systems
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = output_file.metadata()?.permissions();
                perms.set_mode(0o755);
                fs::set_permissions(output_path, perms)?;
            }

            found = true;
            break;
        }
    }

    if !found {
        return Err(format!("Target file '{extract_path}' not found in archive").into());
    }

    Ok(())
}
