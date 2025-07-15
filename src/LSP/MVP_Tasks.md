# PkgGuard LSP MVP Task Definitions

## Overview
This document outlines the specific tasks required to implement the Minimal Viable Product (MVP) for PkgGuard's Language Server Protocol architecture. The MVP focuses on a single critical feature: `validateCommand` with fault tolerance and security.

---

## Task 1: Extract Core Analysis Engine

### Summary
Extract package analysis logic from existing code into a standalone, reusable AnalysisEngine class.

### Subtasks
1. **Create AnalysisEngine class structure**
   - Reference: @src/scoring/index.ts (lines 1-26 for interfaces, 27-185 for stdlib definitions)
   - Reference: @src/types.ts (for TrustScore, RegistryInfo interfaces)
   
2. **Extract PyPI analysis logic**
   - Reference: @src/adapters/pypi.ts (lines 17-30 for adapter structure)
   - Reference: @src/scoring/index.ts (lines 186-389 for PyPI scoring logic)
   
3. **Extract npm analysis logic**
   - Reference: @src/adapters/npm.ts (lines 1-30 for adapter structure)
   - Reference: @src/scoring/javascript.ts (entire file for npm scoring)
   
4. **Implement shared cache manager**
   - Reference: @src/scoring/index.ts (lines 556-675 for cache functions)
   - Create new CacheManager class with TTL support

### Deliverables
- `src/LSP/core/AnalysisEngine.ts`
- `src/LSP/core/CacheManager.ts`
- Unit tests for both classes

---

## Task 2: Implement MVP LSP Server

### Summary
Create a basic LSP server that handles the `pkgguard/validateCommand` custom request with authentication.

### Subtasks
1. **Set up LSP server structure**
   - Initialize vscode-languageserver package
   - Reference: @src/terminal/LSP_Overview.md (lines 155-236 for MVP implementation)
   
2. **Implement authentication system**
   - Token-based auth (SHA256 hash)
   - Reference: @src/terminal/LSP_Overview.md (lines 221-224 for validation logic)
   
3. **Create validateCommand handler**
   - Reference: @src/terminal/simple-terminal.ts (lines 1560-1579 for security check logic)
   - Reference: @src/terminal/simple-terminal.ts (lines 1531-1558 for shouldCheckSecurity patterns)
   
4. **Add rate limiting**
   - Simple in-memory rate limiter
   - 100 requests/minute per client

### Deliverables
- `src/LSP/server/index.ts`
- `src/LSP/server/handlers/validateCommand.ts`
- `src/LSP/server/auth/TokenValidator.ts`

---

## Task 3: Create Fault-Tolerant Client

### Summary
Implement VS Code extension client that gracefully handles server failures with local fallback.

### Subtasks
1. **Create LSP client wrapper**
   - Reference: @src/terminal/LSP_Overview.md (lines 104-131 for fault tolerance pattern)
   - Implement retry logic with exponential backoff
   
2. **Implement local validation fallback**
   - Basic offline package checking
   - Known malicious package list
   - Reference: @src/terminal/LSP_Overview.md (lines 116-130 for local validation)
   
3. **Add health monitoring**
   - Periodic health checks
   - Auto-reconnect on failure
   - Status indicator in VS Code

### Deliverables
- `src/LSP/client/FaultTolerantClient.ts`
- `src/LSP/client/LocalValidator.ts`
- `src/LSP/client/HealthMonitor.ts`

---

## Task 4: Package Extraction Logic

### Summary
Extract and standardize package detection from terminal commands across different package managers.

### Subtasks
1. **Create package extraction utility**
   - Reference: @src/terminal/simple-terminal.ts (lines 1983-2150 for extractPackageInfo)
   - Support pip, npm, yarn, pnpm patterns
   
2. **Implement ecosystem detection**
   - Determine Python vs JavaScript from command
   - Handle edge cases (python -m pip, npx, etc.)

### Deliverables
- `src/LSP/utils/PackageExtractor.ts`
- Comprehensive regex test suite

---

## Task 5: Integration Tests

### Summary
Create comprehensive integration tests for LSP communication and fault tolerance.

### Subtasks
1. **LSP communication tests**
   - Reference: @src/terminal/LSP_Overview.md (lines 270-304 for test structure)
   - Test successful validation flow
   - Test authentication failures
   
2. **Fault injection tests**
   - Reference: @src/terminal/LSP_Overview.md (lines 308-336 for fault scenarios)
   - Server crash simulation
   - Network timeout handling
   
3. **Performance benchmarks**
   - Reference: @src/terminal/LSP_Overview.md (lines 339-382 for benchmark tests)
   - Measure response times
   - Test concurrent request handling

### Deliverables
- `src/LSP/tests/integration/lsp-communication.test.ts`
- `src/LSP/tests/integration/fault-tolerance.test.ts`
- `src/LSP/tests/performance/benchmark.test.ts`

---

## Task 6: Terminal Integration

### Summary
Modify existing terminal to use the new LSP server for command validation.

### Subtasks
1. **Add LSP client to terminal**
   - Reference: @src/terminal/simple-terminal.ts (lines 1253-1299 for processCommand)
   - Replace direct security check with LSP call
   
2. **Implement fallback mode UI**
   - Show warning when using local validation
   - Reference: @src/terminal/simple-terminal.ts (lines 1560-1579 for current UI)
   
3. **Update configuration handling**
   - Add LSP server settings
   - Auto-start server preference

### Deliverables
- Modified `src/terminal/simple-terminal.ts`
- New `src/terminal/LSPTerminalClient.ts`

---

## Task 7: Documentation and Setup

### Summary
Create documentation and setup scripts for the MVP.

### Subtasks
1. **Write setup guide**
   - Server installation instructions
   - Configuration options
   - Troubleshooting guide
   
2. **Create development scripts**
   - Build scripts for server and client
   - Debug launch configurations
   - Test runner setup

### Deliverables
- `src/LSP/README.md`
- `src/LSP/scripts/build.js`
- `.vscode/launch.json` updates

---

## Success Criteria

1. **Performance**: Command validation completes in <100ms
2. **Reliability**: Terminal continues working when server is down
3. **Security**: Only authorized clients can connect
4. **Testing**: >80% code coverage with all tests passing
5. **Documentation**: Clear setup and usage instructions

## Timeline

- **Week 1**: Tasks 1-3 (Core engine, server, and client)
- **Week 2**: Tasks 4-7 (Integration, testing, and documentation)

## Dependencies

- Node.js packages: `vscode-languageserver`, `vscode-languageclient`
- Existing PkgGuard modules: adapters, scoring engines, types
- VS Code Extension API for terminal integration