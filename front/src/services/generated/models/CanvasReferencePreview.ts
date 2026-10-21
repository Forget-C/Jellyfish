/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 当前文件登记和预览地址；available 不代表字节或模型输入已通过执行前复核。
 */
export type CanvasReferencePreview = {
    binding_id: string;
    file_id: string;
    display_name: string;
    status: 'available' | 'deleted' | 'unavailable' | 'wrong_media_kind';
    thumbnail_url?: (string | null);
    media_url?: (string | null);
    preview_issue?: (string | null);
};
