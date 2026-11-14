/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 可选参考的具体文件、原始资产与视角；不根据文件排序猜测视角。
 */
export type AssetReferenceImage = {
    file_id: string;
    view_angle: string;
    source_kind: 'character' | 'scene' | 'prop';
    source_id: string;
    slot_id: number;
    is_view_default?: boolean;
};
