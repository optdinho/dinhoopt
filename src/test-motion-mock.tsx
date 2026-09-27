import type { ReactNode } from 'react'

/**
 * framer-motion props are animation directives, not DOM attributes. The test
 * mock renders `motion.*` as a plain <div>, so forwarding them verbatim makes
 * React warn ("React does not recognize the `whileTap` prop on a DOM element"),
 * once per prop per component type, drowning the real test output.
 *
 * Grounded in the props this codebase actually passes to motion components
 * (animate, transition, initial, exit, layoutId, whileTap, variants,
 * whileHover, layout) plus their siblings, so a new motion prop does not
 * silently reintroduce the warning. Extend this set when one shows up.
 */
const MOTION_ONLY_PROPS: ReadonlySet<string> = new Set([
  // Variants / lifecycle
  'animate',
  'initial',
  'exit',
  'transition',
  'variants',
  'custom',
  'inherit',
  // Layout
  'layout',
  'layoutId',
  'layoutDependency',
  'layoutScroll',
  // Gesture
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileDrag',
  'whileInView',
  'whileTapScale',
  'whileTapRotate',
  'drag',
  'dragConstraints',
  'dragElastic',
  'dragMomentum',
  'dragPropagation',
  'dragSnapToOrigin',
  // Viewport
  'viewport',
  // Callbacks framer-motion owns (not DOM handlers)
  'onAnimationComplete',
  'onAnimationStart',
  'onDrag',
  'onDragEnd',
  'onDragStart',
  'onHoverEnd',
  'onHoverStart',
  'onLayoutAnimationComplete',
  'onLayoutAnimationStart',
  'onPan',
  'onPanEnd',
  'onPanStart',
  'onTap',
  'onTapCancel',
  'onTapStart',
  'onUpdate',
  'onViewportEnter',
  'onViewportLeave',
  'transformTemplate',
])

export function stripMotionProps<T extends Record<string, unknown>>(props: T): Partial<T> {
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!MOTION_ONLY_PROPS.has(key)) rest[key] = value
  }
  return rest as Partial<T>
}

type MotionStubProps = Record<string, unknown> & { children?: ReactNode }

/**
 * Drop-in replacement for the framer-motion module in tests: every `motion.*`
 * element renders as an inert <div> and AnimatePresence just renders children.
 *
 * Import this from an async `vi.mock` factory — the factory is hoisted above
 * the imports, so a plain top-level import would be read before initialisation:
 *
 *   vi.mock('framer-motion', async () => (await import('@/test-motion-mock')).motionMock)
 */
export const motionMock = {
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: MotionStubProps) => <div {...stripMotionProps(props)}>{children}</div>,
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}
