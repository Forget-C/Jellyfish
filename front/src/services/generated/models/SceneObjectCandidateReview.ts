/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneObjectCandidate } from './SceneObjectCandidate';
import type { SceneObjectTaskRead } from './SceneObjectTaskRead';
/**
 * 冻结结果相对当前对象准备的差异，只提供整批预览依据。
 */
export type SceneObjectCandidateReview = {
    task: SceneObjectTaskRead;
    candidate_available: boolean;
    revision: number;
    source_changed: boolean;
    is_current: boolean;
    applied_revision?: (number | null);
    preview_token?: (string | null);
    added: Array<SceneObjectCandidate>;
    removed: Array<SceneObjectCandidate>;
    modified: Array<SceneObjectCandidate>;
    retained_choices: Array<SceneObjectCandidate>;
};

