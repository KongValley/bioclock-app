import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  subscribe: vi.fn(), remove: vi.fn(), reschedule: vi.fn(),
}))
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: mock.subscribe },
}))
vi.mock('../scheduler', () => ({ rescheduleAll: mock.reschedule }))

import { watchForegroundReminders } from '../lifecycle'

let changeState: (state: string) => void
beforeEach(() => {
  vi.resetAllMocks()
  mock.subscribe.mockImplementation((_event, callback) => {
    changeState = callback
    return { remove: mock.remove }
  })
  mock.reschedule.mockResolvedValue({ scheduled: 1 })
})

describe('回前台续排提醒', () => {
  it('后台经 inactive 回到前台只重排一次', () => {
    const stop = watchForegroundReminders(vi.fn())
    changeState('background')
    changeState('inactive')
    changeState('active')
    changeState('active')
    expect(mock.reschedule).toHaveBeenCalledOnce()
    stop()
    expect(mock.remove).toHaveBeenCalledOnce()
  })

  it('权限弹窗引起的 inactive 不重排', () => {
    watchForegroundReminders(vi.fn())
    changeState('inactive')
    changeState('active')
    expect(mock.reschedule).not.toHaveBeenCalled()
  })

  it('重排失败交给界面提示，避免未处理的 Promise', async () => {
    mock.reschedule.mockRejectedValue(new Error('排程失败'))
    const onError = vi.fn()
    watchForegroundReminders(onError)
    changeState('background')
    changeState('active')
    await Promise.resolve()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('卸载后异步失败不再触发提示', async () => {
    mock.reschedule.mockRejectedValue(new Error('排程失败'))
    const onError = vi.fn()
    const stop = watchForegroundReminders(onError)
    changeState('background')
    changeState('active')
    stop()
    await Promise.resolve()
    expect(onError).not.toHaveBeenCalled()
  })
})
