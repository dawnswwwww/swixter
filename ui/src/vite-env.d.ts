/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly mode: string
  readonly base: string
  readonly dev: boolean
  readonly prod: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
