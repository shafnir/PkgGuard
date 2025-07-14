# PkgGuard LSP Architecture - MVP Implementation Guide

## Executive Summary

This document outlines the refined Language Server Protocol (LSP) architecture for PkgGuard, incorporating critical feedback to create a production-ready implementation. The architecture uses a **hybrid approach** combining LSP for document analysis with a separate IPC channel for terminal command validation, ensuring optimal performance, security, and fault tolerance.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [MVP Scope & Implementation](#mvp-scope--implementation)
3. [Testing Strategy](#testing-strategy)
4. [Scaling Roadmap](#scaling-roadmap)
5. [Security & Fault Tolerance](#security--fault-tolerance)

---

## Architecture Overview

### Critical Design Decision: Hybrid Architecture

After thorough analysis, we've determined that a pure LSP approach is insufficient for PkgGuard's requirements. Instead, we're implementing a **hybrid architecture** that leverages LSP's strengths while addressing its limitations.

#### Why Not Pure LSP?

1. **LSP Limitation**: Designed for document-centric operations, not interactive terminal sessions
2. **Performance Requirements**: Terminal commands need <100ms response time
3. **Security Isolation**: Terminal validation requires separate security boundaries
4. **Resource Efficiency**: Need shared daemon for multiple workspaces

#### Hybrid Architecture Solution

```
┌─────────────────────────────────────────────────────────────┐
│                    PkgGuard Server                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌──────────────────────────┐  │
│  │   LSP Server        │    │  Terminal Server         │  │
│  │  (Document Analysis)│    │  (Command Validation)    │  │
│  │  - Hover info      │    │  - Command intercept     │  │
│  │  - Diagnostics     │    │  - Security prompts      │  │
│  │  - Code actions    │    │  - Process management    │  │
│  └─────────────────────┘    └──────────────────────────┘  │
│              │                           │                  │
│              └───────────┬───────────────┘                  │
│                          ▼                                  │
│                 ┌─────────────────┐                        │
│                 │ Shared Analysis │                        │
│                 │     Engine       │                        │
│                 │  - PyPI/npm API │                        │
│                 │  - Trust scoring│                        │
│                 │  - Smart cache  │                        │
│                 └─────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### Communication Architecture

```typescript
// Three communication channels
interface PkgGuardCommunication {
  // 1. LSP Channel (JSON-RPC over stdio)
  lsp: {
    protocol: 'LSP 3.17',
    transport: 'stdio',
    usage: ['document analysis', 'hover', 'diagnostics']
  },
  
  // 2. Terminal Channel (WebSocket)
  terminal: {
    protocol: 'WebSocket',
    port: 'dynamic',
    usage: ['command validation', 'real-time feedback']
  },
  
  // 3. Control Channel (Named Pipe)
  control: {
    protocol: 'IPC',
    pipe: 'pkgguard-control',
    usage: ['health check', 'configuration', 'shutdown']
  }
}
```

---

## MVP Scope & Implementation

### Phase 1: Minimal Viable Product (2 weeks)

#### Core Features

1. **Single LSP Custom Request**
   ```typescript
   // Focus on one critical feature
   interface MVPFeature {
     request: 'pkgguard/validateCommand',
     purpose: 'Validate package installation commands',
     response: 'Security assessment with risk score'
   }
   ```

2. **Basic Fault Tolerance**
   ```typescript
   class FaultTolerantValidation {
     async validate(command: string): Promise<ValidationResult> {
       try {
         // Try server validation
         return await this.serverValidate(command);
       } catch (error) {
         // Fallback to local validation
         console.warn('Server unavailable, using local validation');
         return this.localValidate(command);
       }
     }
     
     private localValidate(command: string): ValidationResult {
       // Basic offline checks
       const knownMalicious = ['malicious-pkg', 'evil-module'];
       const packages = this.extractPackages(command);
       
       const hasKnownMalicious = packages.some(pkg => 
         knownMalicious.includes(pkg.name)
       );
       
       return {
         allowed: !hasKnownMalicious,
         confidence: 'low',
         message: 'Offline validation - limited security'
       };
     }
   }
   ```

3. **Security Model**
   ```typescript
   interface SecurityModel {
     // Client authentication
     authentication: {
       method: 'token-based',
       token: 'SHA256 hash of extension ID + timestamp',
       rotation: 'per-session'
     },
     
     // Request validation
     validation: {
       maxRequestSize: '1MB',
       rateLimit: '100 requests/minute',
       timeout: '5 seconds'
     }
   }
   ```

#### MVP Implementation

```typescript
// server/src/mvp-server.ts
import { createConnection, TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

class PkgGuardMVPServer {
  private connection = createConnection();
  private analysisEngine: AnalysisEngine;
  private authorizedClients = new Set<string>();
  
  constructor() {
    this.analysisEngine = new AnalysisEngine();
    this.setupHandlers();
  }
  
  private setupHandlers(): void {
    // Standard LSP lifecycle
    this.connection.onInitialize((params) => {
      // Verify client authorization
      const token = params.initializationOptions?.authToken;
      if (!this.validateAuthToken(token)) {
        throw new Error('Unauthorized client');
      }
      
      this.authorizedClients.add(params.clientInfo?.name || 'unknown');
      
      return {
        capabilities: {
          // Start with no standard LSP features
          textDocumentSync: 0
        }
      };
    });
    
    // Single custom request for MVP
    this.connection.onRequest('pkgguard/validateCommand', async (params: {
      command: string,
      workspace: string,
      authToken: string
    }) => {
      // Validate auth on every request
      if (!this.validateAuthToken(params.authToken)) {
        throw new Error('Invalid auth token');
      }
      
      // Rate limiting
      if (!this.checkRateLimit(params.authToken)) {
        throw new Error('Rate limit exceeded');
      }
      
      // Extract and analyze packages
      const packages = this.extractPackages(params.command);
      const scores = await this.analysisEngine.analyzePackages(packages);
      
      return {
        isValid: scores.every(s => s.trustLevel !== 'low'),
        packages: packages.map((pkg, i) => ({
          name: pkg.name,
          score: scores[i],
          risks: this.identifyRisks(scores[i])
        })),
        recommendation: this.getRecommendation(scores)
      };
    });
  }
  
  private validateAuthToken(token: string): boolean {
    // Simple token validation for MVP
    // Production: Use proper JWT or OAuth
    return token && token.length === 64;
  }
  
  private checkRateLimit(token: string): boolean {
    // Simple rate limiting
    // Production: Use Redis or similar
    return true;
  }
}

// Start server
const server = new PkgGuardMVPServer();
server.listen();
```

---

## Testing Strategy

### Automated Testing

#### 1. Unit Tests
```typescript
// tests/analysis-engine.test.ts
describe('AnalysisEngine', () => {
  it('should analyze packages correctly', async () => {
    const engine = new AnalysisEngine();
    const result = await engine.analyzePackage('numpy', 'python');
    
    expect(result).toHaveProperty('trustScore');
    expect(result.trustScore).toBeGreaterThanOrEqual(0);
    expect(result.trustScore).toBeLessThanOrEqual(100);
  });
  
  it('should handle network failures gracefully', async () => {
    const engine = new AnalysisEngine();
    // Mock network failure
    jest.spyOn(engine, 'fetchPackageInfo').mockRejectedValue(new Error('Network error'));
    
    const result = await engine.analyzePackage('numpy', 'python');
    expect(result.source).toBe('cache');
  });
});
```

#### 2. Integration Tests
```typescript
// tests/lsp-integration.test.ts
describe('LSP Integration', () => {
  let client: LanguageClient;
  let server: ChildProcess;
  
  beforeAll(async () => {
    // Start test server
    server = spawn('node', ['./dist/server.js'], {
      env: { ...process.env, NODE_ENV: 'test' }
    });
    
    // Create test client
    client = new LanguageClient(
      'test-client',
      'Test Client',
      { command: 'node', args: ['./dist/server.js'] },
      { documentSelector: [{ pattern: '**/*' }] }
    );
    
    await client.start();
  });
  
  it('should validate commands correctly', async () => {
    const result = await client.sendRequest('pkgguard/validateCommand', {
      command: 'pip install numpy',
      workspace: '/test/workspace',
      authToken: 'test-token-'.padEnd(64, '0')
    });
    
    expect(result.isValid).toBe(true);
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe('numpy');
  });
});
```

#### 3. Fault Injection Tests
```typescript
// tests/fault-tolerance.test.ts
describe('Fault Tolerance', () => {
  it('should handle server crash gracefully', async () => {
    const terminal = new PkgGuardTerminal();
    
    // Simulate server crash
    await terminal.killServer();
    
    // Should still work with fallback
    const result = await terminal.validateCommand('pip install requests');
    expect(result.allowed).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.message).toContain('Offline validation');
  });
  
  it('should recover when server restarts', async () => {
    const terminal = new PkgGuardTerminal();
    
    // Kill and restart server
    await terminal.killServer();
    await terminal.startServer();
    
    // Should use server validation again
    const result = await terminal.validateCommand('pip install requests');
    expect(result.confidence).toBe('high');
  });
});
```

#### 4. Performance Benchmarks
```typescript
// tests/performance.test.ts
describe('Performance Benchmarks', () => {
  const packages = [
    'numpy', 'pandas', 'requests', 'django', 'flask',
    'pytest', 'black', 'mypy', 'pylint', 'poetry'
  ];
  
  it('should validate commands within 100ms', async () => {
    const client = await createTestClient();
    
    for (const pkg of packages) {
      const start = Date.now();
      await client.sendRequest('pkgguard/validateCommand', {
        command: `pip install ${pkg}`,
        workspace: '/test',
        authToken: getTestToken()
      });
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(100);
    }
  });
  
  it('should handle concurrent requests efficiently', async () => {
    const client = await createTestClient();
    const start = Date.now();
    
    // Send 10 concurrent requests
    const promises = packages.slice(0, 10).map(pkg =>
      client.sendRequest('pkgguard/validateCommand', {
        command: `pip install ${pkg}`,
        workspace: '/test',
        authToken: getTestToken()
      })
    );
    
    await Promise.all(promises);
    const duration = Date.now() - start;
    
    // Should complete within 200ms (leveraging concurrency)
    expect(duration).toBeLessThan(200);
  });
});
```

### Manual Testing Scenarios

#### Scenario 1: Basic Functionality
```bash
# Terminal 1: Start server
npm run build:server
npm run start:server

# Terminal 2: Test VS Code extension
1. Open VS Code with test project
2. Open PkgGuard terminal
3. Type: pip install numpy
4. Verify: Security analysis appears
5. Type: pip install malicious-package
6. Verify: Security warning appears
```

#### Scenario 2: Fault Tolerance
```bash
# Test server crash recovery
1. Start PkgGuard terminal
2. Install a package successfully
3. Kill the server process (kill -9 <pid>)
4. Try to install another package
5. Verify: Fallback mode activates with warning
6. Restart server
7. Verify: Normal operation resumes
```

#### Scenario 3: Performance Testing
```bash
# Test response times
1. Create script that installs 20 packages
2. Run with time measurement
3. Verify: Average response < 100ms
4. Open 5 VS Code windows
5. Run installations concurrently
6. Verify: No performance degradation
```

#### Scenario 4: Security Testing
```bash
# Test unauthorized access
1. Modify extension to send invalid auth token
2. Verify: Server rejects requests
3. Try to overload server with requests
4. Verify: Rate limiting kicks in
5. Send malformed requests
6. Verify: Server doesn't crash
```

---

## Scaling Roadmap

### Phase 2: Enhanced Features (Weeks 3-4)

```typescript
interface Phase2Features {
  // Add document analysis
  documentAnalysis: {
    imports: 'Real-time import scanning',
    diagnostics: 'Security warnings in editor',
    quickFixes: 'Auto-fix insecure packages'
  },
  
  // Improved caching
  caching: {
    type: 'LRU with TTL',
    invalidation: 'Event-based (npm advisories, PyPI releases)',
    size: '10,000 packages'
  },
  
  // WebSocket terminal connection
  terminalServer: {
    protocol: 'WebSocket',
    features: ['Real-time validation', 'Progress updates', 'Batch operations']
  }
}
```

### Phase 3: Multi-Editor Support (Weeks 5-8)

```typescript
interface MultiEditorSupport {
  // Standardize communication
  protocol: {
    lsp: 'Standard LSP 3.17',
    custom: 'OpenAPI 3.0 spec for custom methods',
    versioning: 'Semantic versioning with capability negotiation'
  },
  
  // Editor plugins
  editors: {
    vscode: 'Primary implementation',
    intellij: 'Java-based LSP client',
    sublime: 'Python-based client',
    vim: 'COC.nvim integration'
  },
  
  // Deployment options
  distribution: {
    npm: 'Global package for Node.js users',
    binary: 'Standalone executables via pkg',
    docker: 'Container for enterprise deployment'
  }
}
```

### Phase 4: Enterprise Features (Weeks 9-12)

```typescript
interface EnterpriseFeatures {
  // Shared daemon architecture
  daemon: {
    type: 'System service',
    activation: 'Socket-based',
    management: 'systemd/launchd/Windows Service'
  },
  
  // Advanced security
  security: {
    authentication: 'OAuth2/SAML',
    encryption: 'TLS for all communication',
    audit: 'Comprehensive logging with SIEM integration'
  },
  
  // Monitoring
  telemetry: {
    metrics: 'Prometheus-compatible',
    tracing: 'OpenTelemetry',
    dashboards: 'Grafana templates'
  },
  
  // Policy management
  policies: {
    format: 'OPA (Open Policy Agent)',
    distribution: 'Central policy server',
    enforcement: 'Client-side with server validation'
  }
}
```

---

## Security & Fault Tolerance

### Security Architecture

```typescript
class SecurityArchitecture {
  // 1. Authentication
  authentication = {
    method: 'HMAC-SHA256',
    secret: 'Per-installation unique key',
    rotation: 'Daily with grace period'
  };
  
  // 2. Authorization
  authorization = {
    model: 'RBAC',
    roles: ['analyzer', 'admin', 'auditor'],
    permissions: 'Granular per-method'
  };
  
  // 3. Encryption
  encryption = {
    transport: 'TLS 1.3',
    storage: 'AES-256-GCM',
    keys: 'Managed by OS keychain'
  };
  
  // 4. Rate Limiting
  rateLimiting = {
    global: '1000 req/min',
    perClient: '100 req/min',
    perMethod: 'Custom limits'
  };
}
```

### Fault Tolerance Strategies

```typescript
class FaultToleranceStrategies {
  // 1. Graceful Degradation
  degradation = {
    levels: ['Full', 'Cached', 'Offline', 'Bypass'],
    triggers: ['Server down', 'Network error', 'Timeout', 'Overload']
  };
  
  // 2. Circuit Breaker
  circuitBreaker = {
    threshold: '5 failures in 60s',
    timeout: '30s cooldown',
    halfOpen: 'Test with single request'
  };
  
  // 3. Retry Logic
  retry = {
    strategy: 'Exponential backoff',
    maxAttempts: 3,
    maxDelay: '5s',
    jitter: true
  };
  
  // 4. Health Checks
  health = {
    endpoint: '/health',
    interval: '30s',
    timeout: '5s',
    metrics: ['Memory', 'CPU', 'Response time']
  };
}
```

### Deployment Configurations

```yaml
# deployment/docker-compose.yml
version: '3.8'
services:
  pkgguard-server:
    image: pkgguard/server:latest
    ports:
      - "7650:7650"  # LSP
      - "7651:7651"  # WebSocket
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
      - CACHE_SIZE=10000
      - MAX_WORKERS=4
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7650/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
```

### Corporate Environment Support

```typescript
interface CorporateSupport {
  // Proxy configuration
  proxy: {
    http: process.env.HTTP_PROXY,
    https: process.env.HTTPS_PROXY,
    bypass: process.env.NO_PROXY
  },
  
  // Offline mode
  offline: {
    cache: 'Pre-populated security database',
    updates: 'Manual import via secure channel',
    validation: 'Conservative allow-list based'
  },
  
  // Custom registries
  registries: {
    pypi: process.env.PYPI_INDEX_URL || 'https://pypi.org/simple',
    npm: process.env.NPM_REGISTRY || 'https://registry.npmjs.org'
  }
}
```

---

## Conclusion

This hybrid LSP architecture provides:

1. **Optimal Performance**: <100ms response times via persistent server
2. **Fault Tolerance**: Multiple fallback strategies ensure availability
3. **Security**: Defense-in-depth with authentication, authorization, and encryption
4. **Scalability**: From single-user MVP to enterprise deployment
5. **Maintainability**: Clear separation of concerns and standard protocols

The MVP implementation focuses on the critical `validateCommand` functionality with robust error handling, setting a solid foundation for future enhancements.