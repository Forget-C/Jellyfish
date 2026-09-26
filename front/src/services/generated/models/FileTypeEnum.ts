/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 素材类型。
 *
 * 必须与 ``app.models.types.FileType`` 对齐：漏掉 ``audio`` 时，序列化一个音频
 * FileItem 会直接抛 ResponseValidationError（用户看到 500），声音绑定也就传不出来。
 */
export type FileTypeEnum = 'image' | 'video' | 'audio';
