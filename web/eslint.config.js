import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['node_modules/**', '../web-dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: {
      globals: {
        document: 'readonly',
        fetch: 'readonly',
      },
    },
  },
]
