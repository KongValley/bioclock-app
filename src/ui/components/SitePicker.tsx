import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ALL_SITES, SITE_LABELS } from '@/domain/rotation'
import { useTheme } from '@/ui/theme'
import type { InjectionSite } from '@/types'

const SHORT_LABELS: Record<InjectionSite, string> = {
  abdomen_ul: '腹左上',
  abdomen_ur: '腹右上',
  abdomen_ll: '腹左下',
  abdomen_lr: '腹右下',
  thigh_l: '左大腿',
  thigh_r: '右大腿',
  arm_l: '左上臂',
  arm_r: '右上臂',
}

const ROW_ONE: InjectionSite[] = ['abdomen_ul', 'abdomen_ur', 'abdomen_ll', 'abdomen_lr']
const ROW_TWO: InjectionSite[] = ['thigh_l', 'thigh_r', 'arm_l', 'arm_r']

/** 8 宫格部位选择，带完整无障碍标签与推荐标记。 */
export function SitePicker({
  value,
  onChange,
  recommended,
  disabled = false,
}: {
  value: InjectionSite
  onChange: (site: InjectionSite) => void
  recommended?: InjectionSite
  disabled?: boolean
}) {
  const theme = useTheme()

  const renderTile = (site: InjectionSite) => {
    const selected = value === site
    const isRecommended = recommended === site
    const supported = ALL_SITES.includes(site)
    if (!supported) return null
    return (
      <Pressable
        key={site}
        accessibilityRole="button"
        accessibilityLabel={`${SITE_LABELS[site]}${isRecommended ? '，推荐部位' : ''}`}
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={() => onChange(site)}
        style={({ pressed }) => [
          styles.tile,
          {
            borderColor: selected ? theme.colors.primary : theme.colors.border,
            backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
            borderRadius: theme.radius.md,
            opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
          },
        ]}
      >
        <Text
          style={{
            color: selected ? theme.colors.primary : theme.colors.text,
            fontSize: theme.fontSize.sm,
            fontWeight: selected ? '700' : '500',
            textAlign: 'center',
          }}
        >
          {SHORT_LABELS[site]}
        </Text>
        {isRecommended ? (
          <Text
            style={{
              color: theme.colors.primary,
              fontSize: theme.fontSize.xs,
              marginTop: 2,
            }}
          >
            推荐
          </Text>
        ) : null}
      </Pressable>
    )
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.row}>{ROW_ONE.map(renderTile)}</View>
      <View style={styles.row}>{ROW_TWO.map(renderTile)}</View>
      <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
        腹部注射点需与肚脐保持 5cm 以上距离，并避开硬结、疤痕。
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  tile: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 4,
  },
})
