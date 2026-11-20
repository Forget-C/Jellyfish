BEGIN;
SET NAMES utf8mb4;

INSERT IGNORE INTO `model_settings` (`id`, `api_timeout`, `log_level`)
VALUES (1, 30, 'info');

INSERT INTO `prompt_templates`
    (`id`, `category`, `name`, `preview`, `content`, `variables`, `variable_defaults`, `version`, `created_at`, `updated_at`, `is_system`, `is_default`)
SELECT seed.id, seed.category, seed.name, seed.preview, seed.content, seed.variables, seed.variable_defaults,
       1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1,
       NOT EXISTS (SELECT 1 FROM prompt_templates chosen WHERE chosen.category = seed.category AND chosen.is_default = 1)
FROM (
    SELECT 'system_actor_image' AS id,
           'actor_image' AS category,
           '演员设定图 / 身份肖像' AS name,
           '单一干净背景的人物身份肖像；通过视角变量生成正面、侧面和背面。' AS preview,
           'Identity portrait of {{ name }}. {{ description }}\nView: {{ view_angle }}. {{ reference_instruction }}\n{{ framing_instruction }}\n{{ visible_detail_instruction }}\n{{ background_instruction }}\n{{ lighting_instruction }}\n{{ negative_prompt }}\nPurpose: {{ purpose }}\nVisual style: {{ visual_style }}. Genre: {{ style }}.\n{{ additional_instruction }}' AS content,
           '["name", "description", "view_angle", "reference_instruction", "framing_instruction", "visible_detail_instruction", "background_instruction", "lighting_instruction", "negative_prompt","purpose","visual_style","style","additional_instruction"]' AS variables,
           '{"framing_instruction":"Full-body or three-quarter identity portrait, neutral standing pose, centered composition.","visible_detail_instruction":"Show facial features, hairstyle, body proportions and clothing details clearly.","background_instruction":"Plain seamless studio background with no scenery, props, text or narrative action.","lighting_instruction":"Soft even studio lighting, accurate skin tone and clear fabric texture.","negative_prompt":"cinematic still, movie scene, complex background, crowd, props, text, logo, watermark, blur, distorted anatomy"}' AS variable_defaults
    UNION ALL
    SELECT 'system_character_image',
           'character_image',
           '角色设定图',
           '单一干净背景的角色身份与服装设定图。',
           'Character identity design for {{ name }}. {{ description }}\nView: {{ view_angle }}. {{ reference_instruction }}\n{{ framing_instruction }}\n{{ background_instruction }}\n{{ lighting_instruction }}\n{{ negative_prompt }}\nPurpose: {{ purpose }}\nVisual style: {{ visual_style }}. Genre: {{ style }}.\n{{ additional_instruction }}',
           '["name", "description", "view_angle", "reference_instruction", "framing_instruction", "background_instruction", "lighting_instruction", "negative_prompt","purpose","visual_style","style","additional_instruction"]',
           '{"framing_instruction":"Centered studio presentation with the full subject clearly visible and details unobstructed.","background_instruction":"Plain seamless studio background with no scenery, story action, text, logo or watermark.","lighting_instruction":"Soft even studio lighting with accurate material, color and texture detail.","negative_prompt":"cinematic still, movie scene, complex background, crowd, narrative action, text, logo, watermark, blur, distorted anatomy"}'
    UNION ALL
    SELECT 'system_prop_image',
           'prop_image',
           '道具展示图',
           '单一干净背景的道具设计展示图。',
           'Product design presentation for {{ name }}. {{ description }}\nView: {{ view_angle }}. {{ reference_instruction }}\n{{ framing_instruction }}\n{{ background_instruction }}\n{{ lighting_instruction }}\n{{ negative_prompt }}\nPurpose: {{ purpose }}\nVisual style: {{ visual_style }}. Genre: {{ style }}.\n{{ additional_instruction }}',
           '["name", "description", "view_angle", "reference_instruction", "framing_instruction", "background_instruction", "lighting_instruction", "negative_prompt","purpose","visual_style","style","additional_instruction"]',
           '{"framing_instruction":"Centered studio presentation with the full subject clearly visible and details unobstructed.","background_instruction":"Plain seamless studio background with no scenery, story action, text, logo or watermark.","lighting_instruction":"Soft even studio lighting with accurate material, color and texture detail.","negative_prompt":"cinematic still, movie scene, complex background, crowd, narrative action, text, logo, watermark, blur, distorted anatomy"}'
    UNION ALL
    SELECT 'system_costume_image',
           'costume_image',
           '服装展示图',
           '单一干净背景的服装设计展示图。',
           'Costume design presentation for {{ name }}. {{ description }}\nView: {{ view_angle }}. {{ reference_instruction }}\n{{ framing_instruction }}\n{{ background_instruction }}\n{{ lighting_instruction }}\n{{ negative_prompt }}\nPurpose: {{ purpose }}\nVisual style: {{ visual_style }}. Genre: {{ style }}.\n{{ additional_instruction }}',
           '["name", "description", "view_angle", "reference_instruction", "framing_instruction", "background_instruction", "lighting_instruction", "negative_prompt","purpose","visual_style","style","additional_instruction"]',
           '{"framing_instruction":"Centered studio presentation with the full subject clearly visible and details unobstructed.","background_instruction":"Plain seamless studio background with no scenery, story action, text, logo or watermark.","lighting_instruction":"Soft even studio lighting with accurate material, color and texture detail.","negative_prompt":"cinematic still, movie scene, complex background, crowd, narrative action, text, logo, watermark, blur, distorted anatomy"}'
) seed
WHERE NOT EXISTS (SELECT 1 FROM prompt_templates existing WHERE existing.id = seed.id AND existing.is_system = 1);

COMMIT;
