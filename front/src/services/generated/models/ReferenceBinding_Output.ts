/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetOrigin } from './AssetOrigin';
import type { Source } from './Source';
/**
 * 本次输入的文件、用途与主体绑定，不自动跟随资产默认图。
 */
export type ReferenceBinding_Output = {
    id: string;
    file_id: string;
    media_kind: 'image' | 'video' | 'audio';
    purpose: 'identity' | 'space' | 'composition' | 'continuity' | 'performance' | 'sound';
    participant_ids: Array<string>;
    ordinal: number;
    source: Source;
    input_role?: 'subject' | 'first_frame' | 'last_frame' | 'key_frame';
    subject_group_id?: (string | null);
    asset_origin?: (AssetOrigin | null);
};

