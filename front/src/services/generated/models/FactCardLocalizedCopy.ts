/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * fact card 的单语言文案。
 */
export type FactCardLocalizedCopy = {
    /**
     * BCP 47 语言标签
     */
    language_tag: string;
    /**
     * 教育性正文行（每行非空）
     */
    body: Array<string>;
    /**
     * 免责声明（非空）
     */
    disclaimer: string;
    /**
     * 可选 CTA
     */
    cta?: (string | null);
};

