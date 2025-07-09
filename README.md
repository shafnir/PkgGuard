# 🛡️ PkgGuard: Package Trust for VS Code

**PkgGuard** is your modern security companion for Python and JavaScript/TypeScript development in VS Code. Instantly see the trustworthiness of your dependencies—right in your editor.

## 🚀 Overview
PkgGuard analyzes your import statements and gives you real-time trust scores, risk factors, and direct links to package registries and GitHub. Stay safe, code with confidence, and never get caught off guard by a risky dependency again.

> **Note:** PkgGuard is designed to protect you from AI hallucinations and package authenticity issues. It does **not** scan for known CVEs or vulnerabilities. Instead, it helps you avoid fake, typo-squatted, or suspicious packages by scoring their trustworthiness. No tool can promise 100% security—PkgGuard is your smart first line of defense, not a silver bullet. Use it as a savvy dev, and always review critical dependencies!

## 🗺️ High-Level Architecture
![PkgGuard Architecture](https://raw.githubusercontent.com/shafnir/PkgGuard/refs/heads/main/docs/architecture.png)

## ✨ Features

### Core Security Features
- **Trust Badges:** Inline trust scores for every import in your code (🟢 High, 🟡 Medium, 🔴 Low, ❓ Unknown).
- **Risk Factors:** See why a package is risky (e.g., single maintainer, outdated, low downloads).
- **Direct Links:** Jump straight to PyPI, npm, or GitHub from your editor.
- **Ignore/Unignore:** Instantly ignore packages you trust (or unignore them) with a click.
- **Smart Caching:** Fast, efficient, and respects your workflow—no unnecessary network calls.
- **No Telemetry:** Your code and data never leave your machine.

### 🖥️ Enhanced Terminal Features (v0.7.0+)
- **Smart Terminal:** Access via terminal dropdown or command palette (`PkgGuard: Create Terminal`)
- **Security Monitoring:** Real-time package analysis during installations with configurable modes:
  - `[interactive]` 🟢 - Ask for approval on risky packages
  - `[monitor]` 🟡 - Show warnings but allow installation
  - `[block]` 🔴 - Automatically block risky packages
  - `[disabled]` ⚪ - No security checks
- **Command History:** Navigate previous commands with ↑/↓ arrow keys (100-command storage)
- **PowerShell Autocomplete:** Tab completion for commands, files, and directories
- **Virtual Environment Support:** Built-in commands for Python development:
  - `create-venv [name]` - Create new virtual environment
  - `activate-venv [name/path]` - Activate environment
  - `deactivate-venv` - Deactivate current environment
  - `list-venvs` - List available environments
- **Manifest Scanning:** Analyze `requirements.txt` and `package.json` for security risks

## 🧠 How It Works
1. Detects imports in Python, JavaScript, and TypeScript files.
2. Fetches metadata from PyPI, npm, and GitHub.
3. Calculates a trust score and highlights risks directly in your editor.
4. Lets you take action—ignore, review, or research—without leaving VS Code.

## 🕹️ Usage

### Editor Features
- **Hover** over any import to see its trust score, risk factors, and direct links.
- **Ignore/Unignore** a package: Click the "Ignore package" or "Unignore package" link in the hover UI.
- **Clear cache:** Run the `PkgGuard: Clear Cache` command from the Command Palette (`Ctrl+Shift+P`).
- **Toggle PkgGuard:** Click the shield icon in the status bar to enable or disable the extension instantly.

### Terminal Usage
1. **Create a PkgGuard Terminal:**
   - From terminal dropdown: Select "PkgGuard Smart Terminal"
   - From command palette: Run `PkgGuard: Create Terminal`

2. **Security Mode:**
   - Toggle modes: Run `PkgGuard: Toggle Security Mode` or use the command palette
   - Current mode displays in terminal prompt: `[interactive] C:\path> `

3. **Virtual Environment Workflow:**
   ```bash
   # Create a new virtual environment
   create-venv myproject
   
   # Activate it
   activate-venv myproject
   
   # Install packages with security monitoring
   pip install flask requests
   
   # Deactivate when done
   deactivate-venv
   ```

4. **Manifest Scanning:**
   ```bash
   # Scan your project dependencies
   scan-manifest
   
   # Install with security filtering
   install-manifest
   ```

## 🔒 Why PkgGuard?
- **Security-first:** Know your dependencies before you `pip install` or `npm install`.
- **Full development workflow:** From code editor to terminal, PkgGuard protects your entire development process.
- **Smart terminal integration:** Virtual environments, command history, and autocomplete—all with security monitoring.
- **Open, transparent, and privacy-respecting.**
- **Designed for modern devs:** Fast, beautiful, and non-intrusive.

---

**Stay safe. Stay productive. Trust your code with PkgGuard.**

---

_Developed with ❤️ for the open source community._ 
