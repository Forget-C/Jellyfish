/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 供用户核对的实际对象与参考身份，不返回项目资产目录。
 */
export type StoryboardBasisObject = {
    id: string;
    name: string;
    excerpt: string;
    kind: 'character' | 'scene' | 'prop';
    asset_id?: (string | null);
    asset_name?: (string | null);
    image_file_id?: (string | null);
    reference_unavailable?: boolean;
};
