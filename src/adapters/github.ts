import fetch from 'node-fetch';

export interface GitHubStats {
    stars: number;
    forks: number;
    lastCommit: number;
    lastCommitDate?: string;
    rateLimited?: boolean;
}

const cache = new Map<string, { stats: GitHubStats; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
    const match = url.match(/github\.com\/(.+?)\/(.+?)(\/|$|\.)/);
    if (match && match[1] && match[2]) {
        return { owner: match[1], repo: match[2] };
    }
    return null;
}

interface GitHubRepoData {
    stargazers_count: number;
    forks_count: number;
    default_branch: string;
}

interface GitHubCommitData {
    commit: {
        committer: {
            date: string;
        };
    };
}

export async function fetchGitHubStats(repoUrl: string): Promise<GitHubStats | null> {
    const repo = parseRepoUrl(repoUrl);
    if (!repo) return null;

    const now = Date.now();
    const cached = cache.get(repoUrl);
    if (cached && now - cached.timestamp < CACHE_TTL) {
        return cached.stats;
    }

    try {
        // Fetch repo info
        const repoResp = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
        if (!repoResp.ok) {
            // Check for rate limit
            if (repoResp.status === 403) {
                const headers = repoResp.headers;
                const remaining = headers.get('x-ratelimit-remaining');
                if (remaining === '0') {
                    return {
                        stars: 0,
                        forks: 0,
                        lastCommit: 0,
                        rateLimited: true
                    };
                }
            }
            return null;
        }
        const repoData = await repoResp.json() as GitHubRepoData;

        // Fetch commits for the default branch
        const defaultBranch = repoData.default_branch || 'main';
        const commitsResp = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${defaultBranch}`);
        if (!commitsResp.ok) {
            // Check for rate limit
            if (commitsResp.status === 403) {
                const headers = commitsResp.headers;
                const remaining = headers.get('x-ratelimit-remaining');
                if (remaining === '0') {
                    return {
                        stars: repoData.stargazers_count || 0,
                        forks: repoData.forks_count || 0,
                        lastCommit: 0,
                        rateLimited: true
                    };
                }
            }
            return null;
        }
        const commitData = await commitsResp.json() as GitHubCommitData;

        // Get the last commit date
        const lastCommitDate = commitData.commit?.committer?.date;
        const lastCommit = lastCommitDate ? new Date(lastCommitDate).getTime() : 0;

        const stats: GitHubStats = {
            stars: repoData.stargazers_count || 0,
            forks: repoData.forks_count || 0,
            lastCommit,
            lastCommitDate
        };

        cache.set(repoUrl, { stats, timestamp: now });
        return stats;
    } catch (error) {
        console.error(`Error fetching GitHub stats for ${repoUrl}:`, error);
        return null;
    }
} 