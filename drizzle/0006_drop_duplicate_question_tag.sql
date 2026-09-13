-- 题目「常引起外周神经炎的抗肿瘤药是（ ）」重复收录：
-- external_id=1996938107505078315（4 选项）与 1996938107505078302（5 选项）题干、答案相同，
-- 指纹按 stem+options 计算故未被判为重复。移出「技能」题池，避免同卷出现两道同题。
DELETE FROM `question_tags`
WHERE `tag` = '技能'
  AND `question_id` = (
    SELECT `id` FROM `questions` WHERE `external_id` = '1996938107505078315'
  );
