/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EvidenceSpan } from './EvidenceSpan';
/**
 * 单条对白：说话人/对象、正文、情绪与表达方式、旁白/电话等模式、镜头内时间点。
 */
export type DialogueLine = {
    /**
     * 说话人角色ID，若无法判定可为空
     */
    speaker_character_id?: (string | null);
    /**
     * 对谁说（听者角色ID），可选
     */
    target_character_id?: (string | null);
    /**
     * 对白正文
     */
    text: string;
    /**
     * 情绪/语气（如：愤怒、平静、哽咽）
     */
    emotion?: (string | null);
    /**
     * 表达方式（如：低声、喊叫、旁白腔）
     */
    delivery?: (string | null);
    /**
     * DIALOGUE=正常对白, VOICE_OVER=旁白, OFF_SCREEN=画外音, PHONE=电话音等
     */
    line_mode?: 'DIALOGUE' | 'VOICE_OVER' | 'OFF_SCREEN' | 'PHONE';
    /**
     * 在该镜头内相对起始时间（秒），用于对口型/字幕切分
     */
    start_time_sec?: (number | null);
    /**
     * 原文依据
     */
    evidence?: Array<EvidenceSpan>;
};

