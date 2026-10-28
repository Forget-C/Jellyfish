/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignField } from './DesignField';
/**
 * 对白正文与声音安排的具体字段；制作安排不代表生成成果。
 */
export type SoundDesignFields = {
    content?: (DesignField | null);
    source_description?: (DesignField | null);
    environment?: (DesignField | null);
    action_sound?: (DesignField | null);
    music?: (DesignField | null);
    production?: ('synchronous' | 'postproduction' | 'undecided' | null);
};
