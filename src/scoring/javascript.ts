import { RegistryInfo, TrustScore } from '../types';
import { fetchGitHubStats } from '../adapters/github';

let topNpmPackages: Set<string> = new Set();
let topNpmDownloads: { [pkg: string]: number } = {};

// Node.js built-in modules (from Node.js documentation)
const NODE_BUILTINS = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib'
]);

export class JavaScriptScoringEngine {
    public static setTopPackages(pkgs: { package: string; downloads: number }[] | string[]) {
        if (typeof pkgs[0] === 'string') {
            topNpmPackages = new Set((pkgs as string[]).map(p => p.toLowerCase()));
            topNpmDownloads = {};
        } else {
            topNpmPackages = new Set((pkgs as { package: string }[]).map(p => p.package.toLowerCase()));
            topNpmDownloads = {};
            for (const pkg of pkgs as { package: string; downloads: number }[]) {
                topNpmDownloads[pkg.package.toLowerCase()] = pkg.downloads;
            }
        }
    }

    public async calculateScore(name: string, info: RegistryInfo): Promise<TrustScore> {
        // Check for Node.js built-in module
        if (NODE_BUILTINS.has(name)) {
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
                scoreReasons: ['📦 This is a Node.js built-in module and is always trusted.'],
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
        const isTop = topNpmPackages.has(name.toLowerCase());
        let topDownloads = 0;
        let releaseDate = '';

        if (isTop && typeof topNpmDownloads[name.toLowerCase()] === 'number') {
            topDownloads = topNpmDownloads[name.toLowerCase()] || 0;
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
            scoreReasons.push('🏆 This is a top npm package.');
            level = this.determineLevel(score);
        }

        // Typosquatting logic (reuse Levenshtein from Python engine if available)
        // ... (to be implemented or imported)

        // GitHub stats
        if (info.githubRepo) {
            const stats = await fetchGitHubStats(info.githubRepo);
            if (stats) {
                if (stats.stars > 10000) {
                    score += 10;
                    scoreReasons.push('⭐ Very popular on GitHub (>10,000 stars).');
                } else if (stats.stars > 1000) {
                    score += 5;
                    scoreReasons.push('⭐ Popular on GitHub (>1,000 stars).');
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

        // Other reasons
        if (!evidence.exists) scoreReasons.push('❌ Package does not exist on npm.');
        if (evidence.downloads === 0 && !topDownloads) scoreReasons.push('📦 No download data available.');
        if (evidence.releaseAge < 90 && evidence.releaseAge > 0) scoreReasons.push('⏰ Very recent release.');
        if (!evidence.multipleMaintainers) scoreReasons.push('👤 Only a single maintainer.');
        if (evidence.vulnerabilities > 0) scoreReasons.push('⚠️ Known vulnerabilities.');

        // Risk factor classification (reuse logic from Python)
        const highRiskFactors: string[] = [];
        const mediumRiskFactors: string[] = [];
        if (scoreReasons.some(r => r.includes('No updates on GitHub for over 2 years.'))) highRiskFactors.push('No updates on GitHub for over 2 years.');
        if (evidence.downloads === 0 && !topDownloads) highRiskFactors.push('No download data available.');
        if (evidence.releaseAge < 90 && evidence.releaseAge > 0) mediumRiskFactors.push('Very recent release.');
        if (!evidence.multipleMaintainers) mediumRiskFactors.push('Only a single maintainer.');
        const uniqueHigh = Array.from(new Set(highRiskFactors));
        const uniqueMedium = Array.from(new Set(mediumRiskFactors.filter(f => !uniqueHigh.includes(f))));
        let filteredScoreReasons = scoreReasons.filter(r => !r.includes('No updates on GitHub for over 2 years.') && !r.includes('No download data available.') && !r.includes('Very recent release.') && !r.includes('Only a single maintainer.'));
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
        if (info.githubRepo) {
            const stats = await fetchGitHubStats(info.githubRepo);
            if (stats && stats.lastCommit > 0) {
                const daysAgo = (Date.now() - stats.lastCommit) / (1000 * 60 * 60 * 24);
                if (daysAgo < 365) activeGitHub = true;
            }
        }
        let riskPenalty = 0;
        riskPenalty += uniqueHigh.length * 20;
        riskPenalty += uniqueMedium.length * 5;
        let baseScore = this.computeScore(evidence) + boost - riskPenalty;
        // Clamp perfect packages to 100, but if any risk factors exist, clamp to 95
        let isPerfect = isTop && millionsOfDownloads && activeRelease && activeGitHub && evidence.multipleMaintainers && uniqueHigh.length === 0 && uniqueMedium.length === 0;
        if (isPerfect) {
            score = 100;
        } else if (uniqueHigh.length > 0 || uniqueMedium.length > 0) {
            score = Math.min(score, 95);
        } else {
            score = Math.max(0, Math.min(100, Math.round(baseScore)));
        }
        level = this.determineLevel(score);
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
                    { text: 'This package does not exist on npm or has no releases. It may be a hallucination or typo. Manual research and verification is required.', color: 'red' }
                ]
            };
        }
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

    private calculateReleaseAge(latestRelease: number): number {
        if (latestRelease === 0) return 0;
        const now = Date.now();
        const ageInDays = (now - latestRelease) / (1000 * 60 * 60 * 24);
        return Math.max(0, 100 - ageInDays);
    }

    private computeScore(evidence: TrustScore['evidence']): number {
        let score = 0;
        score += evidence.exists ? 40 : 0;
        if (evidence.downloads > 0) {
            score += Math.min(20, Math.log10(evidence.downloads) * 5);
        }
        score += (evidence.releaseAge / 100) * 15;
        score += evidence.multipleMaintainers ? 5 : 0;
        score += evidence.vulnerabilities * -10;
        return Math.max(0, Math.min(100, score));
    }

    private determineLevel(score: number): TrustScore['level'] {
        if (score >= 75) return 'high';
        if (score >= 45) return 'medium';
        return 'low';
    }
} 