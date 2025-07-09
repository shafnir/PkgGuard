/**
 * Python package detector implementation.
 * Detects import statements in Python code.
 *
 * @copilot.generateExample usage=true
 * @copilot.avoid any=true
 */

import { Detector, PackageName } from "../types";

/**
 * Regular expressions for detecting Python imports.
 */
const IMPORT_PATTERNS = [
  // from package import module/symbol
  /^\s*from\s+([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\s+import\s+/gm,
  // import package.submodule
  /^\s*import\s+([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\s*$/gm,
  // import package.submodule as alias
  /^\s*import\s+([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\s+as\s+/gm,
];

/**
 * Extract base package name from dotted module path.
 * Examples:
 * - "xml.etree.ElementTree" -> "xml"
 * - "urllib.request" -> "urllib"
 * - "flask" -> "flask"
 */
function getBasePackageName(modulePath: string): string {
  const parts = modulePath.split(".");
  return parts[0] || modulePath;
}

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
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Skip full-line comments and docstrings
      if (line.trim().startsWith("#") || line.trim().startsWith('"""')) {
        continue;
      }

      // Process line to handle inline comments
      const processedLine = line.split("#")[0]?.trim() || "";
      if (!processedLine) continue;

      // Only process lines that actually start with import keywords
      if (
        !processedLine.startsWith("import ") &&
        !processedLine.startsWith("from ")
      ) {
        continue;
      }

      for (const pattern of IMPORT_PATTERNS) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(processedLine)) !== null) {
          const fullModulePath = match[1];
          if (fullModulePath && match.index !== undefined) {
            const basePackageName = getBasePackageName(fullModulePath);
            packages.push({
              name: basePackageName,
              line: i + 1,
              column: match.index + 1,
              importText: line.trim(),
            });
          }
        }
      }
    }

    return packages;
  }
}
