/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type Body_upload_file_api_api_v1_studio_files_upload_post = {
    /**
     * 要上传的二进制文件
     */
    file: string;
    /**
     * 可选：写入 file_usages 的项目 ID
     */
    project_id?: (string | null);
    chapter_id?: (string | null);
    /**
     * 与 project_id 同时提供时写入 file_usages
     */
    usage_kind?: (string | null);
    source_ref?: (string | null);
};
