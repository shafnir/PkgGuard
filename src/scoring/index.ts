/**
 * Scoring engine for package trust evaluation.
 * Calculates trust scores based on registry metadata.
 * 
 * @copilot.generateExample usage=true
 * @copilot.avoid any=true
 */

import { RegistryInfo, TrustScore } from '../types';
import { fetchGitHubStats } from '../adapters/github';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Scoring weights for different factors.
 */
const WEIGHTS = {
    exists: 40,
    downloads: 20,
    releaseAge: 15,
    multipleMaintainers: 5,
    vulnerabilities: -10
} as const;

let topPyPiPackages: Set<string> = new Set();
let topPyPiDownloads: { [pkg: string]: number } = {};
let ignoredPackages: Map<string, string> = new Map();
let ignoreFilePath: string | null = null;

// Python 3.x standard library modules (partial, update as needed)
const PYTHON_STDLIB = new Set([
    'abc', 'aifc', 'argparse', 'array', 'ast', 'asynchat', 'asyncio', 'asyncore', 'atexit', 'audioop', 'base64', 'bdb', 'binascii', 'binhex', 'bisect', 'builtins', 'bz2', 'cProfile', 'calendar', 'cgi', 'cgitb', 'chunk', 'cmath', 'cmd', 'code', 'codecs', 'codeop', 'collections', 'colorsys', 'compileall', 'concurrent', 'configparser', 'contextlib', 'contextvars', 'copy', 'copyreg', 'crypt', 'csv', 'ctypes', 'curses', 'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib', 'dis', 'distutils', 'doctest', 'email', 'encodings', 'ensurepip', 'enum', 'errno', 'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch', 'formatter', 'fractions', 'ftplib', 'functools', 'gc', 'getopt', 'getpass', 'gettext', 'glob', 'graphlib', 'grp', 'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'imaplib', 'imghdr', 'imp', 'importlib', 'inspect', 'io', 'ipaddress', 'itertools', 'json', 'keyword', 'lib2to3', 'linecache', 'locale', 'logging', 'lzma', 'mailbox', 'mailcap', 'marshal', 'math', 'mimetypes', 'mmap', 'modulefinder', 'msilib', 'msvcrt', 'multiprocessing', 'netrc', 'nntplib', 'numbers', 'operator', 'optparse', 'os', 'ossaudiodev', 'parser', 'pathlib', 'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil', 'platform', 'plistlib', 'poplib', 'posix', 'pprint', 'profile', 'pstats', 'pty', 'pwd', 'py_compile', 'pyclbr', 'pydoc', 'queue', 'quopri', 'random', 're', 'readline', 'reprlib', 'resource', 'rlcompleter', 'runpy', 'sched', 'secrets', 'select', 'selectors', 'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtpd', 'smtplib', 'sndhdr', 'socket', 'socketserver', 'spwd', 'sqlite3', 'ssl', 'stat', 'statistics', 'string', 'stringprep', 'struct', 'subprocess', 'sunau', 'symbol', 'symtable', 'sys', 'sysconfig', 'syslog', 'tabnanny', 'tarfile', 'telnetlib', 'tempfile', 'termios', 'test', 'textwrap', 'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize', 'trace', 'traceback', 'tracemalloc', 'tty', 'turtle', 'turtledemo', 'types', 'typing', 'unicodedata', 'unittest', 'urllib', 'uu', 'uuid', 'venv', 'warnings', 'wave', 'weakref', 'webbrowser', 'winreg', 'winsound', 'wsgiref', 'xdrlib', 'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zipimport', 'zlib'
]);

// Persistent workspace-level cache segmented by language
const CACHE_FILE_NAME = '.pkgguard-cache.json';
let cacheFilePath: string | null = null;
let cacheData: any = {};

/**
 * Scoring engine for package trust evaluation.
 */
export class ScoringEngine {
    private recentlyIgnored: Set<string> = new Set();
    private cache: Map<string, { score: TrustScore; timestamp: number }> = new Map();

