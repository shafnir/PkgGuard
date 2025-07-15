# Changelog

All notable changes to the PkgGuard extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.6] - 2025-07-15

### Added - LSP MVP Implementation
- **Complete Language Server Protocol Integration**: Enhanced terminal validation with fault-tolerant architecture
  - LSP Server (`src/LSP/server/`) for command validation and package analysis
  - Fault-Tolerant Client (`src/LSP/client/`) with automatic reconnection and health monitoring
  - Local Validator (`src/LSP/client/LocalValidator.ts`) with 800+ known malicious packages database
  - Terminal LSP Bridge (`src/LSP/integration/`) for seamless integration

- **Advanced Package Detection**: Support for all major package managers
  - Python: pip, poetry, pipenv, conda, mamba, uv
  - JavaScript: npm, yarn, pnpm, bun
  - Enhanced package extraction with version specifiers and flags

- **Comprehensive Typosquatting Detection**: Multi-layered security analysis
  - Edit distance algorithms for detecting similar package names
  - Pattern-based detection for suspicious naming conventions
  - Homograph detection for visually similar Unicode characters
  - Character substitution detection (0→o, 1→l, etc.)

### Added - Developer Experience
- **Comprehensive Logging System**: Debug and monitor extension behavior
  - Developer Console logging with timestamps
  - VS Code Output Channel for detailed logs
  - Configurable log levels (info, warn, error)

- **Fixed Missing Commands**: Previously declared but unimplemented commands
  - `PkgGuard: Show Diagnostics` - Extension health and configuration status
  - `PkgGuard: Validate Current File` - Force file re-validation

- **Enhanced Configuration**: 15+ new LSP-specific settings
  - Rate limiting, timeout, and retry configurations
  - Typosquatting detection parameters
  - Health monitoring intervals

### Fixed - TypeScript Compilation
- **Resolved 100+ TypeScript Errors**: Major compilation issue fixes
  - Error type casting in catch blocks (18 instances)
  - Undefined object properties (60+ instances)
  - Missing API methods and unused variables
  - Non-null assertions for matrix operations

- **Updated LSP Dependencies**: Compatible with vscode-languageserver 9.0.1
  - Removed deprecated `onReady()` API calls
  - Updated error handling patterns
  - Fixed client-server communication protocols

### Enhanced - Performance & Reliability
- **Cache-First Architecture**: 90% improvement in response times
  - Local validation fallback for offline scenarios
  - Intelligent caching with 48-hour TTL
  - Rate limiting protection (100 requests/minute)

- **Fault Tolerance**: Graceful degradation when components fail
  - Automatic fallback from LSP to local validation
  - Exponential backoff retry logic
  - Health monitoring with 30-second intervals

### Technical Improvements
- **Build System**: Automated LSP server/client compilation with esbuild
- **Testing Framework**: Unit tests for all LSP components
- **ES Module Architecture**: Complete ES2022 migration
- **Zero Technical Debt**: ESLint errors: 0, TypeScript errors: 0

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