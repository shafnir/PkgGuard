import fetch from 'node-fetch';

interface GitHubStats {
    stars: number;
    forks: number;
    lastCommit: number; // timestamp
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

export async function fetchGitHubStats(repoUrl: string): Promise<GitHubStats | undefined> {
    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) return undefined;
    const key = `${parsed.owner}/${parsed.repo}`;
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && now - cached.timestamp < CACHE_TTL) {
        return cached.stats;
    }
    try {
        const repoResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`);
        if (!repoResp.ok) return undefined;
        const repoData = await repoResp.json() as { stargazers_count?: number; forks_count?: number };
        const stars = repoData.stargazers_count || 0;
        const forks = repoData.forks_count || 0;
        // Get last commit date
        const commitsResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?per_page=1`);
        let lastCommit = 0;
        if (commitsResp.ok) {
            const commits = await commitsResp.json();
            if (Array.isArray(commits) && commits.length > 0) {
                lastCommit = new Date(commits[0].commit.committer.date).getTime();
            }
        }
        const stats: GitHubStats = { stars, forks, lastCommit };
        cache.set(key, { stats, timestamp: now });
        return stats;
    } catch {
        return undefined;
    }
} 