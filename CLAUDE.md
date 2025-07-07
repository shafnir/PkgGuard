# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Architecture Overview

### Core Components

**Extension Entry Point** (`src/extension.ts`):
- Main orchestration and VS Code lifecycle management
- Document change listeners with 200ms debouncing
- Command registration (ignore/unignore packages, clear cache)
- Status bar integration and configuration management

**Detection Pipeline** (`src/detectors/`):
- `python.ts` - Regex-based Python import detection (from/import statements)
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
- `decorators.ts` - Colored trust badges (🟢🟡🔴⚪) after import lines
- `hovers.ts` - Detailed hover panels with trust scores and evidence

### Data Flow

1. Document changes trigger debounced validation (200ms delay)
2. Language-specific detectors extract package names with positions
3. Cache lookup first (48h TTL), then async registry fetching if needed
4. Trust scores calculated using weighted scoring algorithm
5. UI updated with decorations, hover data, and diagnostic warnings

### Storage and Caching

- **Cache Location**: `.pkgguard/.pkgguard-cache.json` (workspace-specific)
- **Ignore File**: `.pkgguard/.pkgguard-ignore` with format `package_name # note`
- **Global Storage**: Used when no workspace is open
- **TTL**: 48 hours default (configurable via `pkgGuard.cacheTTL`)

## Key Configuration

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
- `pkgguard.createTerminal` - Create secured terminal

## Important Implementation Details

### Trust Scoring Algorithm
- **High Trust (🟢)**: Score ≥ 80 (Python) / ≥ 75 (JavaScript)
- **Medium Trust (🟡)**: Score 50-79 (Python) / 45-74 (JavaScript)  
- **Low Trust (🔴)**: Score < 50 / < 45
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

## Terminal Integration

The extension includes terminal monitoring functionality (`src/terminal/`):
- `shell-integration.ts` - Monitors package installations in terminals
- `simple-terminal.ts` - Creates secured terminals with package validation
- Security modes: interactive, monitor, block, disabled

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

## Security-First Dependency Management

### Core Principle
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