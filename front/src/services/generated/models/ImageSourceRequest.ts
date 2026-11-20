/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UploadedAssetImage } from './UploadedAssetImage';
/**
 * 客户端身份用于重试；来源和权限只能由服务端决定。
 */
export type ImageSourceRequest = {
    id: string;
    name: string;
    project_id?: (string | null);
    source_id?: (string | null);
    images?: Array<UploadedAssetImage>;
};
