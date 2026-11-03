import { ModelRenderer } from './ModelCardEditor'
import { GuidanceDirectionEditor } from './GuidanceDirectionEditor'
import { ConstraintDirectionEditor } from './ConstraintDirectionEditor'
import { VisualStyleEditor } from './VisualStyleEditor'
import { NarrativeDirectionEditor } from './NarrativeDirectionEditor'
import { SpatialDirectionEditor } from './SpatialDirectionEditor'
import { PhotographyEditor } from './PhotographyEditor'
import type { ComponentType, ReactNode } from 'react'
import type { CanvasDocument, CanvasModelCapability, CanvasNodeRead, CanvasResolvedOutput, CreativeBasisCard, ModelRead, TextContentCard } from '../../../services/generated'
import { SoundDirectionEditor } from './SoundDirectionEditor'
import { PerformanceDirectionEditor } from './PerformanceDirectionEditor'
import { NamedImageReferenceEditor } from './NamedImageReferenceEditor'
import { ObjectDescriptionEditor } from './ObjectDescriptionEditor'
import { DESCRIPTION_CARD_TYPES, type DescriptionCardData } from './DescriptionCard'
import { TextContentEditor } from './TextContentEditor'
import { MediaContentEditor } from './MediaContentEditor'
import type { MediaCard } from './MediaContentEditor'
import type { GenerationCard } from './graphRules'

export type CardRendererProps = { editorOpen?: boolean; onDuplicateDesign?: () => void; initialEntry?: string; savedRevision?: number; savedCard?: GenerationCard; card: GenerationCard; document: CanvasDocument; projectId: string; onChange: (card: GenerationCard) => void | boolean;
  defaultModelId?: string | null; models?: ModelRead[]; capability?: CanvasModelCapability; capabilityError?: string; references?: ReactNode; disabled?: boolean; modelOutputs?: Record<string, CanvasResolvedOutput[]>; node?: CanvasNodeRead; busy?: boolean; checking?: boolean; runDisabled?: boolean; onPrecheck?: () => void; sourceActions?: ReactNode }

/** 显式类型入口，无供应商卡片族或通用表单引擎。 */
export const rendererRegistry: Record<string, ComponentType<CardRendererProps>> = {
  'direction.creative_control': GuidanceDirectionEditor, 'direction.guidance': GuidanceDirectionEditor, 'direction.criterion': GuidanceDirectionEditor,
  'direction.space_rule': ConstraintDirectionEditor, 'direction.continuity': ConstraintDirectionEditor, 'direction.fact': ConstraintDirectionEditor,
  'direction.narrative': NarrativeDirectionEditor, 'direction.beat': NarrativeDirectionEditor, 'direction.event': NarrativeDirectionEditor, 'direction.shot': NarrativeDirectionEditor,
  'direction.anchor': SpatialDirectionEditor,
  'direction.blocking': SpatialDirectionEditor,
  'direction.activity': SpatialDirectionEditor,
  'direction.environment': SpatialDirectionEditor,
  'direction.style': VisualStyleEditor,
  'direction.photography': PhotographyEditor,
  'direction.situation': PerformanceDirectionEditor,
  'direction.dialogue': SoundDirectionEditor,
  'direction.sound': SoundDirectionEditor,
  'direction.performance': PerformanceDirectionEditor,
  'direction.performance_rule': PerformanceDirectionEditor,
  'reference.character': NamedImageReferenceEditor,
  'reference.place': NamedImageReferenceEditor,
  'reference.prop': NamedImageReferenceEditor,
  'reference.costume': NamedImageReferenceEditor,
  'content.text': ({ card, onChange, disabled }) => <TextContentEditor card={card as TextContentCard} onChange={onChange} disabled={disabled} />,
  ...Object.fromEntries(DESCRIPTION_CARD_TYPES.map(type => [type, ({ card, onChange, disabled }: CardRendererProps) => <ObjectDescriptionEditor card={card as DescriptionCardData} onChange={onChange} disabled={disabled} />])),
  'content.basis': ({ card, onChange, disabled }) => <TextContentEditor card={card as CreativeBasisCard} onChange={onChange} disabled={disabled} />,
  'content.image': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'content.video': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'content.audio': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'model.text': ModelRenderer,
  'model.image': ModelRenderer,
  'model.video': ModelRenderer,
}
