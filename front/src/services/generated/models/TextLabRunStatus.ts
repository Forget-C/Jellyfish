/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 返回隐藏文本运行的最小状态，不将其暴露到任务中心。
 */
export type TextLabRunStatus = {
    task_id: string;
    status: 'streaming' | 'succeeded' | 'failed' | 'cancelled';
};

