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

let decorators: TrustDecorators | undefined;
let hoverProvider: TrustHoverProvider | undefined;
let diagnosticCollection: vscode.DiagnosticCollection | undefined;
let debounceTimers: Map<string, NodeJS.Timeout> = new Map();

export function activate(context: vscode.ExtensionContext) {
    if (!decorators) decorators = new TrustDecorators();
    if (!hoverProvider) hoverProvider = new TrustHoverProvider();
    if (!diagnosticCollection) diagnosticCollection = vscode.languages.createDiagnosticCollection('pkg-guard');

    // Fetch and cache the top PyPI packages list
    fetch('https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json')
        .then(res => res.json())
        .then((data: any) => {
            if (Array.isArray(data.rows)) {
                ScoringEngine.setTopPackages(data.rows);
            }
        })
        .catch(() => { });

    // Load .pkgguard-ignore file
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
        loadIgnoreFile(workspaceFolders[0].uri.fsPath);
    }

    // Load top npm packages for JS/TS
    JavaScriptScoringEngine.setTopPackages(TOP_NPM_PACKAGES);

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
    context.subscriptions.push(vscode.commands.registerCommand('pkgguard.ignorePackage', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const doc = editor.document;
        const selection = editor.selection;
        const wordRange = doc.getWordRangeAtPosition(selection.active);
        if (!wordRange) return;
        const packageName = doc.getText(wordRange);
        const note = await vscode.window.showInputBox({ prompt: 'Optional: Add a note for why you are ignoring this package.' });
        // Append to .pkgguard-ignore
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
            const fsPath = workspaceFolders[0].uri.fsPath;
            const ignorePath = require('path').join(fsPath, '.pkgguard-ignore');
            let line = packageName;
            if (note && note.trim()) line += ' # ' + note.trim();
            require('fs').appendFileSync(ignorePath, `\n${line}`);
            loadIgnoreFile(fsPath);
            // Refresh decorations
            vscode.window.visibleTextEditors.forEach(e => {
                if (e.document.languageId === 'python') debouncedValidate(e.document);
            });
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('pkgguard.unignorePackage', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const doc = editor.document;
        const selection = editor.selection;
        const wordRange = doc.getWordRangeAtPosition(selection.active);
        if (!wordRange) return;
        const packageName = doc.getText(wordRange);
        // Remove from .pkgguard-ignore
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0 && workspaceFolders[0]) {
            const fsPath = workspaceFolders[0].uri.fsPath;
            const ignorePath = require('path').join(fsPath, '.pkgguard-ignore');
            if (require('fs').existsSync(ignorePath)) {
                const lines = require('fs').readFileSync(ignorePath, 'utf-8').split(/\r?\n/);
                const filtered = lines.filter((line: string) => !line.trim().startsWith(packageName));
                require('fs').writeFileSync(ignorePath, filtered.join('\n'));
                loadIgnoreFile(fsPath);
                // Refresh decorations
                vscode.window.visibleTextEditors.forEach(e => {
                    if (e.document.languageId === 'python') debouncedValidate(e.document);
                });
            }
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
    hoverProvider = undefined;
    decorators = undefined;
    diagnosticCollection = undefined;
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
    const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
    if (!editor || !decorators || !hoverProvider || !diagnosticCollection) {
        if (diagnosticCollection) diagnosticCollection.set(doc.uri, []);
        return;
    }
    let detector: any;
    let adapter: any;
    let scoring: any;
    if (doc.languageId === 'python') {
        detector = new PythonDetector();
        adapter = new PyPIAdapter();
        scoring = new ScoringEngine();
    } else if (doc.languageId === 'javascript' || doc.languageId === 'typescript') {
        detector = new JavaScriptDetector();
        adapter = new NpmAdapter();
        scoring = new JavaScriptScoringEngine();
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

    // Prepare validation tasks with retry and concurrency limiting
    const results: Array<{ score: TrustScore; range: vscode.Range }> = [];
    const trustScores: TrustScore[] = [];
    const diagnostics: vscode.Diagnostic[] = [];

    const tasks = packages.map(pkg => async () => {
        let meta;
        try {
            meta = await retryWithBackoff(() => adapter.meta(pkg.name)) as import('./types').RegistryInfo;
        } catch {
            // If all retries fail, treat as validation failure
            meta = { exists: false, downloads: 0, latestRelease: 0, maintainerCount: 0, highVulnCount: 0 };
        }
        const score = await scoring.calculateScore(pkg.name, meta);
        trustScores.push(score);
        // Place badge at the end of the import line
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
        results.push({ score, range });
        // Add diagnostic for low trust or non-existent package
        const diagRange = new vscode.Range(
            new vscode.Position(pkg.line - 1, pkg.column - 1),
            new vscode.Position(pkg.line - 1, pkg.column - 1 + pkg.name.length)
        );
        if (!meta.exists) {
            diagnostics.push(new vscode.Diagnostic(
                diagRange,
                `Package "${pkg.name}" does not exist on PyPI (or could not be validated after retries).`,
                vscode.DiagnosticSeverity.Warning
            ));
        } else if (score.level === 'low') {
            diagnostics.push(new vscode.Diagnostic(
                diagRange,
                `Low trust score for package "${pkg.name}": ${score.score}. Consider reviewing this package.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    });

    // Run tasks with concurrency limit (5 at a time)
    await runWithConcurrency(tasks, 5);

    // Apply decorations and update hover provider
    if (decorators) decorators.applyDecorations(editor, results);
    if (hoverProvider) hoverProvider.updateScores(trustScores);
    if (diagnosticCollection) diagnosticCollection.set(doc.uri, diagnostics);
}

function debouncedValidate(doc: vscode.TextDocument) {
    if (!debounceTimers) return;
    const key = doc.uri.toString();
    const timer = debounceTimers.get(key);
    if (timer) {
        clearTimeout(timer);
    }
    debounceTimers.set(key, setTimeout(() => {
        validateAndDecorate(doc).catch(() => { });
        debounceTimers.delete(key);
    }, 500)); // 1 second debounce
} 