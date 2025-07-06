# PkgGuard Architecture Schema

## System Overview

PkgGuard is a VS Code extension that provides real-time security analysis for Python and JavaScript/TypeScript package imports. It uses a multi-layered architecture with detection, scoring, caching, and UI components.

## Core Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          VS Code Extension                       │
├─────────────────────────────────────────────────────────────────┤
│  Extension Entry Point (src/extension.ts)                      │
│  ├─ Document Change Listeners (200ms debounce)                 │
│  ├─ Command Registration & Status Bar                          │
│  ├─ Configuration Management                                   │
│  └─ Lifecycle Management                                       │
├─────────────────────────────────────────────────────────────────┤
│  Detection Pipeline                                             │
│  ├─ Python Detector (src/detectors/python.ts)                 │
│  └─ JavaScript Detector (src/detectors/javascript.ts)          │
├─────────────────────────────────────────────────────────────────┤
│  Registry Adapters                                              │
│  ├─ PyPI Adapter (src/adapters/pypi.ts)                       │
│  ├─ npm Adapter (src/adapters/npm.ts)                         │
│  ├─ GitHub Adapter (src/adapters/github.ts)                   │
│  └─ Top Packages (src/adapters/npm-top.ts)                    │
├─────────────────────────────────────────────────────────────────┤
│  Scoring Engines                                               │
│  ├─ Python Scoring (src/scoring/index.ts)                     │
│  └─ JavaScript Scoring (src/scoring/javascript.ts)            │
├─────────────────────────────────────────────────────────────────┤
│  User Interface                                                 │
│  ├─ Trust Decorators (src/ui/decorators.ts)                   │
│  └─ Hover Providers (src/ui/hovers.ts)                        │
├─────────────────────────────────────────────────────────────────┤
│  Terminal Integration                                           │
│  ├─ Shell Integration (src/terminal/shell-integration.ts)     │
│  └─ Simple Terminal (src/terminal/simple-terminal.ts)         │
├─────────────────────────────────────────────────────────────────┤
│  Storage & Caching                                             │
│  ├─ Local Cache (.pkgguard/.pkgguard-cache.json)             │
│  ├─ Ignore File (.pkgguard/.pkgguard-ignore)                 │
│  └─ Global Storage (VS Code global storage)                   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Relationships

### 1. Extension Entry Point (`src/extension.ts`)
**Purpose**: Main orchestration and VS Code integration
**Connects to**:
- All detectors (Python, JavaScript)
- All adapters (PyPI, npm, GitHub)
- All scoring engines
- All UI components
- Terminal integration
- Configuration system

**Key Responsibilities**:
- Document change event handling with 200ms debouncing
- Command registration and execution
- Status bar management
- Extension lifecycle (activate/deactivate)
- Error handling and graceful degradation

### 2. Detection Pipeline

#### Python Detector (`src/detectors/python.ts`)
**Purpose**: Extract Python package names from import statements
**Input**: Document text
**Output**: Array of `PackageName` objects
**Patterns Detected**:
- `import package_name`
- `from package_name import ...`
- Complex import statements with aliases

#### JavaScript Detector (`src/detectors/javascript.ts`)
**Purpose**: Extract JavaScript/TypeScript package names
**Input**: Document text
**Output**: Array of `PackageName` objects
**Patterns Detected**:
- `import ... from 'package'`
- `require('package')`
- Scoped packages (`@scope/package`)
- ES6 and CommonJS imports

### 3. Registry Adapters

#### PyPI Adapter (`src/adapters/pypi.ts`)
**Purpose**: Fetch package metadata from PyPI
**External APIs**:
- `https://pypi.org/pypi/{package}/json` - Package metadata
- `https://pypistats.org/api/packages/{package}/recent?period=month` - Monthly download statistics
- `https://hugovk.github.io/top-pypi-packages/` - Top packages list (used in extension.ts)
**Dual Download Data Sources**:
- **Top Packages**: Lifetime download counts from Hugo van Kemenade's top-pypi-packages.min.json (fetched in extension.ts)
- **Regular Packages**: Monthly download counts from PyPI Stats API (no API key required)
**Returns**: `RegistryInfo` with downloads, maintainers, vulnerabilities

#### npm Adapter (`src/adapters/npm.ts`)
**Purpose**: Fetch package metadata from npm registry
**External APIs**:
- `https://registry.npmjs.org/{package}` - Package metadata
- `https://api.npmjs.org/downloads/point/last-month/{package}` - Download stats
**Returns**: `RegistryInfo` with npm-specific data

