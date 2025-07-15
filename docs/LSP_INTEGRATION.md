# PkgGuard LSP Integration Documentation

## Overview

PkgGuard v0.7.6 introduces a complete Language Server Protocol (LSP) implementation that enhances terminal command validation with fault-tolerant architecture and local fallback capabilities.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LSP Integration                          │
├─────────────────────────────────────────────────────────────┤
│  Terminal LSP Bridge (TerminalLSPBridge.ts)               │
│  ├─ Client Management                                      │
│  ├─ Request Routing                                        │
│  ├─ Fallback Coordination                                  │
│  └─ Status Monitoring                                      │
├─────────────────────────────────────────────────────────────┤
│  LSP Server (src/LSP/server/)                             │
│  ├─ Command Validation                                     │
│  ├─ Package Analysis                                       │
│  ├─ Rate Limiting                                          │
│  └─ Error Handling                                         │
├─────────────────────────────────────────────────────────────┤
│  Fault-Tolerant Client (FaultTolerantClient.ts)           │
│  ├─ Connection Management                                  │
│  ├─ Retry Logic                                            │
│  ├─ Health Monitoring                                      │
│  └─ Graceful Degradation                                   │
├─────────────────────────────────────────────────────────────┤
│  Local Validator (LocalValidator.ts)                      │
│  ├─ Offline Package Analysis                              │
│  ├─ Known Malicious Database                              │
│  ├─ Typosquatting Detection                               │
│  └─ Basic Trust Scoring                                    │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. TerminalLSPBridge
**File**: `src/LSP/integration/TerminalLSPBridge.ts`

Main orchestrator for LSP-based terminal validation:
- Manages LSP client lifecycle
- Routes validation requests
- Handles fallback to local validation
- Provides status monitoring and statistics

```typescript
const bridge = new TerminalLSPBridge(context, {
  enabled: true,
  fallbackToLocal: true,
  showStatusIndicator: true,
  logLevel: 'info'
});

const result = await bridge.validateCommand('pip install numpy');
```

### 2. LSP Server
**File**: `src/LSP/server/index.ts`

Language server implementation providing:
- Package extraction from terminal commands
- Security analysis and scoring
- Rate limiting and authentication
- Comprehensive error handling

**Capabilities**:
- Method: `pkgguard/validateCommand`
- Supports: pip, npm, yarn, poetry, pipenv, pnpm, bun, conda, mamba

### 3. Fault-Tolerant Client
**File**: `src/LSP/client/FaultTolerantClient.ts`

Robust LSP client with:
- Automatic reconnection
- Exponential backoff retry logic
- Health monitoring (30-second intervals)
- Graceful failure handling

### 4. Local Validator
**File**: `src/LSP/client/LocalValidator.ts`

Offline fallback system featuring:
- 800+ known malicious packages database
- Pattern-based typosquatting detection
- Basic trust scoring without network calls
- Instant response times

## Configuration

### LSP-Specific Settings

```json
{
  "pkgGuard.lsp.enabled": true,
  "pkgGuard.lsp.timeout": 5000,
  "pkgGuard.lsp.retries": 3,
  "pkgGuard.lsp.maxRequestsPerMinute": 100,
  "pkgGuard.lsp.authTokenLength": 64,
  "pkgGuard.lsp.cleanupIntervalMs": 60000,
  "pkgGuard.lsp.retryDelayMs": 1000,
  "pkgGuard.lsp.healthCheckIntervalMs": 30000
}
```

### Typosquatting Detection Settings

```json
{
  "pkgGuard.lsp.minPackageNameLength": 3,
  "pkgGuard.lsp.maxNumberSequenceLength": 4,
  "pkgGuard.lsp.editDistanceThreshold": 2,
  "pkgGuard.lsp.homographDetectionEnabled": true
}
```

## Usage Examples

### Basic Command Validation

```typescript
// Validate a pip install command
const result = await bridge.validateCommand('pip install requests numpy');

console.log(result.isValid);        // true/false
console.log(result.source);         // 'lsp' or 'local'
console.log(result.packages);       // Array of package analysis
console.log(result.recommendation); // User-friendly message
```

### Integration in Terminal

