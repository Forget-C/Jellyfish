/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CharacterRead = {
    /**
     * 角色 ID
     */
    id: string;
    /**
     * 所属项目 ID
     */
    project_id: string;
    /**
     * 角色名称
     */
    name: string;
    /**
     * 角色描述
     */
    description?: string;
    /**
     * 演员 ID（可空）
     */
    actor_id?: (string | null);
    /**
     * 服装 ID（可空）
     */
    costume_id?: (string | null);
};

