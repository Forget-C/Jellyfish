/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetQualityLevel } from './AssetQualityLevel';
import type { AssetViewAngle } from './AssetViewAngle';
export type AssetImageCreate = {
    quality_level?: AssetQualityLevel;
    view_angle?: AssetViewAngle;
    url: string;
    width?: (number | null);
    height?: (number | null);
    format?: string;
    is_primary?: boolean;
};

