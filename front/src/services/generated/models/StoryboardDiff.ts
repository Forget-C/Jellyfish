/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardDiffCard } from './StoryboardDiffCard';
/**
 * The effect of applying the task to one saved canvas revision.
 */
export type StoryboardDiff = {
    added: Array<StoryboardDiffCard>;
    modified: Array<StoryboardDiffCard>;
    removed: Array<StoryboardDiffCard>;
    orphaned: Array<StoryboardDiffCard>;
    source_changed: boolean;
};
