/**
 * Tests for the AnalysisEngine class.
 */

import { AnalysisEngine } from '../core/AnalysisEngine.js';
import { CacheData } from '../../types.js';

// Mock the adapters
jest.mock('../../adapters/pypi.js');
jest.mock('../../adapters/npm.js');
jest.mock('../../adapters/github.js');

describe('AnalysisEngine', () => {
  let analysisEngine: AnalysisEngine;
  let mockCacheData: CacheData;

  beforeEach(() => {
    analysisEngine = new AnalysisEngine();
    mockCacheData = {
      python: {},
      javascript: {}
    };
  });

  describe('analyzePackage', () => {
    it('should return high trust score for standard library packages', async () => {
      const result = await analysisEngine.analyzePackage('os', 'python');
      
      expect(result.packageName).toBe('os');
      expect(result.ecosystem).toBe('python');
      expect(result.score.level).toBe('high');
      expect(result.score.score).toBe(100);
      expect(result.score.scoreReasons).toContain('Standard library module');
    });

    it('should return high trust score for Node.js built-ins', async () => {
      const result = await analysisEngine.analyzePackage('fs', 'javascript');
      
      expect(result.packageName).toBe('fs');
      expect(result.ecosystem).toBe('javascript');
      expect(result.score.level).toBe('high');
      expect(result.score.score).toBe(100);
      expect(result.score.scoreReasons).toContain('Standard library module');
    });

    it('should handle node: prefixed packages', async () => {
      const result = await analysisEngine.analyzePackage('node:fs', 'javascript');
      
      expect(result.packageName).toBe('node:fs');
      expect(result.ecosystem).toBe('javascript');
      expect(result.score.level).toBe('high');
      expect(result.score.score).toBe(100);
    });

    it('should use cached results when available', async () => {
      const cachedScore = {
        packageName: 'test-package',
        score: 85,
        level: 'high' as const,
        ecosystem: 'python' as const,
        evidence: {
          exists: true,
          downloads: 10000,
          releaseAge: 86400000,
          multipleMaintainers: true,
          vulnerabilities: 0
        },
        scoreReasons: ['Cached result']
      };

      mockCacheData.python['test-package'] = {
        score: cachedScore,
        timestamp: Date.now()
      };

      const result = await analysisEngine.analyzePackage('test-package', 'python', {
        useCache: true,
        cacheData: mockCacheData
      });

      expect(result.score).toEqual(cachedScore);
      expect(result.processingTime).toBeLessThan(100);
    });

    it('should not use expired cache entries', async () => {
      const expiredCachedScore = {
        packageName: 'test-package',
        score: 85,
        level: 'high' as const,
        ecosystem: 'python' as const,
        evidence: {
          exists: true,
          downloads: 10000,
          releaseAge: 86400000,
          multipleMaintainers: true,
          vulnerabilities: 0
        },
        scoreReasons: ['Expired cached result']
      };

      // Set cache entry with expired timestamp
      mockCacheData.python['test-package'] = {
        score: expiredCachedScore,
        timestamp: Date.now() - (49 * 60 * 60 * 1000) // 49 hours ago
      };

      const result = await analysisEngine.analyzePackage('test-package', 'python', {
        useCache: true,
        cacheData: mockCacheData
      });

      // Should not use expired cache
      expect(result.score.scoreReasons).not.toContain('Expired cached result');
    });

    it('should handle analysis errors gracefully', async () => {
      // Mock adapter to throw error
      const mockAdapter = {
        meta: jest.fn().mockRejectedValue(new Error('Network error'))
      };

      // Replace adapter
      (analysisEngine as any).pypiAdapter = mockAdapter;

      const result = await analysisEngine.analyzePackage('error-package', 'python');

      expect(result.packageName).toBe('error-package');
      expect(result.score.level).toBe('unknown');
      expect(result.score.score).toBeNull();
      expect(result.score.scoreReasons).toContain('Analysis failed: Network error');
    });
  });

  describe('analyzePackages', () => {
    it('should analyze multiple packages concurrently', async () => {
      const packages = [
        { name: 'os', ecosystem: 'python' as const },
        { name: 'fs', ecosystem: 'javascript' as const },
        { name: 'sys', ecosystem: 'python' as const }
      ];

      const results = await analysisEngine.analyzePackages(packages);

      expect(results).toHaveLength(3);
      expect(results[0].packageName).toBe('os');
      expect(results[1].packageName).toBe('fs');
      expect(results[2].packageName).toBe('sys');

      // All should be standard library packages
      results.forEach(result => {
        expect(result.score.level).toBe('high');
        expect(result.score.score).toBe(100);
      });
    });

    it('should handle mixed success and failure scenarios', async () => {
      const packages = [
        { name: 'os', ecosystem: 'python' as const },
        { name: 'unknown-package', ecosystem: 'python' as const }
      ];

      const results = await analysisEngine.analyzePackages(packages);

      expect(results).toHaveLength(2);
      expect(results[0].score.level).toBe('high'); // Standard library
      // Second package behavior depends on mocked adapter
    });
  });

  describe('scoring logic', () => {
    it('should calculate appropriate scores based on different factors', () => {
      const engine = new AnalysisEngine();
      
      // Test base score calculation
      const highDownloadsInfo = {
        exists: true,
        downloads: 1000000,
        latestRelease: Date.now() - 86400000, // 1 day ago
        maintainerCount: 5,
        highVulnCount: 0,
        registryUrl: 'https://pypi.org/project/test'
      };

      const baseScore = (engine as any).calculateBaseScore(highDownloadsInfo);
      expect(baseScore).toBeGreaterThan(60); // Should be high due to good factors

      const lowDownloadsInfo = {
        exists: true,
        downloads: 100,
        latestRelease: Date.now() - (365 * 24 * 60 * 60 * 1000), // 1 year ago
        maintainerCount: 1,
        highVulnCount: 0,
        registryUrl: 'https://pypi.org/project/test'
      };

      const lowScore = (engine as any).calculateBaseScore(lowDownloadsInfo);
      expect(lowScore).toBeLessThan(baseScore);
    });

    it('should apply penalties for vulnerabilities', () => {
      const engine = new AnalysisEngine();
      
      const vulnerableInfo = {
        exists: true,
        downloads: 1000000,
        latestRelease: Date.now(),
        maintainerCount: 5,
        highVulnCount: 3,
        registryUrl: 'https://pypi.org/project/test'
      };

      const penalties = (engine as any).calculatePenalties('test-package', vulnerableInfo);
      expect(penalties).toBeGreaterThan(0);
      expect(penalties).toBe(30); // 3 vulnerabilities * 10 points each
    });

    it('should detect potential typosquatting', () => {
      const engine = new AnalysisEngine();
      
      // Test known typosquatting patterns
      expect((engine as any).isLikelyTyposquatting('python-requests')).toBe(true);
      expect((engine as any).isLikelyTyposquatting('js-react')).toBe(true);
      expect((engine as any).isLikelyTyposquatting('normal-package')).toBe(false);
      expect((engine as any).isLikelyTyposquatting('package12345')).toBe(true);
    });

    it('should determine correct trust levels', () => {
      const engine = new AnalysisEngine();
      
      // Python thresholds
      expect((engine as any).determineTrustLevel(85, 'python')).toBe('high');
      expect((engine as any).determineTrustLevel(65, 'python')).toBe('medium');
      expect((engine as any).determineTrustLevel(40, 'python')).toBe('low');

      // JavaScript thresholds
      expect((engine as any).determineTrustLevel(80, 'javascript')).toBe('high');
      expect((engine as any).determineTrustLevel(60, 'javascript')).toBe('medium');
      expect((engine as any).determineTrustLevel(30, 'javascript')).toBe('low');
    });
  });

  describe('evidence building', () => {
    it('should build comprehensive evidence objects', () => {
      const engine = new AnalysisEngine();
      
      const registryInfo = {
        exists: true,
        downloads: 50000,
        latestRelease: Date.now() - 86400000,
        maintainerCount: 3,
        highVulnCount: 1,
        registryUrl: 'https://pypi.org/project/test',
        githubRepo: 'https://github.com/test/test'
      };

      const evidence = (engine as any).buildEvidence(registryInfo);
      
      expect(evidence.exists).toBe(true);
      expect(evidence.downloads).toBe(50000);
      expect(evidence.multipleMaintainers).toBe(true);
      expect(evidence.vulnerabilities).toBe(1);
      expect(evidence.registryUrl).toBe('https://pypi.org/project/test');
      expect(evidence.githubRepo).toBe('https://github.com/test/test');
    });

    it('should generate appropriate score reasons', () => {
      const engine = new AnalysisEngine();
      
      const registryInfo = {
        exists: true,
        downloads: 50000,
        latestRelease: Date.now() - 86400000,
        maintainerCount: 3,
        highVulnCount: 1,
        registryUrl: 'https://pypi.org/project/test'
      };

      const reasons = (engine as any).buildScoreReasons(registryInfo, 5, 10);
      
      expect(reasons).toContain('Package exists in registry');
      expect(reasons).toContain('50,000 downloads');
      expect(reasons).toContain('3 maintainers');
      expect(reasons).toContain('1 high-severity vulnerabilities');
    });
  });

  describe('performance', () => {
    it('should complete analysis within reasonable time', async () => {
      const startTime = Date.now();
      
      const result = await analysisEngine.analyzePackage('os', 'python');
      
      expect(result.processingTime).toBeLessThan(1000); // Less than 1 second
      expect(Date.now() - startTime).toBeLessThan(2000); // Total time less than 2 seconds
    });

    it('should handle concurrent analysis efficiently', async () => {
      const packages = Array(10).fill(null).map((_, i) => ({
        name: `test-package-${i}`,
        ecosystem: 'python' as const
      }));

      const startTime = Date.now();
      const results = await analysisEngine.analyzePackages(packages);
      const totalTime = Date.now() - startTime;

      expect(results).toHaveLength(10);
      expect(totalTime).toBeLessThan(5000); // Should complete in under 5 seconds
    });
  });
});