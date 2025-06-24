/**
 * Simple Windows-Optimized Terminal Solution
 * Lightweight command interceptor that works smoothly on all platforms
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { TrustScore } from '../types';
import { PyPIAdapter } from '../adapters/pypi';
import { NpmAdapter } from '../adapters/npm';
import { ScoringEngine } from '../scoring';
import { JavaScriptScoringEngine } from '../scoring/javascript';

interface SecurityCheck {
    command: string;
    packages: Array<{ name: string, ecosystem: 'python' | 'javascript' }>;
    resolve: (approved: boolean) => void;
}

export class SimplePkgGuardTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number | void>();
    private currentInput = '';
    private runningProcess: cp.ChildProcess | undefined;

    // Security state
    private pendingSecurityCheck: SecurityCheck | undefined;
    private isInSecurityPrompt: boolean = false;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<number | void> = this.closeEmitter.event;

    constructor(private workspaceFolder?: vscode.WorkspaceFolder) { }

    private fixOutputForPseudoterminal(data: string): string {
        // Fix for VS Code Pseudoterminal display corruption while preserving formatting

        // The issue is that VS Code's pseudoterminal sometimes misinterprets 
        // line endings and text positioning, causing excessive spacing

        // Solution: Ensure consistent line endings and add explicit carriage returns
        // where needed to prevent cursor positioning issues

        return data
            // Normalize line endings first
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Convert back to proper terminal format with explicit carriage returns
            .replace(/\n/g, '\r\n')
            // Ensure each line starts fresh (prevents cumulative spacing issues)
            .split('\r\n')
            .map(line => line.trimRight()) // Remove trailing spaces that can cause positioning issues
            .join('\r\n');
    }

    private safeWriteEmitter(data: string) {
        // Apply the fix to prevent display corruption while preserving all formatting
        const fixedData = this.fixOutputForPseudoterminal(data);
        this.writeEmitter.fire(fixedData);
    }

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.safeWriteEmitter('🛡️ \x1b[32mPkgGuard Smart Terminal\x1b[0m\r\n');
        this.safeWriteEmitter('Full terminal functionality with security for package installations.\r\n');
        this.safeWriteEmitter('Commands: \x1b[33mexit\x1b[0m, \x1b[33mclear\x1b[0m\r\n');
        this.safeWriteEmitter('Use \x1b[33mCtrl+C\x1b[0m to exit. Manifest commands work with requirements.txt, package.json, etc.\r\n\r\n');
        this.showPrompt();
    }

    close(): void {
        if (this.runningProcess) {
            this.runningProcess.kill('SIGTERM');
            this.runningProcess = undefined;
        }
        this.closeEmitter.fire(0);
    }

    private showPrompt(): void {
        const cwd = this.workspaceFolder?.uri.fsPath || process.cwd();
        // Show full path like PowerShell
        this.safeWriteEmitter(`\x1b[36m${cwd}>\x1b[0m `);
    }

    private translateCommand(command: string): string {
        if (os.platform() === 'win32') {
            // Translate Unix commands to Windows equivalents
            const translations: Record<string, string> = {
                'ls': 'dir',
                'ls -la': 'dir',
                'ls -l': 'dir',
                'cat': 'type',
                'grep': 'findstr',
                'which': 'where',
                'touch': 'echo. >',
                'rm': 'del',
                'cp': 'copy',
                'mv': 'move',
                'pwd': 'cd'
            };

            // Check for exact matches first
            if (translations[command.toLowerCase()]) {
                return translations[command.toLowerCase()];
            }

            // Check for command with arguments
            for (const [unixCmd, winCmd] of Object.entries(translations)) {
                if (command.toLowerCase().startsWith(unixCmd + ' ')) {
                    const args = command.substring(unixCmd.length);
                    return winCmd + args;
                }
            }
        }

        return command;
    }

    async handleInput(data: string): Promise<void> {
        // If we have a running process, pass input directly to it
        if (this.runningProcess && this.runningProcess.stdin) {
            // Special handling for different input types
            if (data === '\x03') {
                // Ctrl+C - terminate the running process
                this.runningProcess.kill('SIGINT');
                this.safeWriteEmitter('^C\r\n');
                this.runningProcess = undefined;
                this.showPrompt();
                return;
            } else if (data === '\r') {
                // Enter key - send proper line ending to process and echo to terminal
                this.runningProcess.stdin.write('\n'); // Send newline to process
                this.safeWriteEmitter('\r\n'); // Echo newline to terminal
            } else if (data === '\x7f' || data === '\b') {
                // Backspace - send to process and echo to terminal
                this.runningProcess.stdin.write(data);
                this.safeWriteEmitter('\b \b');
            } else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
                // Printable characters - send to process and echo to terminal
                this.runningProcess.stdin.write(data);
                this.safeWriteEmitter(data);
            } else {
                // Other control characters - just send to process (no echo)
                this.runningProcess.stdin.write(data);
            }
            return;
        }

        // Handle security prompt separately
        if (this.isInSecurityPrompt && this.pendingSecurityCheck) {
            await this.handleSecurityPromptInput(data);
            return;
        }

        if (data === '\r') {
            // Process the command
            await this.processCommand(this.currentInput.trim());
            this.currentInput = '';
        } else if (data === '\x03') {
            // Ctrl+C - clear current input or exit
            if (this.currentInput.trim() === '') {
                this.writeEmitter.fire('\r\n👋 Exiting PkgGuard Terminal...\r\n');
                this.closeEmitter.fire(0);
                return;
            } else {
                this.writeEmitter.fire('^C\r\n');
                this.currentInput = '';
                this.showPrompt();
            }
        } else if (data === '\x7f' || data === '\b') {
            // Backspace
            if (this.currentInput.length > 0) {
                this.currentInput = this.currentInput.slice(0, -1);
                this.writeEmitter.fire('\b \b');
            }
        } else if (data.charCodeAt(0) >= 32) {
            // Printable characters
            this.currentInput += data;
            this.writeEmitter.fire(data);
        }
    }

    private async processCommand(command: string): Promise<void> {
        this.writeEmitter.fire('\r\n');

        if (!command) {
            this.showPrompt();
            return;
        }

        // Handle exit commands
        if (command.toLowerCase() === 'exit' || command.toLowerCase() === 'quit') {
            this.writeEmitter.fire('👋 Exiting PkgGuard Terminal...\r\n');
            this.closeEmitter.fire(0);
            return;
        }

        // Handle clear command
        if (command.toLowerCase() === 'clear' || command.toLowerCase() === 'cls') {
            this.writeEmitter.fire('\x1b[2J\x1b[H'); // Clear screen and move cursor to top
            this.showPrompt();
            return;
        }

        // Handle manifest scanning command
        if (command.toLowerCase() === 'scan-manifest' || command.toLowerCase() === 'scan') {
            await this.scanManifestFiles();
            this.showPrompt();
            return;
        }

        // Handle manifest installation command
        if (command.toLowerCase() === 'install-manifest' || command.toLowerCase() === 'install-deps') {
            await this.installFromManifest();
            this.showPrompt();
            return;
        }

        // Handle manifest uninstallation command
        if (command.toLowerCase() === 'uninstall-manifest' || command.toLowerCase() === 'remove-deps') {
            await this.uninstallFromManifest();
            this.showPrompt();
            return;
        }

        // Handle cross-platform command translation
        command = this.translateCommand(command);

        // Check if this is a manifest-based installation command
        if (await this.isManifestCommand(command)) {
            await this.handleManifestCommand(command);
            this.showPrompt();
            return;
        }

        // Check if this is a package installation command
        if (await this.shouldCheckSecurity(command)) {
            const packages = this.extractPackageInfo(command);
            if (packages.length > 0) {
                const proceed = await this.performSecurityCheck(command, packages);
                if (!proceed) {
                    this.writeEmitter.fire('\x1b[31m❌ Command blocked for security.\x1b[0m\r\n');
                    this.showPrompt();
                    return;
                }
            }
        }

        // Execute the command in a new VS Code terminal
        await this.executeInVSCodeTerminal(command);
        this.showPrompt();
    }

    private async executeInVSCodeTerminal(command: string): Promise<void> {
        return new Promise<void>((resolve) => {
            const cwd = this.workspaceFolder?.uri.fsPath || process.cwd();

            // Determine if this is an interactive command that needs user input
            const isInteractiveCommand = this.isInteractiveCommand(command);

            if (isInteractiveCommand) {
                // Use spawn for interactive commands to handle stdin/stdout properly
                this.runInteractiveCommand(command, cwd, resolve);
            } else {
                // Use exec for simple commands
                this.runSimpleCommand(command, cwd, resolve);
            }
        });
    }

    private isInteractiveCommand(command: string): boolean {
        const interactiveCommands = [
            'pip uninstall',
            'npm uninstall',
            'yarn remove',
            'git push',
            'git pull',
            'ssh',
            'python', // Python REPL
            'node',   // Node REPL
            'mysql',
            'psql'
        ];

        return interactiveCommands.some(cmd => command.toLowerCase().includes(cmd));
    }

    private runInteractiveCommand(command: string, cwd: string, resolve: () => void): void {
        // Parse command into shell and args
        const shell = os.platform() === 'win32' ? 'cmd' : '/bin/bash';
        const shellArgs = os.platform() === 'win32' ? ['/c', command] : ['-c', command];

        this.runningProcess = cp.spawn(shell, shellArgs, {
            cwd: cwd,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        if (!this.runningProcess.stdout || !this.runningProcess.stderr || !this.runningProcess.stdin) {
            this.writeEmitter.fire('Failed to create process streams\r\n');
            resolve();
            return;
        }

        // Handle output
        this.runningProcess.stdout.on('data', (data: Buffer) => {
            const output = data.toString();
            this.safeWriteEmitter(output);
        });

        this.runningProcess.stderr.on('data', (data: Buffer) => {
            const output = data.toString();
            this.safeWriteEmitter(`\x1b[31m${output}\x1b[0m`);
        });

        // Handle process exit
        this.runningProcess.on('close', (code) => {
            if (code !== 0) {
                this.writeEmitter.fire(`\x1b[31mCommand failed with exit code ${code}\x1b[0m\r\n`);
            }
            this.runningProcess = undefined;
            resolve();
        });

        this.runningProcess.on('error', (error) => {
            this.writeEmitter.fire(`\x1b[31mError: ${error.message}\x1b[0m\r\n`);
            this.runningProcess = undefined;
            resolve();
        });
    }

    private runSimpleCommand(command: string, cwd: string, resolve: () => void): void {
        let hasRealTimeOutput = false;

        // Execute command and capture output
        const child = cp.exec(command, {
            cwd: cwd,
            env: process.env,
            encoding: 'utf8',
            maxBuffer: 1024 * 1024, // 1MB buffer
            timeout: 30000 // 30 second timeout
        }, (error, stdout, stderr) => {

            // Only display final output if we didn't get real-time output
            if (!hasRealTimeOutput) {
                if (stdout) {
                    this.safeWriteEmitter(stdout);
                }

                if (stderr) {
                    this.safeWriteEmitter(`\x1b[31m${stderr}\x1b[0m`);
                }
            }

            // Display error if command failed
            if (error && error.code !== 0) {
                this.writeEmitter.fire(`\x1b[31mCommand failed with exit code ${error.code}\x1b[0m\r\n`);
            }

            resolve();
        });

        // Handle real-time output for long-running commands
        if (child.stdout) {
            child.stdout.on('data', (data: string) => {
                hasRealTimeOutput = true;
                this.safeWriteEmitter(data);
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data: string) => {
                hasRealTimeOutput = true;
                this.safeWriteEmitter(`\x1b[31m${data}\x1b[0m`);
            });
        }

        // Handle timeout and other errors
        child.on('error', (error) => {
            this.writeEmitter.fire(`\x1b[31mError: ${error.message}\x1b[0m\r\n`);
            resolve();
        });
    }

    private async shouldCheckSecurity(command: string): Promise<boolean> {
        const config = vscode.workspace.getConfiguration();
        const securityMode = config.get('pkgGuard.securityMode', 'interactive');

        if (securityMode === 'disabled') {
            return false;
        }

        // Only check installation commands
        const installPatterns = [
            /pip\s+install\s+/,
            /pip3\s+install\s+/,
            /python\s+-m\s+pip\s+install\s+/,
            /poetry\s+add\s+/,
            /pipenv\s+install\s+/,
            /npm\s+install\s+/,
            /npm\s+i\s+/,
            /yarn\s+add\s+/,
            /pnpm\s+add\s+/,
            /bun\s+add\s+/
        ];

        return installPatterns.some(pattern => pattern.test(command));
    }

    private async performSecurityCheck(command: string, packages: Array<{ name: string, ecosystem: 'python' | 'javascript' }>): Promise<boolean> {
        this.writeEmitter.fire('🛡️ \x1b[33mPkgGuard: Analyzing packages for security risks...\x1b[0m\r\n');

        const results: Array<{ package: string, score: TrustScore }> = [];

        // Analyze packages
        for (const pkg of packages) {
            try {
                let adapter: any;
                let scoring: any;

                if (pkg.ecosystem === 'python') {
                    adapter = new PyPIAdapter();
                    scoring = new ScoringEngine();
                } else {
                    adapter = new NpmAdapter();
                    scoring = new JavaScriptScoringEngine();
                }

                const meta = await adapter.meta(pkg.name);
                const score = await scoring.calculateScore(pkg.name, meta);
                results.push({ package: pkg.name, score });

                // Show immediate feedback
                const emoji = score.level === 'high' ? '🟢' :
                    score.level === 'medium' ? '🟡' :
                        score.level === 'ignored' ? '⚪' : '🔴';

                const color = score.level === 'high' ? '\x1b[32m' :
                    score.level === 'medium' ? '\x1b[33m' :
                        score.level === 'ignored' ? '\x1b[37m' : '\x1b[31m';

                this.writeEmitter.fire(`${emoji} ${color}${pkg.name}\x1b[0m: Score ${score.score ?? 'Ignored'}\r\n`);
            } catch (error) {
                this.writeEmitter.fire(`❌ \x1b[31mError analyzing ${pkg.name}\x1b[0m\r\n`);
            }
        }

        // Check for high-risk packages
        const highRiskPackages = results.filter(r => r.score.level === 'low');

        if (highRiskPackages.length === 0) {
            this.writeEmitter.fire('\x1b[32m✅ All packages passed security checks.\x1b[0m\r\n');
            return true;
        }

        // Handle risky packages based on security mode
        const config = vscode.workspace.getConfiguration();
        const securityMode = config.get('pkgGuard.securityMode', 'interactive');

        if (securityMode === 'block') {
            this.writeEmitter.fire('\x1b[31m🚫 Installation blocked (block mode enabled).\x1b[0m\r\n');
            return false;
        }

        if (securityMode === 'monitor') {
            this.writeEmitter.fire('\x1b[33m⚠️ Warning: High-risk packages detected but proceeding (monitor mode).\x1b[0m\r\n');
            return true;
        }

        // Interactive mode - ask for user approval
        return await this.requestUserApproval(command, packages);
    }

    private async requestUserApproval(command: string, packages: Array<{ name: string, ecosystem: 'python' | 'javascript' }>): Promise<boolean> {
        this.writeEmitter.fire('\r\n\x1b[31m🚨 WARNING: High-risk packages detected!\x1b[0m\r\n');
        this.writeEmitter.fire('\x1b[33m❓ Proceed with risky installation?\x1b[0m\r\n');
        this.writeEmitter.fire('Options: (y)es, (N)o [default], (d)etails: ');

        return new Promise<boolean>((resolve) => {
            this.pendingSecurityCheck = { command, packages, resolve };
            this.isInSecurityPrompt = true;
        });
    }

    private async handleSecurityPromptInput(data: string): Promise<void> {
        if (!this.pendingSecurityCheck) return;

        const char = data.toLowerCase();

        if (char === 'y') {
            this.writeEmitter.fire('y\r\n');
            this.writeEmitter.fire('\x1b[33m⚠️ Proceeding with risky installation.\x1b[0m\r\n');
            this.pendingSecurityCheck.resolve(true);
            this.isInSecurityPrompt = false;
            this.pendingSecurityCheck = undefined;
        } else if (char === 'n' || char === '\r') {
            this.writeEmitter.fire(char === '\r' ? 'N' : char);
            this.writeEmitter.fire('\r\n');
            this.writeEmitter.fire('\x1b[32m✅ Installation cancelled for security.\x1b[0m\r\n');
            this.pendingSecurityCheck.resolve(false);
            this.isInSecurityPrompt = false;
            this.pendingSecurityCheck = undefined;
        } else if (char === 'd') {
            this.writeEmitter.fire('d\r\n');
            await this.showPackageDetails();
            this.writeEmitter.fire('Options: (y)es, (N)o [default], (d)etails: ');
        }
    }

    private async showPackageDetails(): Promise<void> {
        if (!this.pendingSecurityCheck) return;

        this.writeEmitter.fire('\r\n\x1b[36m📋 Package Risk Details:\x1b[0m\r\n');
        this.writeEmitter.fire('─'.repeat(50) + '\r\n');

        for (const pkg of this.pendingSecurityCheck.packages) {
            try {
                let adapter: any;
                let scoring: any;

                if (pkg.ecosystem === 'python') {
                    adapter = new PyPIAdapter();
                    scoring = new ScoringEngine();
                } else {
                    adapter = new NpmAdapter();
                    scoring = new JavaScriptScoringEngine();
                }

                const meta = await adapter.meta(pkg.name);
                const score = await scoring.calculateScore(pkg.name, meta);

                this.writeEmitter.fire(`\r\n📦 \x1b[1m${pkg.name}\x1b[0m (${pkg.ecosystem})\r\n`);
                this.writeEmitter.fire(`   Trust Score: ${score.score ?? 'N/A'}\r\n`);

                if (score.riskFactors) {
                    this.writeEmitter.fire('   \x1b[31mRisk Factors:\x1b[0m\r\n');
                    for (const risk of score.riskFactors) {
                        const emoji = risk.color === 'red' ? '🔴' : '🟠';
                        this.writeEmitter.fire(`     ${emoji} ${risk.text}\r\n`);
                    }
                }

                if (score.evidence?.registryUrl) {
                    this.writeEmitter.fire(`   🔗 Registry: ${score.evidence.registryUrl}\r\n`);
                }
            } catch (error) {
                this.writeEmitter.fire(`   ❌ Error getting details for ${pkg.name}\r\n`);
            }
        }
        this.writeEmitter.fire('\r\n');
    }

    private extractPackageInfo(command: string): Array<{ name: string, ecosystem: 'python' | 'javascript' }> {
        const packages: Array<{ name: string, ecosystem: 'python' | 'javascript' }> = [];

        // Python patterns
        const pythonPatterns = [
            { pattern: /pip\s+install\s+(.+)/, ecosystem: 'python' as const },
            { pattern: /pip3\s+install\s+(.+)/, ecosystem: 'python' as const },
            { pattern: /python\s+-m\s+pip\s+install\s+(.+)/, ecosystem: 'python' as const },
            { pattern: /poetry\s+add\s+(.+)/, ecosystem: 'python' as const },
            { pattern: /pipenv\s+install\s+(.+)/, ecosystem: 'python' as const },
        ];

        // JavaScript patterns
        const jsPatterns = [
            { pattern: /npm\s+install\s+(.+)/, ecosystem: 'javascript' as const },
            { pattern: /npm\s+i\s+(.+)/, ecosystem: 'javascript' as const },
            { pattern: /yarn\s+add\s+(.+)/, ecosystem: 'javascript' as const },
            { pattern: /pnpm\s+add\s+(.+)/, ecosystem: 'javascript' as const },
            { pattern: /bun\s+add\s+(.+)/, ecosystem: 'javascript' as const },
        ];

        const allPatterns = [...pythonPatterns, ...jsPatterns];

        for (const { pattern, ecosystem } of allPatterns) {
            const match = command.match(pattern);
            if (match) {
                const packageSpecs = match[1]?.split(/\s+/) || [];
                for (const spec of packageSpecs) {
                    const cleanName = this.cleanPackageName(spec);
                    if (cleanName && !cleanName.startsWith('-')) {
                        packages.push({ name: cleanName, ecosystem });
                    }
                }
            }
        }

        return packages;
    }

    private cleanPackageName(spec: string): string {
        return spec
            .split('==')[0]
            .split('>=')[0]
            .split('<=')[0]
            .split('[')[0]
            .split('@')[0]
            .trim();
    }

    private detectManifestFiles(): Array<{ file: string, ecosystem: 'python' | 'javascript' }> {
        const cwd = this.workspaceFolder?.uri.fsPath || process.cwd();
        const manifestFiles: Array<{ file: string, ecosystem: 'python' | 'javascript' }> = [];

        // Python manifest files
        const pythonFiles = ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'poetry.lock'];
        for (const file of pythonFiles) {
            const filePath = path.join(cwd, file);
            if (fs.existsSync(filePath)) {
                manifestFiles.push({ file: filePath, ecosystem: 'python' });
            }
        }

        // JavaScript/Node.js manifest files
        const jsFiles = ['package.json', 'yarn.lock', 'package-lock.json', 'pnpm-lock.yaml'];
        for (const file of jsFiles) {
            const filePath = path.join(cwd, file);
            if (fs.existsSync(filePath)) {
                manifestFiles.push({ file: filePath, ecosystem: 'javascript' });
            }
        }

        return manifestFiles;
    }

    private parseManifestFile(filePath: string, ecosystem: 'python' | 'javascript'): Array<{ name: string, ecosystem: 'python' | 'javascript' }> {
        const packages: Array<{ name: string, ecosystem: 'python' | 'javascript' }> = [];

        try {
            const fileName = path.basename(filePath);
            const content = fs.readFileSync(filePath, 'utf-8');

            if (ecosystem === 'python') {
                if (fileName === 'requirements.txt') {
                    // Parse requirements.txt format
                    const lines = content.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
                            const packageName = this.cleanPackageName(trimmed);
                            if (packageName) {
                                packages.push({ name: packageName, ecosystem: 'python' });
                            }
                        }
                    }
                } else if (fileName === 'pyproject.toml') {
                    // Basic pyproject.toml parsing for dependencies
                    const dependencyMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
                    if (dependencyMatch) {
                        const deps = dependencyMatch[1].match(/"([^"]+)"/g);
                        if (deps) {
                            for (const dep of deps) {
                                const cleaned = this.cleanPackageName(dep.replace(/"/g, ''));
                                if (cleaned) {
                                    packages.push({ name: cleaned, ecosystem: 'python' });
                                }
                            }
                        }
                    }
                }
            } else if (ecosystem === 'javascript') {
                if (fileName === 'package.json') {
                    try {
                        const packageJson = JSON.parse(content);

                        // Parse dependencies
                        if (packageJson.dependencies) {
                            for (const dep of Object.keys(packageJson.dependencies)) {
                                packages.push({ name: dep, ecosystem: 'javascript' });
                            }
                        }

                        // Parse devDependencies
                        if (packageJson.devDependencies) {
                            for (const dep of Object.keys(packageJson.devDependencies)) {
                                packages.push({ name: dep, ecosystem: 'javascript' });
                            }
                        }
                    } catch (parseError) {
                        this.writeEmitter.fire(`\\x1b[31mError parsing package.json: ${parseError}\\x1b[0m\\r\\n`);
                    }
                }
            }
        } catch (error) {
            this.writeEmitter.fire(`\\x1b[31mError reading manifest file ${filePath}: ${error}\\x1b[0m\\r\\n`);
        }

        return packages;
    }

    private async scanManifestFiles(): Promise<void> {
        const manifestFiles = this.detectManifestFiles();

        if (manifestFiles.length === 0) {
            this.writeEmitter.fire('\\x1b[33m📝 No manifest files found (requirements.txt, package.json, etc.)\\x1b[0m\\r\\n');
            return;
        }

        this.writeEmitter.fire(`\\x1b[36m📋 Found ${manifestFiles.length} manifest file(s):\\x1b[0m\\r\\n`);

        let totalPackages: Array<{ name: string, ecosystem: 'python' | 'javascript', source: string }> = [];

        for (const manifest of manifestFiles) {
            const fileName = path.basename(manifest.file);
            this.writeEmitter.fire(`  📄 ${fileName} (${manifest.ecosystem})\\r\\n`);

            const packages = this.parseManifestFile(manifest.file, manifest.ecosystem);
            this.writeEmitter.fire(`     └─ ${packages.length} packages detected\\r\\n`);

            // Add source information
            for (const pkg of packages) {
                totalPackages.push({ ...pkg, source: fileName });
            }
        }

        if (totalPackages.length === 0) {
            this.writeEmitter.fire('\\x1b[33m⚠️ No packages found in manifest files\\x1b[0m\\r\\n');
            return;
        }

        this.writeEmitter.fire(`\\r\\n🛡️ \\x1b[33mScanning ${totalPackages.length} packages for security risks...\\x1b[0m\\r\\n`);

        // Group by ecosystem for analysis
        const pythonPackages = totalPackages.filter(p => p.ecosystem === 'python');
        const jsPackages = totalPackages.filter(p => p.ecosystem === 'javascript');

        const results: Array<{ package: string, score: TrustScore, source: string, ecosystem: string }> = [];

        // Analyze Python packages
        if (pythonPackages.length > 0) {
            this.writeEmitter.fire(`\\r\\n🐍 \\x1b[36mAnalyzing ${pythonPackages.length} Python packages...\\x1b[0m\\r\\n`);
            const adapter = new PyPIAdapter();
            const scoring = new ScoringEngine();

            for (const pkg of pythonPackages) {
                try {
                    const meta = await adapter.meta(pkg.name);
                    const score = await scoring.calculateScore(pkg.name, meta);
                    results.push({ package: pkg.name, score, source: pkg.source, ecosystem: 'Python' });

                    const emoji = score.level === 'high' ? '🟢' :
                        score.level === 'medium' ? '🟡' :
                            score.level === 'ignored' ? '⚪' : '🔴';

                    const color = score.level === 'high' ? '\\x1b[32m' :
                        score.level === 'medium' ? '\\x1b[33m' :
                            score.level === 'ignored' ? '\\x1b[37m' : '\\x1b[31m';

                    this.writeEmitter.fire(`${emoji} ${color}${pkg.name}\\x1b[0m (${pkg.source}): ${score.score ?? 'Ignored'}\\r\\n`);
                } catch (error) {
                    this.writeEmitter.fire(`❌ \\x1b[31mError analyzing ${pkg.name}\\x1b[0m\\r\\n`);
                }
            }
        }

        // Analyze JavaScript packages
        if (jsPackages.length > 0) {
            this.writeEmitter.fire(`\\r\\n📦 \\x1b[36mAnalyzing ${jsPackages.length} JavaScript packages...\\x1b[0m\\r\\n`);
            const adapter = new NpmAdapter();
            const scoring = new JavaScriptScoringEngine();

            for (const pkg of jsPackages) {
                try {
                    const meta = await adapter.meta(pkg.name);
                    const score = await scoring.calculateScore(pkg.name, meta);
                    results.push({ package: pkg.name, score, source: pkg.source, ecosystem: 'JavaScript' });

                    const emoji = score.level === 'high' ? '🟢' :
                        score.level === 'medium' ? '🟡' :
                            score.level === 'ignored' ? '⚪' : '🔴';

                    const color = score.level === 'high' ? '\\x1b[32m' :
                        score.level === 'medium' ? '\\x1b[33m' :
                            score.level === 'ignored' ? '\\x1b[37m' : '\\x1b[31m';

                    this.writeEmitter.fire(`${emoji} ${color}${pkg.name}\\x1b[0m (${pkg.source}): ${score.score ?? 'Ignored'}\\r\\n`);
                } catch (error) {
                    this.writeEmitter.fire(`❌ \\x1b[31mError analyzing ${pkg.name}\\x1b[0m\\r\\n`);
                }
            }
        }

        // Summary
        const highRisk = results.filter(r => r.score.level === 'low');
        const mediumRisk = results.filter(r => r.score.level === 'medium');
        const safe = results.filter(r => r.score.level === 'high');
        const ignored = results.filter(r => r.score.level === 'ignored');

        this.writeEmitter.fire(`\\r\\n📊 \\x1b[1mSecurity Summary:\\x1b[0m\\r\\n`);
        this.writeEmitter.fire(`🟢 Safe: ${safe.length} packages\\r\\n`);
        this.writeEmitter.fire(`🟡 Medium Risk: ${mediumRisk.length} packages\\r\\n`);
        this.writeEmitter.fire(`🔴 High Risk: ${highRisk.length} packages\\r\\n`);
        this.writeEmitter.fire(`⚪ Ignored: ${ignored.length} packages\\r\\n`);

        if (highRisk.length > 0) {
            this.writeEmitter.fire(`\\r\\n\\x1b[31m⚠️ HIGH RISK PACKAGES DETECTED:\\x1b[0m\\r\\n`);
            for (const pkg of highRisk) {
                this.writeEmitter.fire(`🔴 ${pkg.package} (${pkg.source}) - ${pkg.ecosystem}\\r\\n`);
                if (pkg.score.riskFactors && pkg.score.riskFactors.length > 0) {
                    for (const risk of pkg.score.riskFactors.slice(0, 2)) { // Show first 2 risk factors
                        this.writeEmitter.fire(`   └─ ${risk.text}\\r\\n`);
                    }
                }
            }
        }

        // Offer bulk installation
        if (results.length > 0) {
            this.writeEmitter.fire(`\\r\\n💡 \\x1b[33mType 'install-manifest' to install all dependencies with security checks\\x1b[0m\\r\\n`);
        }
    }

    private async installFromManifest(): Promise<void> {
        const manifestFiles = this.detectManifestFiles();

        if (manifestFiles.length === 0) {
            this.writeEmitter.fire('❌ No manifest files found to install from\r\n');
            return;
        }

        // Group manifest files by ecosystem
        const pythonManifests = manifestFiles.filter(m => m.ecosystem === 'python');
        const jsManifests = manifestFiles.filter(m => m.ecosystem === 'javascript');

        // Handle Python manifests
        for (const manifest of pythonManifests) {
            await this.handlePythonManifest(manifest);
        }

        // Handle JavaScript manifests
        for (const manifest of jsManifests) {
            await this.handleJavaScriptManifest(manifest);
        }
    }

    private async uninstallFromManifest(): Promise<void> {
        const manifestFiles = this.detectManifestFiles();

        if (manifestFiles.length === 0) {
            this.writeEmitter.fire('❌ No manifest files found to uninstall from\r\n');
            return;
        }

        // Group manifest files by ecosystem
        const pythonManifests = manifestFiles.filter(m => m.ecosystem === 'python');
        const jsManifests = manifestFiles.filter(m => m.ecosystem === 'javascript');

        // Handle Python manifests
        for (const manifest of pythonManifests) {
            await this.handlePythonUninstall(manifest);
        }

        // Handle JavaScript manifests  
        for (const manifest of jsManifests) {
            await this.handleJavaScriptUninstall(manifest);
        }
    }

    private async handlePythonManifest(manifest: { file: string, ecosystem: 'python' }): Promise<void> {
        const fileName = path.basename(manifest.file);
        const packages = this.parseManifestFile(manifest.file, 'python');

        if (packages.length === 0) return;

        // Silent security check
        const blockedPackages = await this.getBlockedPackages(packages, 'python');
        const safePackages = packages.filter(p => !blockedPackages.includes(p.name));

        let usedFilteredFile = false;
        let targetFile = fileName;

        if (blockedPackages.length > 0) {
            if (safePackages.length > 0) {
                // Silently create filtered requirements file
                await this.createFilteredRequirements(safePackages, fileName, true);
                targetFile = 'requirements-safe.txt';
                usedFilteredFile = true;
            } else {
                this.writeEmitter.fire(`\\r\\n🚫 \\x1b[31mAll packages in ${fileName} are blocked for security reasons\\x1b[0m\\r\\n`);
                await this.generateSecurityReport(packages, blockedPackages, [], 'python');
                return;
            }
        }

        // Use native pip command
        if (fileName === 'requirements.txt') {
            await this.executeInVSCodeTerminal(`pip install -r ${targetFile}`);
        } else {
            // For other manifest types, use appropriate commands
            await this.executeInVSCodeTerminal('pip install .');
        }

        // Show security summary after installation
        await this.showSecuritySummary(packages, blockedPackages, safePackages, 'python');

        // Clean up filtered file
        if (usedFilteredFile) {
            try {
                const cwd = this.workspaceFolder?.uri.fsPath || process.cwd();
                fs.unlinkSync(path.join(cwd, 'requirements-safe.txt'));
            } catch { }
        }
    }

    private async handleJavaScriptManifest(manifest: { file: string, ecosystem: 'javascript' }): Promise<void> {
        const fileName = path.basename(manifest.file);
        const packages = this.parseManifestFile(manifest.file, 'javascript');

        if (packages.length === 0) return;

        // Silent security check
        const blockedPackages = await this.getBlockedPackages(packages, 'javascript');

        // Determine package manager and use native command
        const cwd = this.workspaceFolder?.uri.fsPath || process.cwd();
        let installCommand = 'npm install';

        if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
            installCommand = 'yarn install';
        } else if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
            installCommand = 'pnpm install';
        } else if (fs.existsSync(path.join(cwd, 'bun.lockb'))) {
            installCommand = 'bun install';
        }

        // Execute the command
        await this.executeInVSCodeTerminal(installCommand);

        // Show security summary after installation
        await this.showSecuritySummary(packages, blockedPackages, packages, 'javascript');
    }

    private async handlePythonUninstall(manifest: { file: string, ecosystem: 'python' }): Promise<void> {
        const fileName = path.basename(manifest.file);

        if (fileName === 'requirements.txt') {
            // Native pip uninstall with requirements file (no security blocks for uninstall)
            await this.executeInVSCodeTerminal(`pip uninstall -r ${fileName}`);
        } else {
            this.safeWriteEmitter(`⚠️ Uninstall not directly supported for ${fileName}\r\n`);
        }
    }

    private async handleJavaScriptUninstall(manifest: { file: string, ecosystem: 'javascript' }): Promise<void> {
        const packages = this.parseManifestFile(manifest.file, 'javascript');
        const cwd = this.workspaceFolder?.uri.fsPath || process.cwd();

        // Determine package manager
        let uninstallCommand = 'npm uninstall';

        if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
            uninstallCommand = 'yarn remove';
        } else if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
            uninstallCommand = 'pnpm remove';
        } else if (fs.existsSync(path.join(cwd, 'bun.lockb'))) {
            uninstallCommand = 'bun remove';
        }

        // Uninstall all packages
        const packageNames = packages.map(p => p.name).join(' ');
        await this.executeInVSCodeTerminal(`${uninstallCommand} ${packageNames}`);
    }

    private async getBlockedPackages(
        packages: Array<{ name: string, ecosystem: 'python' | 'javascript' }>,
        ecosystem: 'python' | 'javascript'
    ): Promise<string[]> {
        const config = vscode.workspace.getConfiguration();
        const securityMode = config.get('pkgGuard.securityMode', 'interactive');

        if (securityMode === 'disabled') {
            return [];
        }

        const blockedPackages: string[] = [];
        let adapter: any;
        let scoring: any;

        if (ecosystem === 'python') {
            adapter = new PyPIAdapter();
            scoring = new ScoringEngine();
        } else {
            adapter = new NpmAdapter();
            scoring = new JavaScriptScoringEngine();
        }

        // Quick parallel analysis
        const promises = packages.map(async (pkg) => {
            try {
                const meta = await adapter.meta(pkg.name);
                const score = await scoring.calculateScore(pkg.name, meta);

                if (score.level === 'low') {
                    if (securityMode === 'block' || securityMode === 'interactive') {
                        return pkg.name;
                    }
                }
                return null;
            } catch {
                return null;
            }
        });

        const results = await Promise.all(promises);
        return results.filter(name => name !== null) as string[];
    }

    private async createFilteredRequirements(
        safePackages: Array<{ name: string, ecosystem: 'python' | 'javascript' }>,
        originalFileName: string,
        silent: boolean = false
    ): Promise<void> {
        const cwd = this.workspaceFolder?.uri.fsPath || process.cwd();
        const originalPath = path.join(cwd, originalFileName);
        const safePath = path.join(cwd, 'requirements-safe.txt');

        try {
            // Read original file and preserve versions/constraints
            const originalContent = fs.readFileSync(originalPath, 'utf-8');
            const originalLines = originalContent.split('\n');

            const safeLines = originalLines.filter(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) {
                    return true; // Keep comments and flags
                }

                const packageName = this.cleanPackageName(trimmed);
                return safePackages.some(pkg => pkg.name === packageName);
            });

            fs.writeFileSync(safePath, safeLines.join('\n'));

            if (!silent) {
                this.writeEmitter.fire(`✅ Created requirements-safe.txt with ${safePackages.length} safe packages\r\n`);
            }

        } catch (error) {
            if (!silent) {
                this.writeEmitter.fire('❌ Error creating filtered requirements file\r\n');
            }
        }
    }

    private async showSecuritySummary(
        allPackages: Array<{ name: string, ecosystem: 'python' | 'javascript' }>,
        blockedPackages: string[],
        installedPackages: Array<{ name: string, ecosystem: 'python' | 'javascript' }>,
        ecosystem: 'python' | 'javascript'
    ): Promise<void> {
        this.safeWriteEmitter('\r\n');
        this.safeWriteEmitter('─'.repeat(60) + '\r\n');
        this.safeWriteEmitter('🛡️  \x1b[1m\x1b[36mPkgGuard Security Report\x1b[0m\r\n');
        this.safeWriteEmitter('─'.repeat(60) + '\r\n');

        // Summary stats
        this.safeWriteEmitter(`📊 \x1b[1mSummary:\x1b[0m\r\n`);
        this.safeWriteEmitter(`   Total packages: ${allPackages.length}\r\n`);
        this.safeWriteEmitter(`   ✅ \x1b[32mInstalled: ${installedPackages.length}\x1b[0m\r\n`);
        this.safeWriteEmitter(`   🚫 \x1b[31mBlocked: ${blockedPackages.length}\x1b[0m\r\n`);

        if (blockedPackages.length > 0) {
            this.safeWriteEmitter(`\r\n🚫 \x1b[1m\x1b[31mBlocked Packages:\x1b[0m\r\n`);
            for (const pkg of blockedPackages) {
                this.safeWriteEmitter(`   🔴 ${pkg}\r\n`);
            }

            // Generate detailed report
            await this.generateSecurityReport(allPackages, blockedPackages, installedPackages, ecosystem);

            this.safeWriteEmitter(`\r\n💡 \x1b[33mDetailed security report saved to .pkgguard-report.txt\x1b[0m\r\n`);
            this.safeWriteEmitter(`💡 \x1b[33mTo install blocked packages individually: pip install <package_name>\x1b[0m\r\n`);
        }

        this.safeWriteEmitter('─'.repeat(60) + '\r\n');
    }

    private async generateSecurityReport(
        allPackages: Array<{ name: string, ecosystem: 'python' | 'javascript' }>,
        blockedPackages: string[],
        installedPackages: Array<{ name: string, ecosystem: 'python' | 'javascript' }>,
        ecosystem: 'python' | 'javascript'
    ): Promise<void> {
        const cwd = this.workspaceFolder?.uri.fsPath || process.cwd();
        const reportPath = path.join(cwd, '.pkgguard-report.txt');

        try {
            let adapter: any;
            let scoring: any;

            if (ecosystem === 'python') {
                adapter = new PyPIAdapter();
                scoring = new ScoringEngine();
            } else {
                adapter = new NpmAdapter();
                scoring = new JavaScriptScoringEngine();
            }

            let report = '';
            report += `PkgGuard Security Report\n`;
            report += `Generated: ${new Date().toISOString()}\n`;
            report += `Ecosystem: ${ecosystem}\n`;
            report += `===========================================\n\n`;

            report += `SUMMARY:\n`;
            report += `- Total packages: ${allPackages.length}\n`;
            report += `- Installed: ${installedPackages.length}\n`;
            report += `- Blocked: ${blockedPackages.length}\n\n`;

            if (blockedPackages.length > 0) {
                report += `BLOCKED PACKAGES (Security Risks):\n`;
                report += `-----------------------------------\n`;

                for (const pkgName of blockedPackages) {
                    try {
                        const meta = await adapter.meta(pkgName);
                        const score = await scoring.calculateScore(pkgName, meta);

                        report += `\nPackage: ${pkgName}\n`;
                        report += `Trust Score: ${score.score || 'N/A'}\n`;
                        report += `Risk Level: ${score.level}\n`;

                        if (score.riskFactors && score.riskFactors.length > 0) {
                            report += `Risk Factors:\n`;
                            for (const risk of score.riskFactors) {
                                report += `  - ${risk.text}\n`;
                            }
                        }

                        if (score.evidence?.registryUrl) {
                            report += `Registry: ${score.evidence.registryUrl}\n`;
                        }

                        report += `---\n`;
                    } catch (error) {
                        report += `\nPackage: ${pkgName}\n`;
                        report += `Error: Could not analyze package\n`;
                        report += `---\n`;
                    }
                }
            }

            if (installedPackages.length > 0) {
                report += `\nINSTALLED PACKAGES (Approved):\n`;
                report += `------------------------------\n`;
                for (const pkg of installedPackages) {
                    report += `✅ ${pkg.name}\n`;
                }
            }

            fs.writeFileSync(reportPath, report);

        } catch (error) {
            // Silent fail for report generation
        }
    }

    private async isManifestCommand(command: string): Promise<boolean> {
        // Check for native pip/npm commands that use manifest files
        const manifestPatterns = [
            /pip\s+install\s+-r\s+/,
            /pip\s+uninstall\s+-r\s+/,
            /npm\s+install$/,
            /yarn\s+install$/,
            /pnpm\s+install$/,
            /bun\s+install$/
        ];

        return manifestPatterns.some(pattern => pattern.test(command.toLowerCase()));
    }

    private isUninstallCommand(command: string): boolean {
        const uninstallPatterns = [
            /pip\s+uninstall/,
            /npm\s+uninstall/,
            /yarn\s+remove/,
            /pnpm\s+remove/,
            /bun\s+remove/
        ];

        return uninstallPatterns.some(pattern => pattern.test(command.toLowerCase()));
    }

    private async handleManifestCommand(command: string): Promise<void> {
        const lowerCommand = command.toLowerCase();

        if (lowerCommand.includes('pip') && lowerCommand.includes('-r')) {
            // Handle pip install/uninstall -r requirements.txt
            if (this.isUninstallCommand(command)) {
                // No security checks for uninstall commands
                await this.executeInVSCodeTerminal(command);
            } else {
                await this.handleNativePipCommand(command);
            }
        } else if (lowerCommand.includes('install') &&
            (lowerCommand.startsWith('npm ') || lowerCommand.startsWith('yarn ') ||
                lowerCommand.startsWith('pnpm ') || lowerCommand.startsWith('bun '))) {
            // Handle native npm/yarn/pnpm/bun install
            await this.handleNativeJSInstall(command);
        } else {
            // Fall back to normal execution
            await this.executeInVSCodeTerminal(command);
        }
    }

    private async handleNativePipCommand(command: string): Promise<void> {
        // Extract the requirements file name
        const match = command.match(/-r\s+([^\s]+)/);
        if (!match) {
            await this.executeInVSCodeTerminal(command);
            return;
        }

        const requirementsFile = match[1];
        const cwd = this.workspaceFolder?.uri.fsPath || process.cwd();
        const filePath = path.join(cwd, requirementsFile);

        if (!fs.existsSync(filePath)) {
            await this.executeInVSCodeTerminal(command);
            return;
        }

        // Silent security analysis
        const packages = this.parseManifestFile(filePath, 'python');
        const blockedPackages = await this.getBlockedPackages(packages, 'python');
        const safePackages = packages.filter(p => !blockedPackages.includes(p.name));

        let actualCommand = command;
        let usedFilteredFile = false;

        if (blockedPackages.length > 0 && command.includes('install')) {
            if (safePackages.length > 0) {
                // Silently create filtered requirements file
                await this.createFilteredRequirements(safePackages, requirementsFile, true);
                actualCommand = command.replace(requirementsFile, 'requirements-safe.txt');
                usedFilteredFile = true;
            } else {
                // All packages blocked
                this.writeEmitter.fire('\\r\\n🚫 \\x1b[31mAll packages in requirements.txt are blocked for security reasons\\x1b[0m\\r\\n');
                await this.generateSecurityReport(packages, blockedPackages, [], 'python');
                return;
            }
        }

        // Execute the actual command (clean output)
        await this.executeInVSCodeTerminal(actualCommand);

        // Show security summary after installation
        if (packages.length > 0) {
            await this.showSecuritySummary(packages, blockedPackages, safePackages, 'python');
        }

        // Clean up filtered file
        if (usedFilteredFile) {
            try {
                fs.unlinkSync(path.join(cwd, 'requirements-safe.txt'));
            } catch { }
        }
    }

    private async handleNativeJSInstall(command: string): Promise<void> {
        const cwd = this.workspaceFolder?.uri.fsPath || process.cwd();
        const packageJsonPath = path.join(cwd, 'package.json');

        if (!fs.existsSync(packageJsonPath)) {
            await this.executeInVSCodeTerminal(command);
            return;
        }

        // Silent security analysis
        const packages = this.parseManifestFile(packageJsonPath, 'javascript');
        const blockedPackages = await this.getBlockedPackages(packages, 'javascript');

        // Execute the command (clean output)
        await this.executeInVSCodeTerminal(command);

        // Show security summary after installation
        if (packages.length > 0) {
            await this.showSecuritySummary(packages, blockedPackages, packages, 'javascript');
        }
    }
}

/**
 * Simple Terminal Manager
 */
export class SimpleTerminalManager {
    public static createPkgGuardTerminal(workspaceFolder?: vscode.WorkspaceFolder): vscode.Terminal {
        const pty = new SimplePkgGuardTerminal(workspaceFolder);

        return vscode.window.createTerminal({
            name: '🛡️ PkgGuard Smart',
            pty,
            iconPath: new vscode.ThemeIcon('shield'),
            color: new vscode.ThemeColor('terminal.ansiGreen')
        });
    }

    public static registerCommands(context: vscode.ExtensionContext): void {
        const createTerminal = vscode.commands.registerCommand('pkgguard.createTerminal', () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const terminal = SimpleTerminalManager.createPkgGuardTerminal(workspaceFolder);
            terminal.show();

            vscode.window.showInformationMessage(
                '🛡️ PkgGuard Smart Terminal created. Type commands normally, security checks will intercept risky installations.',
                'Security Settings'
            ).then(selection => {
                if (selection === 'Security Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'pkgGuard.securityMode');
                }
            });
        });

        context.subscriptions.push(createTerminal);
        console.log('PkgGuard: Simple terminal commands registered successfully');
    }
}