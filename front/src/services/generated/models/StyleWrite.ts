/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectStyleProfile_Input } from './ProjectStyleProfile_Input';
/**
 * 保存或派生风格草稿，更新必须携带已看到的版本。
 */
export type StyleWrite = {
    content: ProjectStyleProfile_Input;
    revision_id?: (string | null);
    expected_version?: (number | null);
    parent_id?: (string | null);
};
