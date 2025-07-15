/**
 * PkgGuard LSP Server - MVP Implementation
 * Provides a single custom LSP request for package validation.
 */

import { 
  createConnection, 
  TextDocuments, 
  ProposedFeatures, 
  InitializeParams, 
  TextDocumentSyncKind, 
  InitializeResult,
  RequestType,
  Connection
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { AnalysisEngine, AnalysisResult } from '../core/AnalysisEngine.js';
import { PackageExtractor } from '../utils/PackageExtractor.js';
import * as crypto from 'node:crypto';

// Custom LSP request types
const ValidateCommandRequest = new RequestType<ValidateCommandParams, ValidateCommandResult, void>(
  'pkgguard/validateCommand'
);

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

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * PkgGuard LSP Server MVP implementation.
 */
export class PkgGuardLSPServer {
  private connection: Connection;
  private documents: TextDocuments<TextDocument>;
  private analysisEngine: AnalysisEngine;
  private authorizedTokens: Set<string> = new Set();
  private rateLimitMap: Map<string, RateLimitEntry> = new Map();
  private readonly MAX_REQUESTS_PER_MINUTE = 100;
  private readonly AUTH_TOKEN_LENGTH = 64;

  constructor() {
    // Create LSP connection
    this.connection = createConnection(ProposedFeatures.all);
    this.documents = new TextDocuments(TextDocument);
    this.analysisEngine = new AnalysisEngine();

    this.setupConnectionHandlers();
    this.setupDocumentHandlers();
  }

  /**
   * Setup LSP connection handlers.
   */
  private setupConnectionHandlers(): void {
    // Initialize request
    this.connection.onInitialize((params: InitializeParams) => {
      this.connection.console.log('PkgGuard LSP Server initializing...');
      
      // Validate authentication token
      const authToken = params.initializationOptions?.authToken;
      if (!this.validateAuthToken(authToken)) {
        this.connection.console.error('Invalid authentication token');
        throw new Error('Unauthorized: Invalid authentication token');
      }

      this.authorizedTokens.add(authToken);
      this.connection.console.log(`Client authenticated: ${params.clientInfo?.name || 'Unknown'}`);

      const result: InitializeResult = {
        capabilities: {
          textDocumentSync: TextDocumentSyncKind.None, // MVP: No document sync
          workspace: {
            workspaceFolders: {
              supported: true,
              changeNotifications: true
            }
          }
        },
        serverInfo: {
          name: 'PkgGuard LSP Server',
          version: '1.0.0-mvp'
        }
      };

      return result;
    });

    // Initialized notification
    this.connection.onInitialized(() => {
      this.connection.console.log('PkgGuard LSP Server initialized successfully');
    });

    // Custom request handler for package validation
    this.connection.onRequest(ValidateCommandRequest, async (params: ValidateCommandParams) => {
      return this.handleValidateCommand(params);
    });

    // Error handling
    this.connection.onError((error) => {
      this.connection.console.error(`LSP Server error: ${error.message}`);
    });

    // Shutdown
    this.connection.onShutdown(() => {
      this.connection.console.log('PkgGuard LSP Server shutting down...');
    });
  }

  /**
   * Setup document handlers (minimal for MVP).
   */
  private setupDocumentHandlers(): void {
    this.documents.onDidChangeContent(() => {
      // MVP: No document analysis yet
    });

    this.documents.listen(this.connection);
  }

  /**
   * Handle validate command request.
   */
  private async handleValidateCommand(params: ValidateCommandParams): Promise<ValidateCommandResult> {
    const startTime = Date.now();

    try {
      // Validate authentication
      if (!this.validateAuthToken(params.authToken)) {
        throw new Error('Invalid authentication token');
      }

      // Rate limiting
      if (!this.checkRateLimit(params.authToken)) {
        throw new Error('Rate limit exceeded (100 requests per minute)');
      }

      // Extract packages from command
      const extractionResult = PackageExtractor.extractPackages(params.command);
      
      if (!extractionResult.isInstallCommand || extractionResult.packages.length === 0) {
        return {
          isValid: true,
          packages: [],
          recommendation: "No packages to validate in this command",
          processingTime: Date.now() - startTime,
          source: "server"
        };
      }

      // Analyze packages
      const packageAnalyses = await this.analysisEngine.analyzePackages(
        extractionResult.packages.map(pkg => ({
          name: pkg.name,
          ecosystem: pkg.ecosystem
        }))
      );

      // Transform results
      const packages = packageAnalyses.map(analysis => ({
        name: analysis.packageName,
        ecosystem: analysis.ecosystem,
        score: analysis.score.score,
        trustLevel: analysis.score.level,
        risks: this.identifyRisks(analysis),
        processingTime: analysis.processingTime
      }));

      // Determine if command is valid
      const isValid = packages.every(pkg => pkg.trustLevel !== "low");
      const recommendation = this.generateRecommendation(packages, extractionResult.packageManager);

      return {
        isValid,
        packages,
        recommendation,
        processingTime: Date.now() - startTime,
        source: "server"
      };

    } catch (error) {
      this.connection.console.error(`Validation error: ${error.message}`);
      
      // Return fallback result
      return {
        isValid: false,
        packages: [],
        recommendation: `Analysis failed: ${error.message}. Please proceed with caution.`,
        processingTime: Date.now() - startTime,
        source: "fallback"
      };
    }
  }

  /**
   * Validate authentication token.
   */
  private validateAuthToken(token: string): boolean {
    if (!token || typeof token !== 'string') {
      return false;
    }

    // Basic token validation for MVP
    // In production, implement proper JWT or OAuth
    return token.length === this.AUTH_TOKEN_LENGTH && /^[a-f0-9]+$/.test(token);
  }

  /**
   * Check rate limiting for a token.
   */
  private checkRateLimit(token: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitMap.get(token);

    if (!entry) {
      // First request for this token
      this.rateLimitMap.set(token, {
        count: 1,
        resetTime: now + 60000 // 1 minute
      });
      return true;
    }

    // Check if rate limit period has reset
    if (now >= entry.resetTime) {
      entry.count = 1;
      entry.resetTime = now + 60000;
      return true;
    }

    // Check if under limit
    if (entry.count < this.MAX_REQUESTS_PER_MINUTE) {
      entry.count++;
      return true;
    }

    // Rate limit exceeded
    return false;
  }

  /**
   * Identify risks from analysis result.
   */
  private identifyRisks(analysis: AnalysisResult): string[] {
    const risks: string[] = [];

    if (analysis.score.level === "low") {
      risks.push("Low trust score");
    }

    if (analysis.score.level === "unknown") {
      risks.push("Unable to analyze package");
    }

    if (analysis.score.evidence.vulnerabilities > 0) {
      risks.push(`${analysis.score.evidence.vulnerabilities} known vulnerabilities`);
    }

    if (analysis.score.evidence.downloads < 1000) {
      risks.push("Low download count");
    }

    if (!analysis.score.evidence.exists) {
      risks.push("Package not found in registry");
    }

    if (analysis.score.deprecated) {
      risks.push("Package is deprecated");
    }

    return risks;
  }

  /**
   * Generate recommendation based on analysis results.
   */
  private generateRecommendation(
    packages: Array<{ name: string; trustLevel: string; risks: string[] }>,
    packageManager: string
  ): string {
    const highRiskPackages = packages.filter(pkg => pkg.trustLevel === "low");
    const unknownPackages = packages.filter(pkg => pkg.trustLevel === "unknown");

    if (highRiskPackages.length > 0) {
      const names = highRiskPackages.map(pkg => pkg.name).join(", ");
      return `⚠️ HIGH RISK: Packages ${names} have low trust scores. Consider using alternative packages or proceed with extreme caution.`;
    }

    if (unknownPackages.length > 0) {
      const names = unknownPackages.map(pkg => pkg.name).join(", ");
      return `❓ UNKNOWN: Unable to analyze packages ${names}. Verify manually before installation.`;
    }

    const mediumRiskPackages = packages.filter(pkg => pkg.trustLevel === "medium");
    if (mediumRiskPackages.length > 0) {
      const names = mediumRiskPackages.map(pkg => pkg.name).join(", ");
      return `⚠️ MEDIUM RISK: Packages ${names} have medium trust scores. Review before installation.`;
    }

    return `✅ All packages have high trust scores. Safe to proceed with installation.`;
  }

  /**
   * Clean up rate limit entries periodically.
   */
  private cleanupRateLimits(): void {
    const now = Date.now();
    for (const [token, entry] of this.rateLimitMap.entries()) {
      if (now >= entry.resetTime) {
        this.rateLimitMap.delete(token);
      }
    }
  }

  /**
   * Start the LSP server.
   */
  public listen(): void {
    // Clean up rate limits every minute
    setInterval(() => this.cleanupRateLimits(), 60000);

    // Start listening for messages
    this.connection.listen();
    
    this.connection.console.log('PkgGuard LSP Server started and listening...');
  }

  /**
   * Generate a secure authentication token.
   */
  static generateAuthToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}

// Create and start server if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new PkgGuardLSPServer();
  server.listen();
}

export { ValidateCommandRequest, ValidateCommandParams, ValidateCommandResult };