    /**
     * Set the top PyPI packages list.
     */
    public static setTopPackages(pkgs: { project: string; download_count: number }[] | string[]) {
        if (typeof pkgs[0] === 'string') {
            topPyPiPackages = new Set((pkgs as string[]).map(p => p.toLowerCase()));
            topPyPiDownloads = {};
        } else {
            topPyPiPackages = new Set((pkgs as { project: string }[]).map(p => p.project.toLowerCase()));
            topPyPiDownloads = {};
            for (const pkg of pkgs as { project: string; download_count: number }[]) {
                topPyPiDownloads[pkg.project.toLowerCase()] = pkg.download_count;
            }
        }
    }

    /**
     * Calculate trust score for a package based on registry info.
     * 
     * @param name - Package name
     * @param info - Registry information
     * @returns Trust score with evidence
     */
    public async calculateScore(name: string, info: RegistryInfo): Promise<TrustScore> {
        // Aggressive GitHub detection
        let githubRepo: string | undefined = info.githubRepo;
        if (!githubRepo) {
            githubRepo = this.extractGitHubRepoFromLinks(info, name) || undefined;
        }

        // Check for ignored package
        const ignore = this.isIgnoredPackage(name);
        if (ignore.ignored) {
            return {
                packageName: name,
                score: null as any,
                level: 'ignored' as any,
                evidence: {
                    exists: true,
                    downloads: 0,
                    releaseAge: 0,
                    multipleMaintainers: true,
                    vulnerabilities: 0,
                    maintainerCount: 0,
                    registryUrl: '',
                },
                scoreReasons: ['⚪ This package is ignored by your configuration.' + (ignore.note ? ` Note: ${ignore.note}` : '')],
                riskFactors: [],
                githubRepo
            };
        }

        // Persistent cache check (python)
        const ttl = (typeof process !== 'undefined' && process.env && process.env.PKG_GUARD_CACHE_TTL) ? parseInt(process.env.PKG_GUARD_CACHE_TTL) : 172800;
        const cached = this.getCachedScore('python', name, ttl);

        // Only use cache if the package wasn't just unignored
        const wasIgnored = this.wasRecentlyIgnored(name);
        if (cached && !wasIgnored) return cached;

        // If package was just unignored or no cache, force a rescan
        if (wasIgnored) {
            this.clearRecentlyIgnored(name);
        }

        // Check for standard library
        if (PYTHON_STDLIB.has(name)) {
            return {
                packageName: name,
                score: 100,
                level: 'high',
                evidence: {
                    exists: true,
                    downloads: 0,
                    releaseAge: 0,
                    multipleMaintainers: true,
                    vulnerabilities: 0,
                    maintainerCount: 0,
                    registryUrl: '',
                },
                scoreReasons: ['📦 This is a Python standard library module and is always trusted.'],
                riskFactors: [],
                githubRepo
            };
        }

        const evidence = {
            exists: info.exists,
            downloads: typeof info.downloads === 'number' ? info.downloads : 0,
            releaseAge: this.calculateReleaseAge(info.latestRelease),
            multipleMaintainers: info.maintainerCount >= 2,
            vulnerabilities: info.highVulnCount,
            maintainerCount: info.maintainerCount
        };

        let score = this.computeScore(evidence);
        let level = this.determineLevel(score);
        const scoreReasons: string[] = [];
        const isTop = topPyPiPackages.has(name.toLowerCase());
        let topDownloads = 0;
        let releaseDate = '';
        const riskFactors: { text: string; color: 'red' | 'orange' }[] = [];

        if (isTop && typeof topPyPiDownloads[name.toLowerCase()] === 'number') {
            topDownloads = topPyPiDownloads[name.toLowerCase()] || 0;
        }
        if (info.latestRelease && info.latestRelease > 0) {
            const d = new Date(info.latestRelease);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            releaseDate = `${day}-${month}-${year}`;
        }

        if (isTop) {
            score = Math.max(score, 85);
            scoreReasons.push('🏆 This is a top PyPI package.');
            level = this.determineLevel(score);
        }

        const typosquat = this.isTyposquat(name);
        if (typosquat && !isTop && topPyPiPackages.has(typosquat.toLowerCase())) {
            score = Math.max(0, score - 60);
            scoreReasons.push(`⚠️ Name is very similar to top package "${typosquat}" (possible typosquatting).`);
            level = this.determineLevel(score);
        }

        // Fetch GitHub stats once if needed
        let githubStats = null;
        if (githubRepo) {
            try {
                githubStats = await fetchGitHubStats(githubRepo);
            } catch { githubStats = null; }
        }

        if (githubStats) {
            if (githubStats.rateLimited) {
                scoreReasons.push('⚠️ GitHub API rate limit reached. GitHub-related risks could not be calculated.');
            } else {
                if (githubStats.stars > 1000) {
                    score += 10;
                    scoreReasons.push('⭐ Very popular on GitHub (>1000 stars).');
                } else if (githubStats.stars > 100) {
                    score += 5;
                    scoreReasons.push('⭐ Popular on GitHub (>100 stars).');
                } else if (githubStats.stars < 10) {
                    score -= 10;
                    scoreReasons.push('⭐ Very few GitHub stars (<10).');
                }
                if (githubStats.forks > 100) {
                    score += 5;
                    scoreReasons.push('🍴 Frequently forked on GitHub (>100 forks).');
                }
                if (githubStats.lastCommit > 0) {
                    const monthsAgo = (Date.now() - githubStats.lastCommit) / (1000 * 60 * 60 * 24 * 30);
                    if (monthsAgo < 6) {
                        score += 5;
                        scoreReasons.push('🕒 Recently updated on GitHub (<6 months ago).');
                    }
                }
            }
            score = Math.max(0, Math.min(100, score));
            level = this.determineLevel(score);
        }

        if (!evidence.exists) scoreReasons.push('❌ Package does not exist on PyPI.');
        if (evidence.downloads === 0 && !topDownloads) scoreReasons.push('📦 No download data available.');
        if (evidence.releaseAge < 7 && evidence.releaseAge > 0) scoreReasons.push('⏰ Very recent release.');
        if (evidence.downloads > 0 && evidence.downloads < 10000) scoreReasons.push('📦 Low download count (<10,000/week).');
        if (!evidence.multipleMaintainers) scoreReasons.push('👤 Only a single maintainer.');
        if (evidence.vulnerabilities > 0) scoreReasons.push('⚠️ Known vulnerabilities.');

        if (isTop && score < 80 && evidence.vulnerabilities === 0 && evidence.exists) {
            score = 80;
            level = this.determineLevel(score);
        }

        // Risk factor classification
        const highRiskFactors: string[] = [];
        const mediumRiskFactors: string[] = [];
        let yearsAgo = null;
        if (githubStats && githubStats.lastCommit > 0) {
            const years = Math.floor((Date.now() - githubStats.lastCommit) / (1000 * 60 * 60 * 24 * 365));
            yearsAgo = years;
            if (years >= 2) {
                highRiskFactors.push(`No updates on GitHub for over 2 years (last update: ${years} year${years === 1 ? '' : 's'} ago).`);
            }
        }
        if (evidence.downloads === 0 && !topDownloads) highRiskFactors.push('No download data available.');
        if (evidence.releaseAge < 7 && evidence.releaseAge > 0) mediumRiskFactors.push('Very recent release.');
        if (!evidence.multipleMaintainers) mediumRiskFactors.push('Only a single maintainer.');
        if (evidence.downloads > 0 && evidence.downloads < 10000) mediumRiskFactors.push('Low download count (<10,000/week).');
        const uniqueHigh = Array.from(new Set(highRiskFactors));
        const uniqueMedium = Array.from(new Set(mediumRiskFactors.filter(f => !uniqueHigh.includes(f))));
        let filteredScoreReasons = scoreReasons.filter(r => !r.includes('No updates on GitHub for over 2 years') && !r.includes('No download data available.') && !r.includes('Very recent release.') && !r.includes('Only a single maintainer.'));

        // Scoring logic (reuse from Python, can be tuned for npm)
        let boost = 0;
        if (isTop) boost += 30;
        if ((topDownloads || 0) > 100_000_000 || (evidence.downloads || 0) > 100_000_000) {
            boost += 20;
        } else if ((topDownloads || 0) > 10_000_000 || (evidence.downloads || 0) > 10_000_000) {
            boost += 10;
        }
        // Use topDownloads if available for perfect package check
        const millionsOfDownloads = ((topDownloads || 0) > 1_000_000) || ((evidence.downloads || 0) > 1_000_000);
        let activeRelease = false;
        if (info.latestRelease && info.latestRelease > 0) {
            const daysAgo = (Date.now() - info.latestRelease) / (1000 * 60 * 60 * 24);
            if (daysAgo < 365) activeRelease = true;
        }
        let activeGitHub = false;
        if (githubStats && githubStats.lastCommit > 0) {
            const daysAgo = (Date.now() - githubStats.lastCommit) / (1000 * 60 * 60 * 24);
            if (daysAgo < 365) activeGitHub = true;
        }
        let riskPenalty = 0;
        riskPenalty += uniqueHigh.length * 20;
        riskPenalty += uniqueMedium.length * 5;
        let baseScore = this.computeScore(evidence) + boost - riskPenalty;
        // Clamp perfect packages to 100, but if any risk factors exist, clamp to 95
        let isPerfect = isTop && millionsOfDownloads && activeRelease && activeGitHub && evidence.multipleMaintainers && uniqueHigh.length === 0 && uniqueMedium.length === 0;
        score = isPerfect ? 100 : Math.max(0, Math.min(100, Math.round(baseScore)));
        level = this.determineLevel(score);
        // Merge risk factors for UI
        riskFactors.push(
            ...uniqueHigh.map(f => ({ text: f, color: 'red' as const })),
            ...uniqueMedium.map(f => ({ text: f, color: 'orange' as const }))
        );

        // Hallucination/Nonexistent package check
        if (!evidence.exists || info.latestRelease === 0) {
            return {
                packageName: name,
                score: 0,
                level: 'low',
                evidence: { ...evidence, registryUrl: info.registryUrl, githubRepo: info.githubRepo },
                scoreReasons: filteredScoreReasons,
                topDownloads,
                releaseDate,
                riskFactors: [
                    { text: 'This package does not exist on PyPI or has no releases. It may be a hallucination or typo. Manual research and verification is required.', color: 'red' }
                ],
                githubRepo
            };
        }

        // Always round the score before returning
        score = Math.round(score);

        const result: TrustScore = {
            packageName: name,
            score: Math.round(score),
            level,
            evidence: { ...evidence, registryUrl: info.registryUrl, githubRepo: info.githubRepo },
            scoreReasons: filteredScoreReasons,
            topDownloads,
            releaseDate,
            riskFactors,
            githubRepo
        };
        this.setCachedScore('python', name, result);
        return result;
    }

