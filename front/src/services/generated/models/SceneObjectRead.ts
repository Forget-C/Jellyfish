/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ObjectReferenceSource } from './ObjectReferenceSource';
import type { SourceSpan } from './SourceSpan';
/**
 * 实际文件可用性按当前项目资产读取，已选文件不可用时仍可识别旧选择。
 */
export type SceneObjectRead = {
    id: string;
    kind: 'character' | 'scene' | 'prop';
    name: string;
    description: string;
    excerpt: string;
    span: SourceSpan;
    suggested_asset_id?: (string | null);
    asset_id?: (string | null);
    image_file_id?: (string | null);
    reference_source?: (ObjectReferenceSource | null);
    reference_state: 'unassociated' | 'missing' | 'ready' | 'unavailable';
};
