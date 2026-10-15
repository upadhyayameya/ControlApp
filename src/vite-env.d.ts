/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' in the self-contained hosted build → run the sim on the main thread. */
  readonly VITE_LOCAL_ENGINE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
