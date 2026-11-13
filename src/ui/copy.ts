export const APP_NAME = "Inclusion";

/** Secondary line of the official use-case name. Keep this exact string. */
export const APP_DESCRIPTOR = "Private clinical-trial matching";

/** Official use-case name, used in the HTML title, meta description, and print header. */
export const APP_TITLE = "Inclusion: private clinical-trial matching";

export const TAGLINE = "See where you stand on nearby trials, without your chart leaving this computer.";

export const MEDICAL_DISCLAIMER =
  "This is a discussion aid for you and your care team. It is not medical advice, and it cannot tell you that you qualify for a trial. Only your oncologist can do that.";

export const POSSIBLE_MATCH_LABEL = "Possible match. Discuss with your care team.";

export const TIER_STRONG = "Strong";
export const TIER_POSSIBLE = "Possible";
export const TIER_UNLIKELY = "Unlikely";

export const STRONG_MATCH_LABEL = "Strong. Discuss with your care team.";

export const UNLIKELY_LABEL = "Unlikely. Discuss with your care team if something in the chart was missed.";

export const ATTRIBUTION =
  "Trial records come from ClinicalTrials.gov, a service of the National Library of Medicine. We show the date ClinicalTrials.gov last processed the data, and we note any changes we made to a record.";

export function attributionWithTimestamp(dataTimestamp: string | undefined, modifications?: string): string {
  const when = dataTimestamp
    ? `ClinicalTrials.gov last processed these records at ${dataTimestamp} (shown in the source timezone from the API).`
    : "The date ClinicalTrials.gov last processed these records will appear here once they have been loaded.";
  const mods = modifications || "We keep only regional sites and add a local stage flag. Those are our modifications, not ClinicalTrials.gov fields.";
  return `Trial records come from ClinicalTrials.gov, a service of the National Library of Medicine, National Institutes of Health. ${when} ${mods}`;
}

export const GROUP_MET = "Met (quoted)";
export const GROUP_NOT_MET = "Not met (quoted)";
export const GROUP_DISCUSS = "Discuss with your care team";
