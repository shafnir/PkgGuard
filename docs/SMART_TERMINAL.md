# 🛡️ PkgGuard Smart Terminal

## Overview

The **PkgGuard Smart Terminal** is a fully-featured terminal interface that combines the convenience of a standard terminal with intelligent package security monitoring. It provides seamless command execution while automatically protecting you from risky package installations.

## ✨ Key Features

### 🚀 **Full Terminal Functionality**
- Execute any system command with real-time output
- Cross-platform command compatibility (Unix commands work on Windows)
- Interactive command support (`pip uninstall`, `git push`, Python REPL, etc.)
- Standard terminal features (`clear`, `exit`, full path display)

### 🛡️ **Intelligent Security**
- **Selective Monitoring**: Only intercepts package installation commands
- **Real-time Analysis**: Scans packages during `pip install`, `npm install`, etc.
- **Risk Assessment**: Shows trust scores and detailed security information
- **Flexible Policies**: Interactive, monitor, block, or disabled modes

### ⚡ **Optimized Performance**
- **Blazing Fast**: Lightweight implementation with instant command execution
- **Windows Optimized**: Smooth operation on Windows with PowerShell/CMD support
- **Memory Efficient**: Minimal resource usage compared to full terminal emulators

## 🎯 How It Works

### Normal Commands
Execute any command normally - the terminal acts transparently:

```bash
d:\Projects\MyApp> ls
file1.txt  file2.txt  src/

d:\Projects\MyApp> git status
On branch main
Your branch is up to date with 'origin/main'.

d:\Projects\MyApp> python app.py
Starting application...
```

### Package Installation Security
When installing packages, PkgGuard automatically analyzes them:

```bash
d:\Projects\MyApp> pip install requests
🛡️ PkgGuard: Analyzing packages for security risks...
🟢 requests: Score 95
✅ All packages passed security checks.
Successfully installed requests-2.31.0

d:\Projects\MyApp> pip install suspicious-package
🛡️ PkgGuard: Analyzing packages for security risks...
🔴 suspicious-package: Score 15
🚨 WARNING: High-risk packages detected!
❓ Proceed with risky installation?
Options: (y)es, (N)o [default], (d)etails: N
✅ Installation cancelled for security.
```

## 🚀 Getting Started

### Create Terminal
1. Open VS Code Command Palette (`Ctrl+Shift+P`)
2. Search for `PkgGuard: Create Terminal`
3. Start using it like any normal terminal!

### Security Configuration
Choose your preferred security mode in VS Code settings:

```json
{
  "pkgGuard.securityMode": "interactive"
}
```

**Available Modes:**
- **`interactive`** - Ask for approval on risky packages (recommended)
- **`monitor`** - Show warnings but allow installation  
- **`block`** - Automatically block risky packages
- **`disabled`** - No security checks

## 💻 Cross-Platform Compatibility

### Windows Support
- **Command Translation**: Unix commands automatically work
  - `ls` → `dir`
  - `cat` → `type` 
  - `grep` → `findstr`
- **Shell Support**: Works with CMD, PowerShell, Git Bash
- **Interactive Commands**: `pip uninstall` prompts work correctly

### Linux/macOS Support  
- **Native Commands**: All standard Unix commands work natively
- **Shell Compatibility**: Works with bash, zsh, fish
- **Package Managers**: Supports pip, npm, yarn, poetry, etc.

## 🔧 Advanced Features

### Interactive Command Support
The terminal properly handles commands that require user input:

- ✅ `pip uninstall package` - Confirmation prompts
- ✅ `npm uninstall package` - User interactions  
- ✅ `git push` - Authentication prompts
- ✅ `python` - Python REPL
- ✅ `ssh user@server` - Login prompts

### Security Analysis
When risky packages are detected, get detailed information:

```bash
Options: (y)es, (N)o [default], (d)etails: d

📋 Package Risk Details:
──────────────────────────────────────────────────────
📦 suspicious-package (python)
   Trust Score: 15
   Risk Factors:
     🔴 Package does not exist on PyPI
     🔴 Very similar to popular package 'requests'
   🔗 Registry: https://pypi.org/project/suspicious-package/
```

## 🎨 Terminal Commands

### Built-in Commands
- `exit` / `quit` - Close the terminal
- `clear` / `cls` - Clear the screen
- `Ctrl+C` - Exit terminal (when command line is empty)

### Package Commands (Security Monitored)
- `pip install <package>`
- `pip3 install <package>`
- `python -m pip install <package>`
- `npm install <package>`
- `yarn add <package>`
- `poetry add <package>`

### Regular Commands (Pass-through)
- `ls` / `dir` - List files
- `cd <directory>` - Change directory
- `git <command>` - Git operations
- `python <script>` - Run Python scripts
- `npm run <script>` - Run npm scripts

## 🛠️ Technical Implementation

### Architecture
- **Lightweight Design**: Uses VS Code's Pseudoterminal API
- **Command Interception**: Only monitors package installation commands
- **Process Management**: Handles both simple and interactive commands
- **Cross-platform**: Automatic command translation for Windows

### Performance
- **Fast Execution**: Commands execute immediately
- **Real-time Output**: See results as they happen
- **Memory Efficient**: Minimal overhead compared to full terminal emulators
- **Responsive**: No lag or freezing during command execution

## 🔍 Troubleshooting

### Common Issues

**Commands not working on Windows:**
- The terminal automatically translates Unix commands to Windows equivalents
- If a command doesn't work, try the Windows equivalent manually

**Interactive commands not responding:**
- The terminal supports interactive commands like `pip uninstall`
- Your input goes directly to the running process

**Security checks not triggering:**
- Security checks only apply to package installation commands
- Check your `pkgGuard.securityMode` setting
- Ensure the command matches supported package managers

### Configuration

**Change Security Mode:**
```json
{
  "pkgGuard.securityMode": "monitor"  // or "interactive", "block", "disabled"
}
```

**Quick Toggle:**
Use Command Palette: `PkgGuard: Toggle Security Mode`

## 🎯 Best Practices

### For Individual Developers
- Use `interactive` mode for flexibility and learning
- Review risk details when warned about packages
- Add trusted packages to ignore list if needed

### For Teams
- Use `monitor` mode for advisory warnings
- Share workspace configuration for consistency
- Regular security reviews of installed packages

### For Production/CI
- Use `block` mode for strict security enforcement
- Pre-approve packages in ignore configuration
- Automated security policy enforcement

## 🚀 Benefits

### Developer Experience
- **Familiar Interface**: Works like any terminal you're used to
- **No Learning Curve**: Use existing command knowledge
- **Full Functionality**: Don't sacrifice features for security
- **Fast Performance**: No slowdown compared to regular terminals

### Security Benefits  
- **Automatic Protection**: Security checks happen automatically
- **Risk Awareness**: Learn about package security as you work
- **Flexible Policies**: Choose the right security level for your needs
- **Zero Overhead**: Security only activates when needed

---

**The PkgGuard Smart Terminal gives you the full power of a terminal with the peace of mind of automated security - the best of both worlds! 🛡️✨**