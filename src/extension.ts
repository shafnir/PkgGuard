/**
 * Main entry point for the Package Guard VS Code extension (Python MVP).
 * Watches Python files, detects imports, validates against PyPI, and decorates with trust badges.
 * 
 * @copilot.generateExample usage=true
 * @copilot.avoid any=true
 */

import * as vscode from 'vscode';
import { PythonDetector } from './detectors/python';
import { PyPIAdapter } from './adapters/pypi';
import { ScoringEngine, loadIgnoreFile } from './scoring';
import { TrustDecorators } from './ui/decorators';
import { TrustHoverProvider } from './ui/hovers';
import { PackageName, TrustScore } from './types';
import { JavaScriptDetector } from './detectors/javascript';
import { NpmAdapter } from './adapters/npm';
import { JavaScriptScoringEngine } from './scoring/javascript';
import { TOP_NPM_PACKAGES } from './adapters/npm-top';
import { TerminalPackageMonitor } from './terminal/shell-integration';
import { SimpleTerminalManager } from './terminal/simple-terminal';

let decorators: TrustDecorators | undefined;
let hoverProvider: TrustHoverProvider | undefined;
let diagnosticCollection: vscode.DiagnosticCollection | undefined;
let debounceTimers: Map<string, NodeJS.Timeout> = new Map();
let extensionEnabled: boolean = true;
let statusBarItem: vscode.StatusBarItem | undefined;
let terminalMonitor: TerminalPackageMonitor | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('PkgGuard: Extension activation started');
    
    if (!decorators) decorators = new TrustDecorators();
    if (!hoverProvider) hoverProvider = new TrustHoverProvider();
    if (!diagnosticCollection) diagnosticCollection = vscode.languages.createDiagnosticCollection('pkg-guard');

    // Initialize global storage
    const globalStoragePath = context.globalStorageUri.fsPath;
    require('./scoring').setGlobalStoragePath(globalStoragePath);

    // Read initial enabled state
    extensionEnabled = vscode.workspace.getConfiguration().get('pkgGuard.enabled', true);

    // Fetch and cache the top PyPI packages list
    fetch('https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json')
        .then(res => res.json())
        .then((data: any) => {
            if (Array.isArray(data.rows)) {
                ScoringEngine.setTopPackages(data.rows);
            }
        })
        .catch(() => { });

    // Load .pkgguard-ignore file and cache
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
        const fsPath = workspaceFolders[0].uri.fsPath;
        loadIgnoreFile(fsPath);
        require('./scoring').loadCacheFile(fsPath);
    } else {
        // Use global storage when no workspace
        loadIgnoreFile(globalStoragePath);
        require('./scoring').loadCacheFile(globalStoragePath);
    }

    // Handle workspace changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
                const fsPath = workspaceFolders[0].uri.fsPath;
                loadIgnoreFile(fsPath);
                require('./scoring').loadCacheFile(fsPath);
            } else {
                // Use global storage when no workspace
                loadIgnoreFile(globalStoragePath);
                require('./scoring').loadCacheFile(globalStoragePath);
            }
            // Re-validate all open editors
            vscode.window.visibleTextEditors.forEach(e => {
                if (['python', 'javascript', 'typescript'].includes(e.document.languageId)) {
                    debouncedValidate(e.document);
                }
            });
        })
    );

    // Load top npm packages for JS/TS
    JavaScriptScoringEngine.setTopPackages(TOP_NPM_PACKAGES);

    // Initialize terminal monitoring if enabled
    const terminalEnabled = vscode.workspace.getConfiguration().get('pkgGuard.terminal.enabled', true);
    if (terminalEnabled) {
        terminalMonitor = new TerminalPackageMonitor();
        terminalMonitor.activate(context);
    }

    // Register simple terminal commands
    console.log('PkgGuard: Registering simple terminal commands');
    try {
        SimpleTerminalManager.registerCommands(context);
        console.log('PkgGuard: Simple terminal commands registered successfully');
    } catch (error) {
        console.error('PkgGuard: Failed to register simple terminal commands:', error);
        vscode.window.showErrorMessage(`PkgGuard: Failed to register terminal commands: ${(error as Error).message}`);
    }

    // Register hover provider for Python and JavaScript/TypeScript
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(['python', 'javascript', 'typescript'], hoverProvider)
    );

    // Listen to document open/change events for Python and JS/TS
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (['python', 'javascript', 'typescript'].includes(doc.languageId)) {
                debouncedValidate(doc);
            }
        })
    );
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (['python', 'javascript', 'typescript'].includes(e.document.languageId)) {
                debouncedValidate(e.document);
            }
        })
    );

    // Validate all open Python/JS/TS files on activation
    vscode.workspace.textDocuments.forEach(doc => {
        if (['python', 'javascript', 'typescript'].includes(doc.languageId)) {
            debouncedValidate(doc);
        }
    });

    // Register ignore/unignore commands
    context.subscriptions.push(vscode.commands.registerCommand('pkgguard.ignorePackage', async (packageNameArg?: string) => {
        if (!packageNameArg) {
            vscode.window.showErrorMessage('PkgGuard: Could not determine package to ignore. Please use the hover UI.');
            return;
        }
        const packageName = packageNameArg;
        const note = await vscode.window.showInputBox({ prompt: 'Optional: Add a note for why you are ignoring this package.' });
        const pathLib = require('path');
        const fsLib = require('fs');
        let ignorePath;
        let storagePath;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
            storagePath = workspaceFolders[0].uri.fsPath;
        } else {
            storagePath = context.globalStorageUri.fsPath;
        }
        const guardDir = pathLib.join(storagePath, '.pkgguard');
        if (!fsLib.existsSync(guardDir)) fsLib.mkdirSync(guardDir, { recursive: true });
        ignorePath = pathLib.join(guardDir, '.pkgguard-ignore');
        let line = packageName;
        if (note && note.trim()) line += ' # ' + note.trim();
        fsLib.appendFileSync(ignorePath, `\n${line}`);
        loadIgnoreFile(storagePath);
        // Update cache to store 'ignored' TrustScore
        const { setCachedScore } = require('./scoring');
        setCachedScore('python', packageName, {
            packageName,
            score: null,
            level: 'ignored',
            evidence: { exists: true, downloads: 0, releaseAge: 0, multipleMaintainers: true, vulnerabilities: 0, maintainerCount: 0 },
            scoreReasons: ['⚪ This package is ignored by your configuration.' + (note ? ` Note: ${note}` : '')],
            riskFactors: []
        });
        setCachedScore('javascript', packageName, {
            packageName,
            score: null,
            level: 'ignored',
            evidence: { exists: true, downloads: 0, releaseAge: 0, multipleMaintainers: true, vulnerabilities: 0, maintainerCount: 0 },
            scoreReasons: ['⚪ This package is ignored by your configuration.' + (note ? ` Note: ${note}` : '')],
            riskFactors: []
        });
        // Refresh decorations for all supported languages
        vscode.window.visibleTextEditors.forEach(e => {
            if (["python", "javascript", "typescript"].includes(e.document.languageId)) debouncedValidate(e.document);
        });
        vscode.window.showInformationMessage(`PkgGuard: Package '${packageName}' is now ignored.`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('pkgguard.unignorePackage', async (packageNameArg?: string) => {
        if (!packageNameArg) {
            vscode.window.showErrorMessage('PkgGuard: Could not determine package to unignore. Please use the hover UI.');
            return;
        }
        const packageName = packageNameArg;
        const pathLib = require('path');
        const fsLib = require('fs');
        let ignorePath;
        let storagePath;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
            storagePath = workspaceFolders[0].uri.fsPath;
        } else {
            storagePath = context.globalStorageUri.fsPath;
        }
        const guardDir = pathLib.join(storagePath, '.pkgguard');
        if (!fsLib.existsSync(guardDir)) fsLib.mkdirSync(guardDir, { recursive: true });
        ignorePath = pathLib.join(guardDir, '.pkgguard-ignore');
        if (fsLib.existsSync(ignorePath)) {
            const lines = fsLib.readFileSync(ignorePath, 'utf-8').split(/\r?\n/);
            const filtered = lines.filter((line: string) => !line.trim().startsWith(packageName));
            fsLib.writeFileSync(ignorePath, filtered.join('\n'));
            loadIgnoreFile(storagePath);
            // Remove cache entry for this package
            const { removeCachedScore } = require('./scoring');
            removeCachedScore('python', packageName);
            removeCachedScore('javascript', packageName);
            // Refresh decorations for all supported languages
            vscode.window.visibleTextEditors.forEach(e => {
                if (["python", "javascript", "typescript"].includes(e.document.languageId)) debouncedValidate(e.document);
            });
            vscode.window.showInformationMessage(`PkgGuard: Package '${packageName}' is no longer ignored.`);
        }
    }));

    // Register clear cache command
    context.subscriptions.push(vscode.commands.registerCommand('pkg-guard.clearCache', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
            const fsPath = workspaceFolders[0].uri.fsPath;
            require('./scoring').clearCacheFile(fsPath);
            require('./scoring').loadCacheFile(fsPath);
        } else {
            // Use global storage when no workspace
            const globalStoragePath = context.globalStorageUri.fsPath;
            require('./scoring').clearCacheFile(globalStoragePath);
            require('./scoring').loadCacheFile(globalStoragePath);
        }
        // Refresh all open editors
        vscode.window.visibleTextEditors.forEach(e => {
            if (["python", "javascript", "typescript"].includes(e.document.languageId)) debouncedValidate(e.document);
        });
        vscode.window.showInformationMessage('PkgGuard: Cache cleared. All trust scores will be recalculated.');
    }));

    // Register open cache file command
    context.subscriptions.push(vscode.commands.registerCommand('pkg-guard.openCacheFile', async () => {
        const pathLib = require('path');
        const fsLib = require('fs');
        let cacheFilePath;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
            const fsPath = workspaceFolders[0].uri.fsPath;
            cacheFilePath = pathLib.join(fsPath, '.pkgguard', '.pkgguard-cache.json');
        } else {
            const globalStoragePath = context.globalStorageUri.fsPath;
            cacheFilePath = pathLib.join(globalStoragePath, '.pkgguard', '.pkgguard-cache.json');
        }
        if (fsLib.existsSync(cacheFilePath)) {
            const doc = await vscode.workspace.openTextDocument(cacheFilePath);
            await vscode.window.showTextDocument(doc, { preview: false });
        } else {
            vscode.window.showWarningMessage('PkgGuard: Cache file does not exist.');
        }
    }));

    // Status bar toggle button
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'pkg-guard.toggleEnabled';
    function updateStatusBar() {
        if (!statusBarItem) return;
        if (extensionEnabled) {
            statusBarItem!.text = '$(shield) PkgGuard: On';
            statusBarItem!.color = '#2ecc40'; // green
            statusBarItem!.tooltip = 'PkgGuard is enabled. Click to disable.';
        } else {
            statusBarItem!.text = '$(shield) PkgGuard: Off';
            statusBarItem!.color = '#888888'; // gray
            statusBarItem!.tooltip = 'PkgGuard is disabled. Click to enable.';
        }
        statusBarItem!.show();
    }
    updateStatusBar();
    context.subscriptions.push(statusBarItem);

    // Update status bar on toggle
    context.subscriptions.push(vscode.commands.registerCommand('pkg-guard.toggleEnabled', async () => {
        const config = vscode.workspace.getConfiguration();
        const current = config.get('pkgGuard.enabled', true);
        const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
        const target = hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        await config.update('pkgGuard.enabled', !current, target);
        extensionEnabled = !current;
        updateStatusBar();
        if (!extensionEnabled) {
            // Clear all decorations and diagnostics
            vscode.window.visibleTextEditors.forEach(editor => {
                if (decorators) decorators.clearDecorations(editor);
            });
            if (diagnosticCollection) diagnosticCollection.clear();
            vscode.window.showInformationMessage('PkgGuard: Extension disabled. All trust badges and diagnostics are hidden.');
        } else {
            // Re-validate all open editors
            vscode.window.visibleTextEditors.forEach(e => {
                if (["python", "javascript", "typescript"].includes(e.document.languageId)) debouncedValidate(e.document);
            });
            vscode.window.showInformationMessage('PkgGuard: Extension enabled. Trust badges and diagnostics are active.');
        }
        if (!hasWorkspace) {
            vscode.window.showInformationMessage('PkgGuard: Setting updated for User (no workspace open).');
        }
    }));

    context.subscriptions.push(diagnosticCollection);

    // Reapply decorations on window focus
    context.subscriptions.push(vscode.window.onDidChangeWindowState(e => {
        if (e.focused) {
            const editor = vscode.window.activeTextEditor;
            if (editor && ['python', 'javascript', 'typescript'].includes(editor.document.languageId)) {
                debouncedValidate(editor.document);
            }
        }
    }));
    // Reapply decorations on active editor change
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && ['python', 'javascript', 'typescript'].includes(editor.document.languageId)) {
            debouncedValidate(editor.document);
        }
    }));
}

