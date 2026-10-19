/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Beat_Input } from './Beat_Input';
import type { BlockingState_Input } from './BlockingState_Input';
import type { DesignNote_Input } from './DesignNote_Input';
import type { EditableShotCoverage_Input } from './EditableShotCoverage_Input';
import type { Note_Input } from './Note_Input';
import type { SpatialAnchor_Input } from './SpatialAnchor_Input';
/**
 * 允许尚无节拍和镜头，已填写的身份及关联继续使用设计校验。
 */
export type EditableDirection_Input = {
    viewpoint?: Note_Input;
    information_change?: Note_Input;
    relationship_change?: Note_Input;
    turning_point?: Note_Input;
    immutable_facts?: Array<DesignNote_Input>;
    location_asset_id?: (string | null);
    spatial_basis?: Note_Input;
    shootable_area?: Note_Input;
    axis?: Note_Input;
    scale?: Note_Input;
    open_questions?: Array<DesignNote_Input>;
    control_level?: Note_Input;
    beats?: Array<Beat_Input>;
    anchors?: Array<SpatialAnchor_Input>;
    blocking_states?: Array<BlockingState_Input>;
    shots?: Array<EditableShotCoverage_Input>;
};
