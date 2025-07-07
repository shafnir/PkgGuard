/**
 * Main entry point for the Package Guard VS Code extension (Python MVP).
 * Watches Python files, detects imports, validates against PyPI, and decorates with trust badges.
 *
 * @copilot.generateExample usage=true
 * @copilot.avoid any=true
 */

import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { setTimeout, clearTimeout } from "node:timers";
import fetch from "node-fetch";
import { PythonDetector } from "./detectors/python";
import { PyPIAdapter } from "./adapters/pypi";
import {
  ScoringEngine,
  loadIgnoreFile,
  setGlobalStoragePath,
  migrateWorkspaceDataToGlobal,
  loadCacheFile,
  clearCacheFile,
  setCachedScore,
  removeCachedScore,
  getCachedScore,
} from "./scoring";
import { TrustDecorators } from "./ui/decorators";
import { TrustHoverProvider } from "./ui/hovers";
import {
  PackageName,
  TrustScore,
  Detector,
  RegistryAdapter,
  Scorer,
  RegistryInfo,
} from "./types";
import { JavaScriptDetector } from "./detectors/javascript";
import { NpmAdapter } from "./adapters/npm";
import { JavaScriptScoringEngine } from "./scoring/javascript";
import { TOP_NPM_PACKAGES } from "./adapters/npm-top";
import { TerminalPackageMonitor } from "./terminal/shell-integration";
import { SimpleTerminalManager } from "./terminal/simple-terminal";

interface TopPyPIResponse {
  rows: { project: string; download_count: number }[];
}

/**
 * Type guard to check if an object is a valid TopPyPIResponse
 */
function isTopPyPIResponse(obj: unknown): obj is TopPyPIResponse {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const candidate = obj as Record<string, unknown>;

  if (!("rows" in candidate) || !Array.isArray(candidate.rows)) {
    return false;
  }
  return candidate.rows.every((row: unknown) => {
    if (typeof row !== "object" || row === null) {
      return false;
    }
    const rowCandidate = row as Record<string, unknown>;
    return (
      typeof rowCandidate.project === "string" &&
      typeof rowCandidate.download_count === "number"
    );
  });
}

/**
 * Type guard to check if an object is a valid RegistryInfo
 */
function isRegistryInfo(obj: unknown): obj is RegistryInfo {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const candidate = obj as Record<string, unknown>;
  return (
    "exists" in candidate &&
    "downloads" in candidate &&
    "latestRelease" in candidate &&
    "maintainerCount" in candidate &&
    "highVulnCount" in candidate &&
    typeof candidate.exists === "boolean" &&
    typeof candidate.downloads === "number" &&
    typeof candidate.latestRelease === "number" &&
    typeof candidate.maintainerCount === "number" &&
    typeof candidate.highVulnCount === "number"
  );
}

/**
 * Creates a default RegistryInfo object for cases where metadata cannot be retrieved
 */
function createDefaultRegistryInfo(): RegistryInfo {
  return {
    exists: false,
    downloads: 0,
    latestRelease: 0,
    maintainerCount: 0,
    highVulnCount: 0,
  };
}

