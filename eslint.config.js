import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', '.venv/**', '.venv-windows/**'],
  },
  {
    ...js.configs.recommended,
    files: ['static/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    ...js.configs.recommended,
    files: ['test/**/*.cjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
];
