export interface Cookies {
  discogs?: string
  ebay?: string
  kojima?: string
  mercari?: string
}

export interface Settings {
  discogsToken?: string
  ebayClientId?: string
  ebayClientSecret?: string
  cookies?: Cookies
}

export interface IElectronAPI {
  send: (channel: string, data: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
  getSettings: () => Promise<Settings>
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<void>
  deleteSetting: (key: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

export {}
