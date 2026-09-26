/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type QuickSkillSaveRequest = {
    /**
     * 镜头 ID
     */
    shot_id: string;
    /**
     * 要写入的提示词
     */
    prompt: string;
    /**
     * 已有提示词时是否覆盖
     */
    overwrite?: boolean;
};

