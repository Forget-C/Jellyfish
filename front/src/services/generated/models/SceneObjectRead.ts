/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SourceSpan } from './SourceSpan';
/**
 * 读取当前资源主图投影；图片身份不写入场次准备。
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
    reference_state: 'unassociated' | 'missing' | 'ready' | 'unavailable';
};
