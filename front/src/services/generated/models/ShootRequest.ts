/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 只接受审过的固定输入和请求身份，不能夹带未审提示词。
 */
export type ShootRequest = {
    prompt_revision_id: string;
    review_revision_id: string;
    request_id: string;
};
