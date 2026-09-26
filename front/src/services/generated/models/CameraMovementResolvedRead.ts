/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 归一化后的运镜词。
 */
export type CameraMovementResolvedRead = {
    /**
     * 标准运镜词 key
     */
    key?: string;
    /**
     * 标准中文写法
     */
    label?: string;
    /**
     * 写进提示词的英文表达
     */
    en?: string;
    /**
     * 对应 CameraMovement 枚举值；null 表示 DB 无对应值
     */
    enum_code?: (string | null);
    /**
     * 写回 shots 时的注意事项
     */
    db_note?: string;
    /**
     * 来自词库还是兜底
     */
    source?: 'vocab' | 'fallback';
};

