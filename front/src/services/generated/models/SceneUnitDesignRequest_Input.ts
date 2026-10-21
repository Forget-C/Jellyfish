/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVersionContent_Input } from './SceneVersionContent_Input';
/**
 * 冻结当前编辑、目标镜头及视频模型；model_id 单独指定组织文本模型。
 */
export type SceneUnitDesignRequest_Input = {
    request_id: string;
    expected_revision: number;
    content: SceneVersionContent_Input;
    shot_id: string;
    source_unit_id?: (string | null);
    target_model_id: string;
    model_id?: (string | null);
    instruction?: string;
};