```typescript
// Example terminal integration
async function processCommand(command: string): Promise<boolean> {
  const validation = await bridge.validateCommand(command);
  
  if (!validation.isValid) {
    const proceed = await showSecurityPrompt(validation);
    return proceed;
  }
  
  return true;
}
```

## Testing

### LSP Server Tests
```bash
# Run LSP-specific tests
npm run test:lsp

# Test core functionality
node test-lsp-basic.js

# Manual server testing
node test-lsp-manual.js
```

### Test Coverage
- **PackageExtractor**: Command parsing and package extraction
- **AnalysisEngine**: Security analysis and scoring
- **TyposquattingDetector**: Pattern matching and edit distance
- **FaultTolerantClient**: Connection management and retry logic

## Performance Metrics

### Response Times
- **LSP Server**: <100ms (cached results)
- **Local Fallback**: <10ms (instant)
- **Network Requests**: <2000ms (with retry)

### Cache Performance
- **Hit Rate**: >95% for common packages
- **TTL**: 48 hours (configurable)
- **Storage**: VS Code global storage

### Rate Limiting
- **Default**: 100 requests/minute
- **Burst**: 10 requests/second
- **Cleanup**: Every 60 seconds

## Error Handling & Fallback

### Fault Tolerance Strategy
1. **LSP Server Available**: Primary validation path
2. **LSP Server Down**: Automatic fallback to local validator
3. **Network Issues**: Local validation with cached data
4. **Complete Failure**: Allow command with warning

### Error Categories
- **Recoverable**: Network timeouts, temporary server issues
- **Non-recoverable**: Malformed requests, authentication failures
- **Degraded**: Partial results, cache misses

### Logging
```typescript
// Enable debug logging
localStorage.setItem('storage.logs.level', 'trace');

// Check logs in Developer Console
// Look for: [timestamp] [PkgGuard LSP] message
```

## Debugging

### Common Issues

**LSP Server Not Starting**:
- Check TypeScript compilation: `npm run build:lsp`
- Verify Node.js version: >= 20.0.0
- Check logs: Output Channel → "PkgGuard LSP Bridge"

**Slow Response Times**:
- Clear cache: Command Palette → "PkgGuard: Clear Cache"
- Check network connectivity
- Verify rate limiting settings

**Commands Not Recognized**:
- Check package manager patterns in `PackageExtractor.ts`
- Verify command syntax matches supported formats
- Enable debug logging for detailed analysis

### Status Monitoring

```typescript
// Get LSP bridge statistics
const stats = bridge.getStatistics();
console.log({
  clientState: stats.clientState,
  isEnabled: stats.isEnabled,
  fallbackEnabled: stats.fallbackEnabled,
  validationSource: stats.validationSource
});
```

## Development

### Building LSP Components
```bash
# Build all LSP components
npm run build:lsp

# Build individual components
esbuild src/LSP/server/index.ts --bundle --outfile=dist/lsp-server.js
esbuild src/LSP/client/FaultTolerantClient.ts --bundle --outfile=dist/lsp-client.js
```

### Adding New Package Managers
1. Update patterns in `PackageExtractor.ts`
2. Add test cases in `PackageExtractor.test.ts`
3. Update documentation and examples

### Extending Validation Logic
1. Modify `AnalysisEngine.ts` for new analysis types
2. Update `LocalValidator.ts` for offline support
3. Add corresponding tests and documentation

## Security Considerations

### Authentication
- Token-based authentication between client and server
- 64-character random tokens (configurable)
- Tokens regenerated on client restart

### Network Security
- HTTPS-only external API calls
- No user data transmitted to external services
- Local processing for sensitive operations

### Privacy
- No telemetry or tracking
- All analysis performed locally or on trusted registries
- User commands not logged or transmitted

## Migration Guide

### From v0.7.5 to v0.7.6
- LSP integration is automatic and transparent
- Existing terminal functionality preserved
- New settings available but not required
- Fallback ensures compatibility

### Configuration Migration
```json
// Old settings (still supported)
{
  "pkgGuard.terminal.enabled": true
}

// New LSP settings (optional)
{
  "pkgGuard.lsp.enabled": true,
  "pkgGuard.lsp.timeout": 5000
}
```

---

**Last Updated**: 2025-07-15  
**Version**: 0.7.6  
**Status**: LSP MVP Production Ready