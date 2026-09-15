/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ProjectActorLinkRead = {
    /**
     * 关联行 ID
     */
    id: number;
    /**
     * 项目 ID
     */
    project_id: string;
    /**
     * 章节 ID（可空）
     */
    chapter_id?: (string | null);
    actor_id: string;
    /**
     * 演员缩略图下载地址
     */
    thumbnail?: string;
};
