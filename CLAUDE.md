# CLAUDE.md

This file provides essential guidance for working with the PkgGuard VS Code extension codebase.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Development Commands](#development-commands)
3. [Architecture](#architecture)
4. [Configuration](#configuration)
5. [Code Standards](#code-standards)
6. [Security & Dependencies](#security--dependencies)
7. [Task Management](#task-management)

## Project Overview

PkgGuard is a VS Code extension that protects developers from malicious package imports by analyzing package trustworthiness in real-time. It supports Python (PyPI) and JavaScript/TypeScript (npm) ecosystems with terminal integration and security warnings.

## Development Commands

- `npm run compile` - TypeScript compilation
- `npm run watch` - Watch mode development 
- `npm run package` - Build .vsix extension
- `npm run lint` - ESLint code quality checks (0 errors required)
- `npm run test` - Jest unit tests
- `npm run test:lsp` - LSP-specific unit tests
- `npm run build:lsp` - Build LSP server and client components
- Always verify packages through official sources before adding dependencies
- Use ES6 modules for all new development

## Debugging Commands

- `PkgGuard: Show Diagnostics` - Extension health and status
- `PkgGuard: Validate Current File` - Force file re-validation
- `PkgGuard: Clear Cache` - Clear package cache
- `PkgGuard: Toggle Security Mode` - Cycle terminal security modes
- Developer Console: `Help` → `Toggle Developer Tools` → `Console`
- Output Channel: `View` → `Output` → Select "PkgGuard"

## Development Guidelines

# Package Management & Documentation

- Use only the latest stable package versions for all dependencies
- Always consult official documentation before implementation using context7 or web fetch to ensure current best practices

# Code Quality & Security

- Conduct thorough security reviews of all written code before deployment
- Implement comprehensive test suites to prevent regression and maintain functionality integrity

# Code Organization
- Reference and link to relevant code files when providing examples or explanations to maintain context and traceability
- Do not pass 1.5K code files unless it's absolutley necessary.
- Code in modules, that use each other. Code should be efficient, decoupled, reuseable code, no duplicates, unless it's absolutley necessary.


## Architecture

**Main Components:**
- `src/extension.ts` - Entry point, VS Code integration, document listeners
- `src/detectors/` - Python/JavaScript import detection
- `src/adapters/` - PyPI, npm, GitHub API integration
- `src/scoring/` - Trust scoring algorithms
- `src/ui/` - Decorators and hover providers
- `src/terminal/` - Terminal integration and monitoring

**Data Flow:**
1. Document changes → debounced validation → package detection
2. Cache lookup (48h TTL) → API calls if needed → scoring
3. UI updates with trust badges and hover details

## Configuration

**Settings:**
- `pkgGuard.enabled` - Enable/disable extension
- `pkgGuard.cacheTTL` - Cache TTL (default: 48h)
- `pkgGuard.securityMode` - Terminal security mode

**Commands:**
- `PkgGuard: Create Terminal` - Create smart terminal
- `PkgGuard: Toggle Security Mode` - Cycle security modes
- `PkgGuard: Clear Cache` - Clear cached scores
- `PkgGuard: Validate Current File` - Force re-scan

**Storage:**
- Cache: `.pkgguard/.pkgguard-cache.json` (48h TTL)
- Ignore: `.pkgguard/.pkgguard-ignore`

**Trust Scoring:**
- High (🟢): ≥80 (Python) / ≥75 (JavaScript)
- Medium (🟡): 50-79 (Python) / 45-74 (JavaScript)
- Low (🔴): <50 / <45
- Unknown (❓): API failure
- Ignored (⚪): User-configured

**Scoring Factors:**
- Package existence: 40pts
- Downloads: 20pts (log scale)
- Recent release: 15pts
- Multiple maintainers: 5pts
- Vulnerabilities: -10pts each
- Typosquatting: -60pts

**Testing:**
- Jest unit tests with API mocking
- ESLint strict type checking
- Integration tests for workflows

## Code Standards

- Strict TypeScript (no `any` types)
- Zero ESLint errors required
- Graceful error handling
- HTTPS-only external requests
- No telemetry - local processing only
- JSDoc for public methods

## Security & Dependencies

**Security Principle:** Always verify packages through official sources before adding dependencies.

**Verification Sources:**
- JavaScript/TypeScript: [npmjs.com](https://npmjs.com)
- Python: [pypi.org](https://pypi.org)
- Repositories: [GitHub Releases](https://github.com)

**Checklist:**
- ✅ Package exists on official registry
- ✅ Active maintainers and recent updates
- ✅ No critical vulnerabilities
- ✅ Reasonable download statistics
- ✅ Clear licensing

**Risk Mitigation:**
- Never use unofficial sources
- Verify package names (avoid typosquatting)
- Regular dependency audits

# Claude Code Task Management System 

## Task Management Commands

When you request **add task** or use the command **create task**, I will:
1. Create a new task file with a unique Task ID in the tasks/ folder 
2. Document our thought process about the approach 
3. Develop an implementation plan 
4. Set an initial status 
5. Update the _index.md file to include the new task

For existing tasks, the command **update task [ID]** will prompt me to:
1. Open the specific task file 
2. Add a new progress log entry with today's date 
3. Update the task status if needed 
4. Update the _index.md file to reflect any status changes 
5. Integrate any new decisions into the thought process 

To view tasks, the command **show tasks [filter]** will:
1. Display a filtered list of tasks based on the specified criteria 
2. Valid filters include:
 - **all** - Show all tasks regardless of status
 - **active** - Show only tasks with "In Progress" status
 - **pending** - Show only tasks with "Pending" status
 - **completed** - Show only tasks with "Completed" status
 - **recent** - Show tasks updated in the last week 

## Task File Structure
Each task file follows this format:
 **Status:** [Pending/In Progress/Completed/Abandoned]
 **Added:** [Date Added]
 **Updated:** [Date Last Updated] 

### Implementation Plan
 - [Step 1]
 - [Step 2]
 - [Step 3]

### Progress Tracking
 **Overall Status:** [Not Started/In Progress/Blocked/Completed] - [Completion Percentage] #### Subtasks | ID | Description | Status | Updated | Notes | |----|-------------|--------|---------|-------| | 1.1 | [Subtask description] | [Complete/In Progress/Not Started/Blocked] | [Date] | [Any relevant notes] | ### Progress Log #### [Date] - Updated subtask 1.1 status to Complete - Started work on subtask 1.2 - Encountered issue with [specific problem] - Made decision to [approach/solution] IMPORTANT: Always update both the subtask status table AND the progress log when making progress on a task.

**Key Files:**
- `project-schema.md` - Architecture documentation

**Guidelines:**
- Always Update progress during development
- Reference @project-schema.md for architecture context