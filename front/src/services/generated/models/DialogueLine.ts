/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 镜头内单条对白。
 *
 * ``order`` 为镜头内排序（正整数、镜头内唯一）；``character_key`` 若提供，
 * 必须能在 ``characters`` 中找到（根模型统一校验）。
 */
export type DialogueLine = {
    /**
     * 镜头内排序（正整数，镜头内唯一）
     */
    order: number;
    /**
     * 说话角色键（可选；旁白可为空）
     */
    character_key?: (string | null);
    /**
     * 台词正文（非空）
     */
    text: string;
    /**
     * 对白模式：DIALOGUE/VOICE_OVER/OFF_SCREEN/PHONE
     */
    line_mode?: string;
};

