import type { ReactNode } from 'react'
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg'
import { useTheme } from '@/ui/theme'

/**
 * 应用内图标。
 *
 * 统一 24×24 网格、2px 描边，路径取自 Lucide（ISC 许可），
 * 不依赖字体，所以不会出现 emoji 渲染、字体缺失或平台字形差异。
 * 只描边不填充，颜色永远跟随调用方传入的 color。
 */
export type IconName =
  | 'check'
  | 'chevron-right'
  | 'chevron-left'
  | 'close'
  | 'plus'
  | 'minus'
  | 'pencil'
  | 'unlock'
  | 'lock'
  | 'more'
  | 'syringe'
  | 'smile'
  | 'activity'
  | 'home'
  | 'list'
  | 'settings'
  | 'alert'
  | 'inbox'
  | 'trash'

type IconNode = ReactNode

const icons: Record<IconName, IconNode> = {
  check: <Path d="M20 6 9 17l-5-5" />,
  'chevron-right': <Path d="m9 18 6-6-6-6" />,
  'chevron-left': <Path d="m15 18-6-6 6-6" />,
  close: <Path d="M18 6 6 18M6 6l12 12" />,
  plus: <Path d="M5 12h14M12 5v14" />,
  minus: <Path d="M5 12h14" />,
  pencil: (
    <Path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
  ),
  unlock: (
    <G>
      <Rect x={3} y={11} width={18} height={11} rx={2} />
      <Path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </G>
  ),
  lock: (
    <G>
      <Rect x={3} y={11} width={18} height={11} rx={2} />
      <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </G>
  ),
  more: (
    <G>
      <Circle cx={12} cy={12} r={1} />
      <Circle cx={19} cy={12} r={1} />
      <Circle cx={5} cy={12} r={1} />
    </G>
  ),
  syringe: (
    <G>
      <Path d="m18 2 4 4" />
      <Path d="m17 7 3-3" />
      <Path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5" />
      <Path d="m9 11 4 4" />
      <Path d="m5 19-3 3" />
      <Path d="m14 4 6 6" />
    </G>
  ),
  smile: (
    <G>
      <Circle cx={12} cy={12} r={10} />
      <Path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <Line x1={9} y1={9} x2={9.01} y2={9} />
      <Line x1={15} y1={9} x2={15.01} y2={9} />
    </G>
  ),
  activity: <Path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  home: (
    <G>
      <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <Path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </G>
  ),
  list: (
    <G>
      <Path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13" />
    </G>
  ),
  settings: (
    <G>
      <Path d="M20 7h-9M14 17H5" />
      <Circle cx={17} cy={17} r={3} />
      <Circle cx={7} cy={7} r={3} />
    </G>
  ),
  alert: (
    <G>
      <Circle cx={12} cy={12} r={10} />
      <Path d="M12 8v4M12 16h.01" />
    </G>
  ),
  inbox: (
    <G>
      <Path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <Path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </G>
  ),
  trash: (
    <G>
      <Path d="M3 6h18" />
      <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <Line x1={10} y1={11} x2={10} y2={17} />
      <Line x1={14} y1={11} x2={14} y2={17} />
    </G>
  ),
}

export interface IconProps {
  name: IconName
  /** 图标尺寸（正方形边长），默认 24。 */
  size?: number
  /** 描边颜色，默认跟随主题主文字色。 */
  color?: string
  /** 描边粗细，默认 2。 */
  strokeWidth?: number
  /** 装饰性图标对读屏隐藏；需要语义时由外层节点提供 label。 */
  accessibilityLabel?: string
}

export function Icon({ name, size = 24, color, strokeWidth = 2, accessibilityLabel }: IconProps) {
  const theme = useTheme()
  const tint = color ?? theme.colors.text
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={tint}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={accessibilityLabel === undefined}
      importantForAccessibility={accessibilityLabel === undefined ? 'no-hide-descendants' : 'yes'}
    >
      {icons[name]}
    </Svg>
  )
}