let decorators: TrustDecorators | undefined;
let hoverProvider: TrustHoverProvider | undefined;
let diagnosticCollection: vscode.DiagnosticCollection | undefined;
let debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
let extensionEnabled: boolean = true;
let statusBarItem: vscode.StatusBarItem | undefined;
let terminalMonitor: TerminalPackageMonitor | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Extension activation started

  if (!decorators) decorators = new TrustDecorators();
  if (!hoverProvider) hoverProvider = new TrustHoverProvider();
  if (!diagnosticCollection)
    diagnosticCollection =
      vscode.languages.createDiagnosticCollection("pkg-guard");

  // Initialize global storage
  const globalStoragePath = context.globalStorageUri.fsPath;
  setGlobalStoragePath(globalStoragePath);

  // Migrate existing workspace data to global storage (one-time migration)
  try {
    migrateWorkspaceDataToGlobal();
  } catch {
    // Migration warning - silent fallback
  }

  // Read initial enabled state
  extensionEnabled = vscode.workspace
    .getConfiguration()
    .get("pkgGuard.enabled", true);

  // Fetch and cache the top PyPI packages list
  fetch("https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json")
    .then((res) => res.json())
    .then((data: unknown) => {
      if (isTopPyPIResponse(data)) {
        ScoringEngine.setTopPackages(data.rows);
      }
    })
    .catch(() => {
      // Ignore errors fetching top packages list
    });

  // Load ignore file and cache from global storage
  loadIgnoreFile();
  loadCacheFile();

  // Handle workspace changes - reload from global storage and re-validate
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // Reload ignore file and cache from global storage
      loadIgnoreFile();
      loadCacheFile();

      // Re-validate all open editors
      vscode.window.visibleTextEditors.forEach((e) => {
        if (
          ["python", "javascript", "typescript"].includes(e.document.languageId)
        ) {
          debouncedValidate(e.document);
        }
      });
    }),
  );

  // Handle configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("pkgGuard.securityMode")) {
        // Security mode changed - notify terminal manager if needed
        // (Terminal manager will handle its own status bar updates)
      }
    }),
  );

  // Load top npm packages for JS/TS
  JavaScriptScoringEngine.setTopPackages(TOP_NPM_PACKAGES);

  // Initialize terminal monitoring if enabled
  const terminalEnabled = vscode.workspace
    .getConfiguration()
    .get("pkgGuard.terminal.enabled", true);
  if (terminalEnabled) {
    terminalMonitor = new TerminalPackageMonitor();
    terminalMonitor.activate(context);
  }

  // Register simple terminal commands
  try {
    SimpleTerminalManager.registerCommands(context);
    // Simple terminal commands registered successfully
  } catch (error) {
    vscode.window.showErrorMessage(
      `PkgGuard: Failed to register terminal commands: ${(error as Error).message}`,
    );
  }

  // Register terminal profile provider
  try {
    SimpleTerminalManager.registerTerminalProfileProvider(context);
    // Terminal profile provider registered successfully
  } catch (error) {
    vscode.window.showErrorMessage(
      `PkgGuard: Failed to register terminal profile provider: ${(error as Error).message}`,
    );
  }

  // Register hover provider for Python and JavaScript/TypeScript
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      ["python", "javascript", "typescript"],
      hoverProvider,
    ),
  );

  // Listen to document open/change events for Python and JS/TS
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (["python", "javascript", "typescript"].includes(doc.languageId)) {
        debouncedValidate(doc);
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (
        ["python", "javascript", "typescript"].includes(e.document.languageId)
      ) {
        debouncedValidate(e.document);
      }
    }),
  );

  // Validate all open Python/JS/TS files on activation
  vscode.workspace.textDocuments.forEach((doc) => {
    if (["python", "javascript", "typescript"].includes(doc.languageId)) {
      debouncedValidate(doc);
    }
  });

  // Register ignore/unignore commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pkgguard.ignorePackage",
      async (packageNameArg?: string) => {
        if (!packageNameArg) {
          vscode.window.showErrorMessage(
            "PkgGuard: Could not determine package to ignore. Please use the hover UI.",
          );
          return;
        }
        const packageName = packageNameArg;
        const note = await vscode.window.showInputBox({
          prompt: "Optional: Add a note for why you are ignoring this package.",
        });
        // Always use global storage
        const storagePath = context.globalStorageUri.fsPath;
        const guardDir = path.join(storagePath, ".pkgguard");
        if (!fs.existsSync(guardDir))
          fs.mkdirSync(guardDir, { recursive: true });
        const ignorePath = path.join(guardDir, ".pkgguard-ignore");
        let line = packageName;
        if (note && note.trim()) line += " # " + note.trim();
        fs.appendFileSync(ignorePath, `\n${line}`);
        loadIgnoreFile();

        // Update cache to store 'ignored' TrustScore
        setCachedScore("python", packageName, {
          packageName,
          score: null,
          level: "ignored",
          evidence: {
            exists: true,
            downloads: 0,
            releaseAge: 0,
            multipleMaintainers: true,
            vulnerabilities: 0,
            maintainerCount: 0,
          },
          scoreReasons: [
            "⚪ This package is ignored by your configuration." +
              (note ? ` Note: ${note}` : ""),
          ],
          riskFactors: [],
        });
        setCachedScore("javascript", packageName, {
          packageName,
          score: null,
          level: "ignored",
          evidence: {
            exists: true,
            downloads: 0,
            releaseAge: 0,
            multipleMaintainers: true,
            vulnerabilities: 0,
            maintainerCount: 0,
          },
          scoreReasons: [
            "⚪ This package is ignored by your configuration." +
              (note ? ` Note: ${note}` : ""),
          ],
          riskFactors: [],
        });

        // Refresh decorations for all supported languages
        vscode.window.visibleTextEditors.forEach((e) => {
          if (
            ["python", "javascript", "typescript"].includes(
              e.document.languageId,
            )
          )
            debouncedValidate(e.document);
        });
        vscode.window.showInformationMessage(
          `PkgGuard: Package '${packageName}' is now ignored globally.`,
        );
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pkgguard.unignorePackage",
      (packageNameArg?: string) => {
        if (!packageNameArg) {
          vscode.window.showErrorMessage(
            "PkgGuard: Could not determine package to unignore. Please use the hover UI.",
          );
          return;
        }
        const packageName = packageNameArg;
        // Always use global storage
        const storagePath = context.globalStorageUri.fsPath;
        const guardDir = path.join(storagePath, ".pkgguard");
        if (!fs.existsSync(guardDir))
          fs.mkdirSync(guardDir, { recursive: true });
        const ignorePath = path.join(guardDir, ".pkgguard-ignore");

        if (fs.existsSync(ignorePath)) {
          const lines = fs.readFileSync(ignorePath, "utf-8").split(/\r?\n/);
          const filtered = lines.filter(
            (line: string) => !line.trim().startsWith(packageName),
          );
          fs.writeFileSync(ignorePath, filtered.join("\n"));
          loadIgnoreFile();

          // Remove cache entry for this package
          removeCachedScore("python", packageName);
          removeCachedScore("javascript", packageName);

          // Refresh decorations for all supported languages
          vscode.window.visibleTextEditors.forEach((e) => {
            if (
              ["python", "javascript", "typescript"].includes(
                e.document.languageId,
              )
            )
              debouncedValidate(e.document);
          });
          vscode.window.showInformationMessage(
            `PkgGuard: Package '${packageName}' is no longer ignored globally.`,
          );
        }
      },
    ),
  );

  // Register clear cache command
  context.subscriptions.push(
    vscode.commands.registerCommand("pkg-guard.clearCache", () => {
      // Always use global storage
      clearCacheFile();
      loadCacheFile();

      // Refresh all open editors
      vscode.window.visibleTextEditors.forEach((e) => {
        if (
          ["python", "javascript", "typescript"].includes(e.document.languageId)
        )
          debouncedValidate(e.document);
      });
      vscode.window.showInformationMessage(
        "PkgGuard: Global cache cleared. All trust scores will be recalculated.",
      );
    }),
  );

  // Register open cache file command
  context.subscriptions.push(
    vscode.commands.registerCommand("pkg-guard.openCacheFile", async () => {
      // Always use global storage
      const globalStoragePath = context.globalStorageUri.fsPath;
      const cacheFilePath = path.join(
        globalStoragePath,
        ".pkgguard",
        ".pkgguard-cache.json",
      );

      if (fs.existsSync(cacheFilePath)) {
        const doc = await vscode.workspace.openTextDocument(cacheFilePath);
        await vscode.window.showTextDocument(doc, { preview: false });
      } else {
        vscode.window.showWarningMessage(
          "PkgGuard: Global cache file does not exist.",
        );
      }
    }),
  );

  // Status bar toggle button
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = "pkg-guard.toggleEnabled";
  function updateStatusBar() {
    if (!statusBarItem) return;
    if (extensionEnabled) {
      statusBarItem.text = "$(shield) PkgGuard: On";
      statusBarItem.color = "#2ecc40"; // green
      statusBarItem.tooltip = "PkgGuard is enabled. Click to disable.";
    } else {
      statusBarItem.text = "$(shield) PkgGuard: Off";
      statusBarItem.color = "#888888"; // gray
      statusBarItem.tooltip = "PkgGuard is disabled. Click to enable.";
    }
    statusBarItem.show();
  }
  updateStatusBar();
  context.subscriptions.push(statusBarItem);

  // Update status bar on toggle
  context.subscriptions.push(
    vscode.commands.registerCommand("pkg-guard.toggleEnabled", async () => {
      const config = vscode.workspace.getConfiguration();
      const current = config.get("pkgGuard.enabled", true);
      // Always use global configuration to avoid polluting workspace
      const target = vscode.ConfigurationTarget.Global;
      await config.update("pkgGuard.enabled", !current, target);
      extensionEnabled = !current;
      updateStatusBar();
      if (!extensionEnabled) {
        // Clear all decorations and diagnostics
        vscode.window.visibleTextEditors.forEach((editor) => {
          if (decorators) decorators.clearDecorations(editor);
        });
        if (diagnosticCollection) diagnosticCollection.clear();
        vscode.window.showInformationMessage(
          "PkgGuard: Extension disabled. All trust badges and diagnostics are hidden.",
        );
      } else {
        // Re-validate all open editors
        vscode.window.visibleTextEditors.forEach((e) => {
          if (
            ["python", "javascript", "typescript"].includes(
              e.document.languageId,
            )
          )
            debouncedValidate(e.document);
        });
        vscode.window.showInformationMessage(
          "PkgGuard: Extension enabled. Trust badges and diagnostics are active.",
        );
      }
      // Always use global settings now
      vscode.window.showInformationMessage(
        "PkgGuard: Setting updated globally.",
      );
    }),
  );

  // Register toggle security mode command
  context.subscriptions.push(
    vscode.commands.registerCommand("pkgguard.toggleSecurityMode", async () => {
      const config = vscode.workspace.getConfiguration();
      const currentMode = config.get("pkgGuard.securityMode", "interactive");

      // Cycle through security modes: interactive -> monitor -> block -> disabled -> interactive
      const modes = ["interactive", "monitor", "block", "disabled"];
      const currentIndex = modes.indexOf(currentMode as string);
      const nextIndex = (currentIndex + 1) % modes.length;
      const nextMode = modes[nextIndex];

      // Always use global configuration to avoid polluting workspace
      const target = vscode.ConfigurationTarget.Global;

      await config.update("pkgGuard.securityMode", nextMode, target);

      // Show user-friendly descriptions
      const modeDescriptions = {
        interactive: "Interactive - Ask for approval on risky packages",
        monitor: "Monitor - Show warnings but allow installation",
        block: "Block - Automatically block risky packages",
        disabled: "Disabled - No security checks",
      };

      // Show a consolidated message with mode description
      vscode.window
        .showInformationMessage(
          `PkgGuard Security Mode: ${modeDescriptions[nextMode as keyof typeof modeDescriptions]} (Updated globally)`,
          "Open Settings",
        )
        .then((selection) => {
          if (selection === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "pkgGuard.securityMode",
            );
          }
        });

      // Mode change completed
    }),
  );

  context.subscriptions.push(diagnosticCollection);

  // Reapply decorations on window focus
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) {
        const editor = vscode.window.activeTextEditor;
        if (
          editor &&
          ["python", "javascript", "typescript"].includes(
            editor.document.languageId,
          )
        ) {
          debouncedValidate(editor.document);
        }
      }
    }),
  );
  // Reapply decorations on active editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (
        editor &&
        ["python", "javascript", "typescript"].includes(
          editor.document.languageId,
        )
      ) {
        debouncedValidate(editor.document);
      }
    }),
  );
}

