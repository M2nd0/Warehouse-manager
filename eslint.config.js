import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // CLAUDE.md: src/sim is pure TypeScript — no DOM, no Three.js, no UI.
    files: ['src/sim/**/*.ts', 'src/data/**/*.ts', 'src/save/serialize.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', message: 'src/sim must not depend on Three.js.' },
            { name: 'preact', message: 'src/sim must not depend on the UI.' },
          ],
          patterns: [
            { group: ['three/*', 'preact/*'], message: 'src/sim must stay render/UI free.' },
            { group: ['**/render/**', '**/ui/**'], message: 'src/sim must not import render/ or ui/.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'requestAnimationFrame', 'localStorage'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG (src/sim/rng.ts).' },
        { object: 'Date', property: 'now', message: 'The simulation must not read wall-clock time.' },
      ],
    },
  },
);
