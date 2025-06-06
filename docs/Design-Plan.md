LLM Package Guard – VS Code Extension Development PlanA turnkey guide for Copilot / Cursor to build a secure, high‑performance VS Code extension that guards against hallucinated or malicious package imports suggested by large‑language models.
0  Purpose & ScopeDescriptionProblemLLMs occasionally hallucinate import/require statements for libraries that do not exist. Attackers register look‑alike names on PyPI, npm, etc., weaponising copy‑paste installs.SolutionA VS Code extension that watches code completions & chat panes, validates every package name against its registry, computes a trust score, and overlays an inline badge (🟢/🟡/🔴) plus a hover panel with evidence and safer options.Goal for this docWalk an AI pair‑programmer from blank repo → production‑ready extension (version 1.0) with emphases on security, performance, UX, and accuracy.Out‑of‑scopeBrowser extension, JetBrains port, or cloud backend – those come after v1 ships.1  Prerequisites & ToolchainItemWhyInstall commandNode ≥ 20 LTSExtension runtime & build scriptsnvm install 20 && nvm use 20 VS Code ≥ 1.89Test host & API headershttps://code.visualstudio.com Yeoman + VS Code generatorScaffold boilerplatenpm i -g yo generator-code TypeScript strictSafer, self‑documenting codenpm i -D typescript@latest ESLint + PrettierStyle & bug catchingnpx eslint --init + npm i -D prettier JestUnit testsnpm i -D jest ts-jest @types/jest vscode-testHeadless e2enpm i -D @vscode/test-electron Dependabot/SnykSupply‑chain watchenable in GitHub settings🔐 Security default: Turn on engines.vscode pinning, files.readonly + workspaceContains activation events only.
2  Project ScaffoldingGenerate base project
yo code     # choose ➜ New Extension (TypeScript)
✓ Extension name: pkg‑guard
✓ Identifier: pkg-guard
✓ Add linting: Yes (ESLint)
✓ Include GitHub Actions: YesTighten tsconfig
"strict": true,
"noUncheckedIndexedAccess": true,
"skipLibCheck": falseDirectory layout
src/
  extension.ts        # entry point
  detectors/
    python.ts
    node.ts
  adapters/
    pypi.ts
    npm.ts
  scoring/
    index.ts
  ui/
    decorators.ts
    hovers.ts
test/Continuous Integration – .github/workflows/ci.yml runs npm ci, npm run lint, npm test, npm run package.
3  Core Architecture┌─extension.ts──────────────────────────────────────────────────────┐
│ registerDocumentListener() ┐           ┌─cache.sqlite──────────┐ │
│                            │           │    LRU 10k entries    │ │
│ ─→ emit package names──────┼─WebSocket─▶ validationService.ts  │ │
│                            │           └────────┬──────────────┘ │
└─────────────────────────────┘                    │ registry API
                                                 ▼
        ┌─adapters────────────────────────────────────────────┐
        │ pypi.ts  npm.ts  crates.ts …                       │
        └─────────────────────────────────────────────────────┘Extension layer (VS Code API)
