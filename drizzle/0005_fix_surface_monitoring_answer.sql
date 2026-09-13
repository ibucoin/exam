-- 修订题目「物体表面监测的注意事项包括（）」(external_id=1996944848049402017)
-- C 项 examCorrectAnswer 被源站误填为题目 id，导致正确项丢失且答案数组残留 id 文本
UPDATE `questions`
SET `correct_answer_json` = replace(
  `correct_answer_json`,
  '"1996944848049402017"',
  '"C. 接触碟法采样后，应立即用75%乙醇擦拭被采样表面"'
)
WHERE `external_id` = '1996944848049402017'
  AND `correct_answer_json` LIKE '%"1996944848049402017"%';
--> statement-breakpoint
UPDATE `questions`
SET `raw_question_json` = replace(
  `raw_question_json`,
  '"examCorrectAnswer":"1996944848049402017"',
  '"examCorrectAnswer":"bdic"'
)
WHERE `external_id` = '1996944848049402017'
  AND `raw_question_json` LIKE '%"examCorrectAnswer":"1996944848049402017"%';
