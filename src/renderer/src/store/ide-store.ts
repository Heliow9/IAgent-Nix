import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import type { DesktopAPI, WorkspaceEntry } from '../../../shared/contracts'

export type ActivityId = 'files' | 'search' | 'source-control' | 'agent' | 'settings'
export type PanelId = 'sidebar' | 'bottom' | 'agent'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface PersistedLayout {
  selectedActivity: ActivityId
  panelSizes: Record<PanelId, number>
}

export interface IdeState {
  workspaceRoot?: string
  workspaceError?: { code: string; message: string }
  loadingWorkspace: boolean
  loadingDirectories: string[]
  entriesByDirectory: Record<string, WorkspaceEntry[]>
  selectedActivity: ActivityId
  panelSizes: Record<PanelId, number>
  openTabs: string[]
  activePath?: string
  activeSessionId?: string
  openWorkspace(root: string): Promise<void>
  loadDirectory(path: string): Promise<void>
  selectFile(path: string): void
  selectActivity(activity: ActivityId): void
  setPanelSize(panel: PanelId, size: number): void
}

interface StoreOptions {
  desktop?: () => DesktopAPI
  storage?: KeyValueStorage
}

const STORAGE_KEY = 'groq-studio.layout.v1'
const defaultLayout: PersistedLayout = {
  selectedActivity: 'files',
  panelSizes: { sidebar: 272, bottom: 220, agent: 360 }
}

export type IdeStore = StoreApi<IdeState>

export function createIdeStore(options: StoreOptions = {}): IdeStore {
  const storage = options.storage
  const layout = readLayout(storage)
  const desktop = options.desktop ?? (() => window.desktop)
  const saveLayout = (state: Pick<IdeState, 'selectedActivity' | 'panelSizes'>): void => {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ selectedActivity: state.selectedActivity, panelSizes: state.panelSizes }))
  }
  return createStore<IdeState>((set, get) => ({
    loadingWorkspace: false,
    loadingDirectories: [],
    entriesByDirectory: {},
    selectedActivity: layout.selectedActivity,
    panelSizes: layout.panelSizes,
    openTabs: [],
    async openWorkspace(root) {
      set({ loadingWorkspace: true, workspaceError: undefined })
      try {
        const opened = await desktop().workspace.open(root)
        const entries = await desktop().workspace.list('')
        set({
          workspaceRoot: opened.root,
          entriesByDirectory: { '': entries },
          loadingWorkspace: false,
          openTabs: [],
          activePath: undefined
        })
      } catch (error) {
        set({ loadingWorkspace: false, workspaceError: normalizeError(error) })
      }
    },
    async loadDirectory(path) {
      if (get().entriesByDirectory[path]) return
      set((state) => ({ loadingDirectories: [...state.loadingDirectories, path] }))
      try {
        const entries = await desktop().workspace.list(path)
        set((state) => ({ entriesByDirectory: { ...state.entriesByDirectory, [path]: entries } }))
      } catch (error) {
        set({ workspaceError: normalizeError(error) })
      } finally {
        set((state) => ({ loadingDirectories: state.loadingDirectories.filter((item) => item !== path) }))
      }
    },
    selectFile(path) {
      set((state) => ({ activePath: path, openTabs: state.openTabs.includes(path) ? state.openTabs : [...state.openTabs, path] }))
    },
    selectActivity(selectedActivity) {
      set({ selectedActivity })
      saveLayout({ selectedActivity, panelSizes: get().panelSizes })
    },
    setPanelSize(panel, size) {
      const panelSizes = { ...get().panelSizes, [panel]: Math.round(size) }
      set({ panelSizes })
      saveLayout({ selectedActivity: get().selectedActivity, panelSizes })
    }
  }))
}

const browserStorage = typeof window !== 'undefined' ? window.localStorage : undefined
export const ideStore = createIdeStore({ storage: browserStorage })

export function useIdeStore<T>(selector: (state: IdeState) => T): T {
  return useStore(ideStore, selector)
}

function readLayout(storage?: KeyValueStorage): PersistedLayout {
  if (!storage) return structuredClone(defaultLayout)
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '') as Partial<PersistedLayout>
    return {
      selectedActivity: value.selectedActivity ?? defaultLayout.selectedActivity,
      panelSizes: { ...defaultLayout.panelSizes, ...value.panelSizes }
    }
  } catch {
    return structuredClone(defaultLayout)
  }
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'WORKSPACE_ERROR'
    return { code, message: error.message }
  }
  return { code: 'WORKSPACE_ERROR', message: 'Nao foi possivel abrir o workspace.' }
}
