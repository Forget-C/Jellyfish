BEGIN;
SET NAMES utf8mb4;

DELETE FROM `prompt_templates`
WHERE `id` IN ('system_actor_image', '3', '4', '5', '6');

INSERT INTO `prompt_templates`
    (`id`, `category`, `name`, `preview`, `content`, `variables`, `variable_defaults`, `version`, `created_at`, `updated_at`, `is_system`, `is_default`)
VALUES
    (
        'system_actor_image',
        'actor_image',
        '演员设定图 / 身份肖像',
        '单一干净背景的人物身份肖像；通过视角变量生成正面、侧面和背面。',
        'Identity portrait of {{ name }}. {{ description }}\nView: {{ view_angle }}. {{ reference_instruction }}\n{{ framing_instruction }}\n{{ visible_detail_instruction }}\n{{ background_instruction }}\n{{ lighting_instruction }}\n{{ negative_prompt }}',
        '["name", "description", "view_angle", "reference_instruction", "framing_instruction", "visible_detail_instruction", "background_instruction", "lighting_instruction", "negative_prompt"]',
        '{"framing_instruction":"Full-body or three-quarter identity portrait, neutral standing pose, centered composition.","visible_detail_instruction":"Show facial features, hairstyle, body proportions and clothing details clearly.","background_instruction":"Plain seamless studio background with no scenery, props, text or narrative action.","lighting_instruction":"Soft even studio lighting, accurate skin tone and clear fabric texture.","negative_prompt":"cinematic still, movie scene, complex background, crowd, props, text, logo, watermark, blur, distorted anatomy"}',
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        1,
        1
    ),
    ('3', 'character_image_front', '角色正面图片提示词', '角色正面图片', '{{ description }}\nView: {{ view_angle }}', '["description", "view_angle"]', '{}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0),
    ('4', 'prop_image_front', '道具图片提示词', '道具展示图', '{{ description }}\nView: {{ view_angle }}', '["description", "view_angle"]', '{}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1),
    ('5', 'scene_image_front', '场景图片提示词', '场景展示图', '{{ description }}\nView: {{ view_angle }}', '["description", "view_angle"]', '{}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1),
    ('6', 'costume_image_front', '服装图片提示词', '服装展示图', '{{ description }}\nView: {{ view_angle }}', '["description", "view_angle"]', '{}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1);

COMMIT;
