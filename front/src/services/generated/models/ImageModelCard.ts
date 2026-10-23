/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ImageModelConfig } from './ImageModelConfig';
/**
 * 图片处理卡，参考图片必须被接收端明确使用。
 */
export type ImageModelCard = {
    id: string;
    type_version?: number;
    model_id?: (string | null);
    prompt?: string;
    type?: string;
    config?: ImageModelConfig;
};