export function deactivate() {
    // Clean up decorations
    if (decorators) {
        vscode.window.visibleTextEditors.forEach(editor => {
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
async function retryWithBackoff<T>(fn: () => Promise<T>, maxAttempts = 3, initialDelay = 500): Promise<T> {
    let attempt = 0;
    let delay = initialDelay;
    while (true) {
        try {
            return await fn();
        } catch (err) {
            attempt++;
            if (attempt >= maxAttempts) throw err;
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }
}

/**
 * Helper to run async tasks with concurrency limit.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: T[] = [];
    let i = 0;
    const runNext = async (): Promise<void> => {
        if (i >= tasks.length) return;
        const idx = i++;
        const task = tasks[idx];
        if (typeof task === 'function') {
            try {
                results[idx] = await task();
            } catch (e) {
                results[idx] = undefined as any;
            }
            await runNext();
        }
    };
    const runners = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
    await Promise.all(runners);
    return results;
}

/**
 * Detect, validate, score, and decorate imports in a Python document.
 */
async function validateAndDecorate(doc: vscode.TextDocument) {
    if (!extensionEnabled) return;
    // Always load cache before scoring
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
        const fsPath = workspaceFolders[0].uri.fsPath;
        require('./scoring').loadCacheFile(fsPath);
    } else {
        // Use global storage when no workspace
        const globalStoragePath = (vscode.extensions.getExtension('shafnir.pkgguard')?.exports?.globalStoragePath) || (globalThis as any).globalStoragePath;
        // fallback: try to get from activate context if available
        if (globalStoragePath) {
            require('./scoring').loadCacheFile(globalStoragePath);
        } else if ((globalThis as any).pkgguardGlobalStoragePath) {
            require('./scoring').loadCacheFile((globalThis as any).pkgguardGlobalStoragePath);
        }
    }
    const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
    if (!editor || !decorators || !hoverProvider || !diagnosticCollection) {
        if (diagnosticCollection) diagnosticCollection.set(doc.uri, []);
        return;
    }
    let detector: any;
    let adapter: any;
    let scoring: any;
    let language: string;
    if (doc.languageId === 'python') {
        detector = new PythonDetector();
        adapter = new PyPIAdapter();
        scoring = new ScoringEngine();
        language = 'python';
    } else if (doc.languageId === 'javascript' || doc.languageId === 'typescript') {
        detector = new JavaScriptDetector();
        adapter = new NpmAdapter();
        scoring = new JavaScriptScoringEngine();
        language = 'javascript';
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
    function updateUIForPackage(pkgName: string, score: TrustScore, range: vscode.Range) {
        results.push({ score, range });
        trustScores.push(score);
        if (decorators && editor) decorators.applyDecorations(editor, results);
        if (hoverProvider) hoverProvider.updateScores(trustScores);
        if (score.level === 'low') {
            diagnostics.push(new vscode.Diagnostic(
                range,
                `Low trust score for package "${pkgName}": ${score.score}. Consider reviewing this package.`,
                vscode.DiagnosticSeverity.Warning
            ));
        } else if (score.level === 'ignored') {
            // No diagnostic for ignored
        } else if (score.level !== 'high' && !score.evidence.exists) {
            diagnostics.push(new vscode.Diagnostic(
                range,
                `Package "${pkgName}" does not exist on registry (or could not be validated after retries).`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
        if (diagnosticCollection) diagnosticCollection.set(doc.uri, diagnostics);
    }
    // For each package, check cache and update UI immediately if cached
    const pendingAsync: Array<Promise<void>> = [];
    const { getCachedScore } = require('./scoring');
    const ttl = 172800; // 48h, or get from config if needed
    for (const pkg of packages) {
        let range: vscode.Range;
        if (doc && doc.lineCount >= pkg.line) {
            const lineText = doc.lineAt(pkg.line - 1).text;
            range = new vscode.Range(
                new vscode.Position(pkg.line - 1, lineText.length),
                new vscode.Position(pkg.line - 1, lineText.length)
            );
        } else {
            range = new vscode.Range(
                new vscode.Position(pkg.line - 1, pkg.column - 1),
                new vscode.Position(pkg.line - 1, pkg.column - 1 + pkg.name.length)
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
                let meta;
                try {
                    meta = await retryWithBackoff(() => adapter.meta(pkg.name)) as import('./types').RegistryInfo;
                } catch {
                    meta = { exists: false, downloads: 0, latestRelease: 0, maintainerCount: 0, highVulnCount: 0 };
                }
                // Ensure registryUrl is always set
                if (!meta.registryUrl) {
                    if (language === 'python') {
                        meta.registryUrl = `https://pypi.org/project/${pkg.name}/`;
                    } else if (language === 'javascript') {
                        meta.registryUrl = `https://www.npmjs.com/package/${pkg.name}`;
                    }
                }
                const score = await scoring.calculateScore(pkg.name, meta);
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
    debounceTimers.set(key, setTimeout(() => {
        validateAndDecorate(doc).catch(() => { });
        debounceTimers.delete(key);
    }, 200)); // 1 second debounce
} 