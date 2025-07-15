/**
 * Core analysis engine that consolidates package analysis logic.
 * Extracted from existing scoring engines and adapters for LSP server use.
 */

import { RegistryInfo, TrustScore, CacheData } from "../../types.js";
import { PyPIAdapter } from "../../adapters/pypi.js";
import { NpmAdapter } from "../../adapters/npm.js";
import { LSPConfigManager } from "../config/LSPConfig.js";
import { TyposquattingDetector } from "../utils/TyposquattingDetector.js";

export interface AnalysisResult {
  packageName: string;
  ecosystem: "python" | "javascript";
  score: TrustScore;
  processingTime: number;
}

export interface AnalysisOptions {
  useCache?: boolean;
  cacheData?: CacheData;
  cacheTTL?: number;
}

/**
 * Unified analysis engine for package security scoring.
 * Combines Python and JavaScript analysis capabilities.
 */
export class AnalysisEngine {
  private readonly pypiAdapter = new PyPIAdapter();
  private readonly npmAdapter = new NpmAdapter();
  private readonly configManager = LSPConfigManager.getInstance();
  private readonly config = this.configManager.getAnalysisConfig();
  private readonly standardLibraries = this.configManager.getStandardLibraries();
  private readonly typosquattingDetector = new TyposquattingDetector();
  private readonly topPyPiPackages = new Set<string>();
  private readonly topPyPiDownloads: { [pkg: string]: number } = {};

  constructor(_options: { cacheTTL?: number } = {}) {
    this.initializeTopPackages();
  }

