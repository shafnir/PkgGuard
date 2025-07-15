/**
 * Terminal LSP Bridge
 * Integrates the fault-tolerant LSP client with the existing terminal implementation.
 */

import * as vscode from 'vscode';
import { FaultTolerantClient, ClientState } from '../client/FaultTolerantClient.js';
import { LocalValidator } from '../client/LocalValidator.js';
import { PackageExtractor } from '../utils/PackageExtractor.js';

export interface TerminalValidationResult {
  isValid: boolean;
  packages: Array<{
    name: string;
    ecosystem: "python" | "javascript";
    trustLevel: "high" | "medium" | "low" | "ignored" | "unknown";
    risks: string[];
    score: number | null;
  }>;
  recommendation: string;
  source: "server" | "cache" | "fallback" | "local";
  processingTime: number;
}

export interface TerminalLSPOptions {
  enabled?: boolean;
  fallbackToLocal?: boolean;
  showStatusIndicator?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Bridge between terminal and LSP client for seamless integration.
 */
export class TerminalLSPBridge {
  private lspClient: FaultTolerantClient;
  private localValidator: LocalValidator;
  private statusBarItem: vscode.StatusBarItem;
  private outputChannel: vscode.OutputChannel;
  private options: Required<TerminalLSPOptions>;

  constructor(
    private context: vscode.ExtensionContext,
    options: TerminalLSPOptions = {}
  ) {
    this.options = {
      enabled: true,
      fallbackToLocal: true,
      showStatusIndicator: true,
      logLevel: 'info',
      ...options
    };

    this.lspClient = new FaultTolerantClient(context);
    this.localValidator = new LocalValidator();
    this.outputChannel = vscode.window.createOutputChannel('PkgGuard LSP Bridge');
    
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    
    this.setupStatusBar();
    this.setupEventHandlers();
  }

  /**
   * Initialize the LSP bridge.
   */
  async initialize(): Promise<void> {
    if (!this.options.enabled) {
      this.log('LSP bridge disabled via configuration', 'info');
      return;
    }

    this.log('Initializing LSP bridge...', 'info');
    
    try {
      await this.lspClient.start();
      this.updateStatusBar('connected');
      this.log('LSP bridge initialized successfully', 'info');
    } catch (error) {
      this.log(`Failed to initialize LSP client: ${(error as Error).message}`, 'error');
      this.updateStatusBar('error');
      
      if (!this.options.fallbackToLocal) {
        throw error;
      }
    }
  }

  /**
   * Validate a terminal command using LSP server or local fallback.
   */
  async validateCommand(command: string, workspace?: string): Promise<TerminalValidationResult> {
    const startTime = Date.now();

    if (!this.options.enabled) {
      return this.createNoOpResult(command, startTime);
    }

    try {
      // Check if command needs validation
      if (!PackageExtractor.isInstallCommand(command)) {
        return this.createNoOpResult(command, startTime);
      }

      // Try LSP server first
      const clientState = this.lspClient.getState();
      if (clientState === ClientState.Running) {
        try {
          const result = await this.lspClient.validateCommand(command, workspace);
          this.updateStatusBar('connected');
          
          return {
            isValid: result.isValid,
            packages: result.packages,
            recommendation: result.recommendation,
            source: result.source as "server" | "cache" | "fallback",
            processingTime: Date.now() - startTime
          };
        } catch (error) {
          this.log(`LSP validation failed: ${(error as Error).message}`, 'warn');
          this.updateStatusBar('warning');
        }
      }

      // Fallback to local validation
      if (this.options.fallbackToLocal) {
        this.log('Using local validation fallback', 'info');
        const result = this.localValidator.validate(command);
        
        return {
          isValid: result.isValid,
          packages: result.packages,
          recommendation: result.recommendation,
          source: "local",
          processingTime: Date.now() - startTime
        };
      }

      // No validation available
      this.log('No validation method available', 'warn');
      return this.createNoOpResult(command, startTime);

    } catch (error) {
      this.log(`Command validation error: ${(error as Error).message}`, 'error');
      return this.createErrorResult(command, error as Error, startTime);
    }
  }

  /**
   * Get the current LSP client state.
   */
  getClientState(): ClientState {
    return this.lspClient.getState();
  }

  /**
   * Restart the LSP client.
   */
  async restartClient(): Promise<void> {
    this.log('Restarting LSP client...', 'info');
    this.updateStatusBar('connecting');
    
    try {
      await this.lspClient.restart();
      this.updateStatusBar('connected');
      this.log('LSP client restarted successfully', 'info');
    } catch (error) {
      this.log(`Failed to restart LSP client: ${(error as Error).message}`, 'error');
      this.updateStatusBar('error');
      throw error;
    }
  }

  /**
   * Check if LSP validation is available.
   */
  isLSPAvailable(): boolean {
    return this.lspClient.getState() === ClientState.Running;
  }

