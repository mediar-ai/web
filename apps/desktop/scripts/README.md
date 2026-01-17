# Build Scripts

This directory contains all build and utility scripts for the Mediar project.

## Scripts

### `build-mcp.js`
**Purpose**: Downloads or builds the terminator-mcp-agent binary for bundling with Tauri.

**Usage**:
```bash
bun scripts/build-mcp.js [options]
```

**Options**:
- `--local`: Use local terminator repository (../terminator)
- `--npm`: Force download from npm registry
- `--force-rebuild`: Force rebuild even if binary exists
- `--help`: Show help message

**Features**:
- Handles binary management for Windows, macOS, and Linux
- Checks for MCP binary in shared location or builds from source

### `download-vcredist.js`
**Purpose**: Downloads Visual C++ Redistributables for bundling with Windows installer.

**Usage**:
```bash
node scripts/download-vcredist.js
```

**What it does**:
- Downloads VC++ 2015-2022 Redistributables (x64 and ARM64)
- Saves to `src-tauri/vcredist/`
- ~37MB total download size
- Required for terminator-mcp-agent JavaScript/TypeScript execution

**Note**: This runs automatically during `bun run prebuild:tauri`

### `add-defender-exclusions.ps1`
**Purpose**: Adds Windows Defender exclusions for development directories to improve build performance.

**Usage**:
```powershell
# Run as Administrator
.\scripts\add-defender-exclusions.ps1
```

**What it excludes**:
- Project directory
- Cargo target directories
- npm/node_modules
- Rust toolchain directories

## Integration

These scripts are integrated into the build process via `package.json`:
- `predev:tauri`: Runs `build-mcp.js` before starting dev server
- `prebuild:tauri`: Runs both `build-mcp.js` and `download-vcredist.js` before building

## Path Resolution

All scripts are aware they're in the `scripts/` folder and correctly resolve paths relative to the project root using `PROJECT_ROOT` constant.
