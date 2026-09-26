/**
 * 巨日禄**脚本组选择区 + 目标章节选择**（抓取完成后的第一屏，放在统一预览表**上面**）。
 *
 * 用户要求（2026-09-20 原话 + 同日升级）：
 * 1) 一次抓取拿到的三个 scriptId 分成**三个可选择的脚本组**；**单选**（UI 上不可能选多个）；
 * 2) **默认不跨 scriptId 合并**、默认一组都不选、不匹配、不写库；
 * 3) **选中一组就是整组导入**：该组**全部**记录（31 / 37 / 41）进统一预览与匹配，
 *    **不取前三条、不与其他 scriptId 混合**；
 * 4) 没有可靠时间证据时**不标「最新版本」**：只陈述客观信息（标题、创建/更新时间「未提供」、
 *    记录数、序号范围、「与 X 标题相同」「分镜正文重合度 82%」这类事实）——
 *    判定在 `juriluScriptGroups.versionInfo`（有测试），本组件只负责显示；
 * 5) 先让用户确认 msgpack 解析出的正文 / 分镜序号 / 提示词是否正确，**不自动写库**；
 * 6) 「不要因为接口共返回 109 条，就把 109 条当成同一集的连续镜头」。
 *
 * 目标章节（升级要求第 1 条）：可选本项目**已有章节**，也可以**直接新建章节**
 * （走项目里既有的建章节接口 `StudioChaptersService.createChapter…`，不另造一套）。
 */

import { useState } from 'react'
import { Alert, Button, Card, Input, Modal, Radio, Select, Space, Table, Tag, Typography } from 'antd'
import type { JuriluScriptGroup } from '../../../../../services/llmPipelineApi'
// 阶段 B ①：后端原文不直渲（三级管道 + 中文兜底）
import { toUserFacingText } from '../../../components/userFacingMessage.ts'
// 阶段 B ①：内部标识只允许出现在默认收起的「技术详情」折叠区（全仓唯一实现）
import { TechnicalDetailSection } from './workbench/TechnicalDetailCollapse'
import {
  activeGroupLabel,
  groupFieldTexts,
  rawKeysText,
  sampleRows,
  sampleSectionTitle,
  summarizeScriptGroups,
  versionInfo,
  wholeGroupNotice,
  type JuriluStage,
  type SampleRow,
} from './juriluScriptGroups'

export interface TargetChapterOption {
  value: string
  label: string
  shotCount: number
}

export interface JuriluScriptGroupPickerProps {
  groups: JuriluScriptGroup[]
  /** 当前选中的脚本组（'' = 默认一组都不选） */
  selectedId: string
  onSelect: (scriptId: string) => void
  /** 点「用这一组匹配镜头」 */
  onMatch: () => void
  matching: boolean
  /** 已经完成匹配的脚本组（用于显示「已匹配 N 条」） */
  matchedId?: string
  matchedRowCount?: number
  /** 后端这次的说明 / 状态机给出的中文提示 */
  notices?: string[]
  /** 放弃本次导入（清空凭证与脚本组） */
  onAbandon?: () => void

  /* ---- 目标章节（升级要求：可选已有章节，或直接新建章节） ---- */
  chapterOptions: TargetChapterOption[]
  targetChapterId: string
  onTargetChapterChange: (chapterId: string) => void
  chaptersLoading: boolean
  /** 新建章节：复用项目既有的建章节能力（调用方负责调接口与刷新列表） */
  onCreateChapter: (input: { title: string; summary: string }) => Promise<void>
  creatingChapter: boolean
  /**
   * 目标章节文案（**名称 + ID 末段 + 镜头数**）与流程状态文案，
   * 都由页面的 `resolveJuriluFlow` 一份产出（与缺口面板同源，不会互相矛盾）。
   */
  targetChapterText: string
  flowStatusText: string
  stage: JuriluStage
}

