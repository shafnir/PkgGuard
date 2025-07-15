/**
 * Example integration showing how to use the TerminalLSPBridge
 * with the existing terminal implementation.
 */

import * as vscode from 'vscode';
import { TerminalLSPBridge, TerminalLSPOptions } from './TerminalLSPBridge.js';

/**
 * Example of how to integrate LSP validation into terminal commands.
 */
export class LSPIntegratedTerminal {
  private lspBridge: TerminalLSPBridge;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    
    // Initialize LSP bridge with options
    const options: TerminalLSPOptions = {
      enabled: vscode.workspace.getConfiguration('pkgGuard').get('lsp.enabled', true),
      fallbackToLocal: true,
      showStatusIndicator: true,
      logLevel: 'info'
    };
    
    this.lspBridge = new TerminalLSPBridge(context, options);
  }

  /**
   * Initialize the integrated terminal.
   */
  async initialize(): Promise<void> {
    await this.lspBridge.initialize();
    
    // Register commands
    this.registerCommands();
  }

  /**
   * Process a command with LSP validation.
   * This is what you would call from your existing terminal implementation.
   */
  async processCommand(command: string, workspace?: string): Promise<{
    shouldExecute: boolean;
    userApproved: boolean;
    validationResult: any;
  }> {
    // Validate the command using LSP
    const validationResult = await this.lspBridge.validateCommand(command, workspace);
    
    // Handle the validation result
    if (validationResult.isValid) {
      return {
        shouldExecute: true,
        userApproved: true,
        validationResult
      };
    }

    // Show user prompt for risky commands
    const userApproved = await this.showSecurityPrompt(command, validationResult);
    
    return {
      shouldExecute: userApproved,
      userApproved,
      validationResult
    };
  }

  /**
   * Show security prompt to user for risky commands.
   */
  private async showSecurityPrompt(
    command: string,
    validationResult: any
  ): Promise<boolean> {
    const riskLevel = this.getRiskLevel(validationResult);
    const message = this.formatSecurityMessage(command, validationResult, riskLevel);
    
    const actions = riskLevel === 'high' 
      ? ['Cancel', 'Proceed Anyway']
      : ['Cancel', 'Proceed', 'Always Allow'];
    
    const selection = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      ...actions
    );

    switch (selection) {
      case 'Proceed':
      case 'Proceed Anyway':
        return true;
      case 'Always Allow':
        // TODO: Add to ignore list
        return true;
      default:
        return false;
    }
  }

  /**
   * Get risk level from validation result.
   */
  private getRiskLevel(validationResult: any): 'high' | 'medium' | 'low' {
    const lowRiskCount = validationResult.packages.filter(p => p.trustLevel === 'low').length;
    const mediumRiskCount = validationResult.packages.filter(p => p.trustLevel === 'medium').length;
    
    if (lowRiskCount > 0) return 'high';
    if (mediumRiskCount > 0) return 'medium';
    return 'low';
  }

  /**
   * Format security message for user.
   */
  private formatSecurityMessage(
    command: string,
    validationResult: any,
    riskLevel: 'high' | 'medium' | 'low'
  ): string {
    const icon = riskLevel === 'high' ? '🚨' : '⚠️';
    const levelText = riskLevel.toUpperCase();
    
    let message = `${icon} ${levelText} RISK DETECTED\n\n`;
    message += `Command: ${command}\n`;
    message += `Source: ${validationResult.source}\n\n`;
    message += `${validationResult.recommendation}\n\n`;
    
    if (validationResult.packages.length > 0) {
      message += 'Package Analysis:\n';
      validationResult.packages.forEach(pkg => {
        const pkgIcon = pkg.trustLevel === 'low' ? '🔴' : 
                       pkg.trustLevel === 'medium' ? '🟡' : '🟢';
        message += `  ${pkgIcon} ${pkg.name} (${pkg.trustLevel})\n`;
        
        if (pkg.risks.length > 0) {
          pkg.risks.forEach(risk => {
            message += `    - ${risk}\n`;
          });
        }
      });
    }
    
    return message;
  }

  /**
   * Register VS Code commands.
   */
  private registerCommands(): void {
    // Command to check LSP status
    const statusCommand = vscode.commands.registerCommand(
      'pkgguard.lsp.status',
      () => {
        const stats = this.lspBridge.getStatistics();
        const message = `LSP Status: ${stats.clientState}\n` +
                       `Enabled: ${stats.isEnabled}\n` +
                       `Fallback: ${stats.fallbackEnabled}\n` +
                       `Source: ${stats.validationSource}`;
        
        vscode.window.showInformationMessage(message);
      }
    );

    // Command to restart LSP client
    const restartCommand = vscode.commands.registerCommand(
      'pkgguard.lsp.restart',
      async () => {
        try {
          await this.lspBridge.restartClient();
          vscode.window.showInformationMessage('LSP client restarted successfully');
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to restart LSP client: ${(error as Error).message}`);
        }
      }
    );

    // Command to validate a command manually
    const validateCommand = vscode.commands.registerCommand(
      'pkgguard.lsp.validate',
      async () => {
        const command = await vscode.window.showInputBox({
          prompt: 'Enter command to validate',
          placeHolder: 'pip install numpy'
        });
        
        if (command) {
          const result = await this.lspBridge.validateCommand(command);
          const message = `Validation Result:\n` +
                         `Valid: ${result.isValid}\n` +
                         `Source: ${result.source}\n` +
                         `Recommendation: ${result.recommendation}`;
          
          vscode.window.showInformationMessage(message);
        }
      }
    );

    this.context.subscriptions.push(statusCommand, restartCommand, validateCommand);
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.lspBridge.dispose();
  }
}

/**
 * Example usage in extension.ts
 */
export async function activateLSPIntegration(context: vscode.ExtensionContext): Promise<LSPIntegratedTerminal> {
  const integratedTerminal = new LSPIntegratedTerminal(context);
  await integratedTerminal.initialize();
  
  // Add to context subscriptions for cleanup
  context.subscriptions.push(integratedTerminal);
  
  return integratedTerminal;
}

/**
 * Example of how to modify existing terminal command processing
 */
export async function enhanceExistingTerminal(
  originalProcessCommand: (command: string) => Promise<void>,
  lspBridge: TerminalLSPBridge
): Promise<(command: string) => Promise<void>> {
  
  return async (command: string) => {
    // Validate command first
    const validationResult = await lspBridge.validateCommand(command);
    
    if (!validationResult.isValid) {
      // Show warning and get user approval
      const proceed = await vscode.window.showWarningMessage(
        validationResult.recommendation,
        'Cancel',
        'Proceed Anyway'
      );
      
      if (proceed !== 'Proceed Anyway') {
        return;
      }
    }
    
    // Execute original command processing
    await originalProcessCommand(command);
  };
}