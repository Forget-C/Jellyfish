/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 固定本轮提示词里的出现项，同镜不同单元不得合并。
 */
export type ReviewOccurrence = {
    id: string;
    prompt_revision_id: string;
    plan_revision_id: string;
    unit_id: string;
    coverage_item_id: string;
    shot_id: string;
    local_number: number;
};

