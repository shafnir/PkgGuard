/**
 * Core types and interfaces for the Package Guard extension.
 * 
 * @copilot.generateExample usage=true
 * @copilot.avoid any=true
 */

/**
 * Represents a package name detected in the code.
 */
export interface PackageName {
  /** The name of the package */
  name: string;
  /** The line number where the package was detected */
  line: number;
  /** The column where the package name starts */
  column: number;
  /** The full text of the import statement */
  importText: string;
}

/**
 * Registry information for a package.
 */
export interface RegistryInfo {
  /** Whether the package exists in the registry */
  exists: boolean;
  /** Number of downloads in the last 30 days */
  downloads: number;
  /** Timestamp of the latest release */
  latestRelease: number;
  /** Number of maintainers */
  maintainerCount: number;
  /** Number of high severity vulnerabilities */
  highVulnCount: number;
  /** GitHub repository URL (if available) */
  githubRepo?: string;
}

/**
 * Trust score for a package.
 */
export interface TrustScore {
  /** The package name */
  packageName: string;
  /** The calculated trust score (0-100, or null for ignored) */
  score: number | null;
  /** The trust level (🟢, 🟡, 🔴, or ⚪ for ignored) */
  level: 'high' | 'medium' | 'low' | 'ignored';
  /** The evidence used to calculate the score */
  evidence: {
    exists: boolean;
    downloads: number;
    releaseAge: number;
    multipleMaintainers: boolean;
    vulnerabilities: number;
  };
  /** Main reasons for the score (for UI explanation) */
  scoreReasons?: string[];
  /** Top PyPI download count (if available) */
  topDownloads?: number;
  /** Latest release date formatted as dd-mm-yyyy (if available) */
  releaseDate?: string;
  /** High risk factors (for red warnings) */
  highRiskFactors?: string[];
  /** Medium risk factors (for orange warnings) */
  mediumRiskFactors?: string[];
  /** Risk factors for UI, each with text and color */
  riskFactors?: { text: string; color: 'red' | 'orange' }[];
}

/**
 * Registry adapter interface.
 */
export interface RegistryAdapter {
  /** Check if a package exists in the registry */
  exists(name: string): Promise<boolean>;
  /** Get metadata for a package */
  meta(name: string): Promise<RegistryInfo>;
}

/**
 * Detector interface for different languages.
 */
export interface Detector {
  /** Detect package names in the given text */
  detect(text: string): PackageName[];
}

/**
 * Validation service message types.
 */
export type ValidationRequest = {
  id: string;
  names: string[];
};

export type ValidationResponse = {
  id: string;
  scores: TrustScore[];
}; 