export default function JuriluScriptGroupPicker({
  groups,
  selectedId,
  onSelect,
  onMatch,
  matching,
  matchedId = '',
  matchedRowCount = 0,
  notices = [],
  onAbandon,
  chapterOptions,
  targetChapterId,
  onTargetChapterChange,
  chaptersLoading,
  onCreateChapter,
  creatingChapter,
  targetChapterText,
  flowStatusText,
  stage,
}: JuriluScriptGroupPickerProps) {
  const summary = summarizeScriptGroups(groups)
  const selected = groups.find((group) => group.script_id === selectedId) ?? null
  const target = chapterOptions.find((item) => item.value === targetChapterId) ?? null
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newSummary, setNewSummary] = useState('')

  const submitCreate = async () => {
    if (!newTitle.trim()) return
    await onCreateChapter({ title: newTitle.trim(), summary: newSummary.trim() })
    setNewTitle('')
    setNewSummary('')
    setCreateOpen(false)
  }

  return (
    <Card
      size="small"
      className="mb-3"
      data-testid="jurilu-script-picker"
      title="巨日禄脚本组导入（单选一组 · 整组导入 · 默认不合并）"
      extra={
        onAbandon ? (
          <Button size="small" danger onClick={onAbandon} data-testid="jurilu-script-abandon">
            放弃本次导入（清空凭证）
          </Button>
        ) : null
      }
    >
      <Alert
        type="warning"
        showIcon
        className="mb-2"
        data-testid="jurilu-script-summary"
        message={summary.notice}
        description="每次抓取拿到的每一组剧本都是独立的：本页默认不合并，也不会替你选中任何一组。选中一组后，该组全部记录会一起进入下面的统一预览表（不截断、不与其他组混合）。"
      />

      {notices.length ? (
        <Alert
          type="info"
          showIcon
          className="mb-2"
          data-testid="jurilu-script-notices"
          message="脚本组状态"
          description={
            <ul className="list-disc pl-4 text-[11px] m-0">
              {notices.map((notice, index) => (
                <li key={`jurilu-script-notice-${index}`}>{notice}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      {/* ① 目标章节：可选已有章节，或直接新建（复用项目既有的建章节接口） */}
      <Card size="small" className="mb-2" data-testid="jurilu-target-chapter">
        <Space direction="vertical" className="w-full" size={4}>
          <Typography.Text strong className="text-[12px]">
            {'① 选择目标章节（本组提示词将写入这一集）'}
          </Typography.Text>
          <Space wrap>
            <Select
              style={{ minWidth: 280 }}
              loading={chaptersLoading}
              value={targetChapterId || undefined}
              placeholder="选择本项目已有章节"
              data-testid="jurilu-target-chapter-select"
              onChange={(value) => onTargetChapterChange(String(value))}
              options={chapterOptions.map((item) => ({ value: item.value, label: item.label }))}
            />
            <Button loading={creatingChapter} onClick={() => setCreateOpen(true)} data-testid="jurilu-target-chapter-create">
              新建章节
            </Button>
          </Space>
          {/*
            目标章节身份必须一眼可查（用户复测踩到过「我说 0 镜头、页面显示 3 个」——
            根因是页面没切到新章节，而页面上没有任何地方写着当前是哪一集）。
            这里显示：名称 + ID 末段 + 镜头数（镜头数是**后端真实值**，匹配后才展示）。
          */}
          <Typography.Text strong className="text-[12px]" data-testid="jurilu-target-chapter-info">
            {targetChapterText}
          </Typography.Text>
          {!target ? (
            <Typography.Text type="warning" className="text-[11px]">
              还没有选择目标章节：请先选一集，或点「新建章节」直接建一集（URL 里的 ?chapter= 会是默认目标）。
            </Typography.Text>
          ) : null}
          {/* 流程状态：与下面的缺口面板同一个来源，不会出现"未选组"和"缺少 N 个"同时显示 */}
          <Typography.Text
            type={stage === 'matched' ? 'success' : 'secondary'}
            className="text-[11px]"
            data-testid="jurilu-flow-status"
          >
            {flowStatusText}
          </Typography.Text>
        </Space>
      </Card>

      <Space direction="vertical" className="w-full" size="small" data-testid="jurilu-script-groups">
        {groups.map((group, groupIndex) => {
          const texts = groupFieldTexts(group)
          const version = versionInfo(group)
          const checked = selectedId === group.script_id
          const matched = matchedId !== '' && matchedId === group.script_id
          return (
            <Card
              key={group.script_id}
              size="small"
              className={checked ? 'border-blue-400' : undefined}
              data-testid={`jurilu-script-group-${group.script_id}`}
              title={
                <Space size={8} wrap>
                  <Radio
                    checked={checked}
                    data-testid={`jurilu-script-radio-${group.script_id}`}
                    onChange={() => onSelect(group.script_id)}
                    disabled={matching}
                  >
                    {`脚本组 ${groupIndex + 1}（${texts.recordCountText}）`}
                  </Radio>
                  <Tag color={texts.titleMissing ? 'default' : 'geekblue'} data-testid={`jurilu-script-title-${group.script_id}`}>
                    {texts.titleText}
                  </Tag>
                  {/* 「最新版本」标签只有拿到**时间戳证据**才会出现（没有证据时这里什么都没有） */}
                  {version.label ? (
                    <Tag color="gold" data-testid={`jurilu-script-newest-${group.script_id}`}>
                      {version.label}
                    </Tag>
                  ) : null}
                  {matched ? (
                    <Tag color="green" data-testid={`jurilu-script-matched-${group.script_id}`}>
                      {`已匹配 ${matchedRowCount} 条`}
                    </Tag>
                  ) : null}
                </Space>
              }
            >
              <Typography.Text type="secondary" className="text-[11px] block">
                {`${texts.recordCountText}｜${texts.seqRangeText}｜${texts.createdAtText}｜${texts.updatedAtText}｜${texts.titleSourceText}`}
              </Typography.Text>
              <Typography.Text type="secondary" className="text-[11px] block mt-1" data-testid={`jurilu-script-whole-${group.script_id}`}>
                {wholeGroupNotice(group)}
              </Typography.Text>
              {texts.missingMetaNotice ? (
                <Typography.Text type="warning" className="text-[11px] block mt-1" data-testid={`jurilu-script-missing-${group.script_id}`}>
                  {texts.missingMetaNotice}
                </Typography.Text>
              ) : null}

              {/* 客观事实：一律照实展示；「最新版本」只在上面的标签里有时间戳证据时出现 */}
              {version.facts.length || version.hint || version.noEvidenceNotice ? (
                <div className="mt-1" data-testid={`jurilu-script-version-${group.script_id}`}>
                  {version.facts.length ? (
                    <>
                      <Typography.Text type="secondary" className="text-[11px] block">
                        {`${version.factsTitle}：`}
                      </Typography.Text>
                      <ul className="list-disc pl-4 text-[11px] m-0">
                        {version.facts.map((fact, index) => (
                          <li key={`jurilu-script-fact-${group.script_id}-${index}`}>{fact}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {version.hint ? (
                    <Typography.Text type="secondary" className="text-[11px] block">{`提示：${toUserFacingText(version.hint, '（这条提示暂时无法显示）')}`}</Typography.Text>
                  ) : null}
                  {version.disclaimer ? (
                    <Typography.Text type="warning" className="text-[11px] block">{version.disclaimer}</Typography.Text>
                  ) : null}
                  {version.noEvidenceNotice ? (
                    <Typography.Text type="secondary" className="text-[11px] block">{version.noEvidenceNotice}</Typography.Text>
                  ) : null}
                </div>
              ) : null}

              <Typography.Text type="secondary" className="text-[11px] block mt-1" data-testid={`jurilu-script-raw-keys-${group.script_id}`}>
                {`这一步读到的可用信息项：${(group.raw_keys ?? []).length} 项`}
              </Typography.Text>
              {/* 内部字段名（raw_keys）是第三层内容：只放在默认收起的「技术详情」里 */}
              <TechnicalDetailSection
                className="mt-1"
                testId={`jurilu-script-info-items-${group.script_id}`}
                hint="这一步读到的可用信息项（名称明细）"
              >
                <Typography.Text type="secondary" className="text-[11px]">{rawKeysText(group)}</Typography.Text>
              </TechnicalDetailSection>

              {checked ? (
                <>
                  <Typography.Text strong className="text-[11px] block mt-2" data-testid={`jurilu-script-samples-title-${group.script_id}`}>
                    {sampleSectionTitle(group)}
                  </Typography.Text>
                  <Table<SampleRow>
                    size="small"
                    rowKey="key"
                    pagination={false}
                    dataSource={sampleRows(group)}
                    data-testid={`jurilu-script-samples-${group.script_id}`}
                    locale={{ emptyText: '这次没有返回样例记录，无法在此核对解析结果，请按实际分镜判断' }}
                    columns={[
                      { title: '序号', dataIndex: 'seqText', width: 80 },
                      { title: '剧本编号', dataIndex: 'sbidText', width: 100 },
                      { title: '提示词正文（前 60 字）', dataIndex: 'promptHeadText', ellipsis: true },
                      { title: '字数', dataIndex: 'promptLengthText', width: 70 },
                      { title: '摘要（前 40 字）', dataIndex: 'summaryHeadText', ellipsis: true },
                    ]}
                  />
                  <Typography.Text type="secondary" className="text-[11px] block mt-1">
                    自检通过前不会写库：点「用这一组匹配镜头」只是把这一组全部记录送进下面的预览表，仍要再点「确认保存」。
                  </Typography.Text>
                </>
              ) : null}
            </Card>
          )
        })}

        {!groups.length ? (
          <Typography.Text type="secondary" className="text-[11px]">
            这次没有返回任何脚本组：请核对抓取地址 / Cookie 后重新抓取（抓取失败时这里会显示脱敏诊断）。
          </Typography.Text>
        ) : null}
      </Space>

      <Space className="mt-2" wrap>
        <Button
          type="primary"
          disabled={!selected || matching}
          loading={matching}
          data-testid="jurilu-script-match"
          onClick={onMatch}
        >
          {selected ? `用这一组匹配镜头（整组 ${selected.record_count} 条）` : '用这一组匹配镜头（请先选一组）'}
        </Button>
        <Typography.Text type="secondary" className="text-[11px]" data-testid="jurilu-script-active">
          {activeGroupLabel(groups, matchedId)}
        </Typography.Text>
      </Space>

      <Modal
        title="新建章节（建完仍需你自己选组、匹配、确认保存）"
        open={createOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={creatingChapter}
        okButtonProps={{ disabled: !newTitle.trim(), id: 'jurilu-new-chapter-submit' }}
        onOk={() => void submitCreate()}
        onCancel={() => setCreateOpen(false)}
      >
        <Space direction="vertical" className="w-full" size="small">
          <Typography.Text type="secondary" className="text-[11px]">
            这里走的是项目里既有的新建章节能力（与「章节列表」里新建章节同一套），只建章节、不建镜头、不写提示词。
          </Typography.Text>
          <Input
            placeholder="章节标题（必填）"
            value={newTitle}
            data-testid="jurilu-new-chapter-title"
            onChange={(event) => setNewTitle(event.target.value)}
          />
          <Input.TextArea
            rows={3}
            placeholder="章节摘要（可留空）"
            value={newSummary}
            data-testid="jurilu-new-chapter-summary"
            onChange={(event) => setNewSummary(event.target.value)}
          />
        </Space>
      </Modal>
    </Card>
  )
}
