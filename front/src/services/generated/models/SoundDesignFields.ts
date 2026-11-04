/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReferenceDesignField } from './ReferenceDesignField';
/**
 * 对白正文与声音安排的具体字段；制作安排不代表生成成果。
 */
export type SoundDesignFields = {
    content?: (ReferenceDesignField | null);
    source_description?: (ReferenceDesignField | null);
    environment?: (ReferenceDesignField | null);
    action_sound?: (ReferenceDesignField | null);
    music?: (ReferenceDesignField | null);
    production?: ('synchronous' | 'postproduction' | 'undecided' | null);
};
