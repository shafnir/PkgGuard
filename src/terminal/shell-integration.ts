/**
 * Terminal Shell Integration for PkgGuard
 * Uses VS Code's Shell Integration API to monitor package installation commands
 * Requires VS Code 1.88+ and shell integration enabled
 */

import * as vscode from "vscode";
// import { PythonDetector } from '../detectors/python';
// import { JavaScriptDetector } from '../detectors/javascript';
import { PyPIAdapter } from "../adapters/pypi";
import { NpmAdapter } from "../adapters/npm";
import {
  ScoringEngine,
  getCachedScore,
  setCachedScore,
  loadCacheFile,
} from "../scoring";
import { JavaScriptScoringEngine } from "../scoring/javascript";
import { TrustScore } from "../types";

export class TerminalPackageMonitor {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("PkgGuard Terminal");
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99,
    );
  }

  public activate(context: vscode.ExtensionContext): void {
    // Monitor terminal shell executions
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution(
        this.onShellExecutionStart.bind(this),
      ),
      vscode.window.onDidEndTerminalShellExecution(
        this.onShellExecutionEnd.bind(this),
      ),
    );

    this.statusBarItem.show();
  }

  private onShellExecutionStart(
    e: vscode.TerminalShellExecutionStartEvent,
  ): void {
    const command = e.execution.commandLine.value;
    const packages = this.extractPackageNames(command);

    if (packages.length === 0) return;

    // Show analyzing status
    this.statusBarItem.text = `$(loading~spin) PkgGuard: Analyzing ${packages.length} package${packages.length > 1 ? "s" : ""}...`;
    this.statusBarItem.color = "#ffb400";

    // Analyze packages asynchronously (intentionally not awaited to avoid blocking)
    void this.analyzePackagesAsync(packages, command);
  }

  private onShellExecutionEnd(): void {
    // Reset status bar after command completion
    globalThis.setTimeout(() => {
      this.statusBarItem.text = "$(shield) PkgGuard";
      this.statusBarItem.color = undefined;
    }, 2000);
  }

  /**
   * Extract package names from common installation commands
   */
  public extractPackageNames(
    command: string,
  ): Array<{ name: string; ecosystem: "python" | "javascript" }> {
    const packages: Array<{
      name: string;
      ecosystem: "python" | "javascript";
    }> = [];

    // Python package managers
    const pipPatterns = [
      /pip\s+install\s+([^\s]+)/g,
      /pip3\s+install\s+([^\s]+)/g,
      /python\s+-m\s+pip\s+install\s+([^\s]+)/g,
      /poetry\s+add\s+([^\s]+)/g,
      /pipenv\s+install\s+([^\s]+)/g,
      /conda\s+install\s+([^\s]+)/g,
    ];

    // JavaScript package managers
    const npmPatterns = [
      /npm\s+install\s+([^\s]+)/g,
      /npm\s+i\s+([^\s]+)/g,
      /yarn\s+add\s+([^\s]+)/g,
      /pnpm\s+add\s+([^\s]+)/g,
      /bun\s+add\s+([^\s]+)/g,
    ];

    // Extract Python packages
    for (const pattern of pipPatterns) {
      let match;
      while ((match = pattern.exec(command)) !== null) {
        const packageSpec = match[1];
        const packageName = this.cleanPackageName(packageSpec || "");
        if (packageName) {
          packages.push({ name: packageName, ecosystem: "python" });
        }
      }
    }

    // Extract JavaScript packages
    for (const pattern of npmPatterns) {
      let match;
      while ((match = pattern.exec(command)) !== null) {
        const packageSpec = match[1];
        const packageName = this.cleanPackageName(packageSpec || "");
        if (packageName) {
          packages.push({ name: packageName, ecosystem: "javascript" });
        }
      }
    }

    return packages;
  }

  /**
   * Clean package specification to extract just the package name
   */
  private cleanPackageName(packageSpec: string): string | null {
    // Remove version specifiers, flags, and extras
    const parts = packageSpec.split("==");
    if (parts.length === 0 || !parts[0]) return null;
    let cleaned = parts[0];

    const versionSeparators = [">=", "<=", "~="];
    for (const sep of versionSeparators) {
      const sepParts = cleaned.split(sep);
      if (sepParts.length > 0 && sepParts[0]) {
        cleaned = sepParts[0];
      }
    }

    const extraSeparators = ["[", "@"];
    for (const sep of extraSeparators) {
      const sepParts = cleaned.split(sep);
      if (sepParts.length > 0 && sepParts[0]) {
        cleaned = sepParts[0];
      }
    }

    if (!cleaned) return null;
    cleaned = cleaned.replace(/^-+/, "").trim();

    // Basic validation
    if (!cleaned || cleaned.startsWith("-") || cleaned.includes(" ")) {
      return null;
    }

    return cleaned;
  }

  /**
   * Analyze packages and display results
   */
  private async analyzePackagesAsync(
    packages: Array<{ name: string; ecosystem: "python" | "javascript" }>,
    command: string,
  ): Promise<void> {
    const results: Array<{
      package: string;
      score: TrustScore;
      ecosystem: string;
    }> = [];

    // Load cache first
    loadCacheFile();
    const ttl = 172800; // 48 hours, same as UI

    // Analyze each package
    for (const pkg of packages) {
      try {
        // Check cache first
        const cachedScore = getCachedScore(pkg.ecosystem, pkg.name, ttl);
        if (cachedScore) {
          results.push({
            package: pkg.name,
            score: cachedScore,
            ecosystem: pkg.ecosystem,
          });
          continue;
        }

        // Not cached, fetch and score
        let adapter: PyPIAdapter | NpmAdapter;
        let scoring: ScoringEngine | JavaScriptScoringEngine;

        if (pkg.ecosystem === "python") {
          adapter = new PyPIAdapter();
          scoring = new ScoringEngine();
        } else {
          adapter = new NpmAdapter();
          scoring = new JavaScriptScoringEngine();
        }

        const meta = await adapter.meta(pkg.name);
        const score = await scoring.calculateScore(pkg.name, meta);

        // Cache the result
        setCachedScore(pkg.ecosystem, pkg.name, score);

        results.push({
          package: pkg.name,
          score,
          ecosystem: pkg.ecosystem,
        });
      } catch (error) {
        globalThis.console.error(`Error analyzing package ${pkg.name}:`, error);
      }
    }

    // Display results
    this.displayResults(results, command);
  }

  /**
   * Display package analysis results in terminal and output channel
   */
  private displayResults(
    results: Array<{ package: string; score: TrustScore; ecosystem: string }>,
    command: string,
  ): void {
    if (results.length === 0) return;

    // Update status bar with overall risk
    const riskLevels = results.map((r) => r.score.level);
    const hasHigh = riskLevels.includes("low");
    const hasMedium = riskLevels.includes("medium");

    if (hasHigh) {
      this.statusBarItem.text = "$(warning) PkgGuard: High Risk Detected!";
      this.statusBarItem.color = "#ff4136";
    } else if (hasMedium) {
      this.statusBarItem.text = "$(info) PkgGuard: Medium Risk";
      this.statusBarItem.color = "#ffb400";
    } else {
      this.statusBarItem.text = "$(check) PkgGuard: All Safe";
      this.statusBarItem.color = "#2ecc40";
    }

    // Display detailed results in output channel
    this.outputChannel.appendLine(`\n🛡️ PkgGuard Analysis for: ${command}`);
    this.outputChannel.appendLine("─".repeat(60));

    for (const result of results) {
      const { package: pkg, score, ecosystem } = result;
      const emoji =
        score.level === "high"
          ? "🟢"
          : score.level === "medium"
            ? "🟡"
            : score.level === "ignored"
              ? "⚪"
              : "🔴";

      this.outputChannel.appendLine(
        `${emoji} ${pkg} (${ecosystem}): ${score.score ?? "Ignored"}`,
      );

      if (score.level === "low") {
        this.outputChannel.appendLine(
          `   ⚠️  WARNING: This package has security concerns`,
        );
        if (score.riskFactors) {
          for (const risk of score.riskFactors) {
            this.outputChannel.appendLine(`   • ${risk.text}`);
          }
        }
      }

      if (score.scoreReasons) {
        for (const reason of score.scoreReasons.slice(0, 2)) {
          // Show top 2 reasons
          this.outputChannel.appendLine(`   • ${reason}`);
        }
      }
      this.outputChannel.appendLine("");
    }

    // Show warning notification for high-risk packages
    const highRiskPackages = results.filter((r) => r.score.level === "low");
    if (highRiskPackages.length > 0) {
      const packageNames = highRiskPackages.map((r) => r.package).join(", ");
      vscode.window
        .showWarningMessage(
          `⚠️ PkgGuard: High-risk packages detected: ${packageNames}`,
          "View Details",
          "Ignore",
        )
        .then((selection) => {
          if (selection === "View Details") {
            this.outputChannel.show();
          }
        });
    }
  }

  public dispose(): void {
    this.outputChannel.dispose();
    this.statusBarItem.dispose();
  }
}
