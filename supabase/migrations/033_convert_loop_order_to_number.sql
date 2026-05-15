-- 033_convert_loop_order_to_number.sql
-- idx.index_record.data 내 "11_INTERNAL LOOP ORDER" 값을 JSON string → JSON number로 변환.
-- 숫자 패턴(정수/소수)에 맞는 string만 대상으로 하여 비숫자 값은 건드리지 않음.

UPDATE idx.index_record
SET data = jsonb_set(
  data,
  ARRAY['11_INTERNAL LOOP ORDER'],
  to_jsonb((data->>'11_INTERNAL LOOP ORDER')::numeric)
)
WHERE jsonb_typeof(data->'11_INTERNAL LOOP ORDER') = 'string'
  AND data->>'11_INTERNAL LOOP ORDER' ~ '^-?[0-9]+(\.[0-9]+)?$';
