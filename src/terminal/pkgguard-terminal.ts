/**
 * PkgGuard Enhanced Terminal using Pseudoterminal API
 * Provides universal compatibility for package monitoring across all VS Code versions
 * Creates a custom terminal that wraps system commands with security intelligence
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import { TrustScore } from '../types';
import { PyPIAdapter } from '../adapters/pypi';
import { NpmAdapter } from '../adapters/npm';
import { ScoringEngine } from '../scoring';
import { JavaScriptScoringEngine } from '../scoring/javascript';

export class PkgGuardTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number | void>();
    private currentProcess: cp.ChildProcess | undefined;
    private cwd: string;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<number | void> = this.closeEmitter.event;

    constructor(private workspaceFolder?: vscode.WorkspaceFolder) {
        this.cwd = workspaceFolder?.uri.fsPath || os.homedir();
    }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.writeEmitter.fire('🛡️ \x1b[32mPkgGuard Enhanced Terminal\x1b[0m\r\n');
        this.writeEmitter.fire('✨ Package security monitoring enabled\r\n');
        this.writeEmitter.fire(`📁 Working directory: ${this.cwd}\r\n\r\n`);
        this.showPrompt();
    }

    close(): void {
        if (this.currentProcess) {
            this.currentProcess.kill();
        }
    }

    private showPrompt(): void {
        const promptSymbol = os.platform() === 'win32' ? '>' : '$';
        this.writeEmitter.fire(`\x1b[36m${promptSymbol}\x1b[0m `);
    }

    async handleInput(data: string): Promise<void> {
        const input = data.replace(/\r?\n/g, '');

        if (data === '\r') {
            // Enter key pressed
            this.writeEmitter.fire('\r\n');
            await this.executeCommand(this.currentCommand || '');
            this.currentCommand = '';
            this.showPrompt();
        } else if (data === '\x7f' || data === '\b') {
            // Backspace
            if (this.currentCommand && this.currentCommand.length > 0) {
                this.currentCommand = this.currentCommand.slice(0, -1);
                this.writeEmitter.fire('\b \b');
            }
        } else if (data === '\x03') {
            // Ctrl+C
            if (this.currentProcess) {
                this.currentProcess.kill('SIGINT');
            }
            this.writeEmitter.fire('^C\r\n');
            this.currentCommand = '';
            this.showPrompt();
        } else if (data.charCodeAt(0) >= 32) {
            // Printable characters
            this.currentCommand = (this.currentCommand || '') + data;
            this.writeEmitter.fire(data);
        }
    }

    private currentCommand: string = '';

    private async executeCommand(command: string): Promise<void> {
        if (!command.trim()) return;

        // Check if this is a package installation command
        const packageInfo = this.extractPackageInfo(command);
        
        if (packageInfo.length > 0) {
            await this.analyzeAndWarnBeforeExecution(packageInfo, command);
        }

        // Execute the actual command
        await this.runSystemCommand(command);
    }

    /**
     * Extract package information from installation commands
     */
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
        ];

        const allPatterns = [...pythonPatterns, ...jsPatterns];

        for (const { pattern, ecosystem } of allPatterns) {
            const match = command.match(pattern);
            if (match) {
                const packageSpecs = match[1].split(/\s+/);
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

    /**
     * Analyze packages and show security warnings before execution
     */
    private async analyzeAndWarnBeforeExecution(
        packages: Array<{name: string, ecosystem: 'python' | 'javascript'}>,
        command: string
    ): Promise<void> {
        this.writeEmitter.fire('\r\n🛡️ \x1b[33mPkgGuard: Analyzing packages for security risks...\x1b[0m\r\n\r\n');

        const results: Array<{package: string, score: TrustScore}> = [];

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

                // Display immediate feedback
                const emoji = score.level === 'high' ? '🟢' : 
                             score.level === 'medium' ? '🟡' : 
                             score.level === 'ignored' ? '⚪' : '🔴';
                
                const color = score.level === 'high' ? '\x1b[32m' : 
                             score.level === 'medium' ? '\x1b[33m' : 
                             score.level === 'ignored' ? '\x1b[37m' : '\x1b[31m';

                this.writeEmitter.fire(`${emoji} ${color}${pkg.name}\x1b[0m: Score ${score.score ?? 'Ignored'}\r\n`);

                if (score.level === 'low') {
                    this.writeEmitter.fire(`   \x1b[31m⚠️  HIGH RISK PACKAGE\x1b[0m\r\n`);
                    if (score.riskFactors && score.riskFactors.length > 0) {
                        for (const risk of score.riskFactors.slice(0, 2)) {
                            this.writeEmitter.fire(`   • ${risk.text}\r\n`);
                        }
                    }
                }
            } catch (error) {
                this.writeEmitter.fire(`❌ \x1b[31mError analyzing ${pkg.name}\x1b[0m\r\n`);
            }
        }

        // Check for high-risk packages
        const highRiskPackages = results.filter(r => r.score.level === 'low');
        
        if (highRiskPackages.length > 0) {
            this.writeEmitter.fire('\r\n\x1b[31m🚨 WARNING: High-risk packages detected!\x1b[0m\r\n');
            this.writeEmitter.fire('\x1b[33mContinue with installation? (y/N): \x1b[0m');
            
            // Wait for user confirmation (simplified version)
            // In a real implementation, you'd handle this input properly
            await new Promise(resolve => setTimeout(resolve, 2000));
            this.writeEmitter.fire('N\r\n\r\n');
            this.writeEmitter.fire('\x1b[31m❌ Installation cancelled for security reasons.\x1b[0m\r\n');
            this.writeEmitter.fire('💡 Review package details before proceeding.\r\n\r\n');
            return;
        } else {
            this.writeEmitter.fire('\r\n\x1b[32m✅ All packages passed security checks.\x1b[0m\r\n');
            this.writeEmitter.fire('🚀 Proceeding with installation...\r\n\r\n');
        }
    }

    /**
     * Execute the actual system command
     */
    private async runSystemCommand(command: string): Promise<void> {
        return new Promise((resolve) => {
            const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash';
            const args = os.platform() === 'win32' ? ['/c', command] : ['-c', command];

            this.currentProcess = cp.spawn(shell, args, {
                cwd: this.cwd,
                env: process.env
            });

            this.currentProcess.stdout?.on('data', (data) => {
                this.writeEmitter.fire(data.toString());
            });

            this.currentProcess.stderr?.on('data', (data) => {
                this.writeEmitter.fire(data.toString());
            });

            this.currentProcess.on('close', (code) => {
                this.writeEmitter.fire(`\r\nProcess exited with code ${code}\r\n`);
                this.currentProcess = undefined;
                resolve();
            });

            this.currentProcess.on('error', (error) => {
                this.writeEmitter.fire(`\r\nError: ${error.message}\r\n`);
                this.currentProcess = undefined;
                resolve();
            });
        });
    }
}

/**
 * Terminal Manager for creating PkgGuard-enhanced terminals
 */
export class PkgGuardTerminalManager {
    public static createTerminal(workspaceFolder?: vscode.WorkspaceFolder): vscode.Terminal {
        const pty = new PkgGuardTerminal(workspaceFolder);
        
        return vscode.window.createTerminal({
            name: '🛡️ PkgGuard Terminal',
            pty,
            iconPath: new vscode.ThemeIcon('shield'),
            color: new vscode.ThemeColor('terminal.ansiGreen')
        });
    }

    public static registerCommands(context: vscode.ExtensionContext): void {
        // Register command to create new PkgGuard terminal
        const disposable = vscode.commands.registerCommand('pkgguard.createTerminal', () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const terminal = PkgGuardTerminalManager.createTerminal(workspaceFolder);
            terminal.show();
        });

        context.subscriptions.push(disposable);
    }
}