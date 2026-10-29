/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 编组与只读堆叠组织独立成员，不提供聚合输出。
 */
export type GenerationCanvasGroup = {
    id: string;
    name: string;
    card_ids?: Array<string>;
    kind?: 'group' | 'stack';
    collapsed?: boolean;
};
