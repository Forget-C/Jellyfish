/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NamedImageObject } from './NamedImageObject';
/**
 * 图片出口自含默认名称映射，无需接收端读取祖先。
 */
export type NamedImagePayload = {
    kind?: string;
    name?: string;
    file_id: string;
    objects?: Array<NamedImageObject>;
    angle: string;
};
