/**
 * Smart Blocking Terminal - Full Terminal Functionality with Selective Security
 * Behaves like a native terminal but adds security intelligence for package installations
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import { TrustScore } from '../types';
import { PyPIAdapter } from '../adapters/pypi';
import { NpmAdapter } from '../adapters/npm';
import { ScoringEngine } from '../scoring';
import { JavaScriptScoringEngine } from '../scoring/javascript';
import { TerminalDecorator } from './decorators';

interface SecurityCheck {
    command: string;
    packages: Array<{name: string, ecosystem: 'python' | 'javascript'}>;
    resolve: (approved: boolean) => void;
}

export class SmartBlockingTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number | void>();
    private currentProcess: cp.ChildProcess | undefined;
    private cwd: string;
    private shell: string;
    private shellArgs: string[];
    
    // Security state
    private pendingSecurityCheck: SecurityCheck | undefined;
    private isInSecurityPrompt: boolean = false;
    
    // Terminal state
    private isProcessRunning: boolean = false;
    private currentInput: string = '';

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<number | void> = this.closeEmitter.event;

    constructor(private workspaceFolder?: vscode.WorkspaceFolder) {
        this.cwd = workspaceFolder?.uri.fsPath || os.homedir();
        
        // Determine shell based on platform
        if (os.platform() === 'win32') {
            this.shell = process.env.COMSPEC || 'cmd.exe';
            this.shellArgs = [];
        } else {
            this.shell = process.env.SHELL || '/bin/bash';
            this.shellArgs = [];
        }
    }

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.writeEmitter.fire('🛡️ \x1b[32mPkgGuard Smart Terminal\x1b[0m - Full terminal functionality with security\r\n');
        this.startShell();
    }

    close(): void {
        if (this.currentProcess) {
            this.currentProcess.kill();
        }
    }

    private startShell(): void {
        this.currentProcess = cp.spawn(this.shell, this.shellArgs, {
            cwd: this.cwd,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.isProcessRunning = true;

        // Handle stdout - display all output normally
        this.currentProcess.stdout?.on('data', (data) => {
            this.writeEmitter.fire(data.toString());
        });

        // Handle stderr - display all errors normally  
        this.currentProcess.stderr?.on('data', (data) => {
            this.writeEmitter.fire(data.toString());
        });

        // Handle process exit
        this.currentProcess.on('close', (code) => {
            this.isProcessRunning = false;
            if (code !== 0) {
                this.writeEmitter.fire(`\r\nProcess exited with code ${code}\r\n`);
            }
            this.closeEmitter.fire(code || 0);
        });

        // Handle process error
        this.currentProcess.on('error', (error) => {
            this.isProcessRunning = false;
            this.writeEmitter.fire(`\r\nError: ${error.message}\r\n`);
            this.closeEmitter.fire(1);
        });
    }

    async handleInput(data: string): Promise<void> {
        // If we're in a security prompt, handle it separately
        if (this.isInSecurityPrompt && this.pendingSecurityCheck) {
            await this.handleSecurityPromptInput(data);
            return;
        }

        // For normal operation, intercept Enter key to check for package installation commands
        if (data === '\r') {
            const command = this.currentInput.trim();
            
            // Check if this is a package installation command that needs security review
            if (await this.shouldCheckSecurity(command)) {
                const packages = this.extractPackageInfo(command);
                if (packages.length > 0) {
                    const proceed = await this.performSecurityCheck(command, packages);
                    if (!proceed) {
                        // Command blocked - clear input and return to prompt
                        this.currentInput = '';
                        return;
                    }
                }
            }
            
            // Clear our input tracking since we're sending to shell
            this.currentInput = '';
        } else if (data === '\x7f' || data === '\b') {
            // Backspace - update our input tracking
            if (this.currentInput.length > 0) {
                this.currentInput = this.currentInput.slice(0, -1);
            }
        } else if (data.charCodeAt(0) >= 32) {
            // Regular character - add to our input tracking
            this.currentInput += data;
        } else if (data === '\x03') {
            // Ctrl+C - clear our input tracking
            this.currentInput = '';
        }

        // Always pass input through to the shell process
        if (this.currentProcess && this.currentProcess.stdin && this.isProcessRunning) {
            this.currentProcess.stdin.write(data);
        }
    }

    private async shouldCheckSecurity(command: string): Promise<boolean> {
        const config = vscode.workspace.getConfiguration();
        const blockingMode = config.get('pkgGuard.terminal.blockingMode', 'interactive');
        
        if (blockingMode === 'disabled') {
            return false;
        }

        // Only check installation commands, not uninstall or other commands
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
        this.writeEmitter.fire('\r\n🛡️ \x1b[33mPkgGuard: Analyzing packages for security risks...\x1b[0m\r\n');

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
            this.writeEmitter.fire('🚀 Proceeding with installation...\r\n');
            return true;
        }

        // Handle risky packages based on configuration
        const config = vscode.workspace.getConfiguration();
        const blockingMode = config.get('pkgGuard.terminal.blockingMode', 'interactive');

        if (blockingMode === 'strict') {
            this.writeEmitter.fire('\x1b[31m🚫 Installation blocked automatically (strict mode).\x1b[0m\r\n');
            this.writeEmitter.fire('💡 Change blocking mode to allow manual approval.\r\n');
            return false;
        }

        if (blockingMode === 'warn') {
            this.writeEmitter.fire('\x1b[33m⚠️ Warning: High-risk packages detected but proceeding.\x1b[0m\r\n');
            return true;
        }

        // Interactive mode - ask for user approval
        return await this.requestUserApproval(command, packages);
    }

    private async requestUserApproval(command: string, packages: Array<{name: string, ecosystem: 'python' | 'javascript'}>): Promise<boolean> {
        this.writeEmitter.fire('\r\n\x1b[31m🚨 WARNING: High-risk packages detected!\x1b[0m\r\n');
        this.writeEmitter.fire('\x1b[33m❓ Proceed with risky installation?\x1b[0m\r\n');
        this.writeEmitter.fire('Options: (y)es, (N)o [default], (d)etails, (i)gnore: ');

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
            this.writeEmitter.fire('\x1b[33m⚠️ Proceeding with risky installation as requested.\x1b[0m\r\n');
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
            this.writeEmitter.fire('Options: (y)es, (N)o [default], (d)etails, (i)gnore: ');
        } else if (char === 'i') {
            this.writeEmitter.fire('i\r\n');
            await this.ignorePackages();
            this.pendingSecurityCheck.resolve(true);
            this.isInSecurityPrompt = false;
            this.pendingSecurityCheck = undefined;
        } else if (char === '\x03') {
            // Ctrl+C
            this.writeEmitter.fire('^C\r\n');
            this.writeEmitter.fire('\x1b[31m❌ Installation cancelled.\x1b[0m\r\n');
            this.pendingSecurityCheck.resolve(false);
            this.isInSecurityPrompt = false;
            this.pendingSecurityCheck = undefined;
        } else {
            // Invalid input
            this.writeEmitter.fire('\r\n\x1b[33mInvalid option. Use: y/N/d/i\x1b[0m\r\n');
            this.writeEmitter.fire('Options: (y)es, (N)o [default], (d)etails, (i)gnore: ');
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

                if (score.evidence.registryUrl) {
                    this.writeEmitter.fire(`   🔗 Registry: ${score.evidence.registryUrl}\r\n`);
                }
            } catch (error) {
                this.writeEmitter.fire(`   ❌ Error getting details for ${pkg.name}\r\n`);
            }
        }
        this.writeEmitter.fire('\r\n');
    }

    private async ignorePackages(): Promise<void> {
        if (!this.pendingSecurityCheck) return;

        this.writeEmitter.fire('\x1b[36m➕ Adding packages to ignore list...\x1b[0m\r\n');

        for (const pkg of this.pendingSecurityCheck.packages) {
            try {
                await vscode.commands.executeCommand('pkgguard.ignorePackage', pkg.name);
                this.writeEmitter.fire(`   ✅ ${pkg.name} added to ignore list\r\n`);
            } catch (error) {
                this.writeEmitter.fire(`   ❌ Failed to ignore ${pkg.name}\r\n`);
            }
        }

        this.writeEmitter.fire('\x1b[32m✅ Packages ignored. Proceeding with installation.\x1b[0m\r\n');
    }

    private extractPackageInfo(command: string): Array<{name: string, ecosystem: 'python' | 'javascript'}> {
        const packages: Array<{name: string, ecosystem: 'python' | 'javascript'}> = [];
        
        // Python patterns - only install commands, not uninstall
        const pythonPatterns = [
            { pattern: /pip\s+install\s+(.+)/, ecosystem: 'python' as const },
            { pattern: /pip3\s+install\s+(.+)/, ecosystem: 'python' as const },
            { pattern: /python\s+-m\s+pip\s+install\s+(.+)/, ecosystem: 'python' as const },
            { pattern: /poetry\s+add\s+(.+)/, ecosystem: 'python' as const },
            { pattern: /pipenv\s+install\s+(.+)/, ecosystem: 'python' as const },
        ];

        // JavaScript patterns - only install/add commands
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
 * Smart Terminal Manager
 */
export class SmartTerminalManager {
    public static createSmartTerminal(workspaceFolder?: vscode.WorkspaceFolder): vscode.Terminal {
        const pty = new SmartBlockingTerminal(workspaceFolder);
        
        return vscode.window.createTerminal({
            name: '🛡️ PkgGuard Smart Terminal',
            pty,
            iconPath: new vscode.ThemeIcon('shield'),
            color: new vscode.ThemeColor('terminal.ansiGreen')
        });
    }

    public static registerSmartCommands(context: vscode.ExtensionContext): void {
        // Register command to create smart terminal
        const disposable = vscode.commands.registerCommand('pkgguard.createSmartTerminal', () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const terminal = SmartTerminalManager.createSmartTerminal(workspaceFolder);
            terminal.show();
            
            vscode.window.showInformationMessage(
                '🛡️ PkgGuard Smart Terminal created - Full terminal with security intelligence.',
                'Learn More'
            ).then(selection => {
                if (selection === 'Learn More') {
                    vscode.env.openExternal(vscode.Uri.parse('https://github.com/shafnir/PkgGuard#smart-terminal'));
                }
            });
        });

        context.subscriptions.push(disposable);
    }
}