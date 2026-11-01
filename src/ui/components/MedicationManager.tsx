import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { resolveDiseaseIds } from '@/data/diseases'
import { normalizeMedicationName } from '@/domain/medication'
import { useAppStore, errorMessage } from '@/store/app'
import type { Medication, MedicationRoute } from '@/types'
import { Button } from './Button'
import { TextField } from './Field'
import { SegmentedControl } from './SegmentedControl'
import { Icon } from './Icon'
import { toast } from './Toast'

interface Draft {
  name: string
  genericName: string
  brandNames: string
  route: MedicationRoute
  dose: string
  unit: string
}

function toDraft(medication: Medication | null): Draft {
  return {
    name: medication?.name ?? '',
    genericName: medication?.genericName ?? '',
    brandNames: medication ? medication.brandNames.join('、') : '',
    route: medication?.route ?? 'sc',
    dose: medication?.defaultDose === null || medication?.defaultDose === undefined
      ? ''
      : String(medication.defaultDose),
    unit: medication?.unit ?? 'mg',
  }
}

function parseBrandNames(value: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value.split(/[、,，;；/\n]+/)) {
    const name = item.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

function routeLabel(route: MedicationRoute): string {
  if (route === 'iv') return '医院输注'
  if (route === 'oral') return '口服'
  return '皮下注射'
}

/**
 * 药物管理：内置药只读（默认剂量可改），自定义药可增删改。
 * 直接放在设置页的 BottomSheet 里使用。
 */
export function MedicationManager() {
  const theme = useTheme()
  const medications = useAppStore((state) => state.medications)
  const settings = useAppStore((state) => state.settings)
  const addMedication = useAppStore((state) => state.addMedication)
  const updateMedication = useAppStore((state) => state.updateMedication)
  const removeMedication = useAppStore((state) => state.removeMedication)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => toDraft(null))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const editing = editingId ? medications.find((item) => item.id === editingId) : undefined
  const builtin = editing?.isBuiltin === true

  const startCreate = () => {
    setCreating(true)
    setEditingId(null)
    setDraft(toDraft(null))
    setError(null)
  }

  const startEdit = (medication: Medication) => {
    setCreating(false)
    setEditingId(medication.id)
    setDraft(toDraft(medication))
    setError(null)
  }

  const cancel = () => {
    setCreating(false)
    setEditingId(null)
    setError(null)
  }

  const save = async () => {
    const name = draft.name.trim()
    if (name === '') {
      setError('请填写药名')
      return
    }
    const unit = draft.unit.trim()
    if (unit === '') {
      setError('请填写单位')
      return
    }

    let defaultDose: number | null = null
    if (draft.dose.trim() !== '') {
      const parsed = Number(draft.dose.trim())
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('默认剂量必须是大于等于 0 的数字')
        return
      }
      defaultDose = parsed
    }

    if (!builtin) {
      const duplicate = medications.some(
        (item) =>
          item.id !== editingId &&
          normalizeMedicationName(item.name) === normalizeMedicationName(name),
      )
      if (duplicate) {
        setError('已经有同名药物了')
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      let result
      if (editing) {
        result = await updateMedication(editing.id, {
          defaultDose,
          ...(builtin
            ? {}
            : {
                name,
                genericName: draft.genericName.trim() === '' ? null : draft.genericName.trim(),
                brandNames: parseBrandNames(draft.brandNames),
                route: draft.route,
                unit,
              }),
        })
      } else {
        result = await addMedication({
          name,
          genericName: draft.genericName.trim() === '' ? null : draft.genericName.trim(),
          brandNames: parseBrandNames(draft.brandNames),
          defaultDose,
          unit,
          color: theme.colors.primary,
          route: draft.route,
          diseaseIds: resolveDiseaseIds(settings),
          catalogKey: null,
          isBuiltin: false,
          extra: {},
        })
      }
      cancel()
      toast(editing ? '药物已更新' : '药物已添加', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const confirmRemove = (medication: Medication) => {
    Alert.alert('删除药物？', `将删除「${medication.name}」。已被用药方案使用的药物不能删除。`, [
      { text: zh.common.cancel, style: 'cancel' },
      {
        text: zh.common.delete,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const result = await removeMedication(medication.id)
              toast('药物已删除', 'success')
              if (result.notifyWarning) toast(result.notifyWarning, 'error')
            } catch (err) {
              toast(errorMessage(err), 'error')
            }
          })()
        },
      },
    ])
  }

  if (creating || editing) {
    return (
      <View style={{ gap: theme.spacing.md }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '700' }}>
          {editing ? `编辑「${editing.name}」` : '添加药物'}
        </Text>

        <TextField
          label="药名"
          value={draft.name}
          onChangeText={(value) => setDraft((current) => ({ ...current, name: value }))}
          placeholder="例如：阿达木单抗 / 修美乐"
          editable={!builtin}
          accessibilityLabel="药物名称"
        />

        <TextField
          label={`通用名（${zh.common.optional}）`}
          value={draft.genericName}
          onChangeText={(value) => setDraft((current) => ({ ...current, genericName: value }))}
          placeholder="通用名"
          editable={!builtin}
          accessibilityLabel="药物通用名"
        />

        <TextField
          label={`商品名（${zh.common.optional}）`}
          value={draft.brandNames}
          onChangeText={(value) => setDraft((current) => ({ ...current, brandNames: value }))}
          placeholder="多个商品名用顿号分隔，如 修美乐、格乐立"
          editable={!builtin}
          hint="导入时按药名、通用名、商品名互相认领，避免同一种药重复建档。"
          accessibilityLabel="药物商品名"
        />

        {builtin ? (
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
            目录药的名称、通用名、商品名和给药途径跟随版本更新，只能修改默认剂量。
          </Text>
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              给药途径
            </Text>
            <SegmentedControl<MedicationRoute>
              options={[
                { value: 'sc', label: '皮下' },
                { value: 'iv', label: '医院输注' },
                { value: 'oral', label: '口服' },
              ]}
              value={draft.route}
              onChange={(route) => setDraft((current) => ({ ...current, route }))}
              accessibilityLabel="给药途径"
            />
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <TextField
              label={`默认剂量（${zh.common.optional}）`}
              value={draft.dose}
              onChangeText={(value) => setDraft((current) => ({ ...current, dose: value }))}
              keyboardType="decimal-pad"
              placeholder="40"
              accessibilityLabel="默认剂量"
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="单位"
              value={draft.unit}
              onChangeText={(value) => setDraft((current) => ({ ...current, unit: value }))}
              placeholder="mg"
              editable={!builtin}
              accessibilityLabel="剂量单位"
            />
          </View>
        </View>

        {error ? (
          <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.sm }}>{error}</Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Button label={zh.common.cancel} variant="secondary" onPress={cancel} style={{ flex: 1 }} />
          <Button
            label={zh.common.save}
            onPress={() => {
              void save()
            }}
            loading={saving}
            style={{ flex: 2 }}
          />
        </View>

        {editing && !builtin ? (
          <Button
            label="删除这种药"
            variant="danger"
            onPress={() => confirmRemove(editing)}
          />
        ) : null}
      </View>
    )
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Text style={{ flex: 1, color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
          共 {medications.length} 种。目录药只读，默认剂量可以按医嘱改。
        </Text>
        <Button label="添加药物" icon="plus" onPress={startCreate} />
      </View>

      {medications.map((medication) => (
        <Pressable
          key={medication.id}
          accessibilityRole="button"
          accessibilityLabel={`编辑 ${medication.name}`}
          onPress={() => startEdit(medication)}
          style={({ pressed }) => [
            styles.row,
            {
              borderColor: theme.colors.border,
              backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
              borderRadius: theme.radius.md,
            },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}>
                {medication.name}
              </Text>
              {medication.isBuiltin ? (
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceMuted,
                    borderRadius: theme.radius.pill,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                  }}
                >
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 10 }}>目录</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
              {[
                medication.genericName && medication.genericName !== medication.name
                  ? medication.genericName
                  : null,
                medication.brandNames.length > 0 ? `商品名：${medication.brandNames.join('、')}` : null,
                routeLabel(medication.route),
                medication.defaultDose !== null
                  ? `${medication.defaultDose} ${medication.unit}`
                  : '未设默认剂量',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Icon name="chevron-right" size={18} color={theme.colors.textTertiary} />
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderWidth: 1,
    minHeight: 56,
  },
})
