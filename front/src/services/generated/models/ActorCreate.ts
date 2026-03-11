/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ActorCreate = {
    /**
     * 演员 ID
     */
    id: string;
    /**
     * 归属项目 ID（可空=全局演员）
     */
    project_id?: (string | null);
    /**
     * 演员名称
     */
    name: string;
    /**
     * 演员描述/备注
     */
    description?: string;
    /**
     * 演员头像/缩略图
     */
    thumbnail?: string;
    /**
     * 标签
     */
    tags?: Array<string>;
};

