/**
 * Package extraction utility for parsing package manager commands.
 * Extracts package names and determines ecosystems from terminal commands.
 */

export interface ExtractedPackage {
  name: string;
  ecosystem: "python" | "javascript";
  version?: string;
  flags?: string[];
}

export interface ExtractionResult {
  packages: ExtractedPackage[];
  command: string;
  ecosystem: "python" | "javascript" | "mixed";
  isInstallCommand: boolean;
  packageManager: string;
}

/**
 * Utility class for extracting package information from terminal commands.
 */
export class PackageExtractor {
  
  /**
   * Extract package information from a terminal command.
   */
  static extractPackages(command: string): ExtractionResult {
    const trimmedCommand = command.trim();
    
    // Check for Python package managers
    const pythonResult = this.extractPythonPackages(trimmedCommand);
    if (pythonResult.packages.length > 0) {
      return pythonResult;
    }

    // Check for JavaScript package managers
    const jsResult = this.extractJavaScriptPackages(trimmedCommand);
    if (jsResult.packages.length > 0) {
      return jsResult;
    }

    // No packages found
    return {
      packages: [],
      command: trimmedCommand,
      ecosystem: "mixed",
      isInstallCommand: false,
      packageManager: "unknown"
    };
  }

  /**
   * Extract Python packages from pip, poetry, pipenv commands.
   */
  private static extractPythonPackages(command: string): ExtractionResult {
    const pythonPatterns = [
      { 
        pattern: /^pip\s+install\s+(.+)$/i,
        manager: "pip",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^pip3\s+install\s+(.+)$/i,
        manager: "pip3",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^python\s+-m\s+pip\s+install\s+(.+)$/i,
        manager: "pip",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^python3\s+-m\s+pip\s+install\s+(.+)$/i,
        manager: "pip",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^poetry\s+add\s+(.+)$/i,
        manager: "poetry",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^pipenv\s+install\s+(.+)$/i,
        manager: "pipenv",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^uv\s+add\s+(.+)$/i,
        manager: "uv",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^conda\s+install\s+(.+)$/i,
        manager: "conda",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^mamba\s+install\s+(.+)$/i,
        manager: "mamba",
        flagsPattern: /^-[a-zA-Z-]+/
      }
    ];

    for (const { pattern, manager, flagsPattern } of pythonPatterns) {
      const match = command.match(pattern);
      if (match) {
        const packages = this.parsePythonPackageSpecs(match[1] || "", flagsPattern);
        return {
          packages,
          command,
          ecosystem: "python",
          isInstallCommand: true,
          packageManager: manager
        };
      }
    }

    return {
      packages: [],
      command,
      ecosystem: "python",
      isInstallCommand: false,
      packageManager: "unknown"
    };
  }

  /**
   * Extract JavaScript packages from npm, yarn, pnpm commands.
   */
  private static extractJavaScriptPackages(command: string): ExtractionResult {
    const jsPatterns = [
      { 
        pattern: /^npm\s+install\s+(.+)$/i,
        manager: "npm",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^npm\s+i\s+(.+)$/i,
        manager: "npm",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^npm\s+add\s+(.+)$/i,
        manager: "npm",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^yarn\s+add\s+(.+)$/i,
        manager: "yarn",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^yarn\s+install\s+(.+)$/i,
        manager: "yarn",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^pnpm\s+add\s+(.+)$/i,
        manager: "pnpm",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^pnpm\s+install\s+(.+)$/i,
        manager: "pnpm",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^bun\s+add\s+(.+)$/i,
        manager: "bun",
        flagsPattern: /^-[a-zA-Z-]+/
      },
      { 
        pattern: /^bun\s+install\s+(.+)$/i,
        manager: "bun",
        flagsPattern: /^-[a-zA-Z-]+/
      }
    ];

    for (const { pattern, manager, flagsPattern } of jsPatterns) {
      const match = command.match(pattern);
      if (match) {
        const packages = this.parseJavaScriptPackageSpecs(match[1] || "", flagsPattern);
        return {
          packages,
          command,
          ecosystem: "javascript",
          isInstallCommand: true,
          packageManager: manager
        };
      }
    }

    return {
      packages: [],
      command,
      ecosystem: "javascript",
      isInstallCommand: false,
      packageManager: "unknown"
    };
  }