#### GitHub Adapter (`src/adapters/github.ts`)
**Purpose**: Fetch repository statistics and vulnerability data
**External APIs**:
- GitHub API for repository metadata
- Security advisories API
**Returns**: Repository stats, vulnerability counts

### 4. Scoring Engines

#### Python Scoring (`src/scoring/index.ts`)
**Purpose**: Calculate trust scores for Python packages
**Scoring Algorithm**:
- Package existence: 40 points
- Download popularity: 20 points (logarithmic scale)
- Release recency: 15 points
- Multiple maintainers: 5 points
- Vulnerabilities: -10 points each
- Typosquatting detection: -60 points

**Trust Levels**:
- High (🟢): Score ≥ 80
- Medium (🟡): Score 50-79
- Low (🔴): Score < 50
- Ignored (⚪): User-configured ignore

#### JavaScript Scoring (`src/scoring/javascript.ts`)
**Purpose**: Calculate trust scores for JavaScript/TypeScript packages
**Scoring Algorithm**: Similar to Python with JavaScript-specific adjustments
**Trust Levels**:
- High (🟢): Score ≥ 75
- Medium (🟡): Score 45-74
- Low (🔴): Score < 45
- Ignored (⚪): User-configured ignore

### 5. User Interface Components

#### Trust Decorators (`src/ui/decorators.ts`)
**Purpose**: Display trust badges after import statements
**Visual Elements**:
- 🟢 High trust badge
- 🟡 Medium trust badge
- 🔴 Low trust badge
- ⚪ Ignored badge
**Positioning**: End of import line with proper spacing

#### Hover Providers (`src/ui/hovers.ts`)
**Purpose**: Show detailed trust information on hover
**Content**:
- Trust score and level
- Evidence breakdown
- Registry links
- Risk factors
- Ignore/unignore actions

### 6. Terminal Integration

#### Shell Integration (`src/terminal/shell-integration.ts`)
**Purpose**: Monitor package installations in VS Code terminals
**Monitored Commands**:
- `pip install`, `pip3 install`, `python -m pip install`
- `npm install`, `npm i`, `yarn add`, `pnpm add`, `bun add`
- `poetry add`, `pipenv install`

#### Simple Terminal (`src/terminal/simple-terminal.ts`)
**Purpose**: Create secured terminals with package validation and manifest scanning
**Security Modes**:
- Interactive: Ask for approval
- Monitor: Show warnings
- Block: Prevent installation
- Disabled: No checks
**Enhanced Features**:
- Manifest file scanning functionality for comprehensive package analysis
- Real-time security validation during terminal operations

## Data Flow

```
Document Change Event
         ↓
    Debounced (200ms)
         ↓
    Language Detection
         ↓
    Package Detection
         ↓
    Cache Check (48h TTL)
         ↓
    [Cache Miss] → Registry API → Scoring Engine
         ↓
    UI Update (Decorators + Hovers)
         ↓
    Diagnostics Update
```

## Storage Architecture

### Cache System
**Location**: VS Code global storage (`.pkgguard/.pkgguard-cache.json`)
**Behavior**: Always uses global storage for consistency across workspaces
**Structure**:
```json
{
  "python": {
    "package_name": {
      "score": 85,
      "level": "high",
      "evidence": {...},
      "timestamp": 1704571200000
    }
  },
  "javascript": {...}
}
```

### Ignore System
**Location**: VS Code global storage (`.pkgguard/.pkgguard-ignore`)
**Behavior**: Always uses global storage, shared across all workspaces
**Migration**: Automatically migrates existing workspace ignore lists to global storage
**Format**:
```
package_name # optional comment
another_package # reason for ignoring
```

### Configuration
**VS Code Settings**:
- `pkgGuard.enabled`: Enable/disable extension
- `pkgGuard.cacheTTL`: Cache TTL in seconds (default: 172800)
- `pkgGuard.securityMode`: Terminal security mode
- `pkgGuard.terminal.enabled`: Enable terminal monitoring

## Extension Lifecycle

### Activation
1. Initialize global storage path
2. **Migrate workspace data to global storage** (one-time migration)
3. Load configuration settings
4. Fetch and cache top packages lists
5. Load ignore file and cache from global storage
6. Register commands and event handlers
7. Initialize terminal monitoring
8. Set up hover providers and decorators
9. Validate all open documents

### Document Processing
1. Document change event triggered
2. Debounced validation (200ms)
3. Language-specific detection
4. **Standard library check** (early return, no API calls)
5. Cache lookup with TTL check
6. Async registry fetching for cache misses
7. Trust score calculation
8. UI updates (decorations, hovers, diagnostics)

### Deactivation
1. Clear all decorations
2. Dispose diagnostic collections
3. Clean up terminal monitoring
4. Dispose hover providers
5. Clear timers and event handlers

