import { AssetFactsFields, pickAssetFacts, type AssetFacts } from './AssetFactsFields'
import { useEffect, useRef, useState } from 'react'
import { Input, InputNumber, Modal, message } from 'antd'
import { ProjectVisualStyleAndStyleFields } from '../../project/ProjectVisualStyleAndStyleFields'
import { useProjectStyleOptions } from '../../project/useProjectStyleOptions'

export type StudioAssetLike = AssetFacts & {
  id: string
  name: string
  description?: string | null
  thumbnail?: string
  tags?: string[]
  view_count?: number
}

function normalizeTags(input: string): string[] {
  return input
    .split(/[,，\n]/g)
    .map((t) => t.trim())
    .filter(Boolean)
}

export function normalizeStudioAsset(asset: StudioAssetLike): StudioAssetLike {
  return {
    ...asset,
    thumbnail: asset.thumbnail,
  }
}

function clampViewCount(value: number | null): number | null {
  if (value === null) return null
  return Math.max(1, Math.min(4, Math.trunc(value)))
}

function notifyShotAssetCreatedAndLinked(payload: {
  projectId?: string
  chapterId?: string
  shotId?: string
  assetId?: string
  assetName: string
}) {
  if (!payload.projectId || !payload.chapterId || !payload.shotId) return
  try {
    window.opener?.postMessage(
      {
        type: 'studio-shot-asset-created-and-linked',
        projectId: payload.projectId,
        chapterId: payload.chapterId,
        shotId: payload.shotId,
        assetId: payload.assetId ?? null,
        assetName: payload.assetName,
      },
      window.location.origin,
    )
  } catch {
    // 跨窗口通知失败不阻塞创建成功。
  }
}

type AssetMutationPayload = Record<string, unknown> & {
  name: string
  description?: string
  tags?: string[]
  view_count?: number | null
  thumbnail?: string
}

type AssetCreatePayload = Record<string, unknown> & {
  name: string
  thumbnail?: string
}

export type StudioAssetSavedContext =
  | { type: 'create' }
  | { type: 'update'; id: string; asset: StudioAssetLike }

