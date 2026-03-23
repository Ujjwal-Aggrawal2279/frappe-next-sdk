/**
 * Post-build script — re-injects React module directives stripped by esbuild.
 *
 * esbuild removes 'use client' / 'use server' string directives when bundling
 * because they are only meaningful in the original source context. We prepend
 * them back to the compiled output so consuming bundlers (webpack, turbopack)
 * can correctly mark the modules as client/server boundaries.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** @type {[string, string[]][]} */
const DIRECTIVES = [
  ['"use client"', ['dist/client/index.js', 'dist/client/index.cjs',
                    'dist/components/index.js', 'dist/components/index.cjs']],
]

for (const [directive, files] of DIRECTIVES) {
  for (const rel of files) {
    const abs = resolve(root, rel)
    const src = readFileSync(abs, 'utf8')
    if (!src.startsWith(directive)) {
      writeFileSync(abs, `${directive};\n${src}`)
      console.log(`  ✓ ${directive} → ${rel}`)
    }
  }
}
