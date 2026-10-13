/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneCutReviewDecision } from './SceneCutReviewDecision';
import type { SceneTakeLibraryRead } from './SceneTakeLibraryRead';
import type { SceneVersionContent_Output } from './SceneVersionContent_Output';
/**
 * 内容及审片结论固定；媒体可用性按真实文件读取。
 */
export type SceneDeliveryRead = {
    id: string;
    sequence_id: string;
    version_id: string;
    version_title: string;
    revision: number;
    request_id: string;
    content: SceneVersionContent_Output;
    review_id: (string | null);
    review: (SceneCutReviewDecision | null);
    takes: Array<SceneTakeLibraryRead>;
    created_at: string;
};
