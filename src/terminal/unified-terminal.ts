/**
 * PkgGuard Unified Terminal - Single Terminal Solution
 * Full terminal functionality with configurable security modes
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as cp from 'child_process';

// Conditionally import node-pty
let pty: any;
let hasPty: boolean = false;
try {
    pty = require('node-pty');
    hasPty = true;
    console.log('PkgGuard: node-pty loaded successfully');
} catch (error) {
    console.log('PkgGuard: node-pty not available, using fallback mode');
    pty = null;
    hasPty = false;
}
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

export class UnifiedPkgGuardTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number | void>();
    private ptyProcess: any;
    private fallbackProcess: cp.ChildProcess | undefined;
    private cwd: string;
    
    // Security state
    private pendingSecurityCheck: SecurityCheck | undefined;
    private isInSecurityPrompt: boolean = false;
    
    // Exit state
    private exitRequested: boolean = false;
    private commandBuffer: string = '';

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<number | void> = this.closeEmitter.event;

    constructor(private workspaceFolder?: vscode.WorkspaceFolder) {
        this.cwd = workspaceFolder?.uri.fsPath || os.homedir();
    }

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.writeEmitter.fire('🛡️ \x1b[32mPkgGuard Terminal\x1b[0m - Type \x1b[33m"exit"\x1b[0m or press \x1b[33mCtrl+C\x1b[0m to return to normal terminal\r\n');
        this.startShell();
    }

    close(): void {
        if (this.ptyProcess) {
            this.ptyProcess.kill();
        }
        if (this.fallbackProcess) {
            this.fallbackProcess.kill('SIGTERM');
        }
    }

    private startShell(): void {
        if (this.exitRequested) {
            this.closeEmitter.fire(0);
            return;
        }

        if (hasPty) {
            this.startPtyShell();
        } else {
            this.startFallbackShell();
        }
    }

    private startPtyShell(): void {
        try {
            // Determine shell based on platform
            const shell = os.platform() === 'win32' 
                ? (process.env.COMSPEC || 'powershell.exe')
                : (process.env.SHELL || '/bin/bash');

            this.writeEmitter.fire(`🔍 Starting PTY shell: ${shell}\r\n`);

            // Create PTY process - this creates a real pseudoterminal
            this.ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-color',
                cols: 80,
                rows: 24,
                cwd: this.cwd,
                env: process.env
            });

            this.writeEmitter.fire(`✅ PTY process started (PID: ${this.ptyProcess.pid})\r\n`);

            // Handle all output from PTY
            this.ptyProcess.onData((data: string) => {
                if (!this.exitRequested) {
                    this.writeEmitter.fire(data);
                }
            });

            // Handle PTY exit
            this.ptyProcess.onExit((exitCode: any) => {
                if (this.exitRequested) {
                    this.writeEmitter.fire('\r\n👋 Exiting PkgGuard Terminal...\r\n');
                    this.closeEmitter.fire(0);
                } else {
                    this.writeEmitter.fire(`\r\nShell exited with code ${exitCode.exitCode || exitCode}\r\n`);
                    this.closeEmitter.fire(exitCode.exitCode || exitCode || 0);
                }
            });

            // Send initial newline to trigger prompt
            setTimeout(() => {
                if (this.ptyProcess && !this.exitRequested) {
                    this.ptyProcess.write('\r');
                }
            }, 100);

        } catch (error) {
            this.writeEmitter.fire(`❌ Failed to start PTY: ${(error as Error).message}\r\n`);
            this.writeEmitter.fire('Falling back to basic terminal mode...\r\n');
            this.startFallbackShell();
        }
    }

    private startFallbackShell(): void {
        try {
            // Determine shell based on platform
            const shell = os.platform() === 'win32' 
                ? (process.env.COMSPEC || 'powershell.exe')
                : (process.env.SHELL || '/bin/bash');

            this.writeEmitter.fire(`🔍 Starting fallback shell: ${shell}\r\n`);
            this.writeEmitter.fire('⚠️ Using basic terminal mode (limited features)\r\n');

            // Create fallback process with better Windows support
            const shellArgs = os.platform() === 'win32' ? [] : ['-i'];
            
            this.fallbackProcess = cp.spawn(shell, shellArgs, {
                cwd: this.cwd,
                env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            if (!this.fallbackProcess.stdin || !this.fallbackProcess.stdout || !this.fallbackProcess.stderr) {
                throw new Error('Failed to create shell process streams');
            }

            this.writeEmitter.fire(`✅ Fallback shell started (PID: ${this.fallbackProcess.pid})\r\n`);
            this.writeEmitter.fire('$ '); // Show initial prompt

            // Handle stdout
            this.fallbackProcess.stdout.on('data', (data: Buffer) => {
                if (!this.exitRequested) {
                    this.writeEmitter.fire(data.toString());
                }
            });

            // Handle stderr  
            this.fallbackProcess.stderr.on('data', (data: Buffer) => {
                if (!this.exitRequested) {
                    this.writeEmitter.fire(data.toString());
                }
            });

            // Handle process exit
            this.fallbackProcess.on('close', (code) => {
                if (this.exitRequested) {
                    this.writeEmitter.fire('\r\n👋 Exiting PkgGuard Terminal...\r\n');
                    this.closeEmitter.fire(0);
                } else {
                    this.writeEmitter.fire(`\r\nShell exited with code ${code}\r\n`);
                    this.closeEmitter.fire(code || 0);
                }
            });

            // Handle process error
            this.fallbackProcess.on('error', (error) => {
                this.writeEmitter.fire(`\r\nShell Error: ${error.message}\r\n`);
                this.closeEmitter.fire(1);
            });

        } catch (error) {
            this.writeEmitter.fire(`❌ Failed to start fallback shell: ${(error as Error).message}\r\n`);
            this.closeEmitter.fire(1);
        }
    }

    async handleInput(data: string): Promise<void> {
        // Handle security prompt separately
        if (this.isInSecurityPrompt && this.pendingSecurityCheck) {
            await this.handleSecurityPromptInput(data);
            return;
        }

        // Simple exit handling
        if (data === '\r') {
            const command = this.commandBuffer.trim().toLowerCase();
            if (command === 'exit' || command === 'quit') {
                this.exitRequested = true;
                if (this.ptyProcess) {
                    this.ptyProcess.kill();
                }
                return;
            }
            this.commandBuffer = '';
        } else if (data === '\x03') {
            // Ctrl+C - check if empty line to exit
            if (this.commandBuffer.trim() === '') {
                this.exitRequested = true;
                if (this.ptyProcess) {
                    this.ptyProcess.kill();
                }
                return;
            } else {
                this.commandBuffer = '';
            }
        } else if (data === '\x7f' || data === '\b') {
            // Backspace
            if (this.commandBuffer.length > 0) {
                this.commandBuffer = this.commandBuffer.slice(0, -1);
            }
        } else if (data.charCodeAt(0) >= 32) {
            // Printable characters
            this.commandBuffer += data;
        }

        // Forward input to the active process
        if (!this.exitRequested) {
            if (this.ptyProcess) {
                this.ptyProcess.write(data);
            } else if (this.fallbackProcess && this.fallbackProcess.stdin) {
                // For fallback mode, echo the input since shell won't do it
                if (data.charCodeAt(0) >= 32 || data === '\r') {
                    this.writeEmitter.fire(data === '\r' ? '\r\n' : data);
                }
                this.fallbackProcess.stdin.write(data);
            }
        }
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
            return true;
        }

        // Handle risky packages based on security mode
        const config = vscode.workspace.getConfiguration();
        const securityMode = config.get('pkgGuard.securityMode', 'interactive');

        if (securityMode === 'block') {
            this.writeEmitter.fire('\x1b[31m🚫 Installation blocked (block mode enabled).\x1b[0m\r\n');
            this.writeEmitter.fire('💡 Change security mode to "monitor" to allow manual approval.\r\n');
            return false;
        }

        if (securityMode === 'monitor') {
            this.writeEmitter.fire('\x1b[33m⚠️ Warning: High-risk packages detected but proceeding (monitor mode).\x1b[0m\r\n');
            return true;
        }

        // Interactive mode - ask for user approval (default)
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
        
        // Python patterns - only install commands
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
 * Unified Terminal Manager
 */
