# Changelog

All notable changes to the PkgGuard extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.3] - 2025-07-09

### Added
- **Node.js Built-in Module Support**: Properly detects and scores imports with `node:` prefix
  - Example: `import * as path from "node:path"` now correctly identifies as built-in module
  - All Node.js built-in modules receive maximum trust score (100)
  
- **npm Deprecation Detection**: Automatically detects and warns about deprecated packages
  - Shows clear deprecation warnings in hover tooltips
  - Displays replacement package suggestions when available
  - Applies -60 trust score penalty for deprecated packages
  - Example: `vsce` shows warning and suggests `@vscode/vsce`

### Fixed
- **Terminal Autocomplete**: Tab completion now properly completes in-place without creating new lines
  - Fixed VT100 escape sequence handling in terminal output
  - Professional terminal behavior matching standard shells
  
- **Data Flow Issues**: Fixed critical type guards preventing deprecation data from displaying
  - Updated `isRegistryInfo()` to validate optional deprecation fields
  - Updated `createDefaultRegistryInfo()` to include deprecation fields

### Technical Details
- Added `normalizePackageName()` function to handle `node:` prefix stripping
- Extended TypeScript interfaces with `deprecated` and `replacement` fields
- Enhanced npm adapter with pattern matching for replacement suggestions
- Modified `fixOutputForPseudoterminal()` to preserve escape sequences

## [0.7.2] - 2025-07-08

### Fixed
- Terminal UX polish and production readiness improvements
- HTTP client module hover display for dotted imports
- Terminal prompt spacing issues
- Various minor bug fixes

## [0.7.1] - 2025-07-07

### Fixed
- Critical terminal UX issues resolution
- Security mode message auto-dismiss
- Virtual environment path quoting issues
- Terminal command spacing improvements

## [0.7.0] - 2025-07-07

### Added
- Major terminal enhancement initiative
- Command history navigation with arrow keys
- PowerShell autocomplete system
- Virtual environment integration
- Security mode visual indicators
- Terminal profile integration
- Manifest file operations (scan-manifest, install-manifest)

### Technical Details
- 7-agent concurrent development approach
- Comprehensive terminal transformation
- Cache-first approach with 90%+ performance improvement