/**
 * Fault-tolerant LSP client with local fallback capabilities.
 * Handles server failures gracefully and provides offline validation.
 */

import { 
  LanguageClient, 
  LanguageClientOptions, 
  ServerOptions, 
  TransportKind,
  State,
  RequestType
} from 'vscode-languageclient/node';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { PackageExtractor } from '../utils/PackageExtractor.js';
import { PkgGuardLSPServer } from '../server/index.js';

interface ValidateCommandParams {
  command: string;
  workspace?: string;
  authToken: string;
}

interface ValidateCommandResult {
  isValid: boolean;
  packages: Array<{
    name: string;
    ecosystem: "python" | "javascript";
    score: number | null;
    trustLevel: "high" | "medium" | "low" | "ignored" | "unknown";
    risks: string[];
    processingTime: number;
  }>;
  recommendation: string;
  processingTime: number;
  source: "server" | "cache" | "fallback";
}

const ValidateCommandRequest = new RequestType<ValidateCommandParams, ValidateCommandResult, void>(
  'pkgguard/validateCommand'
);

export enum ClientState {
  Stopped = 'stopped',
  Starting = 'starting',
  Running = 'running',
  Failed = 'failed'
}

export interface LocalValidationResult {
  isValid: boolean;
  packages: Array<{
    name: string;
    ecosystem: "python" | "javascript";
    score: number | null;
    trustLevel: "high" | "medium" | "low" | "ignored" | "unknown";
    risks: string[];
    processingTime: number;
  }>;
  recommendation: string;
  processingTime: number;
  source: "fallback";
}

/**
 * Fault-tolerant LSP client that gracefully handles server failures.
 */
