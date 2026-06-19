import 'dotenv/config'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import pkg from './package.json'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/main/index.ts')
          },
          external: ['better-sqlite3', 'bindings'],
          onwarn(warning, warn) {
            if (warning.code === 'MIXED_DYNAMIC_AND_STATIC_IMPORTS') return
            warn(warning)
          }
        }
    },
    define: {
      'process.env.LICENSE_API_URL': JSON.stringify(process.env.LICENSE_API_URL),
      'process.env.LICENSE_API_TOKEN': JSON.stringify(process.env.LICENSE_API_TOKEN)
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        // The renderer's hardcoded CSP (script-src 'self') blocks Vite's
        // inline HMR injection in dev → blank window. Strip the meta tag
        // when serving dev only; the production HTML keeps the strict CSP.
        name: 'dinho-strip-csp-in-dev',
        apply: 'serve',
        transformIndexHtml(html: string): string {
          return html.replace(
            /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/i,
            ''
          )
        }
      }
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
})
