/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 字幕单条 cue；时间为 episode-absolute 整数毫秒。
 */
export type SubtitleCue = {
    /**
     * cue 稳定 ID（轨内唯一）
     */
    cue_id: string;
    /**
     * 入点（episode-absolute 毫秒）
     */
    start_ms: number;
    /**
     * 出点（必须大于 start_ms）
     */
    end_ms: number;
    /**
     * 译文（非空）
     */
    text: string;
    /**
     * 说话角色键（须存在于 characters）
     */
    speaker_character_key?: (string | null);
    /**
     * 关联镜头（仅关联，不构成第二套时间真相）
     */
    shot_id?: (string | null);
};

