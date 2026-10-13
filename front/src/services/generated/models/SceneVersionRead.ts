/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneVersionContent_Output } from './SceneVersionContent_Output';
import type { SceneVersionSource_Output } from './SceneVersionSource_Output';
/**
 * 带归属与保存状态的场次版本，不向用户暴露多层草稿确认。
 */
export type SceneVersionRead = {
    id: string;
    project_id: string;
    chapter_id: string;
    sequence_id: string;
    title: string;
    revision: number;
    source: SceneVersionSource_Output;
    content: SceneVersionContent_Output;
    copied_from_version_id: (string | null);
    last_save_request_id: (string | null);
    created_at: string;
    updated_at: string;
};
