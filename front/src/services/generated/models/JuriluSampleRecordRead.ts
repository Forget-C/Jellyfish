/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 脚本组的一条采样分镜：让用户确认「正文 / 序号 / 提示词」解析正确。
 */
export type JuriluSampleRecordRead = {
    seq?: string;
    sbid?: string;
    /**
     * 提示词正文前 60 字
     */
    prompt_head?: string;
    prompt_length?: number;
    /**
     * 分镜摘要前 40 字
     */
    summary_head?: string;
};

