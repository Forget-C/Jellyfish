/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PromptPackageShotRead } from './PromptPackageShotRead';
/**
 * 提示词包导出结果。
 */
export type PromptPackageRead = {
    project_id: string;
    shots?: Array<PromptPackageShotRead>;
    rendered_text?: string;
    rendered_markdown?: string;
    warnings?: Array<string>;
    meta?: Record<string, any>;
    /**
     * 边界说明
     */
    note?: string;
};

