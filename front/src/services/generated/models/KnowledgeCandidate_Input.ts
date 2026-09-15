/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * P 原则、O 操作条件、C 项目设定仅为分类，不赋予全局效力。
 */
export type KnowledgeCandidate_Input = {
    category: 'P' | 'O' | 'C';
    role: 'direction' | 'performance' | 'staging' | 'cinematography' | 'continuity' | 'prompt';
    claim: Note_Input;
    conditions: string;
    recommendation: string;
    counterexamples: Note_Input;
    exceptions: Note_Input;
    confidence: 'tentative' | 'supported' | 'contradicted';
    review_on: string;
    evidence_revision_ids?: Array<string>;
    evidence_take_ids?: Array<string>;
};
