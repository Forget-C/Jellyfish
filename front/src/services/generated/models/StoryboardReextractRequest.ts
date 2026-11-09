/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Extract on a known target, optionally adopting a newly confirmed scene range.
 */
export type StoryboardReextractRequest = {
    request_id: string;
    name?: string;
    text_model_id?: (string | null);
    production_model_id?: (string | null);
    mode?: 'complete' | 'faithful';
    adopt_current_source?: boolean;
};