Parses open documents with the built‑in TS/JS/Python language services ➜ extracts import identifiers.
Debounces & dedupes (250 ms) before sending to the validation service.
Applies TextEditorDecorationType badges and code‑actions.
Local Validation Service (runs as a child process)
Adapter pattern for different registries.
Central scoring engine.
SQLite LRU + 48 h TTL cache.
Exposes a lightweight WebSocket API (validateMany(names[]) → Score[]).
Registry Adapters
PyPI – https://pypi.org/p/<pkg>/json
npm – https://registry.npmjs.org/<pkg> + downloads API.
Shared interface fetchMetadata(name): RegistryInfo.
4  Implementation Steps (0 → 100)4.1  Detection PipelineStepActionKey APIsAcceptance test1Use vscode.workspace.onDidOpenTextDocument & onDidChangeTextDocument to capture text.TextDocument.getText()Open a file containing import foobarbaz ➜ detector emits foobarbaz.2Build language‑specific regexes / AST visitors.`pythonRegex = /^\s*(fromimport)\s+([a-zA-Z0-9_]+)/gm`N/ADetector must ignore comments/strings.3Implement debounce (setTimeout) and Set dedupe.Node timersNo duplicate lookups for same name within 2 s.4.2  Validation ServiceSpawn with child_process.fork('validationService.js').
Protocol – JSON messages { id, names: [] } ➜ { id, scores: [] }.
Adapter contract
interface RegistryAdapter {
  exists(name: string): Promise<boolean>;
  meta(name: string): Promise<RegistryInfo>; // dated, downloads, maintainers, osvCount
}Scoring – start with weight table below; store in config/default.yml so users can tweak.
SignalImplementationWeightexistsboolean → 0 / 4040downloads30dlog10(n)20releaseAgeDate.now() - latestRelease±15multipleMaintainersmaintainers.length >= 2+5osvHighhighVulns * -10–…levenshteinDist(topHit,name) > 2–20Cache – sql.js with table (name TEXT PRIMARY KEY, payload BLOB, ts INTEGER).
4.3  Inline UIFeatureAPINotesBadge glyphTextEditorDecorationType.afterUse 🟢🟡🔴 unicode; keep it <3 chars to avoid jitterHover panellanguages.registerHoverProviderRender markdown list: Score 87 (🟢)• Exists on PyPI• Downloads: 12k/week…Quick FixCodeActionProvider“Remove unknown import” or “Replace with …”Settingscontributes.configurationHelpful for weight tuning & proxy settings4.4  Security HardeningTypeScript strict prevents any leaks.
Escape all HTML in hover markdown (use vscode.Uri.parse('command…') instead of raw links).
Registry HTTPS pinning with https.Agent({ maxVersion:'TLSv1.3', timeout:4000 }).
SCA – add npm audit --audit-level=high in CI.
Code Signing – GitHub Action vscode-package → sigstore sign.
4.5  Performance TuningBottleneckMitigationNetwork latencyParallel fetches via Promise.allSettled()UI freezeRun validation in worker; extension thread only decorates.Re‑validation spamUse file hash + cache; recheck only on save or after TTL.4.6  Testing StrategyUnit tests – mock adapters with nock; aim for 95 % coverage.
Integration – spin up npm-registry-mock & pypiserver in Docker.
e2e – vscode-test loads sample workspace, asserts badge presence via vscode.commands.executeCommand('vscode.executeHoverProvider', …).
Secure coding gates – add ESLint rule no-eval, no-unsafe-finally, security/detect-object-injection.
4.7  Packaging & ReleaseVersioning – semver, start 0.1.0.
vsce package ➜ produces .vsix.
GitHub Release workflow: on tag → test → sign → publish to VS Code Marketplace & OpenVSX.
Add comment to release notes: No telemetry by default.
5  User Experience Checklist (Done‑Criteria)UX ElementAcceptance ruleBadge latency≤ 300 ms on cache hit; ≤ 1.2 s on cold lookup.Color accessibilityPass WCAG 2.1 contrast with VS Code themes.No intrusive popupsAll info in hover or Problems pane.Fast disableUsers can toggle via status‑bar ≈ instant.PrivacyNo code snippets leave the machine.6  Learning Resources Embedded in Code CommentsEach adapter file begins with doc‑link to its registry API.
Scoring engine cites OWASP dependency check rationales.
TODO comments include inline Copilot prompts for refactor suggestions.
7  Future Roadmap (post‑v1 teasers)Browser extension sharing the local service.
JetBrains port via IntelliJ Platform SDK.
Heuristic ML model to predict malicious names before they appear in registries.
Org policy mode – allow ops teams to push block‑lists & minimum scores.
8  Appendix: Command Palette CheatsheetCommandPurposePackage Guard: Validate Current FileForce re‑scan immed.Package Guard: Clear CacheDrop SQLite cache │Package Guard: Show DiagnosticsOpens output channel │