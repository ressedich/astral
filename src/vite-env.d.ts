/// <reference types="vite/client" />

export type AppUpdateState = {
  version: string
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'current' | 'unavailable' | 'error'
  message: string
  percent: number | null
  nextVersion: string | null
}

interface AstralDesktop {
  getUpdate: () => Promise<AppUpdateState>
  checkForUpdates: () => Promise<AppUpdateState>
  installUpdate: () => Promise<AppUpdateState>
  onUpdate: (listener: (state: AppUpdateState) => void) => () => void
}

declare global {
  interface Window {
    astral?: AstralDesktop
  }
}
