/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_AUTH_MODE?: 'popup' | 'auto' | 'redirect'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Navigator {
  /** iOS Safari: ホーム画面から起動したとき true */
  readonly standalone?: boolean
}