  /**
   * Analyze a single package and return its trust score.
   */
  async analyzePackage(
    packageName: string,
    ecosystem: "python" | "javascript",
    options: AnalysisOptions = {}
  ): Promise<AnalysisResult> {
    const startTime = Date.now();

    try {
      // Check if it's a standard library module
      if (this.isStandardLibrary(packageName, ecosystem)) {
        return {
          packageName,
          ecosystem,
          score: this.createStandardLibraryScore(packageName, ecosystem),
          processingTime: Date.now() - startTime
        };
      }

      // Check cache first
      if (options.useCache && options.cacheData) {
        const cached = this.getCachedScore(packageName, ecosystem, options.cacheData);
        if (cached) {
          return {
            packageName,
            ecosystem,
            score: cached,
            processingTime: Date.now() - startTime
          };
        }
      }

      // Fetch registry information
      const registryInfo = await this.fetchRegistryInfo(packageName, ecosystem);
      
      // Calculate trust score
      const score = await this.calculateTrustScore(packageName, ecosystem, registryInfo);

      return {
        packageName,
        ecosystem,
        score,
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      // Return unknown score on error
      return {
        packageName,
        ecosystem,
        score: this.createUnknownScore(packageName, ecosystem, error as Error),
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Analyze multiple packages concurrently.
   */
  async analyzePackages(
    packages: Array<{ name: string; ecosystem: "python" | "javascript" }>,
    options: AnalysisOptions = {}
  ): Promise<AnalysisResult[]> {
    const analysisPromises = packages.map(pkg => 
      this.analyzePackage(pkg.name, pkg.ecosystem, options)
    );

    return Promise.all(analysisPromises);
  }

  /**
   * Check if a package is a standard library module.
   */
  private isStandardLibrary(packageName: string, ecosystem: "python" | "javascript"): boolean {
    if (ecosystem === "python") {
      return this.standardLibraries.python.has(packageName);
    } else {
      return this.standardLibraries.javascript.has(packageName) || packageName.startsWith("node:");
    }
  }

  /**
   * Get cached score if available and not expired.
   */
  private getCachedScore(
    packageName: string,
    ecosystem: "python" | "javascript",
    cacheData: CacheData
  ): TrustScore | null {
    const ecosystemCache = cacheData[ecosystem];
    if (!ecosystemCache) return null;

    const entry = ecosystemCache[packageName];
    if (!entry) return null;

    const now = Date.now();
    const isExpired = now - entry.timestamp > this.config.cacheTTL;
    
    return isExpired ? null : entry.score;
  }

  /**
   * Fetch registry information for a package.
   */
  private async fetchRegistryInfo(
    packageName: string,
    ecosystem: "python" | "javascript"
  ): Promise<RegistryInfo> {
    const adapter = ecosystem === "python" ? this.pypiAdapter : this.npmAdapter;
    
    try {
      const registryInfo = await adapter.meta(packageName);
      
      // Ensure registryUrl is always set
      if (!registryInfo.registryUrl) {
        registryInfo.registryUrl = ecosystem === "python" 
          ? `https://pypi.org/project/${packageName}/`
          : `https://www.npmjs.com/package/${packageName}`;
      }
      
      return registryInfo;
    } catch (error) {
      // Return default registry info on error
      return {
        exists: false,
        downloads: 0,
        latestRelease: 0,
        maintainerCount: 0,
        highVulnCount: 0,
        registryUrl: ecosystem === "python"
          ? `https://pypi.org/project/${packageName}/`
          : `https://www.npmjs.com/package/${packageName}`,
        deprecated: undefined,
        replacement: undefined
      };
    }
  }

  /**
   * Calculate trust score based on registry information.
   */
  private async calculateTrustScore(
    packageName: string,
    ecosystem: "python" | "javascript",
    registryInfo: RegistryInfo
  ): Promise<TrustScore> {
    const baseScore = this.calculateBaseScore(registryInfo);
    const penalties = this.calculatePenalties(packageName, registryInfo, ecosystem);
    const bonuses = this.calculateBonuses(packageName, ecosystem, registryInfo);

    const finalScore = Math.max(0, Math.min(100, baseScore + bonuses - penalties));
    
    const level = this.determineTrustLevel(finalScore, ecosystem);
    const evidence = this.buildEvidence(registryInfo);
    const scoreReasons = this.buildScoreReasons(registryInfo, bonuses, penalties);

    return {
      packageName,
      score: finalScore,
      level,
      ecosystem,
      evidence,
      scoreReasons,
      githubRepo: registryInfo.githubRepo,
      deprecated: registryInfo.deprecated,
      replacement: registryInfo.replacement
    };
  }

  /**
   * Calculate base score from registry information.
   */
  private calculateBaseScore(registryInfo: RegistryInfo): number {
    let score = 0;

    // Package existence
    if (registryInfo.exists) {
      score += this.config.scoringWeights.existence;
    }

    // Downloads (logarithmic scale)
    if (registryInfo.downloads > 0) {
      score += Math.min(this.config.scoringWeights.downloads, Math.log10(registryInfo.downloads) * 2);
    }

    // Release recency
    if (registryInfo.latestRelease) {
      const daysSinceRelease = (Date.now() - registryInfo.latestRelease) / (1000 * 60 * 60 * 24);
      if (daysSinceRelease <= 365) {
        score += this.config.scoringWeights.recency * (1 - daysSinceRelease / 365);
      }
    }

    // Multiple maintainers
    if (registryInfo.maintainerCount > 1) {
      score += this.config.scoringWeights.maintainers;
    }

    return score;
  }

  /**
   * Calculate penalties for risk factors.
   */
  private calculatePenalties(packageName: string, registryInfo: RegistryInfo, ecosystem: "python" | "javascript"): number {
    let penalties = 0;

    // High severity vulnerabilities
    penalties += registryInfo.highVulnCount * this.config.scoringWeights.vulnerabilityPenalty;

    // Advanced typosquatting detection
    const typosquattingResult = this.typosquattingDetector.analyze(packageName, ecosystem);
    if (typosquattingResult.isSuspicious) {
      penalties += this.config.scoringWeights.typosquattingPenalty * typosquattingResult.confidence;
    }

    return penalties;
  }

  /**
   * Calculate bonuses for positive factors.
   */
  private calculateBonuses(
    packageName: string,
    ecosystem: "python" | "javascript",
    registryInfo: RegistryInfo
  ): number {
    let bonuses = 0;

    // Top package bonus
    if (ecosystem === "python" && this.topPyPiPackages.has(packageName)) {
      bonuses += 10;
    }

    // GitHub repository bonus
    if (registryInfo.githubRepo) {
      bonuses += 5;
    }

    return bonuses;
  }

  /**
   * Determine trust level based on score and ecosystem.
   */
  private determineTrustLevel(score: number, ecosystem: "python" | "javascript"): "high" | "medium" | "low" {
    const thresholds = this.config.trustThresholds[ecosystem];
    
    if (score >= thresholds.high) return "high";
    if (score >= thresholds.medium) return "medium";
    return "low";
  }

  /**
   * Build evidence object for trust score.
   */
  private buildEvidence(registryInfo: RegistryInfo) {
    return {
      exists: registryInfo.exists,
      downloads: registryInfo.downloads,
      releaseAge: registryInfo.latestRelease ? Date.now() - registryInfo.latestRelease : 0,
      multipleMaintainers: registryInfo.maintainerCount > 1,
      vulnerabilities: registryInfo.highVulnCount,
      maintainerCount: registryInfo.maintainerCount,
      registryUrl: registryInfo.registryUrl,
      githubRepo: registryInfo.githubRepo
    };
  }

  /**
   * Build score reasons for UI display.
   */
  private buildScoreReasons(
    registryInfo: RegistryInfo,
    bonuses: number,
    penalties: number
  ): string[] {
    const reasons: string[] = [];

    if (registryInfo.exists) {
      reasons.push("Package exists in registry");
    }

    if (registryInfo.downloads > 1000) {
      reasons.push(`${registryInfo.downloads.toLocaleString()} downloads`);
    }

    if (registryInfo.maintainerCount > 1) {
      reasons.push(`${registryInfo.maintainerCount} maintainers`);
    }

    if (registryInfo.highVulnCount > 0) {
      reasons.push(`${registryInfo.highVulnCount} high-severity vulnerabilities`);
    }

    if (bonuses > 0) {
      reasons.push("Popular/well-maintained package");
    }

    if (penalties > 0) {
      reasons.push("Risk factors detected");
    }

    return reasons;
  }

  /**
   * Create standard library score.
   */
  private createStandardLibraryScore(
    packageName: string,
    ecosystem: "python" | "javascript"
  ): TrustScore {
    return {
      packageName,
      score: 100,
      level: "high",
      ecosystem,
      evidence: {
        exists: true,
        downloads: 0,
        releaseAge: 0,
        multipleMaintainers: true,
        vulnerabilities: 0
      },
      scoreReasons: ["Standard library module"]
    };
  }

  /**
   * Create unknown score for errors.
   */
  private createUnknownScore(
    packageName: string,
    ecosystem: "python" | "javascript",
    error: Error
  ): TrustScore {
    return {
      packageName,
      score: null,
      level: "unknown",
      ecosystem,
      evidence: {
        exists: false,
        downloads: 0,
        releaseAge: 0,
        multipleMaintainers: false,
        vulnerabilities: 0
      },
      scoreReasons: [`Analysis failed: ${error.message}`]
    };
  }


  /**
   * Initialize top packages data.
   */
  private initializeTopPackages(): void {
    // Top PyPI packages (simplified list)
    const topPyPiList = [
      "requests", "urllib3", "setuptools", "certifi", "pip", "wheel", "six",
      "python-dateutil", "pytz", "pyyaml", "click", "jinja2", "markupsafe",
      "packaging", "numpy", "charset-normalizer", "idna", "colorama", "attrs",
      "pluggy", "py", "tomli", "pyparsing", "pytest", "more-itertools",
      "importlib-metadata", "zipp", "typing-extensions", "filelock", "platformdirs",
      "distlib", "virtualenv", "cffi", "pycparser", "cryptography", "decorator",
      "wrapt", "deprecated", "pyjwt", "oauthlib", "requests-oauthlib", "urllib3",
      "botocore", "s3transfer", "boto3", "awscli", "docutils", "jmespath",
      "rsa", "pyasn1", "colorama", "pydantic", "fastapi", "starlette",
      "uvicorn", "django", "flask", "pandas", "matplotlib", "seaborn",
      "scikit-learn", "scipy", "tensorflow", "torch", "pillow", "opencv-python"
    ];

    topPyPiList.forEach(pkg => {
      this.topPyPiPackages.add(pkg);
      this.topPyPiDownloads[pkg] = 1000000; // Simplified download count
    });
  }
}