  /**
   * Parse Python package specifications.
   */
  private static parsePythonPackageSpecs(
    packageSpecs: string,
    flagsPattern: RegExp
  ): ExtractedPackage[] {
    const packages: ExtractedPackage[] = [];
    const specs = packageSpecs.split(/\s+/).filter(spec => spec.trim());

    for (const spec of specs) {
      // Skip flags
      if (flagsPattern.test(spec)) {
        continue;
      }

      // Skip common pip flags
      if (spec.startsWith('-') || spec === '--upgrade' || spec === '--user' || 
          spec === '--force-reinstall' || spec === '--no-deps' || spec === '--editable') {
        continue;
      }

      const cleaned = this.cleanPythonPackageName(spec);
      if (cleaned.name && !cleaned.name.startsWith('-')) {
        packages.push({
          name: cleaned.name,
          ecosystem: "python",
          version: cleaned.version,
          flags: cleaned.flags
        });
      }
    }

    return packages;
  }

  /**
   * Parse JavaScript package specifications.
   */
  private static parseJavaScriptPackageSpecs(
    packageSpecs: string,
    flagsPattern: RegExp
  ): ExtractedPackage[] {
    const packages: ExtractedPackage[] = [];
    const specs = packageSpecs.split(/\s+/).filter(spec => spec.trim());

    for (const spec of specs) {
      // Skip flags
      if (flagsPattern.test(spec)) {
        continue;
      }

      // Skip common npm flags
      if (spec.startsWith('-') || spec === '--save' || spec === '--save-dev' || 
          spec === '--global' || spec === '--exact' || spec === '--save-optional') {
        continue;
      }

      const cleaned = this.cleanJavaScriptPackageName(spec);
      if (cleaned.name && !cleaned.name.startsWith('-')) {
        packages.push({
          name: cleaned.name,
          ecosystem: "javascript",
          version: cleaned.version,
          flags: cleaned.flags
        });
      }
    }

    return packages;
  }

