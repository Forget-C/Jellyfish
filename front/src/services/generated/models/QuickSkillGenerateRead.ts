/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type QuickSkillGenerateRead = {
    skill_id: string;
    skill_name: string;
    stage: string;
    /**
     * 生成的成品提示词
     */
    prompt: string;
    request: string;
    /**
     * 实际送给模型的上下文（便于复核）
     */
    context: string;
    /**
     * 本次使用的文字模型
     */
    model_used?: string;
    /**
     * 是否已写进镜头
     */
    saved?: boolean;
    saved_shot_id?: (string | null);
    warnings?: Array<string>;
};

