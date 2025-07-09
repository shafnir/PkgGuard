# 🖥️ PkgGuard Terminal Guide

PkgGuard provides a comprehensive smart terminal experience that integrates security monitoring directly into your development workflow. This guide covers all terminal features introduced in version 0.7.0+.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Creating a PkgGuard Terminal](#creating-a-pkgguard-terminal)
3. [Security Modes](#security-modes)
4. [Command History](#command-history)
5. [Autocomplete](#autocomplete)
6. [Virtual Environment Support](#virtual-environment-support)
7. [Manifest Scanning](#manifest-scanning)
8. [Terminal Commands Reference](#terminal-commands-reference)
9. [Configuration](#configuration)
10. [Troubleshooting](#troubleshooting)

## Quick Start

### 1. Create a PkgGuard Terminal
```bash
# Via VS Code Command Palette
Ctrl+Shift+P → "PkgGuard: Create Terminal"

# Or select from terminal dropdown
Terminal → New Terminal → PkgGuard Smart Terminal
```

### 2. Basic Usage
```bash
# Create and activate virtual environment
create-venv myproject
activate-venv myproject

# Install packages with security monitoring
pip install flask requests

# Scan your project dependencies
scan-manifest
```

## Creating a PkgGuard Terminal

### Method 1: Terminal Dropdown (Recommended)
1. Click the terminal dropdown arrow in VS Code
2. Select "PkgGuard Smart Terminal"
3. A new secured terminal opens with full features

### Method 2: Command Palette
1. Open Command Palette (`Ctrl+Shift+P`)
2. Type "PkgGuard: Create Terminal"
3. Press Enter to create a new terminal

### Terminal Profile Integration
PkgGuard registers itself as a terminal profile in VS Code, appearing alongside:
- PowerShell
- Command Prompt
- Git Bash
- WSL terminals

## Security Modes

PkgGuard terminal operates in four security modes, visually indicated in the terminal prompt:

### Interactive Mode `[interactive]` 🟢
- **Behavior**: Asks for user approval before installing risky packages
- **Prompt**: `[interactive] C:\path> `
- **Use Case**: Recommended for development environments

### Monitor Mode `[monitor]` 🟡
- **Behavior**: Shows warnings but allows installation
- **Prompt**: `[monitor] C:\path> `
- **Use Case**: CI/CD environments where blocking isn't desired

### Block Mode `[block]` 🔴
- **Behavior**: Automatically blocks risky packages
- **Prompt**: `[block] C:\path> `
- **Use Case**: High-security environments

### Disabled Mode `[disabled]` ⚪
- **Behavior**: No security checks performed
- **Prompt**: `[disabled] C:\path> `
- **Use Case**: Testing or when security checks aren't needed

### Switching Security Modes
```bash
# Via command palette
Ctrl+Shift+P → "PkgGuard: Toggle Security Mode"

# Mode changes are immediately reflected in terminal prompt
```

## Command History

Navigate through your command history using arrow keys, just like standard terminals:

### Features
- **Up Arrow (↑)**: Previous command
- **Down Arrow (↓)**: Next command
- **Storage**: 100 commands maximum
- **Duplicate Prevention**: Identical consecutive commands aren't stored
- **Session Persistence**: History persists across terminal sessions

### Usage Example
```bash
# Type a command
pip install requests

# Later, press ↑ to recall
pip install requests  # ← Recalled from history

# Navigate through multiple commands
↑ ↑ ↑  # Go back 3 commands
↓     # Go forward 1 command
```

## Autocomplete

Press `Tab` for intelligent command completion:

### Supported Categories
- **PkgGuard Commands**: `create-venv`, `activate-venv`, `list-venvs`, etc.
- **PowerShell**: `Get-Process`, `Set-Location`, `New-Item`, etc.
- **Python**: `python`, `pip`, `pip3`, etc.
- **Node.js**: `npm`, `yarn`, `node`, etc.
- **Git**: `git add`, `git commit`, `git push`, etc.

### File System Completion
- **Directories**: Tab completion for folder navigation
- **Files**: Complete file names in current directory
- **Paths**: Both relative and absolute path completion

### Usage Examples
```bash
# Command completion
cr[Tab] → create-venv
act[Tab] → activate-venv

# File completion
cd src/[Tab] → cd src/adapters/
python scr[Tab] → python script.py

# Multiple matches cycle through
git [Tab] → git add
git [Tab] → git commit
git [Tab] → git push
```

## Virtual Environment Support

PkgGuard provides comprehensive Python virtual environment management:

### Creating Virtual Environments
```bash
# Create in workspace root
create-venv myproject

# Creates: ./myproject/ directory with Python virtual environment
```

### Activating Virtual Environments
```bash
# Activate workspace virtual environment
activate-venv myproject

# Activate with absolute path
activate-venv C:\path\to\venv

# Activate with relative path
activate-venv ../other-project/venv
```

### Listing Virtual Environments
```bash
# List all available virtual environments
list-venvs

# Output:
# Available Virtual Environments:
# - myproject (./myproject)
# - api-server (./api-server)
# - frontend (./frontend)
```

### Deactivating Virtual Environments
```bash
# Deactivate current environment
deactivate-venv

# Terminal prompt updates to show deactivation
```

### VS Code Integration
When you activate a virtual environment:
1. **Python Interpreter**: Automatically updates VS Code's Python interpreter
2. **Terminal Prompt**: Shows active environment: `(.venv) [interactive] C:\path> `
3. **Pip Integration**: `pip` commands automatically use the active environment

### Auto-Detection
PkgGuard automatically detects common virtual environment patterns:
- `.venv`
- `venv`
- `env`
- `virtualenv`

## Manifest Scanning

Analyze your project's dependencies for security risks:

### Scanning Manifest Files
```bash
# Scan requirements.txt and package.json
scan-manifest

# Example output:
# 📋 Manifest Analysis Report
# 
# requirements.txt:
# ✅ flask (2.3.3) - High Trust (Score: 92)
# ⚠️  some-package (1.0.0) - Medium Trust (Score: 65)
# 🔴 suspicious-lib (0.1.0) - Low Trust (Score: 25)
```

### Installing with Security Filtering
```bash
# Install dependencies with security checks
install-manifest

# Processes requirements.txt and applies security policies
# based on current security mode
```

### Supported Manifest Files
- **Python**: `requirements.txt`, `requirements-dev.txt`, `setup.py`, `pyproject.toml`
- **JavaScript**: `package.json`, `package-lock.json`, `yarn.lock`

## Terminal Commands Reference

### Virtual Environment Commands
| Command | Description | Example |
|---------|-------------|---------|
| `create-venv [name]` | Create new virtual environment | `create-venv myproject` |
| `activate-venv [name/path]` | Activate virtual environment | `activate-venv myproject` |
| `deactivate-venv` | Deactivate current environment | `deactivate-venv` |
| `list-venvs` | List available environments | `list-venvs` |

### Manifest Commands
| Command | Description | Example |
|---------|-------------|---------|
| `scan-manifest` | Scan project dependencies | `scan-manifest` |
| `install-manifest` | Install with security filtering | `install-manifest` |

### General Commands
| Command | Description | Example |
|---------|-------------|---------|
| `help` or `?` | Show available commands | `help` |
| `clear` or `cls` | Clear terminal screen | `clear` |

### Standard Commands
All standard terminal commands work as expected:
- `cd`, `ls`, `dir`, `mkdir`, `rmdir`
- `python`, `pip`, `pip3`
- `npm`, `yarn`, `node`
- `git` commands
- PowerShell cmdlets

## Configuration

### Terminal Settings
Configure PkgGuard terminal behavior in VS Code settings:

```json
{
  "pkgGuard.terminal.enabled": true,
  "pkgGuard.securityMode": "interactive",
  "pkgGuard.cacheTTL": 172800
}
```

### Security Mode Settings
- `"interactive"` - Ask for approval (default)
- `"monitor"` - Show warnings only
- `"block"` - Block risky packages
- `"disabled"` - No security checks

### Cache Configuration
- `pkgGuard.cacheTTL`: Cache time-to-live in seconds (default: 48 hours)

## Troubleshooting

### Common Issues

#### Virtual Environment Path Issues
**Problem**: Python paths with spaces cause command failures
**Solution**: Use paths without spaces or escape properly
```bash
# Good
activate-venv myproject

# Avoid
activate-venv "my project"  # May cause issues
```

#### Autocomplete Display
**Problem**: Completion might show residual indicators
**Solution**: Press Tab again to cycle through or Enter to accept
```bash
# If you see: git add (1/2)
# Press Tab again or Enter to accept
```

#### Security Mode Messages
**Problem**: Toggle messages don't auto-dismiss
**Solution**: Messages are informational only and don't affect functionality

### Getting Help

#### Built-in Help
```bash
# Show all available commands
help

# or
?
```

#### Command Palette
```bash
Ctrl+Shift+P → "PkgGuard: Create Terminal"
Ctrl+Shift+P → "PkgGuard: Toggle Security Mode"
```

#### VS Code Settings
Open VS Code settings and search for "pkgGuard" to configure terminal behavior.

### Performance Tips

1. **Use Virtual Environments**: Isolate project dependencies
2. **Scan Before Installing**: Use `scan-manifest` to preview security issues
3. **Leverage Autocomplete**: Press Tab to speed up command entry
4. **Use History**: Arrow keys for command recall

## Advanced Usage

### Integrating with CI/CD
```bash
# Set monitor mode for CI environments
# In VS Code settings or via command palette
"pkgGuard.securityMode": "monitor"

# Scan dependencies in CI pipeline
scan-manifest
```

### Custom Workflows
```bash
# Development workflow
create-venv project-name
activate-venv project-name
scan-manifest
install-manifest
# ... development work ...
deactivate-venv
```

### Multi-Project Management
```bash
# Quick project switching
list-venvs
activate-venv project-a
# ... work on project-a ...
activate-venv project-b
# ... work on project-b ...
```

---

## Summary

PkgGuard's terminal integration provides a comprehensive, secure development environment that:

- **Protects** your development workflow with real-time security monitoring
- **Enhances** productivity with autocomplete and command history
- **Simplifies** virtual environment management
- **Integrates** seamlessly with VS Code's terminal ecosystem

The terminal features work alongside PkgGuard's editor-based security analysis to provide complete protection from malicious packages throughout your development process.

For more information, see the main [README](README.md) or [CLAUDE.md](CLAUDE.md) files.