export function deactivate() {
  // Clean up decorations
  if (decorators) {
    vscode.window.visibleTextEditors.forEach((editor) => {
      if (decorators) decorators.clearDecorations(editor);
    });
    decorators.dispose();
  }
  if (diagnosticCollection) {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
  }
  if (terminalMonitor) {
    terminalMonitor.dispose();
  }
  hoverProvider = undefined;
  decorators = undefined;
  diagnosticCollection = undefined;
  terminalMonitor = undefined;
}

/**
 * Helper to retry a promise-returning function with exponential backoff.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  initialDelay = 500,
): Promise<T> {
  let attempt = 0;
  let delay = initialDelay;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts) throw err;
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
    }
  }
}

/**
 * Detect, validate, score, and decorate imports in a Python document.
 */
async function validateAndDecorate(doc: vscode.TextDocument) {
  if (!extensionEnabled) return;
  // Always load cache from global storage before scoring
  loadCacheFile();
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document === doc,
  );
  if (!editor || !decorators || !hoverProvider || !diagnosticCollection) {
    if (diagnosticCollection) diagnosticCollection.set(doc.uri, []);
    return;
  }
  let detector: Detector;
  let adapter: RegistryAdapter;
  let scoring: Scorer;
  let language: string;
  if (doc.languageId === "python") {
    detector = new PythonDetector();
    adapter = new PyPIAdapter();
    scoring = new ScoringEngine();
    language = "python";
  } else if (
    doc.languageId === "javascript" ||
    doc.languageId === "typescript"
  ) {
    detector = new JavaScriptDetector();
    adapter = new NpmAdapter();
    scoring = new JavaScriptScoringEngine();
    language = "javascript";
  } else {
    return;
  }
  // Detect package names
  const packages: PackageName[] = detector.detect(doc.getText());
  if (packages.length === 0) {
    if (decorators) decorators.clearDecorations(editor);
    if (diagnosticCollection) diagnosticCollection.set(doc.uri, []);
    return;
  }
  // Per-package state
  const results: Array<{ score: TrustScore; range: vscode.Range }> = [];
  const trustScores: TrustScore[] = [];
  const diagnostics: vscode.Diagnostic[] = [];
  const rangeMap: Map<string, vscode.Range> = new Map();
  // Helper to update UI for a single package
  function updateUIForPackage(
    pkgName: string,
    score: TrustScore,
    range: vscode.Range,
  ) {
    results.push({ score, range });
    trustScores.push(score);
    if (decorators && editor) decorators.applyDecorations(editor, results);
    if (hoverProvider) hoverProvider.updateScores(trustScores);
    if (score.level === "low") {
      diagnostics.push(
        new vscode.Diagnostic(
          range,
          `Low trust score for package "${pkgName}": ${score.score}. Consider reviewing this package.`,
          vscode.DiagnosticSeverity.Warning,
        ),
      );
    } else if (score.level === "ignored") {
      // No diagnostic for ignored
    } else if (score.level !== "high" && !score.evidence.exists) {
      diagnostics.push(
        new vscode.Diagnostic(
          range,
          `Package "${pkgName}" does not exist on registry (or could not be validated after retries).`,
          vscode.DiagnosticSeverity.Warning,
        ),
      );
    }
    if (diagnosticCollection) diagnosticCollection.set(doc.uri, diagnostics);
  }
  // For each package, check cache and update UI immediately if cached
  const pendingAsync: Array<Promise<void>> = [];
  const ttl = 172800; // 48h, or get from config if needed
  for (const pkg of packages) {
    let range: vscode.Range;
    if (doc && doc.lineCount >= pkg.line) {
      const lineText = doc.lineAt(pkg.line - 1).text;
      range = new vscode.Range(
        new vscode.Position(pkg.line - 1, lineText.length),
        new vscode.Position(pkg.line - 1, lineText.length),
      );
    } else {
      range = new vscode.Range(
        new vscode.Position(pkg.line - 1, pkg.column - 1),
        new vscode.Position(pkg.line - 1, pkg.column - 1 + pkg.name.length),
      );
    }
    rangeMap.set(pkg.name, range);
    // Try cache directly
    const cachedScore = getCachedScore(language, pkg.name, ttl);
    if (cachedScore) {
      updateUIForPackage(pkg.name, cachedScore, range);
    } else {
      // Not cached or expired, fetch meta and score async
      const asyncTask = (async () => {
        let meta: RegistryInfo;
        let score: TrustScore;
        try {
          const rawMeta = await retryWithBackoff(() => adapter.meta(pkg.name));
          if (isRegistryInfo(rawMeta)) {
            meta = rawMeta;
          } else {
            meta = createDefaultRegistryInfo();
          }
          // Ensure registryUrl is always set
          if (!meta.registryUrl) {
            if (language === "python") {
              meta.registryUrl = `https://pypi.org/project/${pkg.name}/`;
            } else if (language === "javascript") {
              meta.registryUrl = `https://www.npmjs.com/package/${pkg.name}`;
            }
          }
          score = await scoring.calculateScore(pkg.name, meta);
        } catch {
          // Create unknown trust score for failed requests
          score = {
            packageName: pkg.name,
            score: null,
            level: "unknown",
            ecosystem: language as "python" | "javascript",
            evidence: {
              exists: false,
              downloads: 0,
              releaseAge: 0,
              multipleMaintainers: false,
              vulnerabilities: 0,
              registryUrl:
                language === "python"
                  ? `https://pypi.org/project/${pkg.name}/`
                  : `https://www.npmjs.com/package/${pkg.name}`,
            },
            scoreReasons: [
              "❓ Unable to verify package - network or registry issue",
            ],
            riskFactors: [
              {
                text: "Package scoring failed. Please check your internet connection and try again.",
                color: "orange",
              },
            ],
          };
        }
        updateUIForPackage(pkg.name, score, range);
      })();
      pendingAsync.push(asyncTask);
    }
  }
  await Promise.all(pendingAsync);
}

function debouncedValidate(doc: vscode.TextDocument) {
  if (!extensionEnabled) return;
  if (!debounceTimers) return;
  const key = doc.uri.toString();
  const timer = debounceTimers.get(key);
  if (timer) {
    clearTimeout(timer);
  }
  debounceTimers.set(
    key,
    setTimeout(() => {
      validateAndDecorate(doc).catch(() => {});
      debounceTimers.delete(key);
    }, 200),
  ); // 1 second debounce
}
