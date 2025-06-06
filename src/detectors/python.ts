/**
 * Python package detector implementation.
 * Detects import statements in Python code.
 * 
 * @copilot.generateExample usage=true
 * @copilot.avoid any=true
 */

import { Detector, PackageName } from '../types';

/**
 * Regular expressions for detecting Python imports.
 */
const IMPORT_PATTERNS = [
  // from package import module
  /^\s*from\s+([a-zA-Z0-9_]+)\s+import\s+/gm,
  // import package
  /^\s*import\s+([a-zA-Z0-9_]+)\s*$/gm,
  // import package as alias
  /^\s*import\s+([a-zA-Z0-9_]+)\s+as\s+/gm
];

/**
 * Python package detector.
 * Detects import statements in Python code using regex patterns.
 */
export class PythonDetector implements Detector {
  /**
   * Detect package names in Python code.
   * 
   * @param text - The Python code to analyze
   * @returns Array of detected package names with their locations
   */
  public detect(text: string): PackageName[] {
    const packages: PackageName[] = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      
      // Skip comments and docstrings
      if (line.trim().startsWith('#') || line.trim().startsWith('"""')) {
        continue;
      }

      for (const pattern of IMPORT_PATTERNS) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          const packageName = match[1];
          if (packageName && match.index !== undefined) {
            packages.push({
              name: packageName,
              line: i + 1,
              column: match.index + 1,
              importText: line.trim()
            });
          }
        }
      }
    }

    return packages;
  }
} 