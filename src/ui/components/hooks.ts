import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

/** 返回会按固定间隔刷新的当前时间，用于倒计时/「今天」判定。 */
export function useNow(intervalMs: number = 30_000): number {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}

/**
 * 应用锁开启时，如果 App 在后台超过 30 秒再回前台，
 * 关闭当前独立于 Tabs 的全屏 Modal，让根 Stack 外的锁屏重新接管。
 */
export function useDismissOnRelock(onRelock: () => void, enabled: boolean): void {
  const callback = useRef(onRelock)
  const appState = useRef(AppState.currentState)
  const backgroundAt = useRef(0)

  useEffect(() => {
    callback.current = onRelock
  }, [onRelock])

  useEffect(() => {
    if (!enabled) return
    const subscription = AppState.addEventListener('change', (next) => {
      if (appState.current === 'active' && next !== 'active') {
        backgroundAt.current = Date.now()
      }
      if (
        next === 'active' &&
        appState.current !== 'active' &&
        Date.now() - backgroundAt.current > 30_000
      ) {
        callback.current()
      }
      appState.current = next
    })
    return () => subscription.remove()
  }, [enabled])
}
