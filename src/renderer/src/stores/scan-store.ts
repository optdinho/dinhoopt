import { type CleanerType, ScanStatus } from '@shared/enums'
import type { CleanSummaryData, ProgressData, ScanResult } from '@shared/types'
import { create } from 'zustand'

export type { CleanSummaryData }

const EXCLUDED_KEY = 'kudu:excluded-subcategories'

function loadExcluded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXCLUDED_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch {
    /* ignore */
  }
  return new Set()
}

function saveExcluded(excluded: Set<string>): void {
  try {
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...excluded]))
  } catch {
    /* ignore */
  }
}

interface ScanState {
  status: ScanStatus
  results: ScanResult[]
  selectedItems: Set<string>
  excludedSubcategories: Set<string>
  progress: ProgressData | null
  cleanSummary: CleanSummaryData | null
  activeCategory: CleanerType | null

  setStatus: (status: ScanStatus) => void
  setResults: (results: ScanResult[]) => void
  addResults: (results: ScanResult[]) => void
  setProgress: (progress: ProgressData | null) => void
  setCleanSummary: (summary: CleanSummaryData | null) => void
  setActiveCategory: (cat: CleanerType | null) => void
  toggleItem: (id: string) => void
  toggleSubcategory: (result: ScanResult) => void
  selectAll: (category: string) => void
  deselectAll: (category: string) => void
  toggleCategory: (category: string) => void
  getSelectedIds: () => string[]
  getTotalSize: () => number
  getSelectedSize: () => number
  reset: () => void
}

export const useScanStore = create<ScanState>((set, get) => ({
  status: ScanStatus.Idle,
  results: [],
  selectedItems: new Set<string>(),
  excludedSubcategories: loadExcluded(),
  progress: null,
  cleanSummary: null,
  activeCategory: null,

  setStatus: (status) => set({ status }),
  setResults: (results) => {
    const excluded = get().excludedSubcategories
    const selected = new Set<string>()
    for (const r of results) {
      for (const item of r.items) {
        if (!excluded.has(`${r.category}:${r.subcategory}`)) selected.add(item.id)
      }
    }
    set({ results, selectedItems: selected })
  },
  addResults: (newResults) =>
    set((s) => {
      const excluded = s.excludedSubcategories
      const selected = new Set(s.selectedItems)
      // Dedup by merging new results into existing ones, replacing
      // any previous entry that has the same (category, subcategory) pair.
      const existingMap = new Map<string, ScanResult>()
      for (const r of s.results) {
        existingMap.set(`${r.category}:${r.subcategory}`, r)
      }
      for (const r of newResults) {
        existingMap.set(`${r.category}:${r.subcategory}`, r)
        for (const item of r.items) {
          if (!excluded.has(`${r.category}:${r.subcategory}`)) selected.add(item.id)
        }
      }
      return { results: [...existingMap.values()], selectedItems: selected }
    }),
  setProgress: (progress) => set({ progress }),
  setCleanSummary: (cleanSummary) => set({ cleanSummary }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  toggleItem: (id) =>
    set((s) => {
      const next = new Set(s.selectedItems)
      if (next.has(id)) next.delete(id)
      else next.add(id)

      // Update excluded subcategories based on current selection state
      const excluded = new Set(s.excludedSubcategories)
      for (const r of s.results) {
        const itemInResult = r.items.find((i) => i.id === id)
        if (!itemInResult) continue
        const key = `${r.category}:${r.subcategory}`
        const allDeselected = r.items.every((i) => !next.has(i.id))
        const allSelected = r.items.every((i) => next.has(i.id))
        if (allDeselected) excluded.add(key)
        else if (allSelected) excluded.delete(key)
        break
      }
      saveExcluded(excluded)
      return { selectedItems: next, excludedSubcategories: excluded }
    }),
  toggleSubcategory: (result) =>
    set((s) => {
      const next = new Set(s.selectedItems)
      const excluded = new Set(s.excludedSubcategories)
      const key = `${result.category}:${result.subcategory}`
      const allSelected = result.items.every((i) => next.has(i.id))
      if (allSelected) {
        for (const i of result.items) next.delete(i.id)
        excluded.add(key)
      } else {
        for (const i of result.items) next.add(i.id)
        excluded.delete(key)
      }
      saveExcluded(excluded)
      return { selectedItems: next, excludedSubcategories: excluded }
    }),
  selectAll: (category) =>
    set((s) => {
      const next = new Set(s.selectedItems)
      const excluded = new Set(s.excludedSubcategories)
      for (const r of s.results) {
        if (r.category !== category) continue
        for (const item of r.items) next.add(item.id)
        excluded.delete(`${r.category}:${r.subcategory}`)
      }
      saveExcluded(excluded)
      return { selectedItems: next, excludedSubcategories: excluded }
    }),
  deselectAll: (category) =>
    set((s) => {
      const next = new Set(s.selectedItems)
      const excluded = new Set(s.excludedSubcategories)
      for (const r of s.results) {
        if (r.category !== category) continue
        for (const item of r.items) next.delete(item.id)
        excluded.add(`${r.category}:${r.subcategory}`)
      }
      saveExcluded(excluded)
      return { selectedItems: next, excludedSubcategories: excluded }
    }),
  toggleCategory: (category) => {
    const state = get()
    const categoryItems = state.results.filter((r) => r.category === category).flatMap((r) => r.items)
    const allSelected = categoryItems.every((item) => state.selectedItems.has(item.id))
    if (allSelected) {
      state.deselectAll(category)
    } else {
      state.selectAll(category)
    }
  },
  getSelectedIds: () => Array.from(get().selectedItems),
  getTotalSize: () => get().results.reduce((sum, r) => sum + r.totalSize, 0),
  getSelectedSize: () => {
    const selected = get().selectedItems
    return get().results.reduce(
      (sum, r) => sum + r.items.filter((item) => selected.has(item.id)).reduce((s, i) => s + i.size, 0),
      0,
    )
  },
  reset: () =>
    set({
      status: ScanStatus.Idle,
      results: [],
      selectedItems: new Set(),
      progress: null,
      cleanSummary: null,
    }),
}))
