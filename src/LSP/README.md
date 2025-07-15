# PkgGuard LSP MVP Implementation

This directory contains the MVP (Minimum Viable Product) implementation of PkgGuard's Language Server Protocol (LSP) architecture. The LSP server provides enhanced package validation capabilities with fault tolerance and local fallback mechanisms.

## Architecture Overview

The PkgGuard LSP MVP implements a **fault-tolerant architecture** with the following components:

```
┌─────────────────────────────────────────────────────────────┐
│                    PkgGuard LSP MVP                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌──────────────────────────┐  │
│  │   LSP Server        │    │  Fault-Tolerant Client   │  │
│  │  (Command Validation)│    │  (Local Fallback)       │  │
│  │  - validateCommand  │    │  - Health monitoring     │  │
│  │  - Authentication   │    │  - Auto-reconnect        │  │
│  │  - Rate limiting    │    │  - Offline validation    │  │
│  └─────────────────────┘    └──────────────────────────┘  │
│              │                           │                  │
│              └───────────┬───────────────┘                  │
│                          ▼                                  │
│                 ┌─────────────────┐                        │
│                 │ Analysis Engine │                        │
│                 │  - PyPI/npm API │                        │
│                 │  - Trust scoring│                        │
│                 │  - Package cache│                        │
│                 └─────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Core Analysis Engine (`core/AnalysisEngine.ts`)

The unified analysis engine that consolidates package analysis logic from existing PkgGuard components:

- **Package Analysis**: Analyzes Python (PyPI) and JavaScript (npm) packages
- **Trust Scoring**: Calculates trust scores based on multiple factors
- **Cache Management**: Implements 48-hour TTL cache for performance
- **Standard Library Detection**: Recognizes Python and Node.js built-in modules

**Key Features:**
- Concurrent package analysis
- Cache-first strategy for performance
- Comprehensive scoring algorithm
- Graceful error handling

### 2. Package Extraction Utility (`utils/PackageExtractor.ts`)

Extracts package information from terminal commands across different package managers:

- **Python**: pip, pip3, poetry, pipenv, conda, mamba
- **JavaScript**: npm, yarn, pnpm, bun
- **Features**: Version specifiers, extras, VCS URLs, local paths

**Supported Commands:**
```bash
# Python
pip install numpy pandas==1.3.0
poetry add fastapi[all]
pipenv install requests

# JavaScript  
npm install react @types/node
yarn add express axios@^0.27.0
pnpm add vue typescript
```

### 3. LSP Server (`server/index.ts`)

The MVP LSP server implementing a single custom request for package validation:

- **Custom Request**: `pkgguard/validateCommand`
- **Authentication**: SHA256 token-based authentication
- **Rate Limiting**: 100 requests per minute per client
- **Error Handling**: Graceful degradation on failures

**Request Format:**
```typescript
interface ValidateCommandParams {
  command: string;
  workspace?: string;
  authToken: string;
}

interface ValidateCommandResult {
  isValid: boolean;
  packages: Array<{
    name: string;
    ecosystem: "python" | "javascript";
    score: number | null;
    trustLevel: "high" | "medium" | "low" | "unknown";
    risks: string[];
  }>;
  recommendation: string;
  processingTime: number;
  source: "server" | "cache" | "fallback";
}
```

### 4. Fault-Tolerant Client (`client/FaultTolerantClient.ts`)

VS Code extension client with comprehensive fault tolerance:

- **Health Monitoring**: Continuous server health checks
- **Auto-Reconnect**: Automatic reconnection with exponential backoff
- **Local Fallback**: Offline validation when server unavailable
- **Circuit Breaker**: Prevents cascading failures

**Fault Tolerance Features:**
- Retry with exponential backoff (max 3 attempts)
- Request timeout (5 seconds)
- Health checks every 30 seconds
- Graceful degradation to local validation

### 5. Local Validator (`client/LocalValidator.ts`)

Offline validation component for when the LSP server is unavailable:

- **Known Malicious Packages**: Database of known malicious packages
- **Heuristic Analysis**: Pattern-based risk detection
- **Typosquatting Detection**: Identifies potential typosquatting attempts
- **Basic Security Checks**: Offline security validation

## Installation & Setup

### Prerequisites

- Node.js >= 20.0.0
- TypeScript >= 5.8.3
- VS Code >= 1.101.0

### Dependencies

The LSP MVP uses the following key dependencies:

```json
{
  "dependencies": {
    "vscode-languageserver": "^9.0.1",
    "vscode-languageclient": "^9.0.1",
    "node-fetch": "^3.3.2"
  }
}
```

### Build Process

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the LSP server:**
   ```bash
   npm run build:lsp
   ```

3. **Build the extension:**
   ```bash
   npm run compile
   ```

## Usage

### Starting the LSP Server

```bash
# Start the LSP server directly
node dist/lsp-server.js

# Or use the VS Code extension which starts it automatically
```

### Using the Client

```typescript
import { FaultTolerantClient } from './client/FaultTolerantClient';

const client = new FaultTolerantClient(context);
await client.start();

