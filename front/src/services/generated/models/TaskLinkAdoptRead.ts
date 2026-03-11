/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 采用状态更新结果。
 */
export type TaskLinkAdoptRead = {
    task_id: string;
    /**
     * project | chapter | shot
     */
    link_type: string;
    /**
     * 项目/章节/镜头 ID
     */
    entity_id: string;
    /**
     * 是否采用（仅可正向变更为 true）
     */
    is_adopted: boolean;
};

