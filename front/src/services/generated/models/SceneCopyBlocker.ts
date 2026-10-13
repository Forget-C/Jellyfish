/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 非终态任务或无法核实的执行阻止复制，不把取消请求当作完成。
 */
export type SceneCopyBlocker = {
    task_id: (string | null);
    execution_id: (string | null);
    title: string;
    status: string;
};
