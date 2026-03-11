/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetQualityLevel } from './AssetQualityLevel';
import type { AssetViewAngle } from './AssetViewAngle';
export type ActorImageImageRead = {
    /**
     * 图片行 ID
     */
    id: number;
    /**
     * 精度等级
     */
    quality_level?: AssetQualityLevel;
    /**
     * 视角
     */
    view_angle?: AssetViewAngle;
    /**
     * 图片 URL
     */
    url: string;
    /**
     * 宽(px)
     */
    width?: (number | null);
    /**
     * 高(px)
     */
    height?: (number | null);
    /**
     * 格式
     */
    format?: string;
    /**
     * 是否主图
     */
    is_primary?: boolean;
    actor_image_id: string;
};

