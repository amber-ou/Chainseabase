import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts'],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Client pages fetch in effects through sequence-guarded async loaders (useResource);
      // the rule cannot tell those apart from synchronous derived-state updates.
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
];

export default config;
