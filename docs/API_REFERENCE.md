# PkgGuard API Reference

## Extension Commands

### Available Commands (Command Palette)

#### Core Commands
- `PkgGuard: Show Diagnostics` - Display extension health and configuration status
- `PkgGuard: Validate Current File` - Force re-validation of the active document
- `PkgGuard: Clear Cache` - Clear all cached trust scores (forces re-evaluation)
- `PkgGuard: Create Terminal` - Create a new PkgGuard smart terminal
- `PkgGuard: Toggle Security Mode` - Cycle through security modes (interactive/monitor/block/disabled)

#### Package Management
- `PkgGuard: Ignore Package` - Add package to ignore list (via hover UI)
- `PkgGuard: Unignore Package` - Remove package from ignore list (via hover UI)
- `PkgGuard: Open Cache File` - Open cache file for inspection

## LSP Integration API

### TerminalLSPBridge

Main interface for LSP-based terminal validation.

```typescript
import { TerminalLSPBridge, TerminalLSPOptions } from './LSP/integration/TerminalLSPBridge';

// Initialize
const options: TerminalLSPOptions = {
  enabled: true,
  fallbackToLocal: true,
  showStatusIndicator: true,
  logLevel: 'info'
};

const bridge = new TerminalLSPBridge(context, options);
await bridge.initialize();
```

#### Methods

**validateCommand(command: string, workspace?: string): Promise<ValidationResult>**
Validates a terminal command for security risks.

```typescript
const result = await bridge.validateCommand('pip install numpy');
console.log({
  isValid: result.isValid,           // boolean
  source: result.source,             // 'lsp' | 'local'
  packages: result.packages,         // PackageAnalysis[]
  recommendation: result.recommendation // string
});
```

**getStatistics(): BridgeStatistics**
Returns current LSP bridge status and statistics.

```typescript
const stats = bridge.getStatistics();
console.log({
  clientState: stats.clientState,       // 'connected' | 'disconnected' | 'error'
  isEnabled: stats.isEnabled,           // boolean
  fallbackEnabled: stats.fallbackEnabled, // boolean
  validationSource: stats.validationSource // 'lsp' | 'local' | 'unknown'
});
```

**restartClient(): Promise<void>**
Restarts the LSP client connection.

### PackageExtractor

Utility for extracting package information from terminal commands.

```typescript
import { PackageExtractor, ExtractionResult } from './LSP/utils/PackageExtractor';

// Extract packages from command
const result: ExtractionResult = PackageExtractor.extractPackages('pip install numpy pandas');
console.log({
  packages: result.packages,          // ExtractedPackage[]
  ecosystem: result.ecosystem,        // 'python' | 'javascript' | 'mixed'
  isInstallCommand: result.isInstallCommand, // boolean
  packageManager: result.packageManager      // string
});
```

#### ExtractedPackage Interface

```typescript
interface ExtractedPackage {
  name: string;                       // Package name
  ecosystem: "python" | "javascript"; // Package ecosystem
  version?: string;                   // Version specifier
  flags?: string[];                   // Additional flags
}
```

### TyposquattingDetector

Advanced typosquatting detection engine.

```typescript
import { TyposquattingDetector, TyposquattingResult } from './LSP/utils/TyposquattingDetector';

const detector = new TyposquattingDetector();
const result: TyposquattingResult = detector.analyze('reqeusts', 'python');

console.log({
  isSuspicious: result.isSuspicious,     // boolean
  confidence: result.confidence,         // 0-1 scale
  reasons: result.reasons,               // string[]
  similarPackages: result.similarPackages // string[]
});
```

## Configuration API

### Extension Settings

Access via VS Code Settings (search "pkgguard"):

#### Core Settings
```typescript
"pkgGuard.enabled": boolean;           // Enable/disable extension (default: true)
"pkgGuard.cacheTTL": number;          // Cache TTL in seconds (default: 172800)
"pkgGuard.securityMode": string;      // Security mode (default: "interactive")
"pkgGuard.terminal.enabled": boolean; // Terminal monitoring (default: true)
```

#### LSP Settings
```typescript
"pkgGuard.lsp.enabled": boolean;              // Enable LSP server (default: true)
"pkgGuard.lsp.timeout": number;              // Request timeout ms (default: 5000)
"pkgGuard.lsp.retries": number;              // Retry attempts (default: 3)
"pkgGuard.lsp.maxRequestsPerMinute": number; // Rate limit (default: 100)
```

#### Typosquatting Detection
```typescript
"pkgGuard.lsp.minPackageNameLength": number;    // Min name length (default: 3)
"pkgGuard.lsp.maxNumberSequenceLength": number; // Max number sequence (default: 4)
"pkgGuard.lsp.editDistanceThreshold": number;   // Edit distance threshold (default: 2)
"pkgGuard.lsp.homographDetectionEnabled": boolean; // Homograph detection (default: true)
```

## Trust Scoring API

### TrustScore Interface

```typescript
interface TrustScore {
  packageName: string;
  score: number | null;              // 0-100 or null for unknown
  level: "high" | "medium" | "low" | "unknown" | "ignored";
  ecosystem: "python" | "javascript";
  evidence: {
    exists: boolean;
    downloads: number;
    releaseAge: number;
    maintainerCount: number;
    multipleMaintainers: boolean;
    vulnerabilities: number;
    registryUrl?: string;
  };
  scoreReasons: string[];
  riskFactors?: Array<{
    text: string;
    color: string;
  }>;
  deprecated?: string;               // Deprecation message
  replacement?: string;              // Suggested replacement
  releaseDate?: string;
}
```

### Trust Levels

- **High (🟢)**: Score ≥80 (Python) / ≥75 (JavaScript)
- **Medium (🟡)**: Score 50-79 (Python) / 45-74 (JavaScript)  
- **Low (🔴)**: Score <50 (Python) / <45 (JavaScript)
- **Unknown (❓)**: Unable to evaluate (network/API issues)
- **Ignored (⚪)**: User-configured to ignore

## Event Handlers

### Document Validation Events

```typescript
// Listen for document validation
vscode.workspace.onDidChangeTextDocument((event) => {
  if (["python", "javascript", "typescript"].includes(event.document.languageId)) {
    // Debounced validation triggered (200ms)
  }
});
```

### Terminal Command Events

```typescript
// Monitor terminal commands (when enabled)
vscode.window.onDidStartTerminalShellExecution((event) => {
  // Command execution started
});

vscode.window.onDidEndTerminalShellExecution((event) => {
  // Command execution completed
});
```

## Error Handling

### Common Error Patterns

```typescript
// LSP Client Errors
try {
  const result = await bridge.validateCommand(command);
} catch (error) {
  if (error.code === 'LSP_TIMEOUT') {
    // Handle timeout - use local fallback
  } else if (error.code === 'LSP_DISCONNECTED') {
    // Handle disconnection - attempt reconnect
  }
}
```

### Graceful Degradation

1. **LSP Server Available**: Full validation with network lookups
2. **LSP Server Down**: Local validation with cached data  
3. **Network Issues**: Offline validation with known patterns
4. **Complete Failure**: Allow with warning message

## Logging API

### Enable Debug Logging

```typescript
// In browser console
localStorage.setItem('storage.logs.level', 'trace');

// Reload VS Code window
// Check logs in Developer Console or Output Channel
```

### Log Levels

- **info**: General operation logs
- **warn**: Non-critical issues and fallbacks
- **error**: Critical errors and failures

---

**Version**: 0.7.6  
**Last Updated**: 2025-07-15  
**Status**: Production Ready