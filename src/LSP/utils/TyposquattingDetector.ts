/**
 * Advanced typosquatting detection using multiple techniques.
 * Combines pattern matching, edit distance, and heuristic analysis.
 */

import { LSPConfigManager } from '../config/LSPConfig.js';

export interface TyposquattingResult {
  isSuspicious: boolean;
  confidence: number; // 0-1 scale
  reasons: string[];
  similarPackages?: string[];
}

/**
 * Advanced typosquatting detection engine.
 */
export class TyposquattingDetector {
  private readonly configManager = LSPConfigManager.getInstance();
  private readonly patterns = this.configManager.getTyposquattingPatterns();
  private readonly popularPackages = this.getPopularPackages();

  /**
   * Analyze a package name for typosquatting indicators.
   */
  analyze(packageName: string, ecosystem: "python" | "javascript"): TyposquattingResult {
    const reasons: string[] = [];
    let suspiciousScore = 0;
    const maxScore = 100;

    // 1. Pattern-based detection (30 points)
    const patternResult = this.checkPatterns(packageName);
    if (patternResult.matches) {
      suspiciousScore += 30;
      reasons.push(`Matches suspicious pattern: ${patternResult.pattern}`);
    }

    // 2. Edit distance analysis (25 points)
    const editDistanceResult = this.checkEditDistance(packageName, ecosystem);
    if (editDistanceResult.isSuspicious) {
      suspiciousScore += 25;
      reasons.push(`Similar to popular package: ${editDistanceResult.similarPackage}`);
    }

    // 3. Character substitution detection (20 points)
    const substitutionResult = this.checkCharacterSubstitution(packageName);
    if (substitutionResult.isSuspicious) {
      suspiciousScore += 20;
      reasons.push(`Contains character substitutions: ${substitutionResult.substitutions.join(', ')}`);
    }

    // 4. Homograph detection (15 points)
    const homographResult = this.checkHomographs(packageName);
    if (homographResult.isSuspicious) {
      suspiciousScore += 15;
      reasons.push(`Contains homograph characters: ${homographResult.homographs.join(', ')}`);
    }

    // 5. Length and structure analysis (10 points)
    const structureResult = this.checkStructure(packageName);
    if (structureResult.isSuspicious) {
      suspiciousScore += 10;
      reasons.push(`Suspicious structure: ${structureResult.reason}`);
    }

    const confidence = Math.min(suspiciousScore / maxScore, 1);
    const isSuspicious = confidence > 0.4; // 40% threshold

    return {
      isSuspicious,
      confidence,
      reasons,
      similarPackages: editDistanceResult.similarPackages
    };
  }

  /**
   * Check against known suspicious patterns.
   */
  private checkPatterns(packageName: string): { matches: boolean; pattern?: string } {
    for (const pattern of this.patterns) {
      if (pattern.test(packageName)) {
        return { matches: true, pattern: pattern.toString() };
      }
    }
    return { matches: false };
  }

  /**
   * Check edit distance against popular packages.
   */
  private checkEditDistance(packageName: string, ecosystem: "python" | "javascript"): {
    isSuspicious: boolean;
    similarPackage?: string;
    similarPackages?: string[];
  } {
    const popularPackages = this.popularPackages[ecosystem] || [];
    const similarPackages: string[] = [];
    
    for (const popularPackage of popularPackages) {
      const distance = this.calculateEditDistance(packageName, popularPackage);
      const maxLength = Math.max(packageName.length, popularPackage.length);
      const similarity = 1 - (distance / maxLength);
      
      // If very similar but not exact match, it's suspicious
      if (similarity > 0.8 && similarity < 1.0) {
        similarPackages.push(popularPackage);
      }
    }

    return {
      isSuspicious: similarPackages.length > 0,
      similarPackage: similarPackages[0],
      similarPackages
    };
  }

  /**
   * Check for character substitutions (e.g., 0 for o, 1 for l).
   */
  private checkCharacterSubstitution(packageName: string): {
    isSuspicious: boolean;
    substitutions: string[];
  } {
    const substitutions: string[] = [];
    
    // Common substitutions
    const substitutionMap = {
      '0': 'o',
      '1': 'l',
      '3': 'e',
      '4': 'a',
      '5': 's',
      '6': 'g',
      '7': 't',
      '8': 'b',
      '9': 'g',
      'rn': 'm',
      'vv': 'w',
      'cl': 'd'
    };

    for (const [substitute, original] of Object.entries(substitutionMap)) {
      if (packageName.includes(substitute)) {
        substitutions.push(`${substitute} → ${original}`);
      }
    }

    return {
      isSuspicious: substitutions.length > 0,
      substitutions
    };
  }

