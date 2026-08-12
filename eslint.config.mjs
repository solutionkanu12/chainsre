// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    // Not linted by ESLint: build output, vendored/generated code, non-JS workspaces.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/cache/**',
      '**/coverage/**',
      '**/*.d.ts',
      'packages/contracts/**', // Solidity is linted by `forge fmt`
      'supabase/**', // SQL migrations
      'phase0/**', // Phase 0 verification artifacts
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Defaults for all TypeScript in the workspace (server-side unless overridden).
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'off', // TypeScript handles undefined identifiers.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    // Browser code: React + hooks rules and browser globals.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
    },
  },
  {
    // Test files also get node globals (describe/it come from vitest imports).
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
