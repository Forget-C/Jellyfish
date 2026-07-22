/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 实验室提交的命名主体，文件 ID 在服务层转换为供应商可读取的 data URL。
 */
export type VideoLabSubjectReference = {
    /**
     * 主体名称；提示词使用 @名称 引用
     */
    name: string;
    /**
     * 主体参考图片 file_id 列表
     */
    image_file_ids?: Array<string>;
    /**
     * 主体参考视频 file_id 列表
     */
    video_file_ids?: Array<string>;
};

