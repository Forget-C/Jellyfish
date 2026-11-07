/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 已经确认存在的业务来源，供前端构造回跳路径。
 */
export type TaskSourceRead = {
    kind: string;
    id: string;
    title: string;
    project_id?: (string | null);
    chapter_id?: (string | null);
    version_id?: (string | null);
    unit_id?: (string | null);
    shot_id?: (string | null);
    canvas_id?: (string | null);
    run_id?: (string | null);
    node_id?: (string | null);
    check_card_id?: (string | null);
    check_report_id?: (string | null);
};
