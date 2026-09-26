/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 文档解析结果（纯文本，不含任何存储地址）。
 */
export type DocumentParseRead = {
    /**
     * 原始文件名
     */
    filename: string;
    /**
     * 识别出的格式：txt / md / docx
     */
    format: string;
    /**
     * 解析出的纯文本
     */
    text: string;
    /**
     * 字符数
     */
    char_count?: number;
    /**
     * 非空段落数
     */
    paragraph_count?: number;
    /**
     * 解析告警（例如编码不是 UTF-8）
     */
    warnings?: Array<string>;
};

