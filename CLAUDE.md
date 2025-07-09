# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Common Development Commands](#common-development-commands)
3. [Enhanced Terminal Features](#enhanced-terminal-features)
4. [Architecture Overview](#architecture-overview)
5. [Configuration](#configuration)
6. [Implementation Details](#implementation-details)
7. [Testing](#testing)
8. [Code Standards](#code-standards)
9. [Security & Dependencies](#security--dependencies)
10. [Task Management System](#task-management-system)

## Project Overview

PkgGuard is a VS Code extension that protects developers from AI hallucinations and malicious package imports by analyzing package trustworthiness in real-time. It supports Python (PyPI) and JavaScript/TypeScript (npm) ecosystems.

## Common Development Commands

### Build and Development
- `npm run compile` - TypeScript compilation
- `npm run watch` - Watch mode development 
- `npm run package` - Build .vsix extension using esbuild
- `npm run vscode:prepublish` - Prepare for publishing (runs package)

### Testing and Quality
- `npm run test` - Run Jest unit tests
- `npm run pretest` - Compile before running tests
- `npm run lint` - Run ESLint code quality checks

### VS Code Extension Development
- Press F5 in VS Code to launch Extension Development Host for debugging
- Use `npm run package` to create installable .vsix file
- Always use context7 mcp to research for new packages and features. If you can't find what you looking for in context7, use the internet.
- The development was migrated from CommonJS to ES6 modules, with backward compatibility. So every future development should be in modern ES6 modules.

## Enhanced Terminal Features (Version 0.7.0)

PkgGuard now includes a comprehensive smart terminal with advanced development capabilities:

### Accessing PkgGuard Terminal
**Two ways to create a PkgGuard terminal**:
1. **Terminal Dropdown**: Select "PkgGuard Smart Terminal" from the terminal profile dropdown (alongside PowerShell, Git Bash, etc.)
2. **Command Palette**: Run "PkgGuard: Create Terminal" command

### Terminal Features

#### Command History Navigation
- **Up Arrow (↑)**: Navigate to previous commands in history
- **Down Arrow (↓)**: Navigate forward through command history  
- **History Storage**: Stores up to 100 commands with duplicate prevention
- **Smart Navigation**: Preserves current input when browsing history

#### PowerShell Autocomplete
- **Tab Completion**: Press Tab for command, file, and directory completion
- **Supported Commands**: PkgGuard commands, PowerShell, Python, Node.js, Git
- **File System**: Complete directory and file paths in current working directory
- **Cycling**: Multiple matches cycle through with repeated Tab presses

#### Virtual Environment Support
```bash
# Create virtual environment
create-venv myproject

# List available environments  
list-venvs

# Activate environment (workspace venvs)
activate-venv myproject

# Activate with path (any location)
activate-venv ../path/to/venv
activate-venv C:\path\to\venv

# Deactivate current environment
deactivate-venv

# Use pip with active venv (automatically uses venv Python)
pip install requests
```

#### Security Mode Indicators
Terminal prompt shows current security mode with color coding:
- `[interactive]` 🟢 - Ask for approval on risky packages
- `[monitor]` 🟡 - Show warnings but allow installation  
- `[block]` 🔴 - Automatically block risky packages
- `[disabled]` ⚪ - No security checks

#### Manifest File Operations
```bash
# Scan manifest files for security risks
scan-manifest

# Install from manifest with security filtering
install-manifest

# Install specific manifest types
pip install -r requirements.txt  # With security checks
npm install                      # With security filtering
```

### Terminal Command Reference

| Command | Description | Example |
|---------|-------------|---------|
| `help` or `?` | Show all available commands | `help` |
| `clear` or `cls` | Clear terminal screen | `clear` |
| `create-venv [name]` | Create virtual environment | `create-venv myproject` |
| `activate-venv [name]` | Activate virtual environment | `activate-venv myproject` |
| `deactivate-venv` | Deactivate current venv | `deactivate-venv` |
| `list-venvs` | List available virtual environments | `list-venvs` |
| `scan-manifest` | Scan requirements.txt, package.json | `scan-manifest` |
| `install-manifest` | Install dependencies with security | `install-manifest` |

### Known Issues & Workarounds (v0.7.0)

**Virtual Environment Path Issues**:
- Issue: Some Python paths may have quoting problems on Windows
- Workaround: Use short paths without spaces when possible

**Autocomplete Display**:
- Issue: May show completion indicators like "(1/2)" 
- Workaround: Press Tab once more to cycle through or use Enter to accept

**Security Mode Messages**:
- Issue: Toggle messages may not auto-dismiss after 3 seconds
- Workaround: Messages are informational only and don't affect functionality

## Architecture Overview

### Core Components

**Extension Entry Point** (`src/extension.ts`):
- Main orchestration and VS Code lifecycle management
- Document change listeners with 200ms debouncing
- Command registration (ignore/unignore packages, clear cache)
- Status bar integration and configuration management

**Detection Pipeline** (`src/detectors/`):
- `python.ts` - Regex-based Python import detection (from/import statements, supports inline comments)
- `javascript.ts` - ES6/CommonJS import detection including scoped packages

**Registry Adapters** (`src/adapters/`):
- `pypi.ts` - PyPI API integration with PePy download stats
- `npm.ts` - npm registry API with download statistics
- `github.ts` - GitHub API for repository statistics

**Scoring Engines** (`src/scoring/`):
- `index.ts` - Python package scoring with weighted factors
- `javascript.ts` - JavaScript/npm package scoring
- Special handling for standard library, top packages, and typosquatting detection

**UI Components** (`src/ui/`):
- `decorators.ts` - Colored trust badges (🟢🟡🔴⚪) after import lines (supports hyphenated packages)
- `hovers.ts` - Detailed hover panels with trust scores and evidence

**Enhanced Terminal Integration** (`src/terminal/`):
- `shell-integration.ts` - Monitors package installations in regular VS Code terminals with cache-first approach
- `simple-terminal.ts` - Smart terminal with command history, autocomplete, virtual environment support, security indicators

### Data Flow

1. Document changes trigger debounced validation (200ms delay)
2. Language-specific detectors extract package names with positions
3. Cache lookup first (48h TTL), then async registry fetching if needed
4. Trust scores calculated using weighted scoring algorithm
5. UI updated with decorations, hover data, and diagnostic warnings

## Configuration

### VS Code Settings
- `pkgGuard.enabled` - Enable/disable extension
- `pkgGuard.cacheTTL` - Cache TTL in seconds (default: 172800)
- `pkgGuard.securityMode` - Security mode for terminal monitoring
- `pkgGuard.terminal.enabled` - Enable terminal package monitoring

### Commands
- `pkg-guard.validateCurrentFile` - Force re-scan current file
- `pkg-guard.clearCache` - Clear all cached scores
- `pkgguard.ignorePackage` - Add package to ignore list
- `pkgguard.unignorePackage` - Remove from ignore list
- `pkgguard.toggleSecurityMode` - Cycle through security modes
- `pkgguard.createTerminal` - Create secured smart terminal with full features

### Terminal Profile
- **PkgGuard Smart Terminal** - Available in VS Code terminal dropdown alongside PowerShell, Git Bash, etc.

### Storage and Caching
- **Cache Location**: `.pkgguard/.pkgguard-cache.json` (workspace-specific)
- **Ignore File**: `.pkgguard/.pkgguard-ignore` with format `package_name # note`
- **Global Storage**: Used when no workspace is open
- **TTL**: 48 hours default (configurable via `pkgGuard.cacheTTL`)

## Implementation Details

### Trust Scoring Algorithm
- **High Trust (🟢)**: Score ≥ 80 (Python) / ≥ 75 (JavaScript)
- **Medium Trust (🟡)**: Score 50-79 (Python) / 45-74 (JavaScript)  
- **Low Trust (🔴)**: Score < 50 / < 45
- **Unknown (❓)**: Package scoring failed (network/registry issues)
- **Ignored (⚪)**: User-configured ignore

### Weighted Scoring Factors
- Package existence: 40 points
- Download popularity: 20 points (log scale)
- Release recency: 15 points
- Multiple maintainers: 5 points
- Vulnerabilities: -10 points each

### Special Cases
- Standard library modules always score 100
- Top packages get minimum score of 85
- Typosquatting detection (Levenshtein distance = 1) applies -60 penalty
- Perfect packages (top + millions downloads + active + multiple maintainers) score 100

## Enhanced Terminal Integration (Version 0.7.0)

The extension includes comprehensive terminal functionality (`src/terminal/`):

### Shell Integration (`shell-integration.ts`)
- Monitors package installations in regular VS Code terminals
- **Cache-first approach**: 90%+ performance improvement over previous versions
- **Unified scoring**: Uses same scoring mechanism as UI for consistency
- **Security modes**: interactive, monitor, block, disabled

### Smart Terminal (`simple-terminal.ts`)  
- **Command History**: Up/down arrow navigation with 100-command storage
- **PowerShell Autocomplete**: Tab completion for commands, files, directories
- **Virtual Environment Support**: create-venv, activate-venv, deactivate-venv, list-venvs with VS Code integration
- **Security Mode Indicators**: Visual display in terminal prompt with color coding
- **Manifest Operations**: scan-manifest, install-manifest with security filtering
- **Cross-Platform**: Windows and Unix support with proper path handling

### Terminal Profile Integration
- **VS Code Integration**: Available in terminal dropdown alongside other shells
- **Profile Provider**: Registered via VS Code's registerTerminalProfileProvider API
- **Dual Access**: Available via dropdown selection and command palette

## Testing

- Jest for unit tests with mocks for external APIs
- `nock` for HTTP request mocking in adapter tests
- Integration tests for end-to-end workflows
- **Comprehensive ESLint rules enforced** - Zero tolerance for type safety violations
- **Jest globals properly configured** - Test files have proper ESLint environment setup

## Code Standards

- **Strict TypeScript with enforced no `any` types** - Comprehensive ESLint rules ensure complete type safety
- **Zero ESLint errors maintained** - All code must pass strict linting rules before commit
- Graceful error handling - extension should never crash
- HTTPS-only external requests
- No telemetry - all processing happens locally
- JSDoc comments for public methods

## Security & Dependencies

### Core Security Principle
**Always check for latest package versions through the web from official sources before implementing new packages.** This verification step ensures security and authenticity before adding dependencies to the project.

### Official Sources for Verification
- **JavaScript/TypeScript packages**: [npmjs.com](https://npmjs.com) - Official npm registry
- **Python packages**: [pypi.org](https://pypi.org) - Official Python Package Index
- **Direct repository dependencies**: [GitHub Releases](https://github.com) - Official repository release pages

### Dependency Management Workflow
1. **Before adding any new dependency**: 
   - Check the official source for the latest stable version
   - Verify package authenticity and maintainer information
   - Review recent security advisories and known vulnerabilities
   - Confirm package is actively maintained with recent updates

2. **Regular dependency updates**:
   - Prioritize security patches and critical updates
   - Monitor for new vulnerabilities in existing dependencies
   - Update to latest stable versions when possible
   - Document upgrade rationale in tasks.md

3. **Security verification checklist**:
   - ✅ Package exists on official registry
   - ✅ Has active maintainers and recent updates
   - ✅ No known critical security vulnerabilities
   - ✅ Reasonable download statistics indicating community trust
   - ✅ Clear licensing and legal compliance

### Risk Mitigation
- **Never install packages from unofficial sources**
- **Always verify package names to avoid typosquatting**
- **Review package permissions and scope before installation**
- **Use exact version pinning for production dependencies when appropriate**
- **Regularly audit dependencies for security issues**

This approach aligns with PkgGuard's mission of protecting against malicious packages by applying the same security standards to our own development process.

## Quick Reference

### Common Commands
```bash
# Development
npm run compile        # TypeScript compilation
npm run watch         # Watch mode development
npm run package       # Build .vsix extension
npm run lint          # ESLint code quality checks
npm run test          # Run Jest unit tests

# Terminal Commands
create-venv [name]    # Create virtual environment
activate-venv [name]  # Activate virtual environment
deactivate-venv       # Deactivate current environment
list-venvs           # List available environments
scan-manifest        # Scan requirements.txt/package.json
install-manifest     # Install with security filtering
```

### VS Code Commands
- `PkgGuard: Create Terminal` - Create PkgGuard smart terminal
- `PkgGuard: Toggle Security Mode` - Cycle security modes
- `PkgGuard: Clear Cache` - Clear all cached scores
- `PkgGuard: Validate Current File` - Force re-scan current file

## Task Management System

### Personal Assistant Tools

This project uses two key files as personal assistant tools to help with development:

1. **tasks.md** - Project task tracking and management
   - Track all project tasks, their status, and progress
   - Update task status when starting/completing work
   - Document any issues or blockers encountered
   - Maintain a record of completed, in-progress, and pending features
   - Use this file to remember what needs to be done and what's been accomplished

2. **project-schema.md** - Architecture documentation
   - Comprehensive overview of PkgGuard's architecture
   - Details about component connections and data flow
   - Updated whenever architectural changes are made
   - Reference this file to understand the entire system structure
   - Essential for understanding how components interact

### Usage Guidelines

- **Before starting work**: Check tasks.md for current priorities and project-schema.md for architecture context
- **During development**: Update tasks.md with progress and project-schema.md with any architectural changes
- **When discussing new features**: Add agreed-upon tasks to tasks.md
- **When encountering issues**: Document problems and reasons in tasks.md
- **After completing work**: Update both files to reflect current state

These files serve as your memory and planning tools - always consult and update them to maintain project continuity.