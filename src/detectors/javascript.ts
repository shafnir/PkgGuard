// JavaScript/TypeScript package detector implementation.
// Detects import and require statements in JS/TS code.

import { Detector, PackageName } from "../types";

const IMPORT_PATTERNS = [
  // ES6 import ... from 'package' (including node: prefix)
  /^\s*import\s+[^'"\n]+from\s+['"]([a-zA-Z0-9_\-@/:]+)['"]/gm,
  // ES6 import 'package' (including node: prefix)
  /^\s*import\s+['"]([a-zA-Z0-9_\-@/:]+)['"]/gm,
  // CommonJS require('package') (including node: prefix)
  /require\(['"]([a-zA-Z0-9_\-@/:]+)['"]\)/gm,
];

/**
 * Normalizes package names to handle Node.js built-in modules and other special cases
 * @param packageName - The raw package name from import/require statement
 * @returns Normalized package name
 */
function normalizePackageName(packageName: string): string {
  // Handle Node.js built-in modules with node: prefix
  if (packageName.startsWith("node:")) {
    return packageName.substring(5); // Remove 'node:' prefix
  }
  return packageName;
}

export class JavaScriptDetector implements Detector {
  public detect(text: string): PackageName[] {
    const packages: PackageName[] = [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      // Skip comments
      if (line.trim().startsWith("//")) continue;
      for (const pattern of IMPORT_PATTERNS) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          const rawPackageName = match[1];
          if (rawPackageName && match.index !== undefined) {
            const normalizedPackageName = normalizePackageName(rawPackageName);

            // Skip relative imports and file paths
            if (
              !normalizedPackageName.startsWith(".") &&
              !normalizedPackageName.startsWith("/")
            ) {
              packages.push({
                name: normalizedPackageName,
                line: i + 1,
                column: match.index + 1,
                importText: line.trim(),
              });
            }
          }
        }
      }
    }
    return packages;
  }
}