export class UnifiedTerminalManager {
    public static createPkgGuardTerminal(workspaceFolder?: vscode.WorkspaceFolder): vscode.Terminal {
        const pty = new UnifiedPkgGuardTerminal(workspaceFolder);
        
        return vscode.window.createTerminal({
            name: '🛡️ PkgGuard Terminal',
            pty,
            iconPath: new vscode.ThemeIcon('shield'),
            color: new vscode.ThemeColor('terminal.ansiGreen')
        });
    }

    public static registerCommands(context: vscode.ExtensionContext): void {
        try {
            // Main command to create PkgGuard terminal
            const createTerminal = vscode.commands.registerCommand('pkgguard.createTerminal', () => {
                try {
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    const terminal = UnifiedTerminalManager.createPkgGuardTerminal(workspaceFolder);
                    terminal.show();
                    
                    vscode.window.showInformationMessage(
                        '🛡️ PkgGuard Terminal created. Type "exit" or Ctrl+C to return to normal terminal.',
                        'Security Settings'
                    ).then(selection => {
                        if (selection === 'Security Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'pkgGuard.securityMode');
                        }
                    });
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to create PkgGuard terminal: ${(error as Error).message}`);
                }
            });

            // Toggle security mode command
            const toggleSecurityMode = vscode.commands.registerCommand('pkgguard.toggleSecurityMode', async () => {
                try {
                    const config = vscode.workspace.getConfiguration();
                    const current = config.get('pkgGuard.securityMode', 'interactive');
                    const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
                    const target = hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
                    
                    const modes = ['interactive', 'monitor', 'block', 'disabled'];
                    const currentIndex = modes.indexOf(current as string);
                    const nextMode = modes[(currentIndex + 1) % modes.length];
                    
                    await config.update('pkgGuard.securityMode', nextMode, target);
                    
                    const modeDescriptions = {
                        interactive: '🛡️ Interactive - Ask for approval on risky packages',
                        monitor: '👁️ Monitor - Show warnings but allow installation',
                        block: '🚫 Block - Automatically block risky packages',
                        disabled: '⚪ Disabled - No security checks'
                    };
                    
                    vscode.window.showInformationMessage(
                        `PkgGuard Security Mode: ${modeDescriptions[nextMode as keyof typeof modeDescriptions]}`
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to toggle security mode: ${(error as Error).message}`);
                }
            });

            context.subscriptions.push(createTerminal, toggleSecurityMode);
            
            // Log successful registration
            console.log('PkgGuard: Unified terminal commands registered successfully');
            
        } catch (error) {
            console.error('PkgGuard: Failed to register terminal commands:', error);
            vscode.window.showErrorMessage(`PkgGuard: Failed to register terminal commands: ${(error as Error).message}`);
        }
    }
}