/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AudioContentCard } from './AudioContentCard';
import type { GenerationCanvasEdge } from './GenerationCanvasEdge';
import type { GenerationCanvasGroup } from './GenerationCanvasGroup';
import type { ImageContentCard } from './ImageContentCard';
import type { ImageModelCard } from './ImageModelCard';
import type { TextContentCard } from './TextContentCard';
import type { TextModelCard } from './TextModelCard';
import type { VideoContentCard } from './VideoContentCard';
import type { VideoModelCard } from './VideoModelCard';
/**
 * 完整编辑文档；位置、尺寸和视角由浏览器另存。
 */
export type CanvasDocument = {
    id: string;
    project_id: string;
    name: string;
    schema_version?: number;
    cards?: Array<(TextContentCard | ImageContentCard | VideoContentCard | AudioContentCard | TextModelCard | ImageModelCard | VideoModelCard)>;
    edges?: Array<GenerationCanvasEdge>;
    input_order?: Record<string, Record<string, Array<string>>>;
    groups?: Array<GenerationCanvasGroup>;
};
