/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一个导演 Skill 的目录项。
 */
export type QuickSkillItem = {
    skill_id: string;
    display_name: string;
    /**
     * image / video / hybrid
     */
    stage: string;
    stage_label: string;
    summary: string;
    /**
     * 是否高频 Skill
     */
    pinned: boolean;
    source_name: string;
    /**
     * 规则文件是否就位
     */
    source_present: boolean;
    /**
     * 规则正文字数
     */
    rule_chars: number;
    /**
     * 规则文件读取失败原因（正常为空）
     */
    load_error?: string;
};

