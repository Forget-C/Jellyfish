/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 编译预览中可核对的对象到实际提交图片映射。
 */
export type NamedImageMapping = {
    object_id: string;
    name?: string;
    category: 'character' | 'prop' | 'costume' | 'place';
    position?: string;
    media_position: number;
    angle: string;
    input_port?: (string | null);
    subject_name?: (string | null);
    purpose_position?: (number | null);
};
