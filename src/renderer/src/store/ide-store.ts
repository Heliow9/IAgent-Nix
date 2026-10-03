import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import type { DesktopAPI, WorkspaceEntry } from '../../../shared/contracts'
import { languageForPath } from '../lib/languages'

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
  buffers: Record<string, EditorBuffer>
  loadingFiles: string[]
  activePath?: string
  activeSessionId?: string
  openWorkspace(root: string): Promise<void>
  loadDirectory(path: string): Promise<void>
  selectFile(path: string): void
  openFile(path: string, reload?: boolean): Promise<void>
  updateBuffer(path: string, content: string): void
  saveFile(path: string): Promise<void>
  closeFile(path: string, decision: 'save' | 'discard' | 'cancel'): Promise<void>
  selectActivity(activity: ActivityId): void
  setPanelSize(panel: PanelId, size: number): void
}

export interface EditorBuffer {
  path: string
  content: string
  savedContent: string
  hash?: string
  language: string
  dirty: boolean
  error?: { code: string; message: string }
  saveError?: { code: string; message: string }
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
    buffers: {},
    loadingFiles: [],
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
          buffers: {},
          loadingFiles: [],
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
      void get().openFile(path)
    },
    async openFile(path, reload = false) {
      set((state) => ({ activePath: path, openTabs: state.openTabs.includes(path) ? state.openTabs : [...state.openTabs, path] }))
      if (get().buffers[path] && !reload) return
      set((state) => ({ loadingFiles: [...state.loadingFiles.filter((item) => item !== path), path] }))
      try {
        const result = await desktop().workspace.readText(path)
        set((state) => ({ buffers: { ...state.buffers, [path]: {
          path, content: result.content, savedContent: result.content, hash: result.hash,
          language: languageForPath(path), dirty: false
        } } }))
      } catch (error) {
        set((state) => ({ buffers: { ...state.buffers, [path]: {
          path, content: '', savedContent: '', language: languageForPath(path), dirty: false,
          error: normalizeError(error)
        } } }))
      } finally {
        set((state) => ({ loadingFiles: state.loadingFiles.filter((item) => item !== path) }))
      }
    },
    updateBuffer(path, content) {
      const buffer = get().buffers[path]
      if (!buffer || buffer.error) return
      set((state) => ({ buffers: { ...state.buffers, [path]: {
        ...buffer, content, dirty: content !== buffer.savedContent, saveError: undefined
      } } }))
    },
    async saveFile(path) {
      const buffer = get().buffers[path]
      if (!buffer || buffer.error || !buffer.dirty) return
      try {
        const result = await desktop().workspace.saveText(path, buffer.content, buffer.hash)
        set((state) => ({ buffers: { ...state.buffers, [path]: {
          ...buffer, hash: result.hash, savedContent: buffer.content, dirty: false, saveError: undefined
        } } }))
      } catch (error) {
        set((state) => ({ buffers: { ...state.buffers, [path]: { ...buffer, saveError: normalizeError(error) } } }))
      }
    },
    async closeFile(path, decision) {
      const buffer = get().buffers[path]
      if (buffer?.dirty && decision === 'cancel') return
      if (buffer?.dirty && decision === 'save') {
        await get().saveFile(path)
        if (get().buffers[path]?.dirty) return
      }
      set((state) => {
        const openTabs = state.openTabs.filter((item) => item !== path)
        const buffers = { ...state.buffers }
        delete buffers[path]
        return { openTabs, buffers, activePath: state.activePath === path ? openTabs.at(-1) : state.activePath }
      })
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
