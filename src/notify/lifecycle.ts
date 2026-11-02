import { AppState } from 'react-native'
import { rescheduleAll } from './scheduler'

/** 从后台回来时续排提醒；系统权限弹窗引起的 inactive 不触发重排。 */
export function watchForegroundReminders(onError: () => void): () => void {
  let wasBackground = AppState.currentState === 'background'
  let disposed = false
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background') wasBackground = true
    if (state !== 'active' || !wasBackground) return
    wasBackground = false
    void rescheduleAll().catch(() => {
      if (!disposed) onError()
    })
  })
  return () => {
    disposed = true
    subscription.remove()
  }
}
