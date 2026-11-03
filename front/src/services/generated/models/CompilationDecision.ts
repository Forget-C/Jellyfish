/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 关键决定的去向；解释不混入实际提示词。
 */
export type CompilationDecision = {
    section_path: string;
    disposition: 'text' | 'reference' | 'equivalent' | 'unexpressed';
    explanation: string;
    text_excerpt?: (string | null);
    reference_id?: (string | null);
};
