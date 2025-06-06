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

/**
 * Scoring engine for package trust evaluation.
 */
export class ScoringEngine {
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
        // Check for ignored package
        const ignore = isIgnoredPackage(name);
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
                    vulnerabilities: 0
                },
                scoreReasons: ['⚪ This package is ignored by your configuration.' + (ignore.note ? ` Note: ${ignore.note}` : '')],
                riskFactors: []
            };
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
                    vulnerabilities: 0
                },
                scoreReasons: ['📦 This is a Python standard library module and is always trusted.'],
                riskFactors: []
            };
        }

        const evidence = {
            exists: info.exists,
            downloads: typeof info.downloads === 'number' ? info.downloads : 0,
            releaseAge: this.calculateReleaseAge(info.latestRelease),
            multipleMaintainers: info.maintainerCount >= 2,
            vulnerabilities: info.highVulnCount
        };

        let score = this.computeScore(evidence);
        let level = this.determineLevel(score);
        const scoreReasons: string[] = [];
        const isTop = topPyPiPackages.has(name.toLowerCase());
        let topDownloads = 0;
        let releaseDate = '';

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

        if (info.githubRepo) {
            const stats = await fetchGitHubStats(info.githubRepo);
            if (stats) {
                if (stats.stars > 1000) {
                    score += 10;
                    scoreReasons.push('⭐ Very popular on GitHub (>1000 stars).');
                } else if (stats.stars > 100) {
                    score += 5;
                    scoreReasons.push('⭐ Popular on GitHub (>100 stars).');
                } else if (stats.stars < 10) {
                    score -= 10;
                    scoreReasons.push('⭐ Very few GitHub stars (<10).');
                }
                if (stats.forks > 100) {
                    score += 5;
                    scoreReasons.push('🍴 Frequently forked on GitHub (>100 forks).');
                }
                if (stats.lastCommit > 0) {
                    const monthsAgo = (Date.now() - stats.lastCommit) / (1000 * 60 * 60 * 24 * 30);
                    if (monthsAgo < 6) {
                        score += 5;
                        scoreReasons.push('🕒 Recently updated on GitHub (<6 months ago).');
                    } else if (monthsAgo > 24) {
                        score -= 10;
                        scoreReasons.push('🕒 No updates on GitHub for over 2 years.');
                    }
                }
                score = Math.max(0, Math.min(100, score));
                level = this.determineLevel(score);
            }
        }

        if (!evidence.exists) scoreReasons.push('❌ Package does not exist on PyPI.');
        if (evidence.downloads === 0 && !topDownloads) scoreReasons.push('📦 No download data available.');
        if (evidence.releaseAge < 30) scoreReasons.push('⏰ Very recent release.');
        if (!evidence.multipleMaintainers) scoreReasons.push('👤 Only a single maintainer.');
        if (evidence.vulnerabilities > 0) scoreReasons.push('⚠️ Known vulnerabilities.');

        if (isTop && score < 80 && evidence.vulnerabilities === 0 && evidence.exists) {
            score = 80;
            level = this.determineLevel(score);
        }

        if (isTop) {
            const risks: string[] = [];
            if (evidence.releaseAge < 30) risks.push('very recent release');
            if (!evidence.multipleMaintainers) risks.push('only a single maintainer');
            if (evidence.downloads === 0 && !topDownloads) risks.push('no download data');
            if (scoreReasons.some(r => r.includes('No updates on GitHub for over 2 years.'))) risks.push('no updates on GitHub for over 2 years');
            if (risks.length > 0) {
                scoreReasons.push(`⚠️ Note: This top package has risk factors: ${risks.join(', ')}.`);
            }
        }

        // Risk factor classification
        const highRiskFactors: string[] = [];
        const mediumRiskFactors: string[] = [];
        // High risk: no updates on GitHub for over 2 years, no download data
        if (scoreReasons.some(r => r.includes('No updates on GitHub for over 2 years.'))) highRiskFactors.push('No updates on GitHub for over 2 years.');
        if (evidence.downloads === 0 && !topDownloads) highRiskFactors.push('No download data available.');
        // Medium risk: very recent release (now < 90 days), only a single maintainer
        if (evidence.releaseAge < 90 && evidence.releaseAge > 0) mediumRiskFactors.push('Very recent release.');
        if (!evidence.multipleMaintainers) mediumRiskFactors.push('Only a single maintainer.');
        // Deduplicate and remove from medium if in high
        const uniqueHigh = Array.from(new Set(highRiskFactors));
        const uniqueMedium = Array.from(new Set(mediumRiskFactors.filter(f => !uniqueHigh.includes(f))));
        // Remove old risk factor reasons from scoreReasons
        let filteredScoreReasons = scoreReasons.filter(r => !r.includes('No updates on GitHub for over 2 years.') && !r.includes('No download data available.') && !r.includes('Very recent release.') && !r.includes('Only a single maintainer.') && !r.startsWith('⚠️ Note:'));

        // --- New scoring logic ---
        let boost = 0;
        if (isTop) boost += 30;
        // Download bonuses
        if ((topDownloads || 0) > 100_000_000 || (evidence.downloads || 0) > 100_000_000) {
            boost += 20;
        } else if ((topDownloads || 0) > 10_000_000 || (evidence.downloads || 0) > 10_000_000) {
            boost += 10;
        }
        // GitHub stars bonus
        let githubStars = 0;
        if (info.githubRepo) {
            const stats = await fetchGitHubStats(info.githubRepo);
            if (stats) {
                if (stats.stars > 10000) {
                    githubStars = 10;
                } else if (stats.stars > 1000) {
                    githubStars = 5;
                }
                // Always check for last commit > 2 years
                if (stats.lastCommit > 0) {
                    const monthsAgo = (Date.now() - stats.lastCommit) / (1000 * 60 * 60 * 24 * 30);
                    if (monthsAgo > 24) {
                        scoreReasons.push('🕒 No updates on GitHub for over 2 years.');
                    }
                }
            }
        }
        boost += githubStars;
        // Use topDownloads if available for perfect package check
        const millionsOfDownloads = ((topDownloads || 0) > 1_000_000) || ((evidence.downloads || 0) > 1_000_000);
        // Actively maintained: release < 1 year, recent GitHub commit < 1 year
        let activeRelease = false;
        if (info.latestRelease && info.latestRelease > 0) {
            const daysAgo = (Date.now() - info.latestRelease) / (1000 * 60 * 60 * 24);
            if (daysAgo < 365) activeRelease = true;
        }
        let activeGitHub = false;
        if (info.githubRepo) {
            const stats = await fetchGitHubStats(info.githubRepo);
            if (stats && stats.lastCommit > 0) {
                const daysAgo = (Date.now() - stats.lastCommit) / (1000 * 60 * 60 * 24);
                if (daysAgo < 365) activeGitHub = true;
            }
        }
        // Apply risk penalties
        let riskPenalty = 0;
        riskPenalty += uniqueHigh.length * 20;
        riskPenalty += uniqueMedium.length * 5;
        // Compute base score
        let baseScore = this.computeScore(evidence) + boost - riskPenalty;
        // Clamp perfect packages to 100
        let isPerfect = isTop && millionsOfDownloads && activeRelease && activeGitHub && uniqueHigh.length === 0 && uniqueMedium.length === 0;
        score = isPerfect ? 100 : Math.max(0, Math.min(100, Math.round(baseScore)));
        level = this.determineLevel(score);
        // Merge risk factors for UI
        const riskFactors = [
            ...uniqueHigh.map(f => ({ text: f, color: 'red' as const })),
            ...uniqueMedium.map(f => ({ text: f, color: 'orange' as const }))
        ];

        // Hallucination/Nonexistent package check
        if (!evidence.exists || info.latestRelease === 0) {
            return {
                packageName: name,
                score: 0,
                level: 'low',
                evidence,
                scoreReasons: filteredScoreReasons,
                topDownloads,
                releaseDate,
                riskFactors: [
                    { text: 'This package does not exist on PyPI or has no releases. It may be a hallucination or typo. Manual research and verification is required.', color: 'red' }
                ]
            };
        }

        // Always round the score before returning
        score = Math.round(score);

        return {
            packageName: name,
            score,
            level,
            evidence,
            scoreReasons: filteredScoreReasons,
            topDownloads,
            releaseDate,
            riskFactors
        };
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
}

export function loadIgnoreFile(workspaceRoot: string) {
    ignoreFilePath = path.join(workspaceRoot, '.pkgguard-ignore');
    ignoredPackages.clear();
    if (fs.existsSync(ignoreFilePath)) {
        const lines = fs.readFileSync(ignoreFilePath, 'utf-8').split(/\r?\n/);
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
        fs.watchFile(ignoreFilePath, { interval: 1000 }, () => loadIgnoreFile(workspaceRoot));
    }
}

export function isIgnoredPackage(name: string): { ignored: boolean, note?: string } {
    if (ignoredPackages.has(name)) {
        return { ignored: true, note: ignoredPackages.get(name) };
    }
    return { ignored: false };
} 