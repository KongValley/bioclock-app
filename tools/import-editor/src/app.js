/* BioClock 导入编辑器（纯前端，无依赖）。
 * 生成的文件格式见仓库 docs/import-format.md。
 */
;(function () {
  'use strict'

  const META = window.BIOCLOCK_META
  if (!META) {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:sans-serif">缺少 src/meta.js，请先运行 <code>npm run import-editor</code> 生成数据。</p>'
    return
  }
  if (typeof XLSX === 'undefined') {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:sans-serif">缺少 src/vendor/xlsx.full.min.js，请重新拉取仓库或运行 <code>npm install</code> 后复制该文件。</p>'
    return
  }

  const STORAGE_KEY = 'bioclock-import-editor-v1'
  const SEVERITY_LABELS = ['很轻', '较轻', '中等', '较重', '严重']
  const ORAL_STATUS_LABELS = { done: '完成', skipped: '跳过', missed: '漏服' }

  const state = {
    diseases: [],
    injections: [],
    symptoms: [],
    oralLogs: [],
    customDrugs: [],
    customTags: [],
    draftTags: [],
    editingInjection: null,
    editingSymptom: null,
    editingOral: null,
  }

  const $ = (id) => document.getElementById(id)

  // ---------------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------------

  function pad(value) {
    return String(value).padStart(2, '0')
  }

  function nowForInput() {
    const date = new Date()
    date.setSeconds(0, 0)
    date.setMinutes(Math.floor(date.getMinutes() / 5) * 5)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`
  }

  function toLocalText(inputValue) {
    return String(inputValue || '').replace('T', ' ').trim()
  }

  function toInputValue(text) {
    return String(text || '').replace(' ', 'T').trim()
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
      return map[char]
    })
  }

  function painLabel(score) {
    if (score === 0) return '无痛'
    if (score <= 3) return '轻度疼痛'
    if (score <= 6) return '中度疼痛'
    return '重度疼痛'
  }

  function showStatus(text, tone) {
    const node = $('output-status')
    node.textContent = text
    node.style.color = tone === 'error' ? 'var(--danger)' : 'var(--text-tertiary)'
    if (tone !== 'error') {
      window.setTimeout(() => {
        if (node.textContent === text) node.textContent = ''
      }, 4000)
    }
  }

  function setFormError(form, message) {
    const node = $(`${form}-error`)
    node.textContent = message || ''
  }

  // ---------------------------------------------------------------------------
  // 本地存储
  // ---------------------------------------------------------------------------

  function save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          diseases: state.diseases,
          injections: state.injections,
          symptoms: state.symptoms,
          oralLogs: state.oralLogs,
          customDrugs: state.customDrugs,
          customTags: state.customTags,
        }),
      )
    } catch (error) {
      // 隐私模式下 localStorage 可能不可用，忽略即可。
    }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      if (Array.isArray(data.diseases)) state.diseases = data.diseases
      if (Array.isArray(data.injections)) state.injections = data.injections
      if (Array.isArray(data.symptoms)) state.symptoms = data.symptoms
      if (Array.isArray(data.oralLogs)) state.oralLogs = data.oralLogs
      if (Array.isArray(data.customDrugs)) state.customDrugs = data.customDrugs
      if (Array.isArray(data.customTags)) state.customTags = data.customTags
    } catch (error) {
      // 数据坏了就从空开始，不要让页面打不开。
    }
  }

  // ---------------------------------------------------------------------------
  // 病种与药物
  // ---------------------------------------------------------------------------

  function diseaseName(id) {
    const found = META.diseaseOptions.find((item) => item.id === id)
    return found ? found.name : id
  }

  function availableDrugs() {
    const catalog =
      state.diseases.length === 0
        ? META.allDrugs
        : (() => {
            const seen = new Map()
            for (const diseaseId of state.diseases) {
              const list = META.drugsByDisease[diseaseId] || []
              for (const drug of list) {
                if (!seen.has(drug.key)) seen.set(drug.key, drug)
              }
            }
            return Array.from(seen.values())
          })()

    const names = new Set(catalog.map((drug) => drug.name))
    return [...catalog, ...state.customDrugs.filter((drug) => !names.has(drug.name))]
  }

  function routeLabel(route) {
    if (route === 'oral') return '口服'
    if (route === 'iv') return '医院输注'
    return '皮下注射'
  }

  function renderCustomDrugs() {
    const box = $('custom-drug-list')
    box.innerHTML = ''
    if (state.customDrugs.length === 0) {
      box.innerHTML = '<span class="empty-inline">还没有自定义药物</span>'
      return
    }
    for (const drug of state.customDrugs) {
      const chip = document.createElement('span')
      chip.className = 'chip is-static'
      chip.textContent = `${drug.name} · ${routeLabel(drug.route)}${
        drug.defaultDose !== null && drug.defaultDose !== '' ? ` · ${drug.defaultDose}${drug.unit}` : ''
      }`
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'chip-remove'
      remove.textContent = '×'
      remove.setAttribute('aria-label', `删除 ${drug.name}`)
      remove.addEventListener('click', () => {
        if (!window.confirm(`删除自定义药物「${drug.name}」？`)) return
        state.customDrugs = state.customDrugs.filter((item) => item.id !== drug.id)
        save()
        renderCustomDrugs()
        refreshDrugOptions()
      })
      chip.append(remove)
      box.append(chip)
    }
  }

  function addCustomDrug() {
    const name = $('drug-name').value.trim()
    const unit = $('drug-unit').value.trim() || 'mg'
    if (name === '') {
      $('drug-error').textContent = '请填写药名'
      return
    }
    const duplicate = [...META.allDrugs, ...state.customDrugs].some(
      (drug) => drug.name.trim().toLowerCase() === name.toLowerCase(),
    )
    if (duplicate) {
      $('drug-error').textContent = '已经有同名药物了'
      return
    }
    const doseText = $('drug-dose').value.trim()
    const dose = doseText === '' ? null : Number(doseText)
    if (dose !== null && (!Number.isFinite(dose) || dose < 0)) {
      $('drug-error').textContent = '默认剂量必须是大于等于 0 的数字'
      return
    }
    const brands = $('drug-brand')
      .value.split(/[、,，;；/\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)

    state.customDrugs.push({
      id: `custom-${Date.now()}`,
      name,
      genericName: $('drug-generic').value.trim() || null,
      brandNames: Array.from(new Set(brands)),
      route: $('drug-route').value,
      defaultDose: dose,
      unit,
      catalogKey: null,
    })
    $('drug-error').textContent = ''
    $('drug-form').reset()
    $('drug-unit').value = 'mg'
    save()
    renderCustomDrugs()
    refreshDrugOptions()
  }

  function renderDiseases() {
    const box = $('disease-chips')
    box.innerHTML = ''
    for (const disease of META.diseaseOptions) {
      const button = document.createElement('button')
      const selected = state.diseases.includes(disease.id)
      button.type = 'button'
      button.className = `chip${selected ? ' is-selected' : ''}`
      button.textContent = disease.name
      button.setAttribute('aria-pressed', String(selected))
      button.title = disease.group
      button.addEventListener('click', () => {
        if (state.diseases.includes(disease.id)) {
          state.diseases = state.diseases.filter((id) => id !== disease.id)
        } else {
          state.diseases = [...state.diseases, disease.id]
        }
        save()
        renderDiseases()
        refreshDrugOptions()
      })
      box.append(button)
    }

    const summary = $('disease-summary')
    if (state.diseases.length === 0) {
      summary.textContent = '未选病种时，药物下拉显示目录里的全部药物。'
    } else {
      summary.textContent = `已选：${state.diseases.map(diseaseName).join('、')}（药物列表已合并）`
    }
  }

  function refreshDrugOptions() {
    const drugs = availableDrugs()
    fillDrugSelect($('injection-drug'), drugs, true)
    fillDrugSelect(
      $('oral-drug'),
      drugs.filter((drug) => drug.route === 'oral'),
      false,
      '还没有口服药，先在上面的「我的药物」里加一个',
    )
    applyOralDrugDefaults(false)
  }

  function fillDrugSelect(select, drugs, applyDefaults, emptyLabel) {
    if (!select) return
    const previous = select.value
    select.innerHTML = ''
    for (const drug of drugs) {
      const option = document.createElement('option')
      option.value = drug.name
      const brand = drug.brandNames && drug.brandNames.length > 0 ? `（${drug.brandNames[0]}）` : ''
      option.textContent = `${drug.name}${brand}`
      option.dataset.unit = drug.unit || 'mg'
      option.dataset.dose = drug.defaultDose === null || drug.defaultDose === undefined
        ? ''
        : String(drug.defaultDose)
      select.append(option)
    }
    if (drugs.length === 0 && emptyLabel) {
      const placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = emptyLabel
      select.append(placeholder)
    }
    const stillThere = drugs.some((drug) => drug.name === previous)
    select.value = stillThere ? previous : drugs[0] ? drugs[0].name : ''
    if (applyDefaults) applyDrugDefaults(false)
  }

  function applyDrugDefaults(overwrite) {
    const option = $('injection-drug').selectedOptions[0]
    if (!option || option.value === '') return
    if (overwrite || $('injection-unit').value.trim() === '') {
      $('injection-unit').value = option.dataset.unit || 'mg'
    }
    if (overwrite || $('injection-dose').value === '') {
      $('injection-dose').value = option.dataset.dose || ''
    }
  }

  function applyOralDrugDefaults(overwrite) {
    const select = $('oral-drug')
    if (!select) return
    const option = select.selectedOptions[0]
    if (!option || option.value === '') return
    if (overwrite || $('oral-unit').value.trim() === '') {
      $('oral-unit').value = option.dataset.unit || 'mg'
    }
    if (overwrite || $('oral-dose').value === '') {
      $('oral-dose').value = option.dataset.dose || ''
    }
  }

  function renderSites() {
    const select = $('injection-site')
    select.innerHTML = ''
    for (const site of META.sites) {
      const option = document.createElement('option')
      option.value = site.value
      option.textContent = site.label
      select.append(option)
    }
  }

  function renderPainOptions() {
    const select = $('symptom-pain')
    select.innerHTML = '<option value="">未记录</option>'
    for (let score = 0; score <= 10; score += 1) {
      const option = document.createElement('option')
      option.value = String(score)
      option.textContent = `${score} · ${painLabel(score)}`
      select.append(option)
    }
  }

  // ---------------------------------------------------------------------------
  // 症状标签
  // ---------------------------------------------------------------------------

  function tagPool() {
    const all = [...META.defaultSymptomTags, ...state.customTags]
    return Array.from(new Set(all))
  }

  function renderSymptomTags() {
    const box = $('symptom-tags')
    box.innerHTML = ''
    for (const tag of tagPool()) {
      const selected = state.draftTags.includes(tag)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `chip${selected ? ' is-selected' : ''}`
      button.textContent = tag
      button.setAttribute('aria-pressed', String(selected))
      button.addEventListener('click', () => {
        if (state.draftTags.includes(tag)) {
          state.draftTags = state.draftTags.filter((item) => item !== tag)
        } else {
          state.draftTags = [...state.draftTags, tag]
        }
        renderSymptomTags()
      })
      box.append(button)
    }
  }

  function addCustomTag() {
    const input = $('symptom-new-tag')
    const tag = input.value.trim()
    if (tag === '') return
    if (tag.length > 20) {
      setFormError('symptom', '症状名称最多 20 个字')
      return
    }
    if (!tagPool().includes(tag)) state.customTags = [...state.customTags, tag]
    if (!state.draftTags.includes(tag)) state.draftTags = [...state.draftTags, tag]
    input.value = ''
    save()
    renderSymptomTags()
  }

  // ---------------------------------------------------------------------------
  // 记录列表
  // ---------------------------------------------------------------------------

  function injectionMeta(row) {
    const parts = []
    if (row.dose !== '' && row.dose !== null && row.dose !== undefined) {
      parts.push(`剂量 ${row.dose}${row.unit ? ` ${row.unit}` : ''}`)
    } else if (row.unit) {
      parts.push(row.unit)
    }
    const site = META.sites.find((item) => item.value === row.site)
    if (site) parts.push(site.label)
    if (row.lotNumber) parts.push(`批号 ${row.lotNumber}`)
    if (row.note) parts.push(row.note)
    return parts.join(' · ')
  }

  function symptomMeta(row) {
    const parts = []
    if (row.tags.length > 0) parts.push(row.tags.join('、'))
    if (row.painScore !== '' && row.painScore !== null && row.painScore !== undefined) {
      parts.push(`疼痛 ${row.painScore}/10`)
    }
    if (row.temperature !== '' && row.temperature !== null && row.temperature !== undefined) {
      parts.push(`体温 ${row.temperature}℃`)
    }
    if (row.injectionAt) parts.push(`关联注射 ${row.injectionAt}`)
    if (row.note) parts.push(row.note)
    return parts.join(' · ')
  }

  function sortByTime(rows, key) {
    return [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])))
  }

  function renderInjectionList() {
    const list = $('injection-list')
    list.innerHTML = ''
    $('injection-count').textContent = String(state.injections.length)

    if (state.injections.length === 0) {
      list.innerHTML = '<li class="empty">还没有注射记录</li>'
      return
    }

    sortByTime(state.injections, 'injectedAt').forEach((row) => {
      const index = state.injections.indexOf(row)
      const item = document.createElement('li')
      item.className = 'record'
      item.innerHTML = `
        <div class="record-main">
          <div class="record-title">${escapeHtml(row.injectedAt)} · ${escapeHtml(row.medication)}</div>
          <div class="record-meta">${escapeHtml(injectionMeta(row))}</div>
        </div>
        <div class="record-actions">
          <button type="button" class="icon-button" data-action="edit">编辑</button>
          <button type="button" class="icon-button danger" data-action="delete">删除</button>
        </div>`
      item.querySelector('[data-action="edit"]').addEventListener('click', () => editInjection(index))
      item.querySelector('[data-action="delete"]').addEventListener('click', () => {
        state.injections.splice(index, 1)
        save()
        renderAll()
      })
      list.append(item)
    })
  }

  function renderSymptomList() {
    const list = $('symptom-list')
    list.innerHTML = ''
    $('symptom-count').textContent = String(state.symptoms.length)

    if (state.symptoms.length === 0) {
      list.innerHTML = '<li class="empty">还没有症状记录</li>'
      return
    }

    sortByTime(state.symptoms, 'loggedAt').forEach((row) => {
      const index = state.symptoms.indexOf(row)
      const item = document.createElement('li')
      item.className = 'record'
      item.innerHTML = `
        <div class="record-main">
          <div class="record-title">${escapeHtml(row.loggedAt)} · 严重程度 ${row.severity}（${SEVERITY_LABELS[row.severity - 1]}）</div>
          <div class="record-meta">${escapeHtml(symptomMeta(row)) || '无补充信息'}</div>
        </div>
        <div class="record-actions">
          <button type="button" class="icon-button" data-action="edit">编辑</button>
          <button type="button" class="icon-button danger" data-action="delete">删除</button>
        </div>`
      item.querySelector('[data-action="edit"]').addEventListener('click', () => editSymptom(index))
      item.querySelector('[data-action="delete"]').addEventListener('click', () => {
        state.symptoms.splice(index, 1)
        save()
        renderAll()
      })
      list.append(item)
    })
  }

  function renderOralList() {
    const list = $('oral-list')
    list.innerHTML = ''
    $('oral-count').textContent = String(state.oralLogs.length)

    if (state.oralLogs.length === 0) {
      list.innerHTML = '<li class="empty">还没有口服打卡记录</li>'
      return
    }

    sortByTime(state.oralLogs, 'takenAt').forEach((row) => {
      const index = state.oralLogs.indexOf(row)
      const status = ORAL_STATUS_LABELS[row.status] || ORAL_STATUS_LABELS.done
      const item = document.createElement('li')
      item.className = 'record'
      item.innerHTML = `
        <div class="record-main">
          <div class="record-title">${escapeHtml(row.takenAt)} · ${escapeHtml(row.medication)} · ${status}</div>
          <div class="record-meta">${escapeHtml(oralMeta(row)) || '无补充信息'}</div>
        </div>
        <div class="record-actions">
          <button type="button" class="icon-button" data-action="edit">编辑</button>
          <button type="button" class="icon-button danger" data-action="delete">删除</button>
        </div>`
      item.querySelector('[data-action="edit"]').addEventListener('click', () => editOral(index))
      item.querySelector('[data-action="delete"]').addEventListener('click', () => {
        state.oralLogs.splice(index, 1)
        save()
        renderAll()
      })
      list.append(item)
    })
  }

  function oralMeta(row) {
    const parts = []
    if (row.dose !== '' && row.dose !== null && row.dose !== undefined) {
      parts.push(`${row.dose}${row.unit ? ` ${row.unit}` : ''}`)
    }
    if (row.note) parts.push(row.note)
    return parts.join(' · ')
  }

  function renderInjectionSelectForSymptom() {
    const select = $('symptom-injection')
    const previous = select.value
    select.innerHTML = '<option value="">不关联</option>'
    for (const row of sortByTime(state.injections, 'injectedAt')) {
      const option = document.createElement('option')
      option.value = row.injectedAt
      option.textContent = `${row.injectedAt} · ${row.medication}`
      select.append(option)
    }
    select.value = previous && Array.from(select.options).some((option) => option.value === previous)
      ? previous
      : ''
  }

  function renderAll() {
    renderCustomDrugs()
    renderInjectionList()
    renderSymptomList()
    renderOralList()
    renderInjectionSelectForSymptom()
    updatePreview()
  }

  // ---------------------------------------------------------------------------
  // 表单
  // ---------------------------------------------------------------------------

  function resetInjectionForm() {
    state.editingInjection = null
    $('injection-form').reset()
    $('injection-time').value = nowForInput()
    refreshDrugOptions()
    $('injection-submit').textContent = '添加注射记录'
    $('injection-cancel').hidden = true
    applyDrugDefaults(true)
    setFormError('injection', '')
  }

  function editInjection(index) {
    const row = state.injections[index]
    if (!row) return
    state.editingInjection = index
    $('injection-time').value = toInputValue(row.injectedAt)
    if (!Array.from($('injection-drug').options).some((option) => option.value === row.medication)) {
      refreshDrugOptions()
    }
    $('injection-drug').value = row.medication
    $('injection-dose').value = row.dose
    $('injection-unit').value = row.unit
    $('injection-site').value = row.site
    $('injection-lot').value = row.lotNumber || ''
    $('injection-note').value = row.note || ''
    $('injection-submit').textContent = '保存修改'
    $('injection-cancel').hidden = false
    setFormError('injection', '')
    $('injection-time').focus()
  }

  function submitInjection(event) {
    event.preventDefault()
    const injectedAt = toLocalText($('injection-time').value)
    const medication = $('injection-drug').value
    const doseText = $('injection-dose').value.trim()
    const dose = doseText === '' ? '' : Number(doseText)
    const unit = $('injection-unit').value.trim()
    const site = $('injection-site').value
    const lotNumber = $('injection-lot').value.trim()
    const note = $('injection-note').value.trim()

    if (!injectedAt) return setFormError('injection', '请选择注射时间')
    if (!medication) return setFormError('injection', '请选择药物')
    if (dose !== '' && (!Number.isFinite(dose) || dose < 0)) {
      return setFormError('injection', '剂量必须是大于等于 0 的数字')
    }

    const row = { injectedAt, medication, dose, unit: unit || 'mg', site, lotNumber, note }
    if (state.editingInjection !== null) {
      state.injections[state.editingInjection] = row
    } else {
      state.injections.push(row)
    }
    save()
    resetInjectionForm()
    renderAll()
  }

  function resetSymptomForm() {
    state.editingSymptom = null
    state.draftTags = []
    $('symptom-form').reset()
    $('symptom-time').value = nowForInput()
    $('symptom-severity').value = '3'
    $('symptom-pain').value = ''
    $('symptom-submit').textContent = '添加症状记录'
    $('symptom-cancel').hidden = true
    setFormError('symptom', '')
    renderSymptomTags()
  }

  function editSymptom(index) {
    const row = state.symptoms[index]
    if (!row) return
    state.editingSymptom = index
    state.draftTags = [...row.tags]
    $('symptom-time').value = toInputValue(row.loggedAt)
    $('symptom-severity').value = String(row.severity)
    $('symptom-pain').value =
      row.painScore === '' || row.painScore === null || row.painScore === undefined
        ? ''
        : String(row.painScore)
    $('symptom-temperature').value = row.temperature
    $('symptom-note').value = row.note || ''
    renderSymptomTags()
    renderInjectionSelectForSymptom()
    $('symptom-injection').value = row.injectionAt || ''
    $('symptom-submit').textContent = '保存修改'
    $('symptom-cancel').hidden = false
    setFormError('symptom', '')
    $('symptom-time').focus()
  }

  function submitSymptom(event) {
    event.preventDefault()
    const loggedAt = toLocalText($('symptom-time').value)
    const severity = Number($('symptom-severity').value)
    const painText = $('symptom-pain').value
    const temperatureText = $('symptom-temperature').value.trim()
    const temperature = temperatureText === '' ? '' : Number(temperatureText)
    const note = $('symptom-note').value.trim()
    const injectionAt = $('symptom-injection').value

    if (!loggedAt) return setFormError('symptom', '请选择记录时间')
    if (!Number.isInteger(severity) || severity < 1 || severity > 5) {
      return setFormError('symptom', '严重程度必须是 1 到 5')
    }
    if (temperature !== '' && (!Number.isFinite(temperature) || temperature < 30 || temperature > 45)) {
      return setFormError('symptom', '体温应在 30℃ 到 45℃ 之间')
    }

    const row = {
      loggedAt,
      severity,
      painScore: painText === '' ? '' : Number(painText),
      tags: [...state.draftTags],
      temperature,
      note,
      injectionAt,
    }
    if (state.editingSymptom !== null) {
      state.symptoms[state.editingSymptom] = row
    } else {
      state.symptoms.push(row)
    }
    save()
    resetSymptomForm()
    renderAll()
  }

  function resetOralForm() {
    state.editingOral = null
    $('oral-form').reset()
    $('oral-time').value = nowForInput()
    $('oral-status').value = 'done'
    refreshDrugOptions()
    $('oral-submit').textContent = '添加口服打卡'
    $('oral-cancel').hidden = true
    applyOralDrugDefaults(true)
    setFormError('oral', '')
  }

  function editOral(index) {
    const row = state.oralLogs[index]
    if (!row) return
    state.editingOral = index
    $('oral-time').value = toInputValue(row.takenAt)
    if (!Array.from($('oral-drug').options).some((option) => option.value === row.medication)) {
      refreshDrugOptions()
    }
    $('oral-drug').value = row.medication
    $('oral-status').value = row.status
    $('oral-dose').value = row.dose
    $('oral-unit').value = row.unit
    $('oral-note').value = row.note || ''
    $('oral-submit').textContent = '保存修改'
    $('oral-cancel').hidden = false
    setFormError('oral', '')
    $('oral-time').focus()
  }

  function submitOral(event) {
    event.preventDefault()
    const takenAt = toLocalText($('oral-time').value)
    const medication = $('oral-drug').value
    const status = $('oral-status').value
    const doseText = $('oral-dose').value.trim()
    const dose = doseText === '' ? '' : Number(doseText)
    const unit = $('oral-unit').value.trim()
    const note = $('oral-note').value.trim()

    if (!takenAt) return setFormError('oral', '请选择记录时间')
    if (!medication) return setFormError('oral', '请选择药物，没有的话先在上面添加口服药')
    if (!ORAL_STATUS_LABELS[status]) return setFormError('oral', '状态只能是完成、跳过或漏服')
    if (dose !== '' && (!Number.isFinite(dose) || dose < 0)) {
      return setFormError('oral', '剂量必须是大于等于 0 的数字')
    }

    const row = { takenAt, medication, status, dose, unit: unit || 'mg', note }
    if (state.editingOral !== null) {
      state.oralLogs[state.editingOral] = row
    } else {
      state.oralLogs.push(row)
    }
    save()
    resetOralForm()
    renderAll()
  }

  // ---------------------------------------------------------------------------
  // 导出 / 导入
  // ---------------------------------------------------------------------------

  function catalogDrugByName(name) {
    return (
      META.allDrugs.find((drug) => drug.name === name) ||
      META.allDrugs.find((drug) => drug.genericName === name) ||
      null
    )
  }

  function referencedMedicationNames() {
    const names = new Set()
    for (const row of state.injections) {
      if (row.medication) names.add(row.medication)
    }
    for (const row of state.oralLogs) {
      if (row.medication) names.add(row.medication)
    }
    return names
  }

  /** v2 的 medications：自定义药 + 记录里用到的目录药（目录药带 catalogKey）。 */
  function buildMedications() {
    const result = []
    const seen = new Set()

    for (const drug of state.customDrugs) {
      const key = drug.name.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        name: drug.name,
        genericName: drug.genericName || null,
        brandNames: [...(drug.brandNames || [])],
        route: drug.route || 'sc',
        defaultDose:
          drug.defaultDose === null || drug.defaultDose === undefined || drug.defaultDose === ''
            ? null
            : Number(drug.defaultDose),
        unit: drug.unit || 'mg',
      })
    }

    for (const name of referencedMedicationNames()) {
      const catalog = catalogDrugByName(name)
      if (!catalog) continue
      const key = catalog.name.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        name: catalog.name,
        genericName: catalog.genericName || null,
        brandNames: [...(catalog.brandNames || [])],
        route: catalog.route || 'sc',
        defaultDose:
          catalog.defaultDose === null || catalog.defaultDose === undefined
            ? null
            : Number(catalog.defaultDose),
        unit: catalog.unit || 'mg',
        catalogKey: catalog.key,
      })
    }

    return result
  }

  function buildPayload() {
    const medications = buildMedications()

    const injections = state.injections.map((row) => {
      const item = { injectedAt: row.injectedAt }
      if (row.medication) item.medication = row.medication
      if (row.dose !== '' && row.dose !== null && row.dose !== undefined) {
        item.dose = Number(row.dose)
      }
      if (row.unit) item.unit = row.unit
      if (row.site) item.site = row.site
      if (row.lotNumber) item.lotNumber = row.lotNumber
      if (row.note) item.note = row.note
      return item
    })

    const oralLogs = state.oralLogs.map((row) => {
      const item = { takenAt: row.takenAt }
      if (row.medication) item.medication = row.medication
      if (row.status) item.status = row.status
      if (row.dose !== '' && row.dose !== null && row.dose !== undefined) {
        item.dose = Number(row.dose)
      }
      if (row.unit) item.unit = row.unit
      if (row.note) item.note = row.note
      return item
    })

    const symptoms = state.symptoms.map((row) => {
      const item = { loggedAt: row.loggedAt, severity: row.severity }
      if (row.painScore !== '' && row.painScore !== null && row.painScore !== undefined) {
        item.painScore = Number(row.painScore)
      }
      if (row.tags.length > 0) item.tags = [...row.tags]
      if (row.temperature !== '' && row.temperature !== null && row.temperature !== undefined) {
        item.temperature = Number(row.temperature)
      }
      if (row.note) item.note = row.note
      if (row.injectionAt) item.injectionAt = row.injectionAt
      return item
    })

    return {
      format: 'bioclock-import',
      version: 2,
      medications,
      injections,
      oralLogs,
      symptoms,
    }
  }

  function updatePreview() {
    $('json-preview').textContent = JSON.stringify(buildPayload(), null, 2)
  }

  const INJECTION_HEADERS = ['注射时间', '药物', '剂量', '单位', '部位', '批号', '备注']
  const ORAL_HEADERS = ['记录时间', '药物', '状态', '剂量', '单位', '备注']
  const SYMPTOM_HEADERS = [
    '记录时间',
    '严重程度',
    '疼痛评分',
    '症状',
    '体温(℃)',
    '备注',
    '关联注射时间',
  ]
  const MEDICATION_HEADERS = ['药名', '通用名', '商品名', '给药途径', '默认剂量', '单位', '目录标识']

  function dateStamp() {
    const date = new Date()
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  }

  function buildSheet(headers, rows, widths) {
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
    sheet['!cols'] = widths.map((width) => ({ wch: width }))
    return sheet
  }

  /** Excel 里写中文途径，App 的解析认「皮下注射 / 静脉输注 / 口服」。 */
  function routeSheetLabel(route) {
    if (route === 'oral') return '口服'
    if (route === 'iv') return '静脉输注'
    return '皮下注射'
  }

  function injectionSheetRows() {
    return sortByTime(state.injections, 'injectedAt').map((row) => [
      row.injectedAt,
      row.medication,
      row.dose === '' ? '' : Number(row.dose),
      row.unit,
      labelOfSite(row.site),
      row.lotNumber,
      row.note,
    ])
  }

  function oralSheetRows() {
    return sortByTime(state.oralLogs, 'takenAt').map((row) => [
      row.takenAt,
      row.medication,
      ORAL_STATUS_LABELS[row.status] || ORAL_STATUS_LABELS.done,
      row.dose === '' ? '' : Number(row.dose),
      row.unit,
      row.note,
    ])
  }

  function symptomSheetRows() {
    return sortByTime(state.symptoms, 'loggedAt').map((row) => [
      row.loggedAt,
      row.severity,
      row.painScore === '' ? '' : Number(row.painScore),
      row.tags.join('、'),
      row.temperature === '' ? '' : Number(row.temperature),
      row.note,
      row.injectionAt,
    ])
  }

  function medicationSheetRows(medications) {
    return medications.map((drug) => [
      drug.name,
      drug.genericName || '',
      (drug.brandNames || []).join('、'),
      routeSheetLabel(drug.route),
      drug.defaultDose === null || drug.defaultDose === undefined ? '' : Number(drug.defaultDose),
      drug.unit || '',
      drug.catalogKey || '',
    ])
  }

  function labelOfSite(value) {
    const site = META.sites.find((item) => item.value === value)
    return site ? site.label : value
  }

  function buildWorkbook(medications, injections, oralLogs, symptoms) {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      buildSheet(INJECTION_HEADERS, injections, [18, 16, 8, 8, 12, 12, 28]),
      '注射记录',
    )
    XLSX.utils.book_append_sheet(
      workbook,
      buildSheet(ORAL_HEADERS, oralLogs, [18, 16, 10, 8, 8, 28]),
      '口服打卡',
    )
    XLSX.utils.book_append_sheet(
      workbook,
      buildSheet(SYMPTOM_HEADERS, symptoms, [18, 10, 10, 24, 10, 28, 18]),
      '症状记录',
    )
    XLSX.utils.book_append_sheet(
      workbook,
      buildSheet(MEDICATION_HEADERS, medications, [16, 16, 24, 12, 10, 8, 14]),
      '药物',
    )
    return workbook
  }

  function hasAnything() {
    return (
      state.injections.length > 0 ||
      state.symptoms.length > 0 ||
      state.oralLogs.length > 0 ||
      state.customDrugs.length > 0
    )
  }

  function downloadExcel() {
    if (!hasAnything()) {
      showStatus('还没有任何记录，先补录一条再导出。', 'error')
      return
    }
    const medications = buildMedications()
    const workbook = buildWorkbook(
      medicationSheetRows(medications),
      injectionSheetRows(),
      oralSheetRows(),
      symptomSheetRows(),
    )
    XLSX.writeFile(workbook, `bioclock-import-${dateStamp()}.xlsx`)
    showStatus(
      `已导出 ${state.injections.length} 条注射、${state.oralLogs.length} 条口服、${state.symptoms.length} 条症状、${medications.length} 种药物`,
    )
  }

  function downloadTemplate() {
    const workbook = buildWorkbook(
      [
        ['甲氨蝶呤', '甲氨蝶呤', '', '口服', 10, 'mg', ''],
        ['阿达木单抗', '阿达木单抗', '修美乐、格乐立', '皮下注射', 40, 'mg', 'adalimumab'],
      ],
      [['2026-03-15 09:00', '阿达木单抗', 40, 'mg', '腹部左上', 'AB12345', '示例行，可删除']],
      [['2026-03-16 08:30', '甲氨蝶呤', '完成', 10, 'mg', '示例行，可删除']],
      [['2026-03-30 20:30', 4, 6, '发热、乏力', 37.8, '示例行，可删除', '2026-03-15 09:00']],
    )
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['填写说明'],
        ['1. 时间格式：2026-03-15 09:00（本地时间，不要写时区）'],
        ['2. 注射记录：注射时间、药物必填；部位可写中文（腹部左上）或留空'],
        ['3. 口服打卡：记录时间、药物必填；状态写 完成 / 跳过 / 漏服，留空按「完成」算'],
        ['4. 症状记录：记录时间必填；严重程度 1–5；疼痛评分 0–10；症状用顿号或逗号分隔'],
        ['5. 关联注射时间可选，要和某条注射记录的注射时间完全一致'],
        ['6. 药物：目录里没有的药（国产仿制药、口服药等）在这里加一行，药名必填；'],
        ['   给药途径写 皮下注射 / 静脉输注 / 口服；目录标识留空表示自定义药物'],
        ['7. 不要修改表头名称；示例行可以删除或直接覆盖；用不到的整张表可以直接删掉'],
        ['8. 填好后保存为 .xlsx，在 App 的 设置 → 导入数据 里选择该文件'],
      ]),
      '填写说明',
    )
    XLSX.writeFile(workbook, 'bioclock-import-template.xlsx')
    showStatus('模板已下载')
  }

  function download() {
    if (!hasAnything()) {
      showStatus('还没有任何记录，先补录一条再导出。', 'error')
      return
    }
    const payload = buildPayload()
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const date = new Date()
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `bioclock-import-${stamp}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    showStatus(
      `已导出 ${payload.injections.length} 条注射、${payload.oralLogs.length} 条口服、${payload.symptoms.length} 条症状`,
    )
  }

  async function copyJson() {
    const text = JSON.stringify(buildPayload(), null, 2)
    try {
      await navigator.clipboard.writeText(text)
      showStatus('已复制到剪贴板')
    } catch (error) {
      showStatus('浏览器不允许复制，请展开预览手动复制。', 'error')
    }
  }

  function clearAll() {
    if (!hasAnything()) return
    if (!window.confirm('确定清空当前浏览器里补录的所有记录和自定义药物？此操作不可恢复。')) return
    state.injections = []
    state.oralLogs = []
    state.symptoms = []
    state.customDrugs = []
    save()
    resetInjectionForm()
    resetSymptomForm()
    resetOralForm()
    refreshDrugOptions()
    renderAll()
    showStatus('已清空')
  }

  function normalizeInjection(row) {
    return {
      injectedAt: String(row.injectedAt || ''),
      medication: String(row.medication || ''),
      dose: row.dose === null || row.dose === undefined ? '' : String(row.dose),
      unit: String(row.unit || 'mg'),
      site: META.sites.some((item) => item.value === row.site) ? row.site : 'abdomen_ul',
      lotNumber: String(row.lotNumber || ''),
      note: String(row.note || ''),
    }
  }

  function normalizeSymptom(row) {
    return {
      loggedAt: String(row.loggedAt || ''),
      severity: Number(row.severity) >= 1 && Number(row.severity) <= 5 ? Number(row.severity) : 3,
      painScore:
        row.painScore === null || row.painScore === undefined ? '' : String(row.painScore),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      temperature:
        row.temperature === null || row.temperature === undefined ? '' : String(row.temperature),
      note: String(row.note || ''),
      injectionAt: String(row.injectionAt || ''),
    }
  }

  function normalizeOral(row) {
    return {
      takenAt: String(row.takenAt || row.loggedAt || ''),
      medication: String(row.medication || ''),
      status: ORAL_STATUS_LABELS[row.status] ? row.status : 'done',
      dose: row.dose === null || row.dose === undefined ? '' : String(row.dose),
      unit: String(row.unit || 'mg'),
      note: String(row.note || ''),
    }
  }

  /** v2 的 medications 里没有 catalogKey 的条目 = 自定义药。 */
  function normalizeMedication(row, index) {
    if (!row || typeof row !== 'object') return null
    const name = String(row.name || '').trim()
    if (name === '') return null
    const brands = Array.isArray(row.brandNames)
      ? row.brandNames.map(String)
      : String(row.brandNames || '')
          .split(/[、,，;；/\n]+/)
          .map((item) => item.trim())
    const dose =
      row.defaultDose === null || row.defaultDose === undefined || row.defaultDose === ''
        ? null
        : Number(row.defaultDose)
    return {
      id: `custom-${Date.now()}-${index}`,
      name,
      genericName: row.genericName ? String(row.genericName).trim() : null,
      brandNames: Array.from(new Set(brands.filter(Boolean))),
      route: ['sc', 'iv', 'oral'].includes(row.route) ? row.route : 'sc',
      defaultDose: Number.isFinite(dose) ? dose : null,
      unit: String(row.unit || 'mg'),
      catalogKey: null,
    }
  }

  function mergeCustomDrugs(medications) {
    const taken = new Set(
      [...META.allDrugs, ...state.customDrugs].map((drug) => drug.name.trim().toLowerCase()),
    )
    for (const [index, row] of medications.entries()) {
      const drug = normalizeMedication(row, index)
      if (!drug) continue
      const key = drug.name.toLowerCase()
      if (taken.has(key)) continue
      taken.add(key)
      state.customDrugs.push(drug)
    }
  }

  async function loadFile(file) {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const version = data && Number(data.version)
      if (!data || data.format !== 'bioclock-import' || (version !== 1 && version !== 2)) {
        throw new Error('不是 BioClock 的导入文件（只支持版本 1 和 2）')
      }
      const medications = Array.isArray(data.medications) ? data.medications : []
      const injections = Array.isArray(data.injections) ? data.injections : []
      const oralLogs = Array.isArray(data.oralLogs) ? data.oralLogs : []
      const symptoms = Array.isArray(data.symptoms) ? data.symptoms : []
      if (
        medications.length === 0 &&
        injections.length === 0 &&
        oralLogs.length === 0 &&
        symptoms.length === 0
      ) {
        throw new Error('文件里没有记录')
      }

      const beforeCustom = state.customDrugs.length
      // 只有没有 catalogKey 的条目才是用户自定义药；目录药由 App 自己认领。
      mergeCustomDrugs(medications.filter((row) => row && !row.catalogKey))
      const addedCustom = state.customDrugs.length - beforeCustom

      state.injections = injections.map(normalizeInjection)
      state.oralLogs = oralLogs.map(normalizeOral)
      state.symptoms = symptoms.map(normalizeSymptom)
      state.customTags = Array.from(
        new Set([
          ...state.customTags,
          ...state.symptoms.flatMap((row) => row.tags),
        ]),
      ).filter((tag) => !META.defaultSymptomTags.includes(tag))
      save()
      refreshDrugOptions()
      renderAll()
      showStatus(
        `已载入 ${state.injections.length} 条注射、${state.oralLogs.length} 条口服、${state.symptoms.length} 条症状${
          addedCustom > 0 ? `，新增 ${addedCustom} 种自定义药物` : ''
        }`,
      )
    } catch (error) {
      showStatus(error instanceof Error ? error.message : '文件解析失败', 'error')
    }
  }

  // ---------------------------------------------------------------------------
  // 初始化
  // ---------------------------------------------------------------------------

  function setupTabs() {
    const tabs = Array.from(document.querySelectorAll('.tab'))
    const panels = {
      injection: $('panel-injection'),
      symptom: $('panel-symptom'),
      oral: $('panel-oral'),
    }
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((item) => {
          const active = item === tab
          item.classList.toggle('is-active', active)
          item.setAttribute('aria-selected', String(active))
        })
        const target = tab.dataset.tab
        for (const [name, panel] of Object.entries(panels)) {
          if (panel) panel.hidden = name !== target
        }
      })
    })
  }

  function bind() {
    setupTabs()

    $('injection-form').addEventListener('submit', submitInjection)
    $('symptom-form').addEventListener('submit', submitSymptom)
    $('oral-form').addEventListener('submit', submitOral)
    $('drug-form').addEventListener('submit', (event) => {
      event.preventDefault()
      addCustomDrug()
    })

    $('injection-drug').addEventListener('change', () => applyDrugDefaults(true))
    $('oral-drug').addEventListener('change', () => applyOralDrugDefaults(true))
    $('injection-cancel').addEventListener('click', () => {
      resetInjectionForm()
      renderAll()
    })
    $('symptom-cancel').addEventListener('click', () => {
      resetSymptomForm()
      renderAll()
    })
    $('oral-cancel').addEventListener('click', () => {
      resetOralForm()
      renderAll()
    })
    $('symptom-add-tag').addEventListener('click', addCustomTag)
    $('symptom-new-tag').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        addCustomTag()
      }
    })

    $('download').addEventListener('click', download)
    $('download-excel').addEventListener('click', downloadExcel)
    $('download-template').addEventListener('click', downloadTemplate)
    $('copy').addEventListener('click', () => {
      void copyJson()
    })
    $('clear').addEventListener('click', clearAll)
    $('load-file').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0]
      if (file) void loadFile(file)
      event.target.value = ''
    })
  }

  function init() {
    restore()
    renderDiseases()
    renderSites()
    renderPainOptions()
    refreshDrugOptions()
    $('injection-time').value = nowForInput()
    $('symptom-time').value = nowForInput()
    $('oral-time').value = nowForInput()
    renderSymptomTags()
    renderAll()
    bind()
  }

  init()
})()
