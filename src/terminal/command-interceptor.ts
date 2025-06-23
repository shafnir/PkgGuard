/**
 * Command Interceptor for Shell Integration
 * Provides blocking capabilities in regular terminals through shell integration
 */

import * as vscode from 'vscode';
import { TrustScore } from '../types';
import { PyPIAdapter } from '../adapters/pypi';
import { NpmAdapter } from '../adapters/npm';
import { ScoringEngine } from '../scoring';
import { JavaScriptScoringEngine } from '../scoring/javascript';

interface RiskyInstallation {
    command: string;
    packages: Array<{name: string, ecosystem: 'python' | 'javascript', score: TrustScore}>;
    terminal: vscode.Terminal;
}

export class CommandInterceptor {
    private readonly outputChannel: vscode.OutputChannel;
    private blockedCommands: Set<string> = new Set();

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('PkgGuard Command Interceptor');
    }

    public activate(context: vscode.ExtensionContext): void {
        // Monitor terminal shell executions for blocking
        context.subscriptions.push(
            vscode.window.onDidStartTerminalShellExecution(this.onShellExecutionStart.bind(this))
        );
    }

    private async onShellExecutionStart(e: vscode.TerminalShellExecutionStartEvent): Promise<void> {
        const command = e.execution.commandLine.value;
        const config = vscode.workspace.getConfiguration();
        const blockingEnabled = config.get('pkgGuard.terminal.preventRiskyInstalls', false);
        
        if (!blockingEnabled) return;

        const packages = this.extractPackageInfo(command);
        if (packages.length === 0) return;

        // Analyze packages for risks
        const riskyPackages = await this.analyzePackagesForRisks(packages);
        
        if (riskyPackages.length > 0) {
            // Block the command execution
            await this.blockRiskyInstallation({
                command,
                packages: riskyPackages,
                terminal: e.execution.terminal
            });
        }
    }

    private async analyzePackagesForRisks(
        packages: Array<{name: string, ecosystem: 'python' | 'javascript'}>
    ): Promise<Array<{name: string, ecosystem: 'python' | 'javascript', score: TrustScore}>> {
        const riskyPackages: Array<{name: string, ecosystem: 'python' | 'javascript', score: TrustScore}> = [];

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

                if (score.level === 'low') {
                    riskyPackages.push({ ...pkg, score });
                }
            } catch (error) {
                console.error(`Error analyzing package ${pkg.name}:`, error);
            }
        }

        return riskyPackages;
    }

    private async blockRiskyInstallation(installation: RiskyInstallation): Promise<void> {
        const packageNames = installation.packages.map(p => p.name).join(', ');
        
        // Show blocking notification with options
        const result = await vscode.window.showWarningMessage(
            `🚨 PkgGuard: High-risk packages detected: ${packageNames}`,
            {
                modal: true,
                detail: `The following command contains high-risk packages:\n\n${installation.command}\n\nRisky packages:\n${installation.packages.map(p => `• ${p.name} (Score: ${p.score.score})`).join('\n')}\n\nWhat would you like to do?`
            },
            'Block Installation',
            'Allow Once',
            'View Details',
            'Add to Ignore List'
        );

        switch (result) {
            case 'Block Installation':
                await this.executeBlock(installation);
                break;
            case 'Allow Once':
                await this.executeAllow(installation);
                break;
            case 'View Details':
                await this.showPackageDetails(installation);
                break;
            case 'Add to Ignore List':
                await this.addToIgnoreList(installation);
                break;
            default:
                await this.executeBlock(installation);
                break;
        }
    }

    private async executeBlock(installation: RiskyInstallation): Promise<void> {
        // Add command to blocked list
        this.blockedCommands.add(installation.command);
        
        // Send Ctrl+C to terminal to cancel the command
        installation.terminal.sendText('\x03', false);
        
        // Show blocking message
        this.outputChannel.appendLine(`🚫 BLOCKED: ${installation.command}`);
        this.outputChannel.appendLine(`Reason: High-risk packages detected`);
        this.outputChannel.appendLine(`Packages: ${installation.packages.map(p => p.name).join(', ')}`);
        this.outputChannel.appendLine('─'.repeat(60));
        this.outputChannel.show();

        vscode.window.showInformationMessage(
            `🛡️ Installation blocked for security. Command cancelled.`,
            'View Details'
        ).then(selection => {
            if (selection === 'View Details') {
                this.outputChannel.show();
            }
        });
    }

    private async executeAllow(installation: RiskyInstallation): Promise<void> {
        this.outputChannel.appendLine(`⚠️ ALLOWED: ${installation.command}`);
        this.outputChannel.appendLine(`Warning: User approved risky installation`);
        this.outputChannel.appendLine(`Packages: ${installation.packages.map(p => p.name).join(', ')}`);
        this.outputChannel.appendLine('─'.repeat(60));

        vscode.window.showWarningMessage(
            `⚠️ Proceeding with risky installation as requested. Please be cautious.`
        );
        
        // Command continues executing normally
    }

    private async showPackageDetails(installation: RiskyInstallation): Promise<void> {
        const details = installation.packages.map(pkg => {
            const riskFactors = pkg.score.riskFactors?.map(r => `  • ${r.text}`).join('\n') || '  • No specific risk factors identified';
            return `📦 ${pkg.name} (${pkg.ecosystem})\n  Score: ${pkg.score.score}\n  Risk Factors:\n${riskFactors}`;
        }).join('\n\n');

        const action = await vscode.window.showInformationMessage(
            `📋 Package Risk Details`,
            {
                modal: true,
                detail: details + '\n\nWhat would you like to do?'
            },
            'Block Installation',
            'Allow Once',
            'Add to Ignore List'
        );

        // Recursively handle the action
        if (action === 'Block Installation') {
            await this.executeBlock(installation);
        } else if (action === 'Allow Once') {
            await this.executeAllow(installation);
        } else if (action === 'Add to Ignore List') {
            await this.addToIgnoreList(installation);
        } else {
            await this.executeBlock(installation);
        }
    }

    private async addToIgnoreList(installation: RiskyInstallation): Promise<void> {
        const promises = installation.packages.map(pkg => 
            vscode.commands.executeCommand('pkgguard.ignorePackage', pkg.name)
        );

        try {
            await Promise.all(promises);
            vscode.window.showInformationMessage(
                `✅ Added ${installation.packages.length} package${installation.packages.length > 1 ? 's' : ''} to ignore list. Installation will proceed.`
            );
            
            this.outputChannel.appendLine(`➕ IGNORED: Added packages to ignore list`);
            this.outputChannel.appendLine(`Packages: ${installation.packages.map(p => p.name).join(', ')}`);
            this.outputChannel.appendLine(`Command proceeding: ${installation.command}`);
            this.outputChannel.appendLine('─'.repeat(60));
        } catch (error) {
            vscode.window.showErrorMessage(`❌ Failed to add packages to ignore list: ${error}`);
            await this.executeBlock(installation);
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

    public dispose(): void {
        this.outputChannel.dispose();
    }
}