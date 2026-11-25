/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 某种图片操作的模型级参数限制，省略表示沿用适配器范围。
 */
export type ImageModeDeclaration = {
    supported?: (boolean | null);
    sizes?: (Array<string> | null);
    ratios?: (Array<string> | null);
    resolution_profiles?: (Array<string> | null);
    max_outputs?: (number | null);
    max_reference_images?: (number | null);
    seed?: (boolean | null);
    watermark?: (boolean | null);
};
