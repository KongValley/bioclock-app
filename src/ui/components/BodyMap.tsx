import { StyleSheet, View } from 'react-native'
import Svg, { Circle, Ellipse, Rect, Text as SvgText } from 'react-native-svg'
import { useTheme } from '@/ui/theme'
import type { InjectionSite } from '@/types'

const SITE_POINTS: Record<InjectionSite, { x: number; y: number }> = {
  abdomen_ul: { x: 88, y: 86 },
  abdomen_ur: { x: 112, y: 86 },
  abdomen_ll: { x: 88, y: 108 },
  abdomen_lr: { x: 112, y: 108 },
  thigh_l: { x: 87, y: 172 },
  thigh_r: { x: 113, y: 172 },
  arm_l: { x: 55, y: 100 },
  arm_r: { x: 145, y: 100 },
}

/**
 * 极简人体示意图：用圆与圆角矩形拼出轮廓，并高亮推荐/已选部位。
 * 不追求解剖精度，只做「位置提示」。
 */
export function BodyMap({
  selected,
  recommended,
  height = 210,
}: {
  selected?: InjectionSite
  recommended?: InjectionSite
  height?: number
}) {
  const theme = useTheme()
  const outline = theme.colors.border
  const body = theme.colors.surfaceMuted

  return (
    <View
      accessibilityLabel={recommended ? `推荐注射部位示意` : '人体注射部位示意图'}
      style={[styles.wrap, { height }]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 200 240">
        <Ellipse cx={100} cy={214} rx={48} ry={7} fill={theme.colors.border} opacity={0.35} />
        <Circle cx={100} cy={28} r={16} fill={body} stroke={outline} strokeWidth={1.5} />
        <Rect x={94} y={42} width={12} height={9} rx={3} fill={body} stroke={outline} />
        <Rect x={68} y={50} width={64} height={94} rx={18} fill={body} stroke={outline} strokeWidth={1.5} />
        <Rect x={47} y={56} width={15} height={88} rx={7.5} fill={body} stroke={outline} strokeWidth={1.5} />
        <Rect x={138} y={56} width={15} height={88} rx={7.5} fill={body} stroke={outline} strokeWidth={1.5} />
        <Rect x={77} y={142} width={19} height={72} rx={9.5} fill={body} stroke={outline} strokeWidth={1.5} />
        <Rect x={104} y={142} width={19} height={72} rx={9.5} fill={body} stroke={outline} strokeWidth={1.5} />
        <Rect x={78} y={60} width={44} height={62} rx={14} fill={theme.colors.surface} opacity={0.55} />

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
                r={3}
                fill={theme.colors.textTertiary}
                opacity={0.4}
              />
            )
          }
          return (
            <Circle
              key={site}
              cx={point.x}
              cy={point.y}
              r={isSelected ? 8 : 6}
              fill={isSelected ? theme.colors.primary : theme.colors.primaryMuted}
              stroke={theme.colors.primary}
              strokeWidth={isSelected ? 2.5 : 1.5}
              strokeDasharray={isRecommended && !isSelected ? '3 2' : undefined}
            />
          )
        })}

        {recommended ? (
          <SvgText
            x={SITE_POINTS[recommended].x}
            y={SITE_POINTS[recommended].y - 13}
            fontSize={9}
            fontWeight="600"
            fill={theme.colors.primary}
            textAnchor="middle"
          >
            推荐
          </SvgText>
        ) : null}
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
