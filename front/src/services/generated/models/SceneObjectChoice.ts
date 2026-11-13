/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ObjectReferenceSource } from './ObjectReferenceSource';
/**
 * 在同一准备修订上保存明确选择。省略图片表示当前不选。
 */
export type SceneObjectChoice = {
    expected_revision: number;
    actor_id?: (string | null);
    auto_select_image?: boolean;
    asset_id?: (string | null);
    image_file_id?: (string | null);
    reference_source?: (ObjectReferenceSource | null);
};
