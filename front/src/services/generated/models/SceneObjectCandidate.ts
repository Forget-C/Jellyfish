/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SourceSpan } from './SourceSpan';
/**
 * 服务端建立故事对象身份，独立保存当前项目资源选用。
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
};

