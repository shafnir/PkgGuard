/**
 * PyPI registry adapter implementation.
 * Fetches package information from the Python Package Index.
 * 
 * @copilot.generateExample usage=true
 * @copilot.avoid any=true
 */

import fetch from 'node-fetch';
import { Agent as HttpsAgent } from 'https';
import { RegistryAdapter, RegistryInfo } from '../types';

/**
 * PyPI registry adapter.
 * Implements the RegistryAdapter interface for the Python Package Index.
 */
export class PyPIAdapter implements RegistryAdapter {
    private readonly baseUrl = 'https://pypi.org/pypi';
    private readonly agent = new HttpsAgent({
        timeout: 4000,
        keepAlive: true
    });
    // In-memory cache for meta and exists results
    private metaCache: Map<string, { data: RegistryInfo; timestamp: number }> = new Map();
    private existsCache: Map<string, { exists: boolean; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes

    /**
     * Check if a package exists in PyPI.
     * 
     * @param name - The package name to check
     * @returns Promise resolving to true if the package exists
     */
    public async exists(name: string): Promise<boolean> {
        const now = Date.now();
        const cached = this.existsCache.get(name);
        if (cached && now - cached.timestamp < this.CACHE_TTL) {
            return cached.exists;
        }
        try {
            const response = await fetch(`${this.baseUrl}/${name}/json`, {
                agent: this.agent
            });
            const exists = response.status === 200;
            this.existsCache.set(name, { exists, timestamp: now });
            return exists;
        } catch (error) {
            // If we get a 404, the package doesn't exist
            if (error instanceof Error && 'status' in error && (error as { status: number }).status === 404) {
                return false;
            }
            // For other errors, we can't be certain
            throw error;
        }
    }

    /**
     * Get metadata for a package from PyPI.
     * 
     * @param name - The package name to get metadata for
     * @returns Promise resolving to package metadata
     */
    public async meta(name: string): Promise<RegistryInfo> {
        const now = Date.now();
        const cached = this.metaCache.get(name);
        if (cached && now - cached.timestamp < this.CACHE_TTL) {
            return cached.data;
        }
        // Fetch PyPI metadata
        const response = await fetch(`${this.baseUrl}/${name}/json`, {
            agent: this.agent
        });

        if (response.status === 404) {
            return {
                exists: false,
                downloads: 0,
                latestRelease: 0,
                maintainerCount: 0,
                highVulnCount: 0
            };
        }

        if (!response.ok) {
            throw new Error(`Failed to fetch PyPI metadata for ${name}: ${response.statusText}`);
        }

        const data = await response.json() as {
            info: {
                name: string;
                version: string;
                maintainers: Array<{ username: string }>;
                author?: string;
                author_email?: string;
                project_urls?: Record<string, string>;
                home_page?: string;
                description?: string;
            };
            releases: Record<string, Array<{ upload_time: string }>>;
        };

        // Get the latest release date
        let latestRelease = 0;
        let latestReleaseDate = 0;
        for (const files of Object.values(data.releases)) {
            for (const file of files) {
                if (file.upload_time) {
                    const ts = new Date(file.upload_time).getTime();
                    if (ts > latestReleaseDate) latestReleaseDate = ts;
                }
            }
        }
        latestRelease = latestReleaseDate;

        // Fetch download count from PePy
        let downloads = 0;
        try {
            const pepyResp = await fetch(`https://pepy.tech/api/projects/${encodeURIComponent(name)}`);
            if (pepyResp.ok) {
                const pepyData = await pepyResp.json() as { downloads?: number };
                downloads = pepyData.downloads ? pepyData.downloads : 0;
            }
        } catch (e) {
            // Ignore PePy errors, fallback to 0
        }

        // Extract GitHub repo URL (more aggressive)
        let githubRepo: string | undefined = undefined;
        const urls = data.info.project_urls || {};
        // Check all project_urls values for github.com
        for (const key of Object.keys(urls)) {
            const url = urls[key];
            if (typeof url === 'string' && url.includes('github.com')) {
                githubRepo = url;
                break;
            }
        }
        // Check home_page for github.com even if project_urls exists
        if (!githubRepo && typeof data.info.home_page === 'string' && data.info.home_page.includes('github.com')) {
            githubRepo = data.info.home_page;
        }
        // As a last resort, try to parse author or description for github.com
        if (!githubRepo && typeof data.info.author === 'string' && data.info.author.includes('github.com')) {
            githubRepo = data.info.author;
        }
        if (!githubRepo && typeof data.info.description === 'string' && data.info.description.includes('github.com')) {
            const match = data.info.description.match(/https?:\/\/github\.com\/[\w\-\.]+\/[\w\-\.]+/);
            if (match) githubRepo = match[0];
        }

        // Determine maintainer count
        let maintainerCount = 0;
        if (Array.isArray(data.info.maintainers) && data.info.maintainers.length > 0) {
            maintainerCount = data.info.maintainers.length;
        } else if (data.info.author || data.info.author_email) {
            maintainerCount = 1;
        }
        // If GitHub repo found, try to fetch contributors as maintainers
        if (githubRepo) {
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
            githubRepo
        };
        this.metaCache.set(name, { data: result, timestamp: now });
        return result;
    }
} 