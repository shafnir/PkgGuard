import fetch from 'node-fetch';
import { RegistryAdapter, RegistryInfo } from '../types';

export class NpmAdapter implements RegistryAdapter {
    private readonly baseUrl = 'https://registry.npmjs.org';
    // In-memory cache for meta results
    private metaCache: Map<string, { data: RegistryInfo; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes

    public async meta(name: string): Promise<RegistryInfo> {
        const now = Date.now();
        const cached = this.metaCache.get(name);
        if (cached && now - cached.timestamp < this.CACHE_TTL) {
            return cached.data;
        }
        // Fetch npm metadata
        let response = await fetch(`${this.baseUrl}/${encodeURIComponent(name)}`);
        if (response.status === 404 && name.includes('/')) {
            // Try root package if subpath import (e.g., lodash/fp -> lodash)
            const rootName = name.split('/')[0] || '';
            response = await fetch(`${this.baseUrl}/${encodeURIComponent(rootName)}`);
            if (response.status === 404) {
                return {
                    exists: false,
                    downloads: 0,
                    latestRelease: 0,
                    maintainerCount: 0,
                    highVulnCount: 0
                };
            }
        } else if (response.status === 404) {
            return {
                exists: false,
                downloads: 0,
                latestRelease: 0,
                maintainerCount: 0,
                highVulnCount: 0
            };
        }
        if (!response.ok) {
            throw new Error(`Failed to fetch npm metadata for ${name}: ${response.statusText}`);
        }
        const data = await response.json() as any;
        // Get the latest release date
        let latestRelease = 0;
        if (data.time && data['dist-tags'] && data['dist-tags'].latest) {
            const latestVersion = data['dist-tags'].latest;
            if (data.time[latestVersion]) {
                latestRelease = new Date(data.time[latestVersion]).getTime();
            }
        }
        // Get maintainers and contributors from the latest version
        let maintainerCount = 0;
        let uniqueMaintainers = new Set();
        let latestVersion = data['dist-tags'] && data['dist-tags'].latest;
        if (latestVersion && data.versions && data.versions[latestVersion]) {
            const versionData = data.versions[latestVersion];
            if (Array.isArray(versionData.maintainers)) {
                for (const m of versionData.maintainers) {
                    if (m && m.name) uniqueMaintainers.add(m.name);
                }
            }
            if (Array.isArray(versionData.contributors)) {
                for (const c of versionData.contributors) {
                    if (c && c.name) uniqueMaintainers.add(c.name);
                }
            }
        }
        // Fallback to root-level maintainers/contributors if not found in latest version
        if (uniqueMaintainers.size === 0) {
            if (Array.isArray(data.maintainers)) {
                for (const m of data.maintainers) {
                    if (m && m.name) uniqueMaintainers.add(m.name);
                }
            }
            if (Array.isArray(data.contributors)) {
                for (const c of data.contributors) {
                    if (c && c.name) uniqueMaintainers.add(c.name);
                }
            }
        }
        maintainerCount = uniqueMaintainers.size;
        // Get GitHub repo
        let githubRepo: string | undefined = undefined;
        if (data.repository && typeof data.repository.url === 'string' && data.repository.url.includes('github.com')) {
            githubRepo = data.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
        }
        // Fetch download count from npm API (weekly)
        let downloads = 0;
        try {
            let statsResp = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`);
            if (statsResp.ok) {
                const statsData: any = await statsResp.json();
                downloads = statsData.downloads || 0;
            } else {
                // fallback to monthly
                statsResp = await fetch(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`);
                if (statsResp.ok) {
                    const statsData: any = await statsResp.json();
                    const daysInMonth = 30; // npm API does not provide days, so estimate
                    downloads = Math.round((statsData.downloads || 0) / daysInMonth * 7);
                }
            }
        } catch (e) {
            // Ignore errors, fallback to 0
        }
        // If GitHub repo found, try to fetch contributors as maintainers
        if ((!maintainerCount || maintainerCount === 1) && githubRepo) {
            try {
                const repoMatch = githubRepo.match(/github\.com\/([\w\-\.]+)\/([\w\-\.]+)/);
                if (repoMatch) {
                    const owner = repoMatch[1];
                    const repo = repoMatch[2];
                    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100`;
                    const resp = await fetch(apiUrl);
                    if (resp.ok) {
                        const contributors = await resp.json();
                        if (Array.isArray(contributors) && contributors.length > maintainerCount) {
                            maintainerCount = contributors.length;
                        }
                    }
                }
            } catch { }
        }
        const result: RegistryInfo = {
            exists: true,
            downloads,
            latestRelease,
            maintainerCount,
            highVulnCount: 0, // TODO: Implement vulnerability checking
            githubRepo,
            registryUrl: `https://www.npmjs.com/package/${name}`
        };
        this.metaCache.set(name, { data: result, timestamp: now });
        return result;
    }

    public async exists(name: string): Promise<boolean> {
        const meta = await this.meta(name);
        return meta.exists;
    }
} 