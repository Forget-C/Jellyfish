/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 明确媒体引用，禁止由正文或名称猜测内容。
 */
export type MediaOutputPayload = {
    kind: 'image' | 'video' | 'audio';
    file_id: string;
};
