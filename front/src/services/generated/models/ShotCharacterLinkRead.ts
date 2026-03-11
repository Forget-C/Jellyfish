/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ShotCharacterLinkRead = {
    /**
     * 关联行 ID
     */
    id: number;
    /**
     * 镜头 ID
     */
    shot_id: string;
    /**
     * 角色 ID
     */
    character_id: string;
    /**
     * 镜头内角色排序
     */
    index?: number;
    /**
     * 备注
     */
    note?: string;
};

