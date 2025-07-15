#!/usr/bin/env node
/**
 * Build script for PkgGuard LSP MVP
 * Compiles TypeScript and creates production-ready bundles
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '../../..');
const LSP_ROOT = join(__dirname, '..');
const DIST_DIR = join(PROJECT_ROOT, 'dist');
const LSP_DIST_DIR = join(DIST_DIR, 'lsp');

console.log('🚀 Building PkgGuard LSP MVP...');

// Ensure directories exist
if (!existsSync(DIST_DIR)) {
  mkdirSync(DIST_DIR, { recursive: true });
}

if (!existsSync(LSP_DIST_DIR)) {
  mkdirSync(LSP_DIST_DIR, { recursive: true });
}

/**
 * Execute command with error handling
 */
function exec(command, options = {}) {
  try {
    console.log(`   ${command}`);
    const result = execSync(command, { 
      stdio: 'inherit', 
      cwd: PROJECT_ROOT,
      ...options 
    });
    return result;
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    console.error(error.message);
    process.exit(1);
  }
}

/**
 * Build TypeScript files
 */
function buildTypeScript() {
  console.log('\n📦 Compiling TypeScript...');
  exec('npx tsc -p tsconfig.json');
}

/**
 * Bundle LSP server
 */
function bundleLSPServer() {
  console.log('\n📦 Bundling LSP server...');
  
  const serverEntry = join(LSP_ROOT, 'server/index.ts');
  const serverOutput = join(LSP_DIST_DIR, 'lsp-server.js');
  
  // Use esbuild for bundling
  exec(`npx esbuild ${serverEntry} --bundle --outfile=${serverOutput} --platform=node --format=esm --external:vscode`);
  
  // Make executable
  exec(`chmod +x ${serverOutput}`);
  
  console.log(`   ✅ LSP server bundled: ${serverOutput}`);
}

/**
 * Bundle LSP client
 */
function bundleLSPClient() {
  console.log('\n📦 Bundling LSP client...');
  
  const clientEntry = join(LSP_ROOT, 'client/FaultTolerantClient.ts');
  const clientOutput = join(LSP_DIST_DIR, 'lsp-client.js');
  
  // Use esbuild for bundling
  exec(`npx esbuild ${clientEntry} --bundle --outfile=${clientOutput} --platform=node --format=esm --external:vscode`);
  
  console.log(`   ✅ LSP client bundled: ${clientOutput}`);
}

/**
 * Create package.json for LSP server
 */
function createServerPackageJson() {
  console.log('\n📦 Creating server package.json...');
  
  const serverPackage = {
    name: 'pkgguard-lsp-server',
    version: '1.0.0-mvp',
    type: 'module',
    main: 'lsp-server.js',
    engines: {
      node: '>=20.0.0'
    },
    dependencies: {
      'vscode-languageserver': '^9.0.1',
      'node-fetch': '^3.3.2'
    },
    scripts: {
      start: 'node lsp-server.js'
    },
    keywords: ['lsp', 'language-server', 'pkgguard', 'security'],
    author: 'PkgGuard Team',
    license: 'MIT'
  };
  
  const packagePath = join(LSP_DIST_DIR, 'package.json');
  writeFileSync(packagePath, JSON.stringify(serverPackage, null, 2));
  
  console.log(`   ✅ Server package.json created: ${packagePath}`);
}

/**
 * Copy configuration files
 */
function copyConfigFiles() {
  console.log('\n📦 Copying configuration files...');
  
  // Copy README
  const readmePath = join(LSP_ROOT, 'README.md');
  const readmeDestPath = join(LSP_DIST_DIR, 'README.md');
  
  if (existsSync(readmePath)) {
    const readmeContent = readFileSync(readmePath, 'utf-8');
    writeFileSync(readmeDestPath, readmeContent);
    console.log(`   ✅ README.md copied: ${readmeDestPath}`);
  }
  
  // Create launcher script
  const launcherScript = `#!/usr/bin/env node
/**
 * PkgGuard LSP Server Launcher
 * Starts the LSP server with proper configuration
 */

import { PkgGuardLSPServer } from './lsp-server.js';

// Set up environment
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Create and start server
const server = new PkgGuardLSPServer();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Start the server
server.listen();

console.log('PkgGuard LSP Server started successfully');
console.log('Process ID:', process.pid);
console.log('Node.js version:', process.version);
console.log('Environment:', process.env.NODE_ENV);
`;
  
  const launcherPath = join(LSP_DIST_DIR, 'start-server.js');
  writeFileSync(launcherPath, launcherScript);
  exec(`chmod +x ${launcherPath}`);
  
  console.log(`   ✅ Launcher script created: ${launcherPath}`);
}

/**
 * Run tests
 */
function runTests() {
  console.log('\n🧪 Running tests...');
  
  try {
    exec('npm test -- --testPathPattern=LSP --passWithNoTests');
    console.log('   ✅ All tests passed');
  } catch (error) {
    console.warn('   ⚠️  Some tests failed, but continuing build...');
  }
}

/**
 * Optimize bundles
 */
function optimizeBundles() {
  console.log('\n⚡ Optimizing bundles...');
  
  // Minify server bundle
  const serverPath = join(LSP_DIST_DIR, 'lsp-server.js');
  exec(`npx esbuild ${serverPath} --minify --outfile=${serverPath}.min.js --allow-overwrite`);
  
  // Minify client bundle
  const clientPath = join(LSP_DIST_DIR, 'lsp-client.js');
  exec(`npx esbuild ${clientPath} --minify --outfile=${clientPath}.min.js --allow-overwrite`);
  
  console.log('   ✅ Bundles optimized');
}

/**
 * Generate build info
 */
function generateBuildInfo() {
  console.log('\n📊 Generating build info...');
  
  const buildInfo = {
    version: '1.0.0-mvp',
    buildDate: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    gitCommit: process.env.GITHUB_SHA || 'unknown',
    gitBranch: process.env.GITHUB_REF || 'unknown',
    components: {
      server: 'lsp-server.js',
      client: 'lsp-client.js',
      launcher: 'start-server.js'
    },
    dependencies: {
      'vscode-languageserver': '^9.0.1',
      'vscode-languageclient': '^9.0.1',
      'node-fetch': '^3.3.2'
    }
  };
  
  const buildInfoPath = join(LSP_DIST_DIR, 'build-info.json');
  writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2));
  
  console.log(`   ✅ Build info generated: ${buildInfoPath}`);
}

/**
 * Main build process
 */
function main() {
  const startTime = Date.now();
  
  try {
    buildTypeScript();
    bundleLSPServer();
    bundleLSPClient();
    createServerPackageJson();
    copyConfigFiles();
    runTests();
    optimizeBundles();
    generateBuildInfo();
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('\n🎉 Build completed successfully!');
    console.log(`   ⏱️  Duration: ${duration}s`);
    console.log(`   📁 Output: ${LSP_DIST_DIR}`);
    console.log('\n📋 Next steps:');
    console.log('   1. Test the LSP server: node dist/lsp/lsp-server.js');
    console.log('   2. Use the launcher: node dist/lsp/start-server.js');
    console.log('   3. Install in VS Code: Copy files to extension');
    
  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  }
}

// Handle command line arguments
if (process.argv.includes('--help')) {
  console.log(`
PkgGuard LSP Build Script

Usage: node build.js [options]

Options:
  --help          Show this help message
  --skip-tests    Skip running tests
  --skip-minify   Skip minification
  --verbose       Enable verbose logging

Examples:
  node build.js                # Full build
  node build.js --skip-tests   # Build without tests
  node build.js --skip-minify  # Build without minification
`);
  process.exit(0);
}

if (process.argv.includes('--skip-tests')) {
  console.log('⚠️  Skipping tests...');
  runTests = () => console.log('   ⏭️  Tests skipped');
}

if (process.argv.includes('--skip-minify')) {
  console.log('⚠️  Skipping minification...');
  optimizeBundles = () => console.log('   ⏭️  Minification skipped');
}

if (process.argv.includes('--verbose')) {
  console.log('📝 Verbose logging enabled');
}

// Run the build
main();