  /**
   * Clean and parse Python package name from specification.
   */
  private static cleanPythonPackageName(spec: string): {
    name: string;
    version?: string;
    flags?: string[];
  } {
    let name = spec;
    let version: string | undefined;
    const flags: string[] = [];

    // Handle version specifiers
    const versionSeparators = ["==", ">=", "<=", "!=", "~=", ">", "<"];
    for (const sep of versionSeparators) {
      const parts = name.split(sep);
      if (parts.length > 1) {
        name = parts[0];
        version = parts[1];
        break;
      }
    }

    // Handle extras (e.g., package[extra])
    const extraMatch = name.match(/^([^[]+)\[([^\]]+)\]$/);
    if (extraMatch) {
      name = extraMatch[1] || "";
      flags.push(`extra:${extraMatch[2] || ""}`);
    }

    // Handle URLs and VCS
    if (name.includes('@')) {
      const parts = name.split('@');
      name = parts[0] || "";
      version = parts[1] || "";
    }

    // Handle git+https:// URLs
    if (name.startsWith('git+') || name.startsWith('https://') || name.startsWith('http://')) {
      const match = name.match(/\/([^\/]+?)(?:\.git)?(?:#|$)/);
      if (match) {
        name = match[1] || "";
        flags.push('vcs');
      }
    }

    // Handle file:// URLs
    if (name.startsWith('file://')) {
      const match = name.match(/\/([^\/]+?)(?:\.tar\.gz|\.zip|\.whl)?$/);
      if (match) {
        name = match[1] || "";
        flags.push('local');
      }
    }

    // Handle -e flag (editable installs)
    if (name.startsWith('-e ')) {
      name = name.substring(3);
      flags.push('editable');
    }

    return {
      name: name.trim(),
      version,
      flags: flags.length > 0 ? flags : undefined
    };
  }

  /**
   * Clean and parse JavaScript package name from specification.
   */
  private static cleanJavaScriptPackageName(spec: string): {
    name: string;
    version?: string;
    flags?: string[];
  } {
    let name = spec;
    let version: string | undefined;
    const flags: string[] = [];

    // Handle version specifiers
    const versionMatch = name.match(/^(@?[^@]+)@(.+)$/);
    if (versionMatch) {
      name = versionMatch[1];
      version = versionMatch[2];
    }

    // Handle scoped packages (@scope/package)
    if (name.startsWith('@') && !name.includes('/')) {
      // Invalid scoped package format
      return { name: "", version, flags };
    }

    // Handle URLs
    if (name.includes('://')) {
      const match = name.match(/\/([^\/]+?)(?:\.git)?(?:#|$)/);
      if (match) {
        name = match[1] || "";
        flags.push('vcs');
      }
    }

    // Handle file:// URLs
    if (name.startsWith('file://')) {
      const match = name.match(/\/([^\/]+?)(?:\.tar\.gz|\.tgz)?$/);
      if (match) {
        name = match[1] || "";
        flags.push('local');
      }
    }

    // Handle relative paths
    if (name.startsWith('./') || name.startsWith('../')) {
      const match = name.match(/\/([^\/]+?)$/);
      if (match) {
        name = match[1] || "";
        flags.push('local');
      }
    }

    return {
      name: name.trim(),
      version,
      flags: flags.length > 0 ? flags : undefined
    };
  }

  /**
   * Check if a command is a package installation command.
   */
  static isInstallCommand(command: string): boolean {
    const installPatterns = [
      /^pip\s+install\b/i,
      /^pip3\s+install\b/i,
      /^python\s+-m\s+pip\s+install\b/i,
      /^python3\s+-m\s+pip\s+install\b/i,
      /^poetry\s+add\b/i,
      /^pipenv\s+install\b/i,
      /^uv\s+add\b/i,
      /^conda\s+install\b/i,
      /^mamba\s+install\b/i,
      /^npm\s+install\b/i,
      /^npm\s+i\b/i,
      /^npm\s+add\b/i,
      /^yarn\s+add\b/i,
      /^yarn\s+install\b/i,
      /^pnpm\s+add\b/i,
      /^pnpm\s+install\b/i,
      /^bun\s+add\b/i,
      /^bun\s+install\b/i
    ];

    return installPatterns.some(pattern => pattern.test(command.trim()));
  }

  /**
   * Get the ecosystem from a command.
   */
  static getEcosystem(command: string): "python" | "javascript" | "mixed" {
    const pythonPatterns = [
      /^pip\b/i,
      /^pip3\b/i,
      /^python\s+-m\s+pip\b/i,
      /^python3\s+-m\s+pip\b/i,
      /^poetry\b/i,
      /^pipenv\b/i,
      /^uv\b/i,
      /^conda\b/i,
      /^mamba\b/i
    ];

    const jsPatterns = [
      /^npm\b/i,
      /^yarn\b/i,
      /^pnpm\b/i,
      /^bun\b/i
    ];

    const trimmedCommand = command.trim();
    
    if (pythonPatterns.some(pattern => pattern.test(trimmedCommand))) {
      return "python";
    }
    
    if (jsPatterns.some(pattern => pattern.test(trimmedCommand))) {
      return "javascript";
    }

    return "mixed";
  }

  /**
   * Validate extracted package names.
   */
  static validatePackageName(name: string, ecosystem: "python" | "javascript"): boolean {
    if (!name || name.trim().length === 0) {
      return false;
    }

    if (ecosystem === "python") {
      // Python package name validation
      // Must start with letter or underscore, contain only letters, numbers, dots, hyphens, underscores
      return /^[a-zA-Z_][a-zA-Z0-9._-]*$/.test(name);
    } else {
      // JavaScript package name validation
      // Can be scoped (@scope/package) or regular package name
      if (name.startsWith('@')) {
        return /^@[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(name);
      } else {
        return /^[a-zA-Z0-9._-]+$/.test(name);
      }
    }
  }
}