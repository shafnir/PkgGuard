/**
 * Enhanced PkgGuard Terminal with Comprehensive Blocking
 * Provides real user input handling and flexible approval workflows
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

interface PendingCommand {
    command: string;
    packages: Array<{name: string, ecosystem: 'python' | 'javascript'}>;
    resolve: (approved: boolean) => void;
}

export class BlockingPkgGuardTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number | void>();
    private currentProcess: cp.ChildProcess | undefined;
    private cwd: string;
    private currentInput: string = '';
    private awaitingApproval: PendingCommand | undefined;
    private promptText: string = '';

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<number | void> = this.closeEmitter.event;

    constructor(private workspaceFolder?: vscode.WorkspaceFolder) {
        this.cwd = workspaceFolder?.uri.fsPath || os.homedir();
    }

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.writeEmitter.fire('🛡️ \x1b[32mPkgGuard Enhanced Terminal\x1b[0m\r\n');
        this.writeEmitter.fire('✨ Real-time package security monitoring with blocking enabled\r\n');
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
        this.promptText = `\x1b[36m${promptSymbol}\x1b[0m `;
        this.writeEmitter.fire(this.promptText);
    }

    async handleInput(data: string): Promise<void> {
        // Handle approval prompts first
        if (this.awaitingApproval) {
            await this.handleApprovalInput(data);
            return;
        }

        if (data === '\r') {
            // Enter key pressed
            this.writeEmitter.fire('\r\n');
            await this.executeCommand(this.currentInput.trim());
            this.currentInput = '';
            this.showPrompt();
        } else if (data === '\x7f' || data === '\b') {
            // Backspace
            if (this.currentInput.length > 0) {
                this.currentInput = this.currentInput.slice(0, -1);
                this.writeEmitter.fire('\b \b');
            }
        } else if (data === '\x03') {
            // Ctrl+C
            if (this.currentProcess) {
                this.currentProcess.kill('SIGINT');
            } else if (this.awaitingApproval) {
                this.writeEmitter.fire('^C\r\n');
                this.awaitingApproval.resolve(false);
                this.awaitingApproval = undefined;
                this.writeEmitter.fire('\x1b[31m❌ Installation cancelled.\x1b[0m\r\n\r\n');
                this.showPrompt();
            } else {
                this.writeEmitter.fire('^C\r\n');
                this.currentInput = '';
                this.showPrompt();
            }
        } else if (data.charCodeAt(0) >= 32) {
            // Printable characters
            this.currentInput += data;
            this.writeEmitter.fire(data);
        }
    }

    private async handleApprovalInput(data: string): Promise<void> {
        if (!this.awaitingApproval) return;

        const char = data.toLowerCase();
        
        if (char === 'y' || char === '\r') {
            this.writeEmitter.fire(char === '\r' ? 'N' : char);
            this.writeEmitter.fire('\r\n');
            
            if (char === 'y') {
                this.writeEmitter.fire('\x1b[33m⚠️  Proceeding with risky installation as requested.\x1b[0m\r\n');
                this.awaitingApproval.resolve(true);
            } else {
                this.writeEmitter.fire('\x1b[32m✅ Installation cancelled for security.\x1b[0m\r\n');
                this.awaitingApproval.resolve(false);
            }
            
            this.awaitingApproval = undefined;
        } else if (char === 'n' || char === '\x03') {
            this.writeEmitter.fire(char === '\x03' ? '^C' : char);
            this.writeEmitter.fire('\r\n');
            this.writeEmitter.fire('\x1b[32m✅ Installation cancelled for security.\x1b[0m\r\n');
            this.awaitingApproval.resolve(false);
            this.awaitingApproval = undefined;
        } else if (char === 'd') {
            // 'D' for details
            this.writeEmitter.fire(char);
            this.writeEmitter.fire('\r\n');
            await this.showPackageDetails();
            this.showApprovalPrompt();
        } else if (char === 'i') {
            // 'I' for ignore (add to ignore list)
            this.writeEmitter.fire(char);
            this.writeEmitter.fire('\r\n');
            await this.ignorePackages();
            this.awaitingApproval.resolve(true);
            this.awaitingApproval = undefined;
        } else {
            // Invalid input, show help
            this.writeEmitter.fire('\r\n\x1b[33mInvalid option. Use: y/N/d/i\x1b[0m\r\n');
            this.showApprovalPrompt();
        }
    }

    private showApprovalPrompt(): void {
        this.writeEmitter.fire('\x1b[33mOptions: (y)es, (N)o [default], (d)etails, (i)gnore: \x1b[0m');
    }

    private async showPackageDetails(): Promise<void> {
        if (!this.awaitingApproval) return;

        this.writeEmitter.fire('\r\n\x1b[36m📋 Package Risk Details:\x1b[0m\r\n');
        this.writeEmitter.fire('─'.repeat(50) + '\r\n');

        for (const pkg of this.awaitingApproval.packages) {
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
        if (!this.awaitingApproval) return;

        this.writeEmitter.fire('\x1b[36m➕ Adding packages to ignore list...\x1b[0m\r\n');

        for (const pkg of this.awaitingApproval.packages) {
            try {
                // Add to ignore list via command
                await vscode.commands.executeCommand('pkgguard.ignorePackage', pkg.name);
                this.writeEmitter.fire(`   ✅ ${pkg.name} added to ignore list\r\n`);
            } catch (error) {
                this.writeEmitter.fire(`   ❌ Failed to ignore ${pkg.name}\r\n`);
            }
        }

        this.writeEmitter.fire('\x1b[32m✅ Packages ignored. Proceeding with installation.\x1b[0m\r\n');
    }

    private async executeCommand(command: string): Promise<void> {
        if (!command.trim()) return;

        // Check if this is a package installation command
        const packageInfo = this.extractPackageInfo(command);
        
        if (packageInfo.length > 0) {
            const shouldBlock = await this.analyzeAndCheckBlocking(packageInfo, command);
            if (!shouldBlock) {
                this.writeEmitter.fire('\x1b[31m❌ Installation blocked for security reasons.\x1b[0m\r\n');
                this.writeEmitter.fire('💡 Use (d)etails option to learn more about risks.\r\n\r\n');
                return;
            }
        }

        // Execute the actual command
        await this.runSystemCommand(command);
    }

    private async analyzeAndCheckBlocking(
        packages: Array<{name: string, ecosystem: 'python' | 'javascript'}>,
        command: string
    ): Promise<boolean> {
        this.writeEmitter.fire('\r\n🛡️ \x1b[33mPkgGuard: Analyzing packages for security risks...\x1b[0m\r\n\r\n');

        const results: Array<{package: string, score: TrustScore}> = [];
        const progressTotal = packages.length;
        let progressCurrent = 0;

        for (const pkg of packages) {
            try {
                progressCurrent++;
                const progressBar = TerminalDecorator.createProgressIndicator(progressCurrent, progressTotal, pkg.name);
                this.writeEmitter.fire(progressBar + '\r');

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

                // Clear progress line and show result
                this.writeEmitter.fire(' '.repeat(60) + '\r');
                const emoji = score.level === 'high' ? '🟢' : 
                             score.level === 'medium' ? '🟡' : 
                             score.level === 'ignored' ? '⚪' : '🔴';
                
                const color = score.level === 'high' ? '\x1b[32m' : 
                             score.level === 'medium' ? '\x1b[33m' : 
                             score.level === 'ignored' ? '\x1b[37m' : '\x1b[31m';

                this.writeEmitter.fire(`${emoji} ${color}${pkg.name}\x1b[0m: Score ${score.score ?? 'Ignored'}\r\n`);

                if (score.level === 'low') {
                    this.writeEmitter.fire(`   \x1b[31m⚠️  HIGH RISK PACKAGE\x1b[0m\r\n`);
                }
            } catch (error) {
                this.writeEmitter.fire(`❌ \x1b[31mError analyzing ${pkg.name}\x1b[0m\r\n`);
            }
        }

        // Check configuration for blocking behavior
        const config = vscode.workspace.getConfiguration();
        const preventRiskyInstalls = config.get('pkgGuard.terminal.preventRiskyInstalls', false);
        const highRiskPackages = results.filter(r => r.score.level === 'low');
        
        if (highRiskPackages.length > 0) {
            this.writeEmitter.fire(`\r\n\x1b[31m🚨 WARNING: ${highRiskPackages.length} high-risk package${highRiskPackages.length > 1 ? 's' : ''} detected!\x1b[0m\r\n`);
            
            for (const risky of highRiskPackages) {
                this.writeEmitter.fire(`   🔴 ${risky.package}\r\n`);
            }

            if (preventRiskyInstalls) {
                // Automatic blocking enabled
                this.writeEmitter.fire('\r\n\x1b[31m🚫 Automatic blocking enabled. Installation prevented.\x1b[0m\r\n');
                this.writeEmitter.fire('💡 Disable "pkgGuard.terminal.preventRiskyInstalls" to allow manual approval.\r\n');
                return false;
            } else {
                // Interactive approval
                this.writeEmitter.fire('\r\n\x1b[33m❓ Proceed with risky installation?\x1b[0m\r\n');
                
                return new Promise<boolean>((resolve) => {
                    this.awaitingApproval = {
                        command,
                        packages,
                        resolve
                    };
                    this.showApprovalPrompt();
                });
            }
        } else {
            this.writeEmitter.fire('\r\n\x1b[32m✅ All packages passed security checks.\x1b[0m\r\n');
            this.writeEmitter.fire('🚀 Proceeding with installation...\r\n\r\n');
            return true;
        }
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
 * Enhanced Terminal Manager with Blocking Capabilities
 */
export class BlockingTerminalManager {
    public static createBlockingTerminal(workspaceFolder?: vscode.WorkspaceFolder): vscode.Terminal {
        const pty = new BlockingPkgGuardTerminal(workspaceFolder);
        
        return vscode.window.createTerminal({
            name: '🛡️ PkgGuard Secure Terminal',
            pty,
            iconPath: new vscode.ThemeIcon('shield'),
            color: new vscode.ThemeColor('terminal.ansiRed')
        });
    }

    public static registerBlockingCommands(context: vscode.ExtensionContext): void {
        // Register command to create blocking terminal
        const disposable = vscode.commands.registerCommand('pkgguard.createBlockingTerminal', () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const terminal = BlockingTerminalManager.createBlockingTerminal(workspaceFolder);
            terminal.show();
            
            vscode.window.showInformationMessage(
                '🛡️ PkgGuard Secure Terminal created with installation blocking enabled.',
                'Learn More'
            ).then(selection => {
                if (selection === 'Learn More') {
                    vscode.env.openExternal(vscode.Uri.parse('https://github.com/shafnir/PkgGuard#terminal-integration'));
                }
            });
        });

        context.subscriptions.push(disposable);
    }
}