// Validate a command
const result = await client.validateCommand('pip install numpy');
console.log(result.recommendation);
```

## Configuration

### VS Code Settings

```json
{
  "pkgGuard.enabled": true,
  "pkgGuard.lsp.enabled": true,
  "pkgGuard.lsp.serverPath": "./dist/lsp-server.js",
  "pkgGuard.lsp.timeout": 5000,
  "pkgGuard.lsp.retries": 3
}
```

### Environment Variables

```bash
# LSP Server Configuration
PKGGUARD_LSP_PORT=7650
PKGGUARD_LSP_LOG_LEVEL=info
PKGGUARD_LSP_CACHE_SIZE=10000
PKGGUARD_LSP_RATE_LIMIT=100

# Analysis Engine Configuration
PKGGUARD_CACHE_TTL=172800  # 48 hours
PKGGUARD_REQUEST_TIMEOUT=5000  # 5 seconds
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testNamePattern="AnalysisEngine"
npm test -- --testNamePattern="PackageExtractor"

# Run tests with coverage
npm run test:coverage
```

### Test Structure

```
src/LSP/tests/
├── AnalysisEngine.test.ts       # Core analysis engine tests
├── PackageExtractor.test.ts     # Package extraction tests
├── LSPServer.test.ts           # LSP server tests
├── FaultTolerantClient.test.ts # Client tests
└── integration/
    ├── lsp-communication.test.ts
    └── fault-tolerance.test.ts
```

## Performance Benchmarks

### Expected Performance

- **Command Validation**: <100ms (with server)
- **Local Fallback**: <50ms (offline mode)
- **Cache Hit Rate**: >90% (with 48h TTL)
- **Concurrent Requests**: 10+ simultaneous
- **Memory Usage**: <50MB per client

### Optimization Features

- **Debounced Validation**: 200ms debounce for rapid commands
- **Concurrent Analysis**: Parallel package analysis
- **Smart Caching**: LRU cache with TTL
- **Standard Library Early Return**: Instant validation for built-ins

## Security Features

### Authentication

- **Token-based**: SHA256 authentication tokens
- **Per-session**: Tokens rotate per session
- **Validation**: Every request validates auth token

### Rate Limiting

- **Global Limit**: 1000 requests/minute server-wide
- **Per-Client Limit**: 100 requests/minute per client
- **Sliding Window**: 60-second sliding window

### Input Validation

- **Command Sanitization**: Validates all input commands
- **Package Name Validation**: Ensures valid package names
- **Size Limits**: Maximum 1MB request size

## Monitoring & Logging

### Health Checks

- **Endpoint**: `/health` (HTTP GET)
- **Interval**: 30-second health checks
- **Metrics**: Memory, CPU, response time

### Logging

```typescript
// Log levels: error, warn, info, debug
connection.console.log('LSP Server started');
connection.console.error('Validation failed');
```

### Metrics

- **Request Count**: Total requests processed
- **Response Time**: Average response time
- **Error Rate**: Percentage of failed requests
- **Cache Hit Rate**: Cache efficiency

## Troubleshooting

### Common Issues

1. **Server Won't Start**
   - Check Node.js version (>= 20.0.0)
   - Verify dependencies are installed
   - Check port availability

2. **Authentication Failures**
   - Verify auth token format (64-character hex)
   - Check token expiration
   - Ensure proper initialization

3. **Performance Issues**
   - Monitor cache hit rate
   - Check network connectivity
   - Verify resource limits

4. **Fallback Mode Stuck**
   - Check server logs for errors
   - Verify network connectivity
   - Restart VS Code extension

### Debug Mode

```bash
# Start server in debug mode
NODE_ENV=development node dist/lsp-server.js

# Enable verbose logging
PKGGUARD_LSP_LOG_LEVEL=debug node dist/lsp-server.js
```

## Roadmap

### Phase 1: MVP (Current)
- ✅ Single `validateCommand` request
- ✅ Basic fault tolerance
- ✅ Local fallback validation
- ✅ Authentication & rate limiting

### Phase 2: Enhanced Features
- [ ] Document analysis (hover, diagnostics)
- [ ] WebSocket communication
- [ ] Improved caching (Redis)
- [ ] Policy management

### Phase 3: Enterprise Features
- [ ] Multi-editor support
- [ ] Centralized policy server
- [ ] Advanced monitoring
- [ ] SAML/OAuth integration

## Contributing

### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the project: `npm run build`
4. Run tests: `npm test`

### Code Style

- **TypeScript**: Strict mode enabled
- **ESLint**: Zero errors required
- **Prettier**: Auto-formatting
- **JSDoc**: Document all public methods

### Testing Requirements

- **Unit Tests**: >80% code coverage
- **Integration Tests**: End-to-end scenarios
- **Performance Tests**: Response time benchmarks
- **Security Tests**: Authentication and validation

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
- GitHub Issues: [PkgGuard Issues](https://github.com/shafnir/PkgGuard/issues)
- Documentation: [PkgGuard Docs](https://github.com/shafnir/PkgGuard/wiki)
- Email: support@pkgguard.dev