/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 更新采用状态请求：task_id + 三选一绑定对象（project_id/chapter_id/shot_id）。
 */
export type TaskLinkAdoptRequest = {
    /**
     * 绑定项目 ID（可选）
     */
    project_id?: (string | null);
    /**
     * 绑定章节 ID（可选）
     */
    chapter_id?: (string | null);
    /**
     * 绑定镜头 ID（可选）
     */
    shot_id?: (string | null);
    /**
     * 任务 ID
     */
    task_id: string;
};