  /**
   * Get validation statistics.
   */
  getStatistics(): {
    clientState: ClientState;
    isEnabled: boolean;
    fallbackEnabled: boolean;
    validationSource: 'lsp' | 'local' | 'none';
  } {
    return {
      clientState: this.lspClient.getState(),
      isEnabled: this.options.enabled,
      fallbackEnabled: this.options.fallbackToLocal,
      validationSource: this.isLSPAvailable() ? 'lsp' : 
                       this.options.fallbackToLocal ? 'local' : 'none'
    };
  }

  /**
   * Setup status bar indicator.
   */
  private setupStatusBar(): void {
    if (!this.options.showStatusIndicator) {
      return;
    }

    this.statusBarItem.command = 'pkgguard.lsp.showStatus';
    this.statusBarItem.tooltip = 'PkgGuard LSP Status';
    this.statusBarItem.show();
    
    this.updateStatusBar('disconnected');
  }

  /**
   * Setup event handlers for LSP client state changes.
   */
  private setupEventHandlers(): void {
    // Register status command
    const statusCommand = vscode.commands.registerCommand(
      'pkgguard.lsp.showStatus',
      () => this.showStatusMessage()
    );

    // Register restart command
    const restartCommand = vscode.commands.registerCommand(
      'pkgguard.lsp.restart',
      () => this.restartClient()
    );

    this.context.subscriptions.push(statusCommand, restartCommand);
  }

  /**
   * Update status bar based on client state.
   */
  private updateStatusBar(state: 'connected' | 'connecting' | 'disconnected' | 'error' | 'warning'): void {
    if (!this.options.showStatusIndicator) {
      return;
    }

    const icons = {
      connected: '$(check)',
      connecting: '$(sync~spin)',
      disconnected: '$(circle-slash)',
      error: '$(error)',
      warning: '$(warning)'
    };

    const colors = {
      connected: undefined,
      connecting: undefined,
      disconnected: new vscode.ThemeColor('statusBarItem.warningForeground'),
      error: new vscode.ThemeColor('statusBarItem.errorForeground'),
      warning: new vscode.ThemeColor('statusBarItem.warningForeground')
    };

    this.statusBarItem.text = `${icons[state]} PkgGuard LSP`;
    this.statusBarItem.color = colors[state];
  }

  /**
   * Show status message with detailed information.
   */
  private async showStatusMessage(): Promise<void> {
    const stats = this.getStatistics();
    const state = stats.clientState;
    
    let message = `PkgGuard LSP Status: ${state}`;
    let actions: string[] = [];

    switch (state) {
      case ClientState.Running:
        message += ' - Ready for validation';
        actions = ['Show Logs', 'Restart'];
        break;
      case ClientState.Failed:
        message += ' - Using local fallback';
        actions = ['Show Logs', 'Restart', 'Disable'];
        break;
      case ClientState.Starting:
        message += ' - Connecting to server';
        actions = ['Show Logs', 'Cancel'];
        break;
      case ClientState.Stopped:
        message += ' - Disconnected';
        actions = ['Show Logs', 'Start', 'Disable'];
        break;
    }

    const selection = await vscode.window.showInformationMessage(
      message,
      ...actions
    );

    switch (selection) {
      case 'Show Logs':
        this.outputChannel.show();
        break;
      case 'Restart':
        await this.restartClient();
        break;
      case 'Start':
        await this.lspClient.start();
        break;
      case 'Disable':
        this.options.enabled = false;
        break;
      case 'Cancel':
        await this.lspClient.stop();
        break;
    }
  }

  /**
   * Create a no-op validation result.
   */
  private createNoOpResult(_command: string, startTime: number): TerminalValidationResult {
    return {
      isValid: true,
      packages: [],
      recommendation: 'No validation needed for this command',
      source: 'local',
      processingTime: Date.now() - startTime
    };
  }

  /**
   * Create an error validation result.
   */
  private createErrorResult(_command: string, error: Error, startTime: number): TerminalValidationResult {
    return {
      isValid: false,
      packages: [],
      recommendation: `Validation failed: ${error.message}. Proceed with caution.`,
      source: 'local',
      processingTime: Date.now() - startTime
    };
  }

  /**
   * Log message with appropriate level.
   */
  private log(message: string, level: 'error' | 'warn' | 'info' | 'debug'): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    // Only log if level is enabled
    const levels = ['error', 'warn', 'info', 'debug'];
    const currentLevelIndex = levels.indexOf(this.options.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    
    if (messageLevelIndex <= currentLevelIndex) {
      this.outputChannel.appendLine(logMessage);
      
      if (level === 'error') {
        console.error(logMessage);
      } else if (level === 'warn') {
        console.warn(logMessage);
      } else {
        console.log(logMessage);
      }
    }
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.lspClient.dispose();
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
  }
}