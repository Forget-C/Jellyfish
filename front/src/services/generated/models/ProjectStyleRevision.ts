/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectStyleProfile_Output } from './ProjectStyleProfile_Output';
/**
 * 项目风格的确认身份由服务端返回，不接受模型自称确认。
 */
export type ProjectStyleRevision = {
    id: string;
    project_id: string;
    parent_id: (string | null);
    version: number;
    confirmed_by: (string | null);
    confirmed_at: (string | null);
    content: ProjectStyleProfile_Output;
};
