/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ShotRuntimeSummaryRead = {
    /**
     * 镜头 ID
     */
    shot_id: string;
    /**
     * 是否存在进行中的关联任务
     */
    has_active_tasks: boolean;
    /**
     * 是否存在进行中的视频任务
     */
    has_active_video_tasks: boolean;
    /**
     * 是否存在进行中的分镜帧图片任务
     */
    has_active_frame_tasks: boolean;
    /**
     * 进行中的唯一任务数
     */
    active_task_count: number;
};

