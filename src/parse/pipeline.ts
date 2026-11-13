/**
 * Client re-exports of the option-(a) public-trial parse gates.
 * The implementation lives in scripts/lib/ai-logic-parse-pipeline.mjs so the
 * batch job and the in-browser refresh action share one verifier.
 */
export {
  applyConsistencyGate,
  applyNormalizerVerifier,
  applyQuoteGate,
  checksAgree,
  isVerbatimQuote,
  mergeTwoRuns,
  PARSER_MODEL,
  PIPELINE_ID,
  PROMPT_VERSION,
  quoteOf,
} from "../../scripts/lib/ai-logic-parse-pipeline.mjs";
