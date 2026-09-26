/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type QuickSkillGenerateRequest = {
    /**
     * 导演 Skill ID
     */
    skill_id: string;
    /**
     * 本次要生成什么（必填）
     */
    request: string;
    /**
     * 额外上下文（补充要求）
     */
    context?: string;
    /**
     * 项目 ID（可选，仅用于一致性校验）
     */
    project_id?: (string | null);
    /**
     * 章节 ID（可选，用来自动装配上下文）
     */
    chapter_id?: (string | null);
    /**
     * 镜头 ID（可选；填了就自动带上该镜头的剧本/资产）
     */
    shot_id?: (string | null);
    /**
     * 是否把结果写进该镜头的视频提示词
     */
    save_to_shot?: boolean;
    /**
     * 镜头已有提示词时是否覆盖
     */
    overwrite?: boolean;
};

