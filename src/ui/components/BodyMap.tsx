import { StyleSheet, View } from 'react-native'
import Svg, {
  Circle,
  Ellipse,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg'
import { useTheme } from '@/ui/theme'
import type { InjectionSite } from '@/types'

/**
 * 示意图坐标系：200 × 248，原点在左上角。
 *
 * 头 14–50 → 颈 52–60 → 肩 62 → 躯干 62–160（腹部约 95–150）→ 髋 154
 * → 大腿 154–196 → 膝 198 → 小腿 198–226 → 脚。
 * 腹部四点围在肚脐周围，腿点在大腿中段，上臂点在手肘上方。
 */
const SITE_POINTS: Record<InjectionSite, { x: number; y: number }> = {
  abdomen_ul: { x: 87, y: 107 },
  abdomen_ur: { x: 113, y: 107 },
  abdomen_ll: { x: 87, y: 137 },
  abdomen_lr: { x: 113, y: 137 },
  thigh_l: { x: 91, y: 176 },
  thigh_r: { x: 109, y: 176 },
  arm_l: { x: 54, y: 116 },
  arm_r: { x: 146, y: 116 },
}
/** 肚脐：腹部四点的中心，也是「距脐 5cm 以上」的参照点。 */
const NAVEL = { x: 100, y: 122 }

/** 腹部注药区：肚脐周围的虚线椭圆（避开脐周 5cm 以内）。 */
const ABDOMEN_ZONE = { x: 100, y: 122, rx: 33, ry: 29 }

const FILL = '#FFFFFF'

/** 极简人体剪影：头、颈、躯干、双臂、双腿、双脚，只做位置提示。 */
const BODY_PATH = [
  // 头
  'M 100 14 C 111 14 118 21 118 32 C 118 43 111 50 100 50 C 89 50 82 43 82 32 C 82 21 89 14 100 14 Z',
  // 颈
  'M 93 52 L 107 52 L 107 62 L 93 62 Z',
  // 躯干（肩 → 腰 → 髋）
  'M 84 62 C 74 62 68 67 67 77 L 63 112 C 62 132 64 146 68 158 L 132 158 C 136 146 138 132 137 112 L 133 77 C 132 67 126 62 116 62 Z',
  // 右臂（画面左侧）
  'M 68 76 C 62 84 59 96 58 110 L 55 140 C 54 148 58 152 63 152 L 68 152 C 72 152 74 148 73 142 L 74 112 L 76 78 Z',
  // 左臂（画面右侧）
  'M 132 76 C 138 84 141 96 142 110 L 145 140 C 146 148 142 152 137 152 L 132 152 C 128 152 126 148 127 142 L 126 112 L 124 78 Z',
  // 右腿（大腿 → 膝 → 小腿 → 脚）
  'M 70 158 L 96 158 C 95 172 95 186 95 196 L 66 196 C 67 186 68 172 70 158 Z',
  'M 67 200 C 80 198 94 198 95 200 L 95 224 C 95 228 92 230 88 230 L 72 230 C 68 230 66 228 66 224 Z',
  // 左腿
  'M 104 158 L 130 158 C 132 172 133 186 134 196 L 105 196 C 105 186 105 172 104 158 Z',
  'M 105 200 C 106 198 120 198 133 200 L 134 224 C 134 228 132 230 128 230 L 112 230 C 108 230 105 228 105 224 Z',
].join(' ')

/**
 * 极简人体示意图：用 SVG 路径拼出轮廓，并高亮推荐 / 已选部位。
 * 腹部四点围绕肚脐标注，腿部与上臂点位对应各自的注射部位。
 */
export function BodyMap({
  selected,
  recommended,
  height = 220,
}: {
  selected?: InjectionSite
  recommended?: InjectionSite
  height?: number
}) {
  const theme = useTheme()
  const outline = theme.colors.border

  const highlight = selected ?? recommended ?? null
  const highlightPoint = highlight ? SITE_POINTS[highlight] : null
  const isAbdomen = highlight?.startsWith('abdomen') ?? false

  return (
    <View
      accessibilityLabel={recommended ? '推荐注射部位示意' : '人体注射部位示意图'}
      style={[styles.wrap, { height }]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 200 248">
        {/* 地面阴影 */}
        <Ellipse cx={100} cy={234} rx={44} ry={4.5} fill={outline} opacity={0.35} />

        {/* 身体轮廓 */}
        <Path
          d={BODY_PATH}
          fill={FILL}
          stroke={outline}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 腹部注药区：虚线椭圆 + 肚脐 */}
        <Ellipse
          cx={ABDOMEN_ZONE.x}
          cy={ABDOMEN_ZONE.y}
          rx={ABDOMEN_ZONE.rx}
          ry={ABDOMEN_ZONE.ry}
          fill="none"
          stroke={theme.colors.primary}
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={isAbdomen ? 0.55 : 0.16}
        />
        <Circle cx={NAVEL.x} cy={NAVEL.y} r={2} fill={theme.colors.textTertiary} opacity={0.5} />

        {/* 膝线，让大腿与小腿分开 */}
        <Line x1={68} y1={198} x2={94} y2={198} stroke={outline} strokeWidth={1.2} />
        <Line x1={106} y1={198} x2={132} y2={198} stroke={outline} strokeWidth={1.2} />

        {(Object.keys(SITE_POINTS) as InjectionSite[]).map((site) => {
          const point = SITE_POINTS[site]
          const isSelected = selected === site
          const isRecommended = recommended === site
          if (!isSelected && !isRecommended) {
            return (
              <Circle
                key={site}
                cx={point.x}
                cy={point.y}
                r={2.6}
                fill={theme.colors.textTertiary}
                opacity={0.35}
              />
            )
          }
          return (
            <Circle
              key={site}
              cx={point.x}
              cy={point.y}
              r={isSelected ? 6.5 : 5}
              fill={isSelected ? theme.colors.primary : theme.colors.primaryMuted}
              stroke={theme.colors.primary}
              strokeWidth={isSelected ? 2 : 1.5}
              strokeDasharray={isRecommended && !isSelected ? '2.5 1.5' : undefined}
            />
          )
        })}

        {highlightPoint && highlight ? (
          <SiteCallout
            point={highlightPoint}
            // 标签朝身体中线避让，避免压住另一侧的高亮点或遮住轮廓
            side={highlight.endsWith('_r') ? 'left' : highlight.endsWith('_l') ? 'right' : 'center'}
            color={theme.colors.primary}
            textColor={theme.colors.onPrimary}
          />
        ) : null}
      </Svg>
    </View>
  )
}

const CALLOUT_WIDTH = 34
const CALLOUT_HEIGHT = 14

/** 高亮点的「推荐」气泡：默认在上方，靠近边缘时横向避让。 */
function SiteCallout({
  point,
  side,
  color,
  textColor,
}: {
  point: { x: number; y: number }
  side: 'left' | 'right' | 'center'
  color: string
  textColor: string
}) {
  const offsetX = side === 'left' ? -22 : side === 'right' ? 22 : 0
  const x = Math.min(196 - CALLOUT_WIDTH, Math.max(4, point.x + offsetX - CALLOUT_WIDTH / 2))
  const y = point.y - 36
  const anchorX = point.x + offsetX

  return (
    <>
      <Line
        x1={point.x}
        y1={point.y - 7}
        x2={anchorX}
        y2={y + CALLOUT_HEIGHT}
        stroke={color}
        strokeWidth={1}
        opacity={0.5}
      />
      <Rect
        x={x}
        y={y}
        width={CALLOUT_WIDTH}
        height={CALLOUT_HEIGHT}
        rx={CALLOUT_HEIGHT / 2}
        fill={color}
      />
      <SvgText
        x={x + CALLOUT_WIDTH / 2}
        y={y + CALLOUT_HEIGHT / 2 + 3.2}
        fontSize={9}
        fontWeight="600"
        fill={textColor}
        textAnchor="middle"
      >
        推荐
      </SvgText>
    </>
  )
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