    /**
     * Calculate release age score.
     * Newer releases get higher scores.
     */
    private calculateReleaseAge(latestRelease: number): number {
        if (latestRelease === 0) return 0;

        const now = Date.now();
        const ageInDays = (now - latestRelease) / (1000 * 60 * 60 * 24);

        // Score decreases as age increases
        return Math.max(0, 100 - ageInDays);
    }

    /**
     * Compute final score from evidence.
     */
    private computeScore(evidence: TrustScore['evidence']): number {
        let score = 0;

        // Existence check
        score += evidence.exists ? WEIGHTS.exists : 0;

        // Download popularity (log scale)
        if (evidence.downloads > 0) {
            score += Math.min(WEIGHTS.downloads, Math.log10(evidence.downloads) * 5);
        }

        // Release age
        score += (evidence.releaseAge / 100) * WEIGHTS.releaseAge;

        // Multiple maintainers
        score += evidence.multipleMaintainers ? WEIGHTS.multipleMaintainers : 0;

        // Vulnerabilities (negative impact)
        score += evidence.vulnerabilities * WEIGHTS.vulnerabilities;

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Determine trust level based on score.
     */
    private determineLevel(score: number): TrustScore['level'] {
        if (score >= 80) return 'high';
        if (score >= 50) return 'medium';
        return 'low';
    }

    private isTyposquat(name: string): string | null {
        const lower = (name ?? '').toLowerCase();
        for (const topRaw of topPyPiPackages) {
            if (typeof topRaw !== 'string') continue;
            const top = (topRaw ?? '').toLowerCase();
            if (lower === top) continue;
            if (this.levenshtein(lower, top) === 1) return top;
        }
        return null;
    }

    private levenshtein(a: string, b: string): number {
        if (!a || !b) return Math.max(a?.length ?? 0, b?.length ?? 0);
        const aLen = a.length;
        const bLen = b.length;
        const matrix = Array.from({ length: aLen + 1 }, () => new Array(bLen + 1).fill(0)) as number[][];
        for (let i = 0; i <= aLen; i++) matrix[i]![0] = i;
        for (let j = 0; j <= bLen; j++) matrix[0]![j] = j;
        function getMatrix(matrix: number[][], i: number, j: number): number {
            return (matrix[i] && matrix[i][j] !== undefined) ? matrix[i][j] : Infinity;
        }
        function setMatrix(matrix: number[][], i: number, j: number, value: number) {
            if (matrix[i]) matrix[i][j] = value;
        }
        for (let i = 1; i <= aLen; i++) {
            for (let j = 1; j <= bLen; j++) {
                const aChar = a.charAt(i - 1);
                const bChar = b.charAt(j - 1);
                const up = getMatrix(matrix, i - 1, j);
                const left = getMatrix(matrix, i, j - 1);
                const diag = getMatrix(matrix, i - 1, j - 1);
                setMatrix(matrix, i, j, Math.min(
                    up + 1,
                    left + 1,
                    diag + (aChar === bChar ? 0 : 1)
                ));
            }
        }
        return matrix[aLen]![bLen]!;
    }

    // Aggressive GitHub detection: extract GitHub repo from all available links
    private extractGitHubRepoFromLinks(info: RegistryInfo, packageName: string): string | null {
        const githubRegex = /https?:\/\/(www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(\/|$)/i;
        const links: string[] = [];
        if (typeof (info as any).homepage === 'string') links.push((info as any).homepage);
        if ((info as any).projectUrls && typeof (info as any).projectUrls === 'object') {
            const projectUrls = (info as any).projectUrls;
            if (projectUrls) {
                for (const key in projectUrls) {
                    if (typeof projectUrls[key] === 'string') links.push(projectUrls[key]);
                }
            }
        }
        for (const url of links) {
            const match = githubRegex.exec(url);
            if (match) {
                // Only accept if repo name matches package name (case-insensitive, allow dashes/underscores)
                const repoName = match[3]?.toLowerCase().replace(/[-_]/g, '') ?? '';
                const pkgName = packageName.toLowerCase().replace(/[-_]/g, '');
                if (repoName === pkgName) {
                    return `https://github.com/${match[2]}/${match[3]}`;
                }
            }
        }
        return null;
    }

    private isIgnoredPackage(name: string): { ignored: boolean; note?: string } {
        const note = ignoredPackages.get(name);
        if (!note) {
            return { ignored: false };
        }
        return { ignored: true, note };
    }

    private wasRecentlyIgnored(name: string): boolean {
        return this.recentlyIgnored.has(name);
    }

    private clearRecentlyIgnored(name: string): void {
        this.recentlyIgnored.delete(name);
    }

    private getCachedScore(language: string, name: string, ttl: number): TrustScore | null {
        const key = `${language}:${name}`;
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < ttl * 1000) {
            return cached.score;
        }
        return null;
    }

    private setCachedScore(language: string, name: string, score: TrustScore): void {
        const key = `${language}:${name}`;
        this.cache.set(key, { score, timestamp: Date.now() });
    }
}

export function loadIgnoreFile(workspaceRoot: string) {
    const pathLib = require('path');
    const fsLib = require('fs');
    const guardDir = pathLib.join(workspaceRoot, '.pkgguard');
    if (!fsLib.existsSync(guardDir)) fsLib.mkdirSync(guardDir);
    ignoreFilePath = pathLib.join(guardDir, '.pkgguard-ignore');
    ignoredPackages.clear();
    if (fsLib.existsSync(ignoreFilePath)) {
        const lines = fsLib.readFileSync(ignoreFilePath, 'utf-8').split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const [pkg, ...noteParts] = trimmed.split('#');
            const pkgName = (pkg || '').trim();
            const note = noteParts.join('#').trim();
            if (pkgName) ignoredPackages.set(pkgName, note);
        }
    }
    // Watch for changes
    if (ignoreFilePath) {
        fsLib.watchFile(ignoreFilePath, { interval: 1000 }, () => loadIgnoreFile(workspaceRoot));
    }
}

