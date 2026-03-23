import { defineConfig } from 'tsup'

// esbuild strips 'use client' / 'use server' directives when bundling.
// We re-inject them via a post-build script (scripts/inject-directives.mjs).

const external = ['next', 'react', 'react-dom', 'server-only']

// Produce .js for ESM, .cjs for CommonJS — unambiguous regardless of
// the consumer's "type" field.
const outExtension = ({ format }: { format: string }) =>
  ({ js: format === 'cjs' ? '.cjs' : '.js' })

export default defineConfig([
  // ── Server helpers + Server Actions ───────────────────────────────────────
  {
    entry: {
      'server/index':   'src/server/index.ts',
      'server/actions': 'src/server/actions.ts',
    },
    format:      ['esm', 'cjs'],
    dts:         true,
    external,
    outDir:      'dist',
    outExtension,
    treeshake:   true,
  },

  // ── Types (pure interfaces — zero runtime) ────────────────────────────────
  {
    entry:       { 'types/index': 'src/types/index.ts' },
    format:      ['esm', 'cjs'],
    dts:         true,
    external,
    outDir:      'dist',
    outExtension,
  },

  // ── Middleware (Edge Runtime — zero Node.js APIs) ─────────────────────────
  {
    entry:       { 'middleware/index': 'src/middleware/index.ts' },
    format:      ['esm', 'cjs'],
    dts:         true,
    external,
    outDir:      'dist',
    outExtension,
    treeshake:   true,
  },

  // ── Client hooks ──────────────────────────────────────────────────────────
  // "use client" is re-injected by scripts/inject-directives.mjs after build.
  {
    entry:       { 'client/index': 'src/client/index.ts' },
    format:      ['esm', 'cjs'],
    dts:         true,
    external,
    outDir:      'dist',
    outExtension,
    treeshake:   true,
  },

  // ── React components ──────────────────────────────────────────────────────
  // "use client" is re-injected by scripts/inject-directives.mjs after build.
  {
    entry:       { 'components/index': 'src/components/FrappeProvider.tsx' },
    format:      ['esm', 'cjs'],
    dts:         true,
    external,
    outDir:      'dist',
    outExtension,
    treeshake:   true,
    esbuildOptions: (o) => { o.jsx = 'automatic' },
  },
])