  /**
   * Check for homograph characters (visually similar characters).
   */
  private checkHomographs(packageName: string): {
    isSuspicious: boolean;
    homographs: string[];
  } {
    const homographs: string[] = [];
    
    // Unicode homographs
    const homographMap = {
      'а': 'a', // Cyrillic a
      'е': 'e', // Cyrillic e
      'о': 'o', // Cyrillic o
      'р': 'p', // Cyrillic p
      'с': 'c', // Cyrillic c
      'х': 'x', // Cyrillic x
      'у': 'y', // Cyrillic y
      'ι': 'i', // Greek iota
      'ο': 'o', // Greek omicron
      'υ': 'u', // Greek upsilon
      'ϲ': 'c', // Greek lunate sigma
      'ν': 'v', // Greek nu
      'τ': 't', // Greek tau
      'κ': 'k', // Greek kappa
      'η': 'n', // Greek eta
      'μ': 'm', // Greek mu
      'ρ': 'p', // Greek rho
      'ѕ': 's', // Cyrillic dze
      'ј': 'j', // Cyrillic je
      'һ': 'h', // Cyrillic shha
      'ҝ': 'k', // Cyrillic ka with hook
      'ӏ': 'l', // Cyrillic palochka
      'ա': 'a', // Armenian a
      'ս': 's', // Armenian s
      'ժ': 'zh', // Armenian zhe
      'ր': 'r', // Armenian r
      'ց': 'c', // Armenian c
      'ւ': 'u', // Armenian u
      'փ': 'p', // Armenian p
      'ք': 'k', // Armenian k
      'օ': 'o', // Armenian o
      'ֆ': 'f'  // Armenian f
    };

    for (const [homograph, latin] of Object.entries(homographMap)) {
      if (packageName.includes(homograph)) {
        homographs.push(`${homograph} → ${latin}`);
      }
    }

    return {
      isSuspicious: homographs.length > 0,
      homographs
    };
  }

  /**
   * Check package structure for suspicious patterns.
   */
  private checkStructure(packageName: string): {
    isSuspicious: boolean;
    reason?: string;
  } {
    // Very short names (< 3 characters) are suspicious
    if (packageName.length < 3) {
      return { isSuspicious: true, reason: 'Package name too short' };
    }

    // Very long names (> 50 characters) are suspicious
    if (packageName.length > 50) {
      return { isSuspicious: true, reason: 'Package name too long' };
    }

    // Too many consecutive numbers
    if (/\d{4,}/.test(packageName)) {
      return { isSuspicious: true, reason: 'Contains long number sequence' };
    }

    // Too many consecutive same characters
    if (/(.)\1{3,}/.test(packageName)) {
      return { isSuspicious: true, reason: 'Contains repeated character sequence' };
    }

    // Mixed scripts (Latin + non-Latin)
    const hasLatin = /[a-zA-Z]/.test(packageName);
    const hasNonLatin = /[^\x00-\x7F]/.test(packageName);
    if (hasLatin && hasNonLatin) {
      return { isSuspicious: true, reason: 'Mixed character scripts' };
    }

    // Excessive use of separators
    const separatorCount = (packageName.match(/[-_.]/g) || []).length;
    if (separatorCount > 5) {
      return { isSuspicious: true, reason: 'Excessive use of separators' };
    }

    // Alternating case patterns (e.g., aBcDeF)
    if (/^[a-z]([A-Z][a-z]){3,}/.test(packageName)) {
      return { isSuspicious: true, reason: 'Alternating case pattern' };
    }

    return { isSuspicious: false };
  }

  /**
   * Calculate Levenshtein distance between two strings.
   */
  private calculateEditDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) {
      matrix[0]![i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j]![0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j]![i] = Math.min(
          matrix[j]![i - 1]! + 1, // deletion
          matrix[j - 1]![i]! + 1, // insertion
          matrix[j - 1]![i - 1]! + indicator // substitution
        );
      }
    }

    return matrix[str2.length]![str1.length]!;
  }

  /**
   * Get popular packages for each ecosystem.
   */
  private getPopularPackages(): { python: string[]; javascript: string[] } {
    return {
      python: [
        'requests', 'urllib3', 'setuptools', 'certifi', 'pip', 'wheel', 'six',
        'python-dateutil', 'pytz', 'pyyaml', 'click', 'jinja2', 'markupsafe',
        'packaging', 'numpy', 'charset-normalizer', 'idna', 'colorama', 'attrs',
        'pluggy', 'py', 'tomli', 'pyparsing', 'pytest', 'more-itertools',
        'importlib-metadata', 'zipp', 'typing-extensions', 'filelock', 'platformdirs',
        'distlib', 'virtualenv', 'cffi', 'pycparser', 'cryptography', 'decorator',
        'wrapt', 'deprecated', 'pyjwt', 'oauthlib', 'requests-oauthlib',
        'botocore', 's3transfer', 'boto3', 'awscli', 'docutils', 'jmespath',
        'rsa', 'pyasn1', 'pydantic', 'fastapi', 'starlette', 'uvicorn',
        'django', 'flask', 'pandas', 'matplotlib', 'seaborn', 'scikit-learn',
        'scipy', 'tensorflow', 'torch', 'pillow', 'opencv-python', 'sqlalchemy',
        'psycopg2', 'pymongo', 'redis', 'celery', 'gunicorn', 'gevent'
      ],
      javascript: [
        'lodash', 'react', 'chalk', 'debug', 'express', 'commander', 'vue',
        'request', 'async', 'moment', 'underscore', 'axios', 'jquery',
        'typescript', 'webpack', 'babel-core', 'eslint', 'prettier',
        'fs-extra', 'uuid', 'inquirer', 'yargs', 'glob', 'rimraf',
        'mkdirp', 'semver', 'bluebird', 'cross-env', 'dotenv', 'nodemon',
        'jest', 'mocha', 'chai', 'sinon', 'supertest', 'cypress',
        'react-dom', 'react-router-dom', 'redux', 'react-redux',
        'next', 'gatsby', 'nuxt', 'vue-router', 'vuex', 'angular',
        'rxjs', 'zone.js', 'core-js', 'regenerator-runtime', 'tslib',
        'ws', 'socket.io', 'express-session', 'passport', 'bcryptjs',
        'jsonwebtoken', 'cors', 'helmet', 'morgan', 'compression',
        'multer', 'body-parser', 'cookie-parser', 'express-validator'
      ]
    };
  }
}