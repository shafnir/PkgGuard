/**
 * Core analysis engine that consolidates package analysis logic.
 * Extracted from existing scoring engines and adapters for LSP server use.
 */

import { RegistryInfo, TrustScore, CacheData, CacheEntry } from "../../types.js";
import { PyPIAdapter } from "../../adapters/pypi.js";
import { NpmAdapter } from "../../adapters/npm.js";
import { fetchGitHubStats } from "../../adapters/github.js";

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
  private readonly cacheTTL: number;
  private readonly topPyPiPackages = new Set<string>();
  private readonly topPyPiDownloads: { [pkg: string]: number } = {};
  private readonly pythonStdLib = new Set([
    "__future__", "__main__", "abc", "aifc", "argparse", "array", "ast",
    "asynchat", "asyncio", "asyncore", "atexit", "audioop", "base64", "bdb",
    "binascii", "binhex", "bisect", "builtins", "bz2", "cProfile", "calendar",
    "cgi", "cgitb", "chunk", "cmath", "cmd", "code", "codecs", "codeop",
    "collections", "colorsys", "compileall", "concurrent", "configparser",
    "contextlib", "contextvars", "copy", "copyreg", "crypt", "csv", "ctypes",
    "curses", "dataclasses", "datetime", "dbm", "decimal", "difflib", "dis",
    "distutils", "doctest", "email", "encodings", "ensurepip", "enum", "errno",
    "faulthandler", "fcntl", "filecmp", "fileinput", "fnmatch", "formatter",
    "fractions", "ftplib", "functools", "gc", "getopt", "getpass", "glob",
    "grp", "gzip", "hashlib", "heapq", "hmac", "html", "http", "imaplib",
    "imghdr", "imp", "importlib", "inspect", "io", "ipaddress", "itertools",
    "json", "keyword", "lib2to3", "linecache", "locale", "logging", "lzma",
    "mailbox", "mailcap", "marshal", "math", "mimetypes", "mmap", "modulefinder",
    "multiprocessing", "netrc", "nntplib", "numbers", "operator", "optparse",
    "os", "ossaudiodev", "parser", "pathlib", "pdb", "pickle", "pickletools",
    "pipes", "pkgutil", "platform", "plistlib", "poplib", "posix", "pprint",
    "profile", "pstats", "pty", "pwd", "py_compile", "pyclbr", "pydoc", "queue",
    "quopri", "random", "re", "readline", "reprlib", "resource", "rlcompleter",
    "runpy", "sched", "secrets", "select", "selectors", "shelve", "shlex",
    "shutil", "signal", "site", "smtpd", "smtplib", "sndhdr", "socket",
    "socketserver", "sqlite3", "ssl", "stat", "statistics", "string", "stringprep",
    "struct", "subprocess", "sunau", "symbol", "symtable", "sys", "sysconfig",
    "syslog", "tabnanny", "tarfile", "telnetlib", "tempfile", "termios", "test",
    "textwrap", "threading", "time", "timeit", "tkinter", "token", "tokenize",
    "trace", "traceback", "tracemalloc", "tty", "turtle", "types", "typing",
    "unicodedata", "unittest", "urllib", "uu", "uuid", "venv", "warnings",
    "wave", "weakref", "webbrowser", "winreg", "winsound", "wsgiref", "xdrlib",
    "xml", "xmlrpc", "zipapp", "zipfile", "zipimport", "zlib"
  ]);
  
  private readonly nodeBuiltins = new Set([
    "assert", "buffer", "child_process", "cluster", "console", "constants",
    "crypto", "dgram", "dns", "domain", "events", "fs", "http", "https",
    "module", "net", "os", "path", "process", "punycode", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "tty", "url", "util", "vm", "zlib"
  ]);

  constructor(options: { cacheTTL?: number } = {}) {
    this.cacheTTL = options.cacheTTL || 48 * 60 * 60 * 1000; // 48 hours
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
      return this.pythonStdLib.has(packageName);
    } else {
      return this.nodeBuiltins.has(packageName) || packageName.startsWith("node:");
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
    const isExpired = now - entry.timestamp > this.cacheTTL;
    
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
    return adapter.meta(packageName);
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
    const penalties = this.calculatePenalties(packageName, registryInfo);
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

    // Package existence (40 points)
    if (registryInfo.exists) {
      score += 40;
    }

    // Downloads (20 points, logarithmic scale)
    if (registryInfo.downloads > 0) {
      score += Math.min(20, Math.log10(registryInfo.downloads) * 2);
    }

    // Release recency (15 points)
    if (registryInfo.latestRelease) {
      const daysSinceRelease = (Date.now() - registryInfo.latestRelease) / (1000 * 60 * 60 * 24);
      if (daysSinceRelease <= 365) {
        score += 15 * (1 - daysSinceRelease / 365);
      }
    }

    // Multiple maintainers (5 points)
    if (registryInfo.maintainerCount > 1) {
      score += 5;
    }

    return score;
  }

  /**
   * Calculate penalties for risk factors.
   */
  private calculatePenalties(packageName: string, registryInfo: RegistryInfo): number {
    let penalties = 0;

    // High severity vulnerabilities
    penalties += registryInfo.highVulnCount * 10;

    // Typosquatting detection (simple check)
    if (this.isLikelyTyposquatting(packageName)) {
      penalties += 60;
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
    const thresholds = ecosystem === "python" ? { high: 80, medium: 50 } : { high: 75, medium: 45 };
    
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
   * Simple typosquatting detection.
   */
  private isLikelyTyposquatting(packageName: string): boolean {
    // Basic typosquatting patterns
    const suspiciousPatterns = [
      /^python-/,
      /^py-/,
      /^js-/,
      /^node-/,
      /-js$/,
      /-py$/,
      /\d{4,}/, // Long numbers
      /[Il0O]{2,}/, // Confusing characters
    ];

    return suspiciousPatterns.some(pattern => pattern.test(packageName));
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