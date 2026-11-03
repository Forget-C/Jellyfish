/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AcceptanceCriterionCard } from './AcceptanceCriterionCard';
import type { AudioContentCard } from './AudioContentCard';
import type { BlockingDirectionCard } from './BlockingDirectionCard';
import type { CharacterDescriptionCard } from './CharacterDescriptionCard';
import type { CharacterPerformanceCard } from './CharacterPerformanceCard';
import type { CharacterSituationCard } from './CharacterSituationCard';
import type { ContinuityCard } from './ContinuityCard';
import type { CostumeDescriptionCard } from './CostumeDescriptionCard';
import type { CreativeBasisCard } from './CreativeBasisCard';
import type { CreativeControlCard } from './CreativeControlCard';
import type { DialogueCard } from './DialogueCard';
import type { EnvironmentActivityCard } from './EnvironmentActivityCard';
import type { GenerationCanvasEdge } from './GenerationCanvasEdge';
import type { GenerationCanvasGroup } from './GenerationCanvasGroup';
import type { GenerationGuidanceCard } from './GenerationGuidanceCard';
import type { ImageContentCard } from './ImageContentCard';
import type { ImageModelCard } from './ImageModelCard';
import type { ImmutableFactCard } from './ImmutableFactCard';
import type { InFrameActivityCard } from './InFrameActivityCard';
import type { MovementCard } from './MovementCard';
import type { NamedImageReferenceCard } from './NamedImageReferenceCard';
import type { NarrativeBeatCard } from './NarrativeBeatCard';
import type { NarrativeEventCard } from './NarrativeEventCard';
import type { NarrativeOverviewCard } from './NarrativeOverviewCard';
import type { PerformanceRuleCard } from './PerformanceRuleCard';
import type { PhotographyCard } from './PhotographyCard';
import type { PlaceDescriptionCard } from './PlaceDescriptionCard';
import type { PropDescriptionCard } from './PropDescriptionCard';
import type { ShotDesignCard } from './ShotDesignCard';
import type { SoundArrangementCard } from './SoundArrangementCard';
import type { SpaceRuleCard } from './SpaceRuleCard';
import type { SpatialAnchorCard } from './SpatialAnchorCard';
import type { TextContentCard } from './TextContentCard';
import type { TextModelCard } from './TextModelCard';
import type { VideoContentCard } from './VideoContentCard';
import type { VideoModelCard } from './VideoModelCard';
import type { VisualStyleCard } from './VisualStyleCard';
/**
 * 完整编辑文档；位置、尺寸和视角由浏览器另存。
 */
export type CanvasDocument = {
    id: string;
    project_id: string;
    name: string;
    schema_version?: number;
    cover_file_id?: (string | null);
    cards?: Array<(MovementCard | VisualStyleCard | SpaceRuleCard | ContinuityCard | ImmutableFactCard | CreativeControlCard | GenerationGuidanceCard | AcceptanceCriterionCard | PhotographyCard | DialogueCard | SoundArrangementCard | NarrativeOverviewCard | NarrativeBeatCard | NarrativeEventCard | ShotDesignCard | SpatialAnchorCard | BlockingDirectionCard | InFrameActivityCard | EnvironmentActivityCard | CharacterSituationCard | CharacterPerformanceCard | PerformanceRuleCard | NamedImageReferenceCard | TextContentCard | CreativeBasisCard | CharacterDescriptionCard | PropDescriptionCard | CostumeDescriptionCard | PlaceDescriptionCard | ImageContentCard | VideoContentCard | AudioContentCard | TextModelCard | ImageModelCard | VideoModelCard)>;
    edges?: Array<GenerationCanvasEdge>;
    input_order?: Record<string, Record<string, Array<string>>>;
    groups?: Array<GenerationCanvasGroup>;
};
