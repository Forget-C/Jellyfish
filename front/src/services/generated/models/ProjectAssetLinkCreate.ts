/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 资产关联以项目和可选章节为范围，不接受旧镜头目标。
 */
export type ProjectAssetLinkCreate = {
    project_id: string;
    chapter_id?: (string | null);
    /**
     * 本项目专属对象 ID；库中对象须先导入独立副本
     */
    asset_id: string;
};
