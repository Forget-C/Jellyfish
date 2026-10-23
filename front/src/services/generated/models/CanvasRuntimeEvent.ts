/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 共用连接复用所有运行，按画布游标去重。
 */
export type CanvasRuntimeEvent = {
    version?: number;
    cursor: number;
    type: 'snapshot' | 'node.updated' | 'text.delta' | 'node.finished' | 'run.finished';
    canvas_id: string;
    run_id?: (string | null);
    node_id?: (string | null);
    payload: Record<string, any>;
};
