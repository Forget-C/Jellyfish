/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetOrigin } from './AssetOrigin';
import type { Source } from './Source';
/**
 * 本次输入的文件、用途与主体绑定，不自动跟随资产默认图。
 */
export type ReferenceBinding_Input = {
    id: string;
    file_id: string;
    media_kind: 'image' | 'video' | 'audio';
    purpose: 'identity' | 'space' | 'composition' | 'continuity' | 'performance' | 'sound';
    participant_ids: Array<string>;
    ordinal: number;
    source: Source;
    input_role?: 'subject' | 'first_frame' | 'last_frame' | 'key_frame';
    subject_group_id?: (string | null);
    /**
     * 所选素材的真实项目资产来源，与目标参与对象及导演默认独立；新选择须核实项目归属及资产图片。
     */
    asset_origin?: (AssetOrigin | null);
};
