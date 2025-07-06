// @ts-check
import eslint from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  {
    // Global ignores
    ignores: ['dist/**', 'node_modules/**', '*.js', '*.mjs', '*.cjs'],
  },
  
  // Base recommended configs
  eslint.configs.recommended,
  
  // Main configuration
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      // Use the recommended TypeScript rules
      ...tsPlugin.configs.recommended.rules,
      ...tsPlugin.configs.strict.rules,
      
      // Additional strict rules that exist
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      
      // Security rules
      'no-eval': 'error',
      'no-unsafe-finally': 'error',
      
      // Prettier formatting
      'prettier/prettier': 'error',
    },
  },
  
  // Test file overrides
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  
  // Prettier config (must be last)
  prettier
];