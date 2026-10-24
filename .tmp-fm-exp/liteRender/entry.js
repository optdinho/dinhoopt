
import { createElement } from 'react'
import { AnimatePresence, LazyMotion, m, MotionConfig, domAnimation } from 'framer-motion'
export function Page() {
  return createElement(MotionConfig, { reducedMotion: 'user' },
    createElement(LazyMotion, { features: domAnimation },
      createElement(AnimatePresence, { mode: 'popLayout' },
        createElement(m.div, { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: 0.2 } },
          createElement('span', null, 'x')))))
}
