/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 卡片或字段的来源定位，不参与实际模型输入绑定。
 */
export type CanvasSourceIndex = {
    card_id: string;
    field_id?: (string | null);
    source_field_id?: (string | null);
    segment_id?: (string | null);
    /**
     * Python Unicode 字符偏移
     */
    start?: (number | null);
    end?: (number | null);
    excerpt?: (string | null);
    source_version?: (string | null);
};
