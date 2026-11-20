/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetViewAngle } from './AssetViewAngle';
/**
 * 一张参考图的明确用途；去重时同一文件可以保留多个用途。
 */
export type AssetPromptReference = {
    file_id: string;
    role: 'identity' | 'costume' | 'prop' | 'layout' | 'style' | 'design';
    source_kind?: ('actor' | 'character' | 'scene' | 'prop' | 'costume' | null);
    source_id?: (string | null);
    source_image_id?: (number | null);
    view_angle?: (AssetViewAngle | null);
};

