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
// import { TerminalLSPBridge } from "./LSP/integration/TerminalLSPBridge";

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

  // Check required fields
  const hasRequiredFields =
    "exists" in candidate &&
    "downloads" in candidate &&
    "latestRelease" in candidate &&
    "maintainerCount" in candidate &&
    "highVulnCount" in candidate &&
    typeof candidate.exists === "boolean" &&
    typeof candidate.downloads === "number" &&
    typeof candidate.latestRelease === "number" &&
    typeof candidate.maintainerCount === "number" &&
    typeof candidate.highVulnCount === "number";

  // Check optional deprecation fields (if present, they must be strings or undefined)
  const hasValidDeprecationFields =
    (!("deprecated" in candidate) ||
      candidate.deprecated === undefined ||
      typeof candidate.deprecated === "string") &&
    (!("replacement" in candidate) ||
      candidate.replacement === undefined ||
      typeof candidate.replacement === "string");

  return hasRequiredFields && hasValidDeprecationFields;
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
    deprecated: undefined,
    replacement: undefined,
  };
}

let decorators: TrustDecorators | undefined;
let hoverProvider: TrustHoverProvider | undefined;
let diagnosticCollection: vscode.DiagnosticCollection | undefined;
let debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
let extensionEnabled: boolean = true;
let statusBarItem: vscode.StatusBarItem | undefined;
let terminalMonitor: TerminalPackageMonitor | undefined;
let outputChannel: vscode.OutputChannel | undefined;
// let lspBridge: TerminalLSPBridge | undefined;