## External Dependencies

### Runtime Dependencies
- `node-fetch`: HTTP requests to registries (^3.3.2)
- `node-pty`: Terminal integration (^1.0.0)
- `sqlite3`: Local storage (^5.1.7)
- `ws`: WebSocket support (^8.18.3 - security patches)

### Development Dependencies
- `typescript`: Language and compiler (^5.8.3 - latest stable)
- `eslint`: Code linting (^9.0.0 - modern flat config)
- `@typescript-eslint/*`: TypeScript ESLint integration (^8.35.1)
- `jest`: Unit testing (^29.7.0)
- `ts-jest`: TypeScript Jest integration (^29.4.0)
- `nock`: HTTP mocking for tests (^13.5.4)
- `esbuild`: Bundling for distribution (0.25.5 - exact version, CORS fix)
- `prettier`: Code formatting (^3.2.5)

## Security Considerations

### Network Security
- All external requests use HTTPS
- API endpoints are predefined and validated
- No user input directly used in URLs
- PyPI Stats API used instead of PePy (which requires API keys)

### Local Security
- No telemetry or data collection
- All processing happens locally
- Cache files stored in workspace or global storage
- No execution of arbitrary code

### Extension Security
- Strict TypeScript with no `any` types
- Graceful error handling prevents crashes
- Proper input validation and sanitization
- VS Code untrusted workspace support

## Performance Optimizations

### Caching Strategy
- 48-hour TTL for registry data
- Workspace-specific cache isolation
- Lazy loading of package lists
- Debounced document validation

### Standard Library Optimization
- Early return for Python standard library modules (180+ packages)
- Skips all external API calls (PyPI, GitHub, PyPI Stats)
- Static score of 100 with immediate caching
- Significant rate limit conservation

### Concurrency
- Async/await for all network operations
- Retry mechanism with exponential backoff
- Concurrent processing of multiple packages
- Non-blocking UI updates

### Memory Management
- Efficient decoration disposal
- Proper event handler cleanup
- Garbage collection friendly patterns
- Resource cleanup on deactivation

## Testing Strategy

### Unit Tests
- Mock external APIs with `nock` (^13.5.4)
- Test detection algorithms
- Validate scoring calculations
- Test error handling scenarios
- Jest-based with TypeScript integration (ts-jest ^29.4.0)

### Integration Tests
- End-to-end workflow testing
- Terminal integration testing with manifest scanning
- Configuration management testing
- Cache system validation
- Modern ESLint rules for type safety

### Code Quality
- ESLint 9.0 with flat configuration (eslint.config.js)
- TypeScript 5.8.3 strict type checking (628+ strict null errors pending)
- Prettier code formatting (applied 3,375+ fixes)
- Security-focused linting rules
- **Current Issues**: MODULE_TYPELESS_PACKAGE_JSON warning, type safety errors in terminal files

## File Structure

```
src/
├── extension.ts           # Main entry point
├── types.ts              # TypeScript interfaces
├── adapters/             # Registry API adapters
│   ├── pypi.ts
│   ├── npm.ts
│   ├── github.ts
│   └── npm-top.ts
├── detectors/            # Import detection
│   ├── python.ts
│   └── javascript.ts
├── scoring/              # Trust scoring engines
│   ├── index.ts         # Python scoring
│   └── javascript.ts    # JavaScript scoring
├── ui/                   # User interface
│   ├── decorators.ts
│   └── hovers.ts
└── terminal/             # Terminal integration
    ├── shell-integration.ts
    ├── simple-terminal.ts
    └── __tests__/
        └── terminal-integration.test.ts
```

## Current Technical Debt & Future Work

### Immediate Priorities
- **TypeScript Strict Errors**: 628+ remaining strict null checking issues (non-breaking)
- **ESLint Configuration**: MODULE_TYPELESS_PACKAGE_JSON warning, linting errors in adapters
- **Code Quality**: Unused variables, unsafe assignments, console usage

### Blocked Upgrades (Monitoring)
- **Jest 30**: Waiting for ts-jest v30.x compatibility release
- **vscode-test**: 6 remaining vulnerabilities, waiting for compatible version
- **node-pty beta**: Optional upgrade deferred (current version stable)

### Future Architecture Considerations

#### Scalability
- Plugin architecture for additional languages
- Configurable registry endpoints
- Enhanced caching strategies
- Distributed scoring systems

#### Extensibility
- Custom scoring algorithms
- Additional security checks
- Integration with other security tools
- Custom UI themes and layouts

---

**Last Updated**: 2025-07-06
**Version**: 0.6.4
**Architecture Review**: Complete with Modern Toolchain