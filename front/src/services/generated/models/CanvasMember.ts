/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一个原对象可属于多个视图，呈现角色不改变其业务身份。
 */
export type CanvasMember = {
    node_id: string;
    presentation?: 'card' | 'entry' | 'reference';
    group: string;
    entry_view_id?: (string | null);
    title?: (string | null);
};