export class FaultTolerantClient {
  private client: LanguageClient | null = null;
  private authToken: string;
  private state: ClientState = ClientState.Stopped;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private retryTimeout: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // Start with 1 second
  private readonly healthCheckIntervalMs = 30000; // 30 seconds
  private readonly requestTimeoutMs = 5000; // 5 seconds
  private readonly context: vscode.ExtensionContext;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly knownMaliciousPackages = new Set([
    'malicious-package',
    'evil-module',
    'backdoor-lib',
    'crypto-stealer',
    'data-harvester',
    'keylogger-py',
    'trojan-horse',
    'virus-scanner',
    'fake-numpy',
    'fake-requests',
    'fake-pandas',
    'fake-django',
    'fake-flask',
    'fake-react',
    'fake-lodash',
    'fake-express',
    'fake-axios'
  ]);

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.outputChannel = vscode.window.createOutputChannel('PkgGuard LSP Client');
    this.authToken = PkgGuardLSPServer.generateAuthToken();
  }

  /**
   * Start the LSP client with fault tolerance.
   */
  async start(): Promise<void> {
    if (this.state === ClientState.Running) {
      return;
    }

    this.state = ClientState.Starting;
    this.outputChannel.appendLine('Starting PkgGuard LSP Client...');

    try {
      await this.createAndStartClient();
      this.startHealthMonitoring();
      this.state = ClientState.Running;
      this.retryCount = 0;
      this.outputChannel.appendLine('LSP Client started successfully');
    } catch (error) {
      this.state = ClientState.Failed;
      this.outputChannel.appendLine(`Failed to start LSP Client: ${(error as Error).message}`);
      
      // Schedule retry with exponential backoff
      this.scheduleRetry();
    }
  }

  /**
   * Stop the LSP client.
   */
  async stop(): Promise<void> {
    this.state = ClientState.Stopped;
    this.stopHealthMonitoring();
    
    // Clear retry timeout
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    if (this.client) {
      try {
        await this.client.stop();
        this.outputChannel.appendLine('LSP Client stopped');
      } catch (error) {
        this.outputChannel.appendLine(`Error stopping LSP Client: ${(error as Error).message}`);
      }
      this.client = null;
    }
  }

  /**
   * Restart the LSP client.
   */
  async restart(): Promise<void> {
    this.outputChannel.appendLine('Restarting LSP Client...');
    await this.stop();
    await this.start();
  }

  /**
   * Validate a command with fault tolerance.
   */
  async validateCommand(
    command: string,
    workspace?: string
  ): Promise<ValidateCommandResult> {
    const startTime = Date.now();

    try {
      // Try server validation first
      if (this.state === ClientState.Running && this.client) {
        const serverResult = await this.validateWithServer(command, workspace);
        if (serverResult) {
          return serverResult;
        }
      }

      // Fall back to local validation
      this.outputChannel.appendLine('Server unavailable, using local validation');
      return this.validateLocally(command, startTime);

    } catch (error) {
      this.outputChannel.appendLine(`Validation error: ${(error as Error).message}`);
      return this.validateLocally(command, startTime);
    }
  }

  /**
   * Get current client state.
   */
  getState(): ClientState {
    return this.state;
  }

  /**
   * Create and start the LSP client.
   */
  private async createAndStartClient(): Promise<void> {
    const serverPath = path.join(this.context.extensionPath, 'dist', 'lsp-server.js');
    
    const serverOptions: ServerOptions = {
      run: { module: serverPath, transport: TransportKind.stdio },
      debug: { module: serverPath, transport: TransportKind.stdio }
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [], // MVP: No document analysis
      synchronize: {
        configurationSection: 'pkgGuard'
      },
      initializationOptions: {
        authToken: this.authToken
      },
      outputChannel: this.outputChannel,
      revealOutputChannelOn: 4, // Never reveal automatically
      middleware: {
        handleDiagnostics: (uri, diagnostics, next) => {
          // MVP: No diagnostics handling
          next(uri, diagnostics);
        }
      }
    };

    this.client = new LanguageClient(
      'pkgguard-lsp',
      'PkgGuard LSP Client',
      serverOptions,
      clientOptions
    );

    // Set up event handlers
    this.client.onDidChangeState((event) => {
      if (event.newState === State.Stopped) {
        this.outputChannel.appendLine('LSP Client stopped unexpectedly');
        this.state = ClientState.Failed;
        this.scheduleRetry();
      }
    });

    await this.client.start();
  }

  /**
   * Validate command using the LSP server.
   */
  private async validateWithServer(
    command: string,
    workspace?: string
  ): Promise<ValidateCommandResult | null> {
    if (!this.client) {
      return null;
    }

    try {
      const result = await Promise.race([
        this.client.sendRequest(ValidateCommandRequest, {
          command,
          workspace,
          authToken: this.authToken
        }),
        this.createTimeoutPromise(this.requestTimeoutMs)
      ]);

      return result as ValidateCommandResult;
    } catch (error) {
      this.outputChannel.appendLine(`Server request failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Validate command locally (fallback mode).
   */
  private validateLocally(command: string, startTime: number): LocalValidationResult {
    const extractionResult = PackageExtractor.extractPackages(command);
    
    if (!extractionResult.isInstallCommand || extractionResult.packages.length === 0) {
      return {
        isValid: true,
        packages: [],
        recommendation: "No packages to validate in this command",
        processingTime: Date.now() - startTime,
        source: "fallback"
      };
    }

    const packages = extractionResult.packages.map(pkg => {
      const isMalicious = this.knownMaliciousPackages.has(pkg.name);
      const risks: string[] = [];
      
      if (isMalicious) {
        risks.push("Known malicious package");
      }

      // Basic heuristics
      if (pkg.name.length < 3) {
        risks.push("Suspiciously short package name");
      }

      if (/\d{4,}/.test(pkg.name)) {
        risks.push("Package name contains long number sequence");
      }

      if (/[Il0O]{2,}/.test(pkg.name)) {
        risks.push("Package name contains confusing characters");
      }

      const trustLevel = isMalicious ? "low" : 
                        risks.length > 1 ? "medium" : 
                        "unknown";

      return {
        name: pkg.name,
        ecosystem: pkg.ecosystem,
        score: null,
        trustLevel: trustLevel as "high" | "medium" | "low" | "ignored" | "unknown",
        risks,
        processingTime: 0
      };
    });

    const isValid = packages.every(pkg => pkg.trustLevel !== "low");
    const recommendation = this.generateLocalRecommendation(packages);

    return {
      isValid,
      packages,
      recommendation,
      processingTime: Date.now() - startTime,
      source: "fallback"
    };
  }

  /**
   * Generate recommendation for local validation.
   */
  private generateLocalRecommendation(
    packages: Array<{ name: string; trustLevel: string; risks: string[] }>
  ): string {
    const maliciousPackages = packages.filter(pkg => pkg.trustLevel === "low");
    const suspiciousPackages = packages.filter(pkg => pkg.trustLevel === "medium");

    if (maliciousPackages.length > 0) {
      const names = maliciousPackages.map(pkg => pkg.name).join(", ");
      return `🚨 BLOCKED: Packages ${names} are known to be malicious. Do not install.`;
    }

    if (suspiciousPackages.length > 0) {
      const names = suspiciousPackages.map(pkg => pkg.name).join(", ");
      return `⚠️ WARNING: Packages ${names} appear suspicious. Verify manually before installation.`;
    }

    return `❓ OFFLINE MODE: Limited security analysis available. Verify packages manually at their official registries.`;
  }

  /**
   * Start health monitoring.
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.checkHealth();
    }, this.healthCheckIntervalMs);
  }

  /**
   * Stop health monitoring.
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Check server health.
   */
  private async checkHealth(): Promise<void> {
    if (!this.client || this.state !== ClientState.Running) {
      return;
    }

    try {
      // Simple health check with a minimal command
      await this.validateWithServer('echo "health check"');
    } catch (error) {
      this.outputChannel.appendLine(`Health check failed: ${(error as Error).message}`);
      this.state = ClientState.Failed;
      this.scheduleRetry();
    }
  }

  /**
   * Schedule retry with exponential backoff.
   */
  private scheduleRetry(): void {
    if (this.retryCount >= this.maxRetries) {
      this.outputChannel.appendLine('Max retries reached, giving up');
      return;
    }

    const delay = this.retryDelay * Math.pow(2, this.retryCount);
    this.retryCount++;

    this.outputChannel.appendLine(`Scheduling retry ${this.retryCount}/${this.maxRetries} in ${delay}ms`);
    
    // Clear existing retry timeout
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
    
    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.start();
    }, delay);
  }

  /**
   * Create a timeout promise.
   */
  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.stop();
    this.outputChannel.dispose();
  }
}