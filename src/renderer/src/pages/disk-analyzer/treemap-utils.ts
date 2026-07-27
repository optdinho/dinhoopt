export const COLORS = [
  '#f59e0b',
  '#d97706',
  '#b45309',
  '#92400e',
  '#78350f',
  '#a16207',
  '#ca8a04',
  '#eab308',
  '#facc15',
  '#fbbf24',
]

export interface TreemapRect {
  name: string
  size: number
  x: number
  y: number
  w: number
  h: number
  color: string
}

export function squarify(
  items: { name: string; size: number; fill: string }[],
  x: number,
  y: number,
  w: number,
  h: number,
  rects: TreemapRect[],
) {
  if (!items.length || w <= 0 || h <= 0) return
  const first = items[0]
  if (!first) return
  if (items.length === 1) {
    rects.push({ name: first.name, size: first.size, x, y, w, h, color: first.fill ?? 'transparent' })
    return
  }
  const total = items.reduce((s, i) => s + i.size, 0)
  const horizontal = w >= h
  const side = horizontal ? h : w
  // Find the best row: add items until aspect ratio worsens
  let rowSum = 0
  let bestIdx = 0
  let bestWorst = Number.POSITIVE_INFINITY
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue
    rowSum += item.size
    const rowFrac = rowSum / total
    const rowLen = horizontal ? w * rowFrac : h * rowFrac
    // Compute worst aspect ratio in this row
    let worst = 0
    let _sub = 0
    for (let j = 0; j <= i; j++) {
      const subItem = items[j]
      if (!subItem) continue
      _sub += subItem.size
      const frac = subItem.size / rowSum
      const itemLen = side * frac
      const aspect = rowLen > itemLen ? rowLen / itemLen : itemLen / rowLen
      if (aspect > worst) worst = aspect
    }
    if (worst <= bestWorst) {
      bestWorst = worst
      bestIdx = i
    } else break
  }
  const rowItems = items.slice(0, bestIdx + 1)
  const restItems = items.slice(bestIdx + 1)
  const rowTotal = rowItems.reduce((s, i) => s + i.size, 0)
  const rowFrac = rowTotal / total
  if (horizontal) {
    const rowW = w * rowFrac
    let cy = y
    for (const item of rowItems) {
      const itemH = h * (item.size / rowTotal)
      rects.push({ name: item.name, size: item.size, x, y: cy, w: rowW, h: itemH, color: item.fill })
      cy += itemH
    }
    squarify(restItems, x + rowW, y, w - rowW, h, rects)
  } else {
    const rowH = h * rowFrac
    let cx = x
    for (const item of rowItems) {
      const itemW = w * (item.size / rowTotal)
      rects.push({ name: item.name, size: item.size, x: cx, y, w: itemW, h: rowH, color: item.fill })
      cx += itemW
    }
    squarify(restItems, x, y + rowH, w, h - rowH, rects)
  }
}

export function layoutTreemap(
  items: { name: string; size: number; fill: string }[],
  width: number,
  height: number,
  otherLabel?: (count: number) => string,
): TreemapRect[] {
  if (!items.length || width <= 0 || height <= 0) return []
  const total = items.reduce((s, i) => s + i.size, 0)
  if (total <= 0) return []
  // Group tiny items (<1.5% each) into "Other"
  const threshold = total * 0.015
  const big = items.filter((i) => i.size >= threshold)
  const small = items.filter((i) => i.size < threshold)
  const grouped = [...big]
  if (small.length > 0) {
    const otherSize = small.reduce((s, i) => s + i.size, 0)
    grouped.push({
      name: otherLabel ? otherLabel(small.length) : `${small.length} other items`,
      size: otherSize,
      fill: 'var(--text-muted)',
    })
  }
  const sorted = grouped.sort((a, b) => b.size - a.size)
  const rects: TreemapRect[] = []
  squarify(sorted, 0, 0, width, height, rects)
  return rects
}
