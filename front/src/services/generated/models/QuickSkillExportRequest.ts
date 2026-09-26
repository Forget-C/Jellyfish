/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { QuickSkillExportEntry } from './QuickSkillExportEntry';
export type QuickSkillExportRequest = {
    /**
     * 导演 Skill ID（用于文件名与标题）
     */
    skill_id: string;
    /**
     * 项目 ID（用于文件名，可空）
     */
    project_id?: string;
    /**
     * 文档标题（可空，默认用 Skill 名）
     */
    title?: string;
    /**
     * 要导出的条目
     */
    entries?: Array<QuickSkillExportEntry>;
};

