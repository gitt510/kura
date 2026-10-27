// user 発話として扱わない transcript noise。search が使う。
export const HISTORY_NOISE_PREDICATE =
  "text NOT LIKE '%tool_use_id%' " +
  "AND text NOT LIKE '<command-name>%' " +
  "AND text NOT LIKE '<local-command-caveat>%' " +
  "AND text NOT LIKE '%was malformed and could not be parsed%' " +
  "AND length(trim(text)) > 0";