function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [PkgGuard] ${message}`;
  
  // Log to console (visible in Developer Tools)
  if (level === 'error') {
    console.error(logMessage);
  } else if (level === 'warn') {
    console.warn(logMessage);
  } else {
    console.log(logMessage);
  }
  
  // Log to output channel
  if (outputChannel) {
    outputChannel.appendLine(`[${level.toUpperCase()}] ${message}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Create output channel for logging
  outputChannel = vscode.window.createOutputChannel("PkgGuard");
  context.subscriptions.push(outputChannel);
  
  log("Extension activation started", "info");

  log("Initializing core components...");
  if (!decorators) decorators = new TrustDecorators();
  if (!hoverProvider) hoverProvider = new TrustHoverProvider();
  if (!diagnosticCollection)
    diagnosticCollection =
      vscode.languages.createDiagnosticCollection("pkg-guard");

  // Initialize global storage
  log("Setting up global storage...");
  const globalStoragePath = context.globalStorageUri.fsPath;
  setGlobalStoragePath(globalStoragePath);

  // Migrate existing workspace data to global storage (one-time migration)
  try {
    migrateWorkspaceDataToGlobal();
    log("Data migration completed successfully");
  } catch (error) {
    log(`Data migration failed: ${(error as Error).message}`, "warn");
  }

  // Read initial enabled state
  extensionEnabled = vscode.workspace
    .getConfiguration()
    .get("pkgGuard.enabled", true);
  log(`Extension enabled state: ${extensionEnabled}`);

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
  log(`Terminal monitoring enabled: ${terminalEnabled}`);
  if (terminalEnabled) {
    log("Initializing terminal package monitor...");
    terminalMonitor = new TerminalPackageMonitor();
    terminalMonitor.activate(context);
    log("Terminal package monitor activated");
  }

  // Register simple terminal commands
  try {
    log("Registering simple terminal commands...");
    SimpleTerminalManager.registerCommands(context);
    log("Simple terminal commands registered successfully");
  } catch (error) {
    log(`Failed to register terminal commands: ${(error as Error).message}`, "error");
    vscode.window.showErrorMessage(
      `PkgGuard: Failed to register terminal commands: ${(error as Error).message}`,
    );
  }

  // Register terminal profile provider
  try {
    log("Registering terminal profile provider...");
    SimpleTerminalManager.registerTerminalProfileProvider(context);
    log("Terminal profile provider registered successfully");
  } catch (error) {
    log(`Failed to register terminal profile provider: ${(error as Error).message}`, "error");
    vscode.window.showErrorMessage(
      `PkgGuard: Failed to register terminal profile provider: ${(error as Error).message}`,
    );
  }

  // Initialize LSP bridge for enhanced terminal validation
  const lspEnabled = vscode.workspace
    .getConfiguration()
    .get("pkgGuard.lsp.enabled", true);
  log(`LSP integration enabled: ${lspEnabled}`);
  if (lspEnabled) {
    try {
      log("Initializing LSP bridge...");
      // NOTE: LSP bridge is temporarily disabled due to TypeScript compilation issues
      // but we log the attempt for diagnostic purposes
      log("LSP bridge initialization skipped (TypeScript compilation issues)", "warn");
      
      // TODO: Uncomment when TypeScript issues are resolved
      // lspBridge = new TerminalLSPBridge(context, {
      //   enabled: true,
      //   fallbackToLocal: true,
      //   showStatusIndicator: true,
      //   logLevel: 'info'
      // });
      // 
      // // Initialize LSP bridge asynchronously
      // lspBridge.initialize().catch(error => {
      //   log(`LSP bridge initialization failed: ${(error as Error).message}`, "warn");
      //   // Continue without LSP - will fall back to local validation
      // });
      // 
      // // Add LSP bridge to context subscriptions for cleanup
      // context.subscriptions.push(lspBridge);
    } catch (error) {
      log(`Failed to create LSP bridge: ${(error as Error).message}`, "warn");
      // Continue without LSP - existing terminal functionality will work
    }
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

  // Register show diagnostics command
  context.subscriptions.push(
    vscode.commands.registerCommand("pkg-guard.showDiagnostics", () => {
      const diagnostics = {
        extensionEnabled,
        version: "0.7.5",
        documentsScanned: vscode.window.visibleTextEditors.length,
        cacheEnabled: true,
        terminalEnabled: vscode.workspace.getConfiguration('pkgGuard').get('terminal.enabled', true),
        lspEnabled: vscode.workspace.getConfiguration('pkgGuard').get('lsp.enabled', true),
        securityMode: vscode.workspace.getConfiguration('pkgGuard').get('securityMode', 'interactive'),
        supportedLanguages: ['python', 'javascript', 'typescript']
      };
      
      const message = `PkgGuard Diagnostics:
• Status: ${diagnostics.extensionEnabled ? 'Enabled' : 'Disabled'}
• Version: ${diagnostics.version}
• Documents scanned: ${diagnostics.documentsScanned}
• Cache enabled: ${diagnostics.cacheEnabled}
• Terminal monitoring: ${diagnostics.terminalEnabled}
• LSP enabled: ${diagnostics.lspEnabled}
• Security mode: ${diagnostics.securityMode}
• Supported languages: ${diagnostics.supportedLanguages.join(', ')}`;
      
      vscode.window.showInformationMessage(message, { modal: true });
    }),
  );

  // Register validate current file command
  context.subscriptions.push(
    vscode.commands.registerCommand("pkg-guard.validateCurrentFile", async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode.window.showWarningMessage("PkgGuard: No active editor found.");
        return;
      }
      
      const document = activeEditor.document;
      if (!["python", "javascript", "typescript"].includes(document.languageId)) {
        vscode.window.showWarningMessage(
          `PkgGuard: Language '${document.languageId}' is not supported. Supported languages: Python, JavaScript, TypeScript.`
        );
        return;
      }
      
      vscode.window.showInformationMessage(
        `PkgGuard: Validating ${document.fileName}...`
      );
      
      // Force validation without debounce
      await validateDocument(document);
      
      vscode.window.showInformationMessage(
        `PkgGuard: Validation completed for ${path.basename(document.fileName)}.`
      );
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

      // Show a consolidated message with mode description and auto-dismiss after 3 seconds
      const messagePromise = vscode.window.showInformationMessage(
        `PkgGuard Security Mode: ${modeDescriptions[nextMode as keyof typeof modeDescriptions]} (Updated globally)`,
        "Open Settings",
      );

      // Auto-dismiss after 3 seconds by resolving with undefined
      const timeoutPromise = new Promise<string | undefined>((resolve) => {
        setTimeout(() => resolve(undefined), 3000);
      });

      void Promise.race([messagePromise, timeoutPromise]).then((selection) => {
        if (selection === "Open Settings") {
          void vscode.commands.executeCommand(
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
  
  log("Extension activation completed successfully");
  log("Commands registered, listeners attached, ready for package validation");
}

export function deactivate() {
  log("Extension deactivation started");
  
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
  
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = undefined;
  }
  
  log("Extension deactivation completed");
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
  if (!extensionEnabled) {
    log("Extension disabled, skipping validation");
    return;
  }
  
  log(`Validating document: ${doc.fileName} (${doc.languageId})`);
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