export function isIgnoredPackage(name: string): { ignored: boolean, note?: string } {
    if (ignoredPackages.has(name)) {
        return { ignored: true, note: ignoredPackages.get(name) };
    }
    return { ignored: false };
}

export function loadCacheFile(workspaceRoot: string) {
    const pathLib = require('path');
    const fsLib = require('fs');
    const guardDir = pathLib.join(workspaceRoot, '.pkgguard');
    if (!fsLib.existsSync(guardDir)) fsLib.mkdirSync(guardDir);
    cacheFilePath = pathLib.join(guardDir, CACHE_FILE_NAME);
    if (fsLib.existsSync(cacheFilePath)) {
        try {
            cacheData = JSON.parse(fsLib.readFileSync(cacheFilePath, 'utf-8'));
        } catch {
            cacheData = {};
        }
    } else {
        cacheData = {};
    }
}

export function getCachedScore(language: string, packageName: string, ttlSeconds: number): any | null {
    if (!cacheData[language] || !cacheData[language][packageName]) return null;
    const entry = cacheData[language][packageName];
    if (!entry.timestamp || (Date.now() - entry.timestamp) / 1000 > ttlSeconds) return null;
    return entry.score;
}

export function setCachedScore(language: string, packageName: string, score: any) {
    if (!cacheFilePath) return;
    const pathLib = require('path');
    const fsLib = require('fs');
    if (!cacheData[language]) cacheData[language] = {};
    cacheData[language][packageName] = { score, timestamp: Date.now() };
    try {
        fsLib.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2));
    } catch { }
}

export function clearCacheFile(workspaceRoot: string) {
    const pathLib = require('path');
    const fsLib = require('fs');
    const guardDir = pathLib.join(workspaceRoot, '.pkgguard');
    const cachePath = pathLib.join(guardDir, CACHE_FILE_NAME);
    if (fsLib.existsSync(cachePath)) {
        fsLib.unlinkSync(cachePath);
    }
    cacheData = {};
}

export function removeCachedScore(language: string, packageName: string) {
    if (cacheData[language] && cacheData[language][packageName]) {
        delete cacheData[language][packageName];
        if (cacheFilePath) {
            const fsLib = require('fs');
            fsLib.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2));
        }
    }
} 