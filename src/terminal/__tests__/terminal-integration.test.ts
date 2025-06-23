/**
 * Tests for Terminal Integration functionality
 */

import { TerminalPackageMonitor } from '../shell-integration';
import { TerminalDecorator } from '../decorators';
import { TrustScore } from '../../types';

describe('Terminal Integration', () => {
    describe('TerminalPackageMonitor', () => {
        let monitor: TerminalPackageMonitor;

        beforeEach(() => {
            monitor = new TerminalPackageMonitor();
        });

        test('should extract Python package names from pip commands', () => {
            const commands = [
                'pip install requests',
                'pip3 install django==4.0.0',
                'python -m pip install numpy[all]',
                'poetry add fastapi',
                'pipenv install flask'
            ];

            commands.forEach(command => {
                const packages = (monitor as any).extractPackageNames(command);
                expect(packages.length).toBeGreaterThan(0);
                expect(packages[0].ecosystem).toBe('python');
            });
        });

        test('should extract JavaScript package names from npm commands', () => {
            const commands = [
                'npm install react',
                'npm i @types/node',
                'yarn add lodash',
                'pnpm add express',
                'bun add typescript'
            ];

            commands.forEach(command => {
                const packages = (monitor as any).extractPackageNames(command);
                expect(packages.length).toBeGreaterThan(0);
                expect(packages[0].ecosystem).toBe('javascript');
            });
        });

        test('should clean package specifications correctly', () => {
            const testCases = [
                { input: 'requests==2.28.0', expected: 'requests' },
                { input: 'django>=4.0.0', expected: 'django' },
                { input: 'numpy[all]', expected: 'numpy' },
                { input: '@types/node@^18.0.0', expected: '@types/node' },
                { input: 'react@latest', expected: 'react' }
            ];

            testCases.forEach(({ input, expected }) => {
                const result = (monitor as any).cleanPackageName(input);
                expect(result).toBe(expected);
            });
        });

        test('should ignore invalid package specifications', () => {
            const invalidSpecs = [
                '--upgrade',
                '-r requirements.txt',
                '',
                '   ',
                '--index-url https://example.com'
            ];

            invalidSpecs.forEach(spec => {
                const result = (monitor as any).cleanPackageName(spec);
                expect(result).toBe(null);
            });
        });

        test('should not extract packages from non-install commands', () => {
            const commands = [
                'ls -la',
                'cd /home/user',
                'python script.py',
                'npm run build',
                'git commit -m "message"'
            ];

            commands.forEach(command => {
                const packages = (monitor as any).extractPackageNames(command);
                expect(packages.length).toBe(0);
            });
        });
    });

    describe('TerminalDecorator', () => {
        const mockTrustScore: TrustScore = {
            packageName: 'test-package',
            score: 85,
            level: 'high',
            evidence: {
                exists: true,
                downloads: 100000,
                releaseAge: 30,
                multipleMaintainers: true,
                vulnerabilities: 0,
                maintainerCount: 5
            }
        };

        test('should create trust badge with correct emoji and color', () => {
            const badge = TerminalDecorator.createTrustBadge(mockTrustScore);
            expect(badge).toContain('🟢');
            expect(badge).toContain('85');
            expect(badge).toContain('\x1b[32m'); // Green color
            expect(badge).toContain('\x1b[0m');  // Reset color
        });

        test('should create trust badge for different trust levels', () => {
            const testCases = [
                { level: 'high' as const, emoji: '🟢', score: 90 },
                { level: 'medium' as const, emoji: '🟡', score: 65 },
                { level: 'low' as const, emoji: '🔴', score: 30 },
                { level: 'ignored' as const, emoji: '⚪', score: null }
            ];

            testCases.forEach(({ level, emoji, score }) => {
                const trustScore: TrustScore = {
                    ...mockTrustScore,
                    level,
                    score
                };
                const badge = TerminalDecorator.createTrustBadge(trustScore);
                expect(badge).toContain(emoji);
            });
        });

        test('should decorate package name with trust indicator', () => {
            const decorated = TerminalDecorator.decoratePackageName('requests', mockTrustScore);
            expect(decorated).toContain('requests');
            expect(decorated).toContain('🟢');
            expect(decorated).toContain('\x1b[4m'); // Underscore
        });

        test('should create security report for multiple packages', () => {
            const packages = [
                {
                    name: 'requests',
                    score: { ...mockTrustScore, level: 'high' as const, score: 95 },
                    ecosystem: 'python'
                },
                {
                    name: 'suspicious-pkg',
                    score: {
                        ...mockTrustScore,
                        level: 'low' as const,
                        score: 15,
                        riskFactors: [
                            { text: 'Package does not exist', color: 'red' as const }
                        ]
                    },
                    ecosystem: 'python'
                }
            ];

            const report = TerminalDecorator.createSecurityReport(packages);
            expect(report).toContain('PkgGuard Security Report');
            expect(report).toContain('requests');
            expect(report).toContain('suspicious-pkg');
            expect(report).toContain('High risk: 1');
            expect(report).toContain('Low risk: 1');
        });

        test('should create warning box for high-risk packages', () => {
            const packages = ['fake-requests', 'malicious-lib'];
            const warning = TerminalDecorator.createWarningBox(packages);
            
            expect(warning).toContain('SECURITY WARNING');
            expect(warning).toContain('fake-requests');
            expect(warning).toContain('malicious-lib');
            expect(warning).toContain('╔');
            expect(warning).toContain('╚');
        });

        test('should create success box for safe packages', () => {
            const packages = ['requests', 'django', 'numpy'];
            const success = TerminalDecorator.createSuccessBox(packages);
            
            expect(success).toContain('SECURITY CHECK PASSED');
            expect(success).toContain('requests');
            expect(success).toContain('django');
            expect(success).toContain('numpy');
        });

        test('should create progress indicator', () => {
            const progress = TerminalDecorator.createProgressIndicator(3, 5, 'requests');
            expect(progress).toContain('60%');
            expect(progress).toContain('requests');
            expect(progress).toContain('█');
            expect(progress).toContain('░');
        });

        test('should annotate command with package scores', () => {
            const command = 'pip install requests django';
            const packageScores = new Map([
                ['requests', mockTrustScore],
                ['django', { ...mockTrustScore, score: 75, level: 'medium' as const }]
            ]);

            const annotated = TerminalDecorator.annotateCommand(command, packageScores);
            expect(annotated).toContain('requests 🟢');
            expect(annotated).toContain('django 🟡');
        });
    });
});

// Mock VS Code API for testing
jest.mock('vscode', () => ({
    window: {
        createOutputChannel: jest.fn(() => ({
            appendLine: jest.fn(),
            show: jest.fn(),
            dispose: jest.fn()
        })),
        createStatusBarItem: jest.fn(() => ({
            show: jest.fn(),
            dispose: jest.fn(),
            text: '',
            color: '',
            tooltip: ''
        })),
        showWarningMessage: jest.fn(),
        onDidStartTerminalShellExecution: jest.fn(),
        onDidEndTerminalShellExecution: jest.fn()
    },
    StatusBarAlignment: {
        Right: 2
    },
    workspace: {
        getConfiguration: jest.fn(() => ({
            get: jest.fn(() => true)
        }))
    }
}));