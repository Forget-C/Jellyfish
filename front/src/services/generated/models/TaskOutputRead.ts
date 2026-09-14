/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 已保存的媒体输出，字节删除后仍保留文件身份供历史查询。
 */
export type TaskOutputRead = {
    ordinal: number;
    file_id: string;
    media_type: string;
    delivery_status?: (string | null);
    delivery_reason?: (string | null);
    deleted?: boolean;
};
