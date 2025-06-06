// JavaScript/TypeScript package detector implementation.
// Detects import and require statements in JS/TS code.

import { Detector, PackageName } from '../types';

const IMPORT_PATTERNS = [
    // ES6 import ... from 'package'
    /^\s*import\s+[^'"\n]+from\s+['"]([a-zA-Z0-9_\-@/]+)['"]/gm,
    // ES6 import 'package'
    /^\s*import\s+['"]([a-zA-Z0-9_\-@/]+)['"]/gm,
    // CommonJS require('package')
    /require\(['"]([a-zA-Z0-9_\-@/]+)['"]\)/gm
];

export class JavaScriptDetector implements Detector {
    public detect(text: string): PackageName[] {
        const packages: PackageName[] = [];
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            // Skip comments
            if (line.trim().startsWith('//')) continue;
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