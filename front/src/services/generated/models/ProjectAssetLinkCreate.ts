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
    asset_id: string;
};
