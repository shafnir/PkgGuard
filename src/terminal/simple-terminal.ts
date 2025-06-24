/**
 * Simple Windows-Optimized Terminal Solution
 * Lightweight command interceptor that works smoothly on all platforms
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import { TrustScore } from '../types';
import { PyPIAdapter } from '../adapters/pypi';
import { NpmAdapter } from '../adapters/npm';
import { ScoringEngine } from '../scoring';
import { JavaScriptScoringEngine } from '../scoring/javascript';

interface SecurityCheck {
    command: string;
    packages: Array<{name: string, ecosystem: 'python' | 'javascript'}>;
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

    constructor(private workspaceFolder?: vscode.WorkspaceFolder) {}

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
        this.safeWriteEmitter('Commands: \x1b[33mexit\x1b[0m, \x1b[33mclear\x1b[0m, or any system command. \x1b[33mCtrl+C\x1b[0m to exit.\r\n\r\n');
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
            this.runningProcess.stdin.write(data);
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

        // Handle cross-platform command translation
        command = this.translateCommand(command);

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

    private async performSecurityCheck(command: string, packages: Array<{name: string, ecosystem: 'python' | 'javascript'}>): Promise<boolean> {
        this.writeEmitter.fire('🛡️ \x1b[33mPkgGuard: Analyzing packages for security risks...\x1b[0m\r\n');

        const results: Array<{package: string, score: TrustScore}> = [];
        
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

    private async requestUserApproval(command: string, packages: Array<{name: string, ecosystem: 'python' | 'javascript'}>): Promise<boolean> {
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

    private extractPackageInfo(command: string): Array<{name: string, ecosystem: 'python' | 'javascript'}> {
        const packages: Array<{name: string, ecosystem: 'python' | 'javascript'}> = [];
        
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