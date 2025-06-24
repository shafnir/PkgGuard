/**
 * Tests for Terminal Integration functionality
 */

import { TerminalPackageMonitor } from '../shell-integration';

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

    // TerminalDecorator tests removed - that class was part of old implementation
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