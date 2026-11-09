/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SourceSpan } from './SourceSpan';
/**
 * 服务端建立对象身份，并独立保存用户的关联与图片选择。
 */
export type SceneObjectCandidate = {
    id: string;
    kind: 'character' | 'scene' | 'prop';
    name: string;
    description: string;
    excerpt: string;
    span: SourceSpan;
    suggested_asset_id?: (string | null);
    asset_id?: (string | null);
    image_file_id?: (string | null);
};