export function StudioAssetTypeFormModal({
  open,
  label,
  entityType,
  editing,
  linkProjectId,
  linkChapterId,
  linkShotId,
  createAsset,
  updateAsset,
  onCancel,
  onSaved,
  seedCreateForm,
  onSeedConsumed,
}: {
  open: boolean
  label: string
  entityType: 'scene' | 'prop' | 'costume'
  editing: StudioAssetLike | null
  linkProjectId?: string
  linkChapterId?: string
  linkShotId?: string
  createAsset: (payload: AssetCreatePayload) => Promise<StudioAssetLike>
  updateAsset: (id: string, payload: AssetMutationPayload) => Promise<StudioAssetLike>
  onCancel: () => void
  onSaved: (ctx: StudioAssetSavedContext) => void | Promise<void>
  seedCreateForm?: {
    name?: string
    description?: string
    visual_style?: '现实' | '动漫'
    style?: string
  } | null
  onSeedConsumed?: () => void
}) {
  const { options: projectStyleOptions, defaultVisualStyle, getDefaultStyle } = useProjectStyleOptions()
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formFacts, setFormFacts] = useState<AssetFacts>({})
  const [formTags, setFormTags] = useState('')
  const [formViewCount, setFormViewCount] = useState<number | null>(null)
  const [formVisualStyle, setFormVisualStyle] = useState<'现实' | '动漫'>(defaultVisualStyle as '现实' | '动漫')
  const [formStyle, setFormStyle] = useState<string>(getDefaultStyle(defaultVisualStyle))
  const createFormInitializedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      createFormInitializedRef.current = false
      return
    }
    if (editing) {
      setFormName(editing.name)
      setFormDesc(editing.supplementary_info ?? '')
      setFormFacts(pickAssetFacts(entityType, editing))
      setFormTags((editing.tags ?? []).join(', '))
      setFormViewCount(editing.view_count ?? null)
      const nextVisual = (((editing as { visual_style?: '现实' | '动漫' }).visual_style ?? defaultVisualStyle) as '现实' | '动漫')
      setFormVisualStyle(nextVisual)
      setFormStyle(
        ((editing as { style?: string }).style as string | undefined) ??
          getDefaultStyle(nextVisual),
      )
      createFormInitializedRef.current = true
      return
    }
    if (!createFormInitializedRef.current) {
      createFormInitializedRef.current = true
      if (seedCreateForm) {
        setFormFacts({})
        setFormName(seedCreateForm.name ?? '')
        setFormDesc(seedCreateForm.description ?? '')
        const nextVisual = seedCreateForm.visual_style ?? (defaultVisualStyle as '现实' | '动漫')
        setFormVisualStyle(nextVisual)
        setFormStyle(seedCreateForm.style ?? getDefaultStyle(nextVisual))
        onSeedConsumed?.()
      } else {
        setFormFacts({})
      setFormName('')
        setFormDesc('')
        setFormVisualStyle(defaultVisualStyle as '现实' | '动漫')
        setFormStyle(getDefaultStyle(defaultVisualStyle))
      }
      setFormTags('')
      setFormViewCount(null)
    }
  }, [open, editing, seedCreateForm, onSeedConsumed, defaultVisualStyle, getDefaultStyle])

  const handleOk = async () => {
    if (!formName.trim()) {
      message.warning('请输入资产名称')
      return Promise.reject(new Error('validation'))
    }

    try {
      const nextViewCount = clampViewCount(formViewCount)

      if (editing) {
        const next = await updateAsset(editing.id, {
          name: formName.trim(),
          supplementary_info: formDesc.trim(),
          ...formFacts,
          tags: normalizeTags(formTags),
          ...(nextViewCount === null ? {} : { view_count: nextViewCount }),
          visual_style: formVisualStyle,
          style: formStyle,
        })
        const normalizedNext = normalizeStudioAsset(next)
        message.success('已保存')
        onCancel()
        await onSaved({ type: 'update', id: editing.id, asset: normalizedNext })
      } else {
        const created = await createAsset({
          id: `asset_${Date.now()}`,
          name: formName.trim(),
          supplementary_info: formDesc.trim(),
          ...formFacts,
          tags: normalizeTags(formTags),
          visual_style: formVisualStyle,
          style: formStyle,
          ...(linkProjectId ? { project_id: linkProjectId } : {}),
          ...(linkProjectId && linkChapterId ? { chapter_id: linkChapterId } : {}),
          ...(linkProjectId && linkShotId ? { shot_id: linkShotId } : {}),
          ...(nextViewCount === null ? {} : { view_count: nextViewCount }),
        })
        notifyShotAssetCreatedAndLinked({
          projectId: linkProjectId,
          chapterId: linkChapterId,
          shotId: linkShotId,
          assetId: created.id,
          assetName: formName.trim(),
        })
        message.success('已创建')
        onCancel()
        await onSaved({ type: 'create' })
      }
    } catch {
      message.error('保存失败')
      return Promise.reject(new Error('api'))
    }
  }

  return (
    <Modal
      title={editing ? `编辑${label}` : `新建${label}`}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="保存"
      width={560}
    >
      <div className="space-y-3">
        <div>
          <span className="text-gray-600 text-sm">名称</span>
          <Input value={formName} onChange={(e) => setFormName(e.target.value)} className="mt-1" />
        </div>
        <AssetFactsFields type={entityType} value={formFacts} onChange={setFormFacts} supplementaryInfo={formDesc} />
        <div>
          <span className="text-gray-600 text-sm">补充信息</span>
          <Input.TextArea maxLength={8000} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} rows={4} className="mt-1" />
        </div>
        <div>
          <span className="text-gray-600 text-sm">标签（逗号分隔）</span>
          <Input value={formTags} onChange={(e) => setFormTags(e.target.value)} className="mt-1" />
        </div>
        <div>
          <span className="text-gray-600 text-sm">视角数</span>
          <InputNumber
            min={1}
            max={4}
            precision={0}
            value={formViewCount}
            onChange={(v) => setFormViewCount(v ?? null)}
            className="mt-1 w-full"
            placeholder="例如 4（最大 4）"
          />
        </div>
        <div>
          <ProjectVisualStyleAndStyleFields
            visual_style={formVisualStyle}
            style={formStyle}
            options={projectStyleOptions}
            onChange={(next) => {
              setFormVisualStyle(next.visual_style)
              setFormStyle(next.style)
            }}
          />
        </div>
      </div>
    </Modal>
  )
}
