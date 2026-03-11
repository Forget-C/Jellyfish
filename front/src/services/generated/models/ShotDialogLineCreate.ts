/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DialogueLineMode } from './DialogueLineMode';
export type ShotDialogLineCreate = {
    shot_detail_id: string;
    index?: number;
    text: string;
    line_mode?: DialogueLineMode;
    speaker_character_id?: (string | null);
    target_character_id?: (string | null);
};

