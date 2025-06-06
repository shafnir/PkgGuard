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
        // Get maintainers
        let maintainerCount = 0;
        if (Array.isArray(data.maintainers)) {
            maintainerCount = data.maintainers.length;
        }
        // Get GitHub repo
        let githubRepo: string | undefined = undefined;
        if (data.repository && typeof data.repository.url === 'string' && data.repository.url.includes('github.com')) {
            githubRepo = data.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
        }
        // Fetch download count from npm API
        let downloads = 0;
        try {
            const statsResp = await fetch(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`);
            if (statsResp.ok) {
                const statsData = await statsResp.json() as any;
                downloads = statsData.downloads || 0;
            }
        } catch (e) {
            // Ignore errors, fallback to 0
        }
        const result: RegistryInfo = {
            exists: true,
            downloads,
            latestRelease,
            maintainerCount,
            highVulnCount: 0, // TODO: Implement vulnerability checking
            githubRepo
        };
        this.metaCache.set(name, { data: result, timestamp: now });
        return result;
    }

    public async exists(name: string): Promise<boolean> {
        const meta = await this.meta(name);
        return meta.exists;
    }
} 