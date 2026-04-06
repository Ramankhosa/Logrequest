import type {
  KpiTemplateAccreditationRef,
  KpiTemplateWriteDraft,
} from "./builder-shared";
import type { AchievementFieldConfig } from "./shared";
import { ACHIEVEMENT_TEMPLATES } from "./shared";
import {
  NAAC_AWARD_TEMPLATE_KEY,
  NAAC_BODY_CODE,
  NAAC_COLLAB_ACTIVITY_TEMPLATE_KEY,
  NAAC_ECONTENT_TEMPLATE_KEY,
  NAAC_EXTENSION_ACTIVITY_TEMPLATE_KEY,
  NAAC_EXTENSION_AWARD_TEMPLATE_KEY,
  NAAC_FELLOWSHIP_TEMPLATE_KEY,
  NAAC_RESEARCH_EVENT_TEMPLATE_KEY,
  NAAC_TEMPLATE_CATEGORY,
  NAAC_UNIVERSITY_STARTER_PACK_KEY,
  NAAC_UNIVERSITY_VERSION_CODE,
} from "./naac-template-constants";

const TEMPLATE_KRA_ID = "TEMPLATE_KRA";
const TEMPLATE_UNIT_ID = "TEMPLATE_UNIT";

type MeasurementType =
  | "NUMERIC"
  | "PERCENTAGE"
  | "CURRENCY"
  | "BOOLEAN"
  | "RATING"
  | "MILESTONE"
  | "DATE_TARGET"
  | "GRADE";

type TeamCreditMethod = "FULL_EACH" | "EQUAL_SPLIT" | "WEIGHTED_SPLIT" | "PRIMARY_ONLY";
type ParticipantMode = "SINGLE_OWNER" | "OPTIONAL_TEAM" | "REQUIRED_TEAM";
type RewardRecurrencePolicy =
  | "RECURRING"
  | "ONCE_PER_PERIOD"
  | "ONCE_PER_KPI_LIFETIME"
  | "ONCE_PER_UNIQUE_KEY";

type TemplateDefinitionInput = {
  title: string;
  description: string;
  measurementType: MeasurementType;
  unitLabel: string | null;
  achievementTemplateKey: string;
  fields: AchievementFieldConfig[];
  guidanceNotes: string;
  evidenceInstructions: string;
  isTeamKpi: boolean;
  teamCreditMethod: TeamCreditMethod;
  allowMultipleAchievementsPerAllocation?: boolean;
  participantMode: ParticipantMode;
  rewardRecurrencePolicy: RewardRecurrencePolicy;
  policyDateFieldKey?: string | null;
  allocationType?: "DEPARTMENT" | "INDIVIDUAL" | "BOTH";
  sortOrder: number;
};

type TemplateInput = {
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  definition: TemplateDefinitionInput;
  applicableRoles: Array<{ roleCode: string; isDefault: boolean; sortOrder: number }>;
  contributorConfig: {
    externalContribTemplateId: null;
    allowExternalContributors: boolean;
    duplicateCheckFields: string[];
    creditSumMode: "MUST_EQUAL_100" | "MAX_100" | "UNCAPPED";
  };
  accreditationRefs: KpiTemplateAccreditationRef[];
};

function cloneFields(fields: AchievementFieldConfig[]): AchievementFieldConfig[] {
  return fields.map((field) => ({
    ...field,
    ...(field.options ? { options: [...field.options] } : {}),
    ...(field.validation ? { validation: { ...field.validation } } : {}),
    ...(field.visibilityRules ? { visibilityRules: [...field.visibilityRules] } : {}),
    ...(field.requiredRules ? { requiredRules: [...field.requiredRules] } : {}),
  }));
}

function accreditationRef(blockCode: string, officialMetricCode: string): KpiTemplateAccreditationRef {
  return {
    bodyCode: NAAC_BODY_CODE,
    versionCode: NAAC_UNIVERSITY_VERSION_CODE,
    blockCode,
    officialMetricCode,
  };
}

function buildNaacGuidance(metricCodes: string[], extra: string): string {
  const metricsLabel =
    metricCodes.length === 1
      ? `NAAC metric ${metricCodes[0]}`
      : `NAAC metrics ${metricCodes.join(", ")}`;
  return [
    `NAAC starter KPI aligned to ${metricsLabel}.`,
    "The tenant should set target values after applying this template, based on its annual allocation plan.",
    "This form intentionally captures more proof data than the minimum NAAC metric so the same submissions can support accreditation, rankings, audit queries, and internal analytics.",
    extra,
  ].join(" ");
}

function buildTemplate(input: TemplateInput): KpiTemplateWriteDraft {
  return {
    code: input.code,
    name: input.name,
    description: input.description,
    category: NAAC_TEMPLATE_CATEGORY,
    sortOrder: input.sortOrder,
    isActive: true,
    payload: {
      definition: {
        kraDefinitionId: TEMPLATE_KRA_ID,
        title: input.definition.title,
        description: input.definition.description,
        measurementType: input.definition.measurementType,
        unitLabel: input.definition.unitLabel,
        weightage: 0,
        defaultTarget: null,
        measurementConfig: null,
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: null,
        isPerCapita: false,
        allocationType: input.definition.allocationType ?? "BOTH",
        startingUnitId: TEMPLATE_UNIT_ID,
        achievementTemplateKey: input.definition.achievementTemplateKey,
        achievementFormConfig: {
          templateKey: input.definition.achievementTemplateKey,
          fields: input.definition.fields,
        },
        guidanceNotes: input.definition.guidanceNotes,
        sortOrder: input.definition.sortOrder,
        keyUnitId: null,
        finalUnitId: null,
        keyReviewerUserId: null,
        finalReviewerUserId: null,
        sopDescription: null,
        evidenceRequired: true,
        evidenceTypes: ["DOCUMENT", "URL"],
        evidenceInstructions: input.definition.evidenceInstructions,
        isTeamKpi: input.definition.isTeamKpi,
        teamCreditMethod: input.definition.teamCreditMethod,
        allowPartialCompletion: true,
        allowMultipleAchievementsPerAllocation:
          input.definition.allowMultipleAchievementsPerAllocation ?? true,
        participantMode: input.definition.participantMode,
        rewardRecurrencePolicy: input.definition.rewardRecurrencePolicy,
        policyDateFieldKey: input.definition.policyDateFieldKey ?? null,
        contributionRoles: null,
      },
      meta: {
        starterPackKey: NAAC_UNIVERSITY_STARTER_PACK_KEY,
        accreditationRefs: input.accreditationRefs,
      },
      applicableRoles: input.applicableRoles,
      contributorConfig: input.contributorConfig,
      stages: [],
      rewardTiers: [],
      rewardComponents: [],
    },
  };
}

const publicationFields: AchievementFieldConfig[] = [
  { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "publicationType", label: "Publication Type", type: "SELECT", required: true, options: ["Journal Article", "Review Article", "Conference Paper", "Case Study", "Other"], sortOrder: 1, marker: "CATEGORY_FIELD" },
  { key: "journalName", label: "Journal / Conference Name", type: "TEXT", required: true, sortOrder: 2 },
  { key: "publisher", label: "Publisher", type: "TEXT", required: false, sortOrder: 3 },
  { key: "issn", label: "ISSN", type: "TEXT", required: false, sortOrder: 4 },
  { key: "eIssn", label: "e-ISSN", type: "TEXT", required: false, sortOrder: 5 },
  { key: "doi", label: "DOI", type: "TEXT", required: false, placeholder: "10.xxxx/...", sortOrder: 6, marker: "UNIQUE_CHECK" },
  { key: "indexing", label: "Indexing Source", type: "MULTI_SELECT", required: true, options: ["Scopus", "Web of Science", "UGC CARE", "PubMed", "Google Scholar", "Other"], sortOrder: 7, marker: "CATEGORY_FIELD" },
  { key: "scopusIndexed", label: "Indexed in Scopus", type: "BOOLEAN", required: true, sortOrder: 8 },
  { key: "webOfScienceIndexed", label: "Indexed in Web of Science", type: "BOOLEAN", required: true, sortOrder: 9 },
  { key: "ugcCareListed", label: "UGC CARE Listed", type: "BOOLEAN", required: false, sortOrder: 10 },
  { key: "journalQuartile", label: "Quartile / Rank Band", type: "SELECT", required: false, options: ["Q1", "Q2", "Q3", "Q4", "NA"], sortOrder: 11, marker: "CATEGORY_FIELD" },
  { key: "impactFactor", label: "Impact Factor", type: "NUMBER", required: false, sortOrder: 12 },
  { key: "impactFactorSource", label: "Impact Factor Source", type: "TEXT", required: false, sortOrder: 13 },
  { key: "sjr", label: "SJR", type: "NUMBER", required: false, sortOrder: 14 },
  { key: "publicationYear", label: "Publication Year", type: "NUMBER", required: true, sortOrder: 15, validation: { min: 2000, max: 2100 } },
  { key: "publicationDate", label: "Publication Date", type: "DATE", required: true, sortOrder: 16, marker: "POLICY_DATE_FIELD" },
  { key: "volume", label: "Volume", type: "TEXT", required: false, sortOrder: 17 },
  { key: "issue", label: "Issue", type: "TEXT", required: false, sortOrder: 18 },
  { key: "pageRange", label: "Page Range", type: "TEXT", required: false, sortOrder: 19 },
  { key: "correspondingAuthor", label: "Corresponding Author", type: "BOOLEAN", required: false, sortOrder: 20 },
  { key: "institutionAffiliation", label: "Affiliation Used in Publication", type: "TEXT", required: false, sortOrder: 21 },
  { key: "articleUrl", label: "Article URL", type: "URL", required: false, sortOrder: 22 },
  { key: "pdfLink", label: "Paper PDF / Proof URL", type: "URL", required: true, sortOrder: 23 },
];

const bookOutputFields: AchievementFieldConfig[] = [
  { key: "outputKind", label: "Book Output Type", type: "SELECT", required: true, options: ["Authored Book", "Edited Book", "Book Chapter", "Conference Proceeding"], sortOrder: 0, marker: "CATEGORY_FIELD" },
  { key: "outputTitle", label: "Title", type: "TEXT", required: true, sortOrder: 1 },
  { key: "parentVolumeTitle", label: "Book / Proceedings Title", type: "TEXT", required: false, sortOrder: 2 },
  { key: "publisher", label: "Publisher", type: "TEXT", required: true, sortOrder: 3 },
  { key: "isbn", label: "ISBN", type: "TEXT", required: true, sortOrder: 4, marker: "UNIQUE_CHECK" },
  { key: "publicationYear", label: "Publication Year", type: "NUMBER", required: true, sortOrder: 5, validation: { min: 2000, max: 2100 } },
  { key: "publicationDate", label: "Publication Date", type: "DATE", required: true, sortOrder: 6, marker: "POLICY_DATE_FIELD" },
  { key: "publisherCategory", label: "Publisher Category", type: "SELECT", required: false, options: ["International", "National", "University Press", "Other"], sortOrder: 7, marker: "CATEGORY_FIELD" },
  { key: "edition", label: "Edition", type: "TEXT", required: false, sortOrder: 8 },
  { key: "chapterPageRange", label: "Chapter / Output Page Range", type: "TEXT", required: false, sortOrder: 9 },
  { key: "scopusIndexed", label: "Indexed in Scopus", type: "BOOLEAN", required: false, sortOrder: 10 },
  { key: "webOfScienceIndexed", label: "Indexed in Web of Science", type: "BOOLEAN", required: false, sortOrder: 11 },
  { key: "publisherLink", label: "Publisher Page / Listing", type: "URL", required: true, sortOrder: 12 },
  { key: "supportingProofLink", label: "Supporting Proof", type: "URL", required: false, sortOrder: 13 },
];

const patentFields: AchievementFieldConfig[] = [
  { key: "patentTitle", label: "Patent / IPR Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "patentType", label: "IPR Type", type: "SELECT", required: true, options: ["Patent", "Design", "Copyright", "Trademark", "Other"], sortOrder: 1, marker: "CATEGORY_FIELD" },
  { key: "applicationNumber", label: "Application Number", type: "TEXT", required: true, sortOrder: 2, marker: "UNIQUE_CHECK" },
  { key: "patentOffice", label: "Patent Office", type: "SELECT", required: true, options: ["Indian Patent Office", "USPTO", "EPO", "WIPO", "Other"], sortOrder: 3 },
  { key: "filingDate", label: "Filing Date", type: "DATE", required: true, sortOrder: 4, marker: "POLICY_DATE_FIELD" },
  { key: "publicationDate", label: "Publication Date", type: "DATE", required: false, sortOrder: 5 },
  { key: "grantDate", label: "Grant Date", type: "DATE", required: false, sortOrder: 6 },
  { key: "status", label: "Status", type: "SELECT", required: true, options: ["Filed", "Published", "Granted", "Licensed", "Transferred", "Abandoned"], sortOrder: 7, marker: "CATEGORY_FIELD" },
  { key: "technologyArea", label: "Technology Area", type: "TEXT", required: false, sortOrder: 8 },
  { key: "ipcClassification", label: "IPC / CPC Classification", type: "TEXT", required: false, sortOrder: 9 },
  { key: "commercializationStatus", label: "Commercialization Status", type: "SELECT", required: false, options: ["None", "Licensing", "Transferred", "Start-up Use", "Other"], sortOrder: 10, marker: "CATEGORY_FIELD" },
  { key: "assigneeOrganization", label: "Assignee / Owner", type: "TEXT", required: false, sortOrder: 11 },
  { key: "certificateLink", label: "Filing / Grant Proof", type: "URL", required: true, sortOrder: 12 },
];

const grantFields: AchievementFieldConfig[] = [
  { key: "projectTitle", label: "Project Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "schemeType", label: "Funding Category", type: "SELECT", required: true, options: ["Government", "Non-Government", "Industry", "International", "Institutional"], sortOrder: 1, marker: "CATEGORY_FIELD" },
  { key: "fundingAgency", label: "Funding Agency", type: "TEXT", required: true, sortOrder: 2 },
  { key: "sanctionedAmount", label: "Sanctioned Amount (INR)", type: "NUMBER", required: true, sortOrder: 3, marker: "VALUE_FIELD" },
  { key: "amountReceived", label: "Amount Received So Far (INR)", type: "NUMBER", required: false, sortOrder: 4 },
  { key: "sanctionNumber", label: "Sanction / Reference Number", type: "TEXT", required: false, sortOrder: 5, marker: "UNIQUE_CHECK" },
  { key: "startDate", label: "Start Date", type: "DATE", required: true, sortOrder: 6, marker: "POLICY_DATE_FIELD" },
  { key: "endDate", label: "End Date", type: "DATE", required: false, sortOrder: 7 },
  { key: "durationMonths", label: "Duration (Months)", type: "NUMBER", required: false, sortOrder: 8 },
  { key: "projectStatus", label: "Project Status", type: "SELECT", required: true, options: ["Sanctioned", "Ongoing", "Completed", "Closed"], sortOrder: 9, marker: "CATEGORY_FIELD" },
  { key: "interdisciplinary", label: "Interdisciplinary Project", type: "BOOLEAN", required: false, sortOrder: 10 },
  { key: "sanctionLetterLink", label: "Sanction Letter", type: "URL", required: true, sortOrder: 11 },
  { key: "projectPageLink", label: "Project Webpage / Public Listing", type: "URL", required: false, sortOrder: 12 },
];

const awardFields: AchievementFieldConfig[] = [
  { key: "awardTitle", label: "Award / Recognition Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "recognitionType", label: "Recognition Type", type: "SELECT", required: true, options: ["Award", "Recognition", "Honor", "Fellowship", "Professional Membership"], sortOrder: 1, marker: "CATEGORY_FIELD" },
  { key: "awardCategory", label: "Category", type: "SELECT", required: true, options: ["Teaching", "Research", "Innovation", "Extension", "Professional", "Other"], sortOrder: 2, marker: "CATEGORY_FIELD" },
  { key: "awardingBody", label: "Awarding Body", type: "TEXT", required: true, sortOrder: 3 },
  { key: "level", label: "Level", type: "SELECT", required: true, options: ["International", "National", "State", "Institution"], sortOrder: 4, marker: "CATEGORY_FIELD" },
  { key: "awardDate", label: "Award Date", type: "DATE", required: true, sortOrder: 5, marker: "POLICY_DATE_FIELD" },
  { key: "certificateNumber", label: "Certificate / Award Number", type: "TEXT", required: false, sortOrder: 6, marker: "UNIQUE_CHECK" },
  { key: "awardCitation", label: "Award Citation / Summary", type: "TEXTAREA", required: false, sortOrder: 7 },
  { key: "proofLink", label: "Certificate / Citation", type: "URL", required: true, sortOrder: 8 },
];

const fellowshipFields: AchievementFieldConfig[] = [
  { key: "supportTitle", label: "Support / Fellowship Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "supportType", label: "Support Type", type: "SELECT", required: true, options: ["Fellowship", "Study Leave", "Travel Grant", "Research Support", "Seed Funding", "Post-Doctoral Support", "Other"], sortOrder: 1, marker: "CATEGORY_FIELD" },
  { key: "sponsoringBody", label: "Sponsoring Body", type: "TEXT", required: true, sortOrder: 2 },
  { key: "sanctionAmount", label: "Support Amount (INR)", type: "NUMBER", required: false, sortOrder: 3, marker: "VALUE_FIELD" },
  { key: "supportPeriodStart", label: "Support Start Date", type: "DATE", required: false, sortOrder: 4 },
  { key: "supportPeriodEnd", label: "Support End Date", type: "DATE", required: false, sortOrder: 5 },
  { key: "sanctionDate", label: "Sanction Date", type: "DATE", required: true, sortOrder: 6, marker: "POLICY_DATE_FIELD" },
  { key: "referenceNumber", label: "Reference Number", type: "TEXT", required: false, sortOrder: 7, marker: "UNIQUE_CHECK" },
  { key: "purpose", label: "Purpose / Outcome", type: "TEXTAREA", required: false, sortOrder: 8 },
  { key: "supportProofLink", label: "Support Letter / Proof", type: "URL", required: true, sortOrder: 9 },
];

const phdFields: AchievementFieldConfig[] = [
  ...cloneFields(ACHIEVEMENT_TEMPLATES.PHD_SUPERVISION.fields).map((field) => {
    if (field.key === "awardDate") {
      return { ...field, marker: "POLICY_DATE_FIELD" as const };
    }
    return field;
  }),
  { key: "discipline", label: "Discipline / Department", type: "TEXT", required: false, sortOrder: 6 },
  { key: "mode", label: "Mode", type: "SELECT", required: false, options: ["Full Time", "Part Time"], sortOrder: 7, marker: "CATEGORY_FIELD" },
];

const econtentFields: AchievementFieldConfig[] = [
  { key: "contentTitle", label: "E-Content Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "contentType", label: "Content Type", type: "SELECT", required: true, options: ["e-Book", "e-Module", "Video Lecture", "Question Bank", "Assessment Material", "Simulation", "MOOC Module", "Other"], sortOrder: 1, marker: "CATEGORY_FIELD" },
  { key: "platformName", label: "Platform / Repository", type: "TEXT", required: true, sortOrder: 2 },
  { key: "contentLink", label: "Content URL", type: "URL", required: true, sortOrder: 3, marker: "UNIQUE_CHECK" },
  { key: "academicYear", label: "Academic Year", type: "TEXT", required: false, sortOrder: 4 },
  { key: "publicationDate", label: "Publication Date", type: "DATE", required: true, sortOrder: 5, marker: "POLICY_DATE_FIELD" },
  { key: "courseMappedTo", label: "Course / Subject Mapped To", type: "TEXT", required: false, sortOrder: 6 },
  { key: "accessType", label: "Access Type", type: "SELECT", required: false, options: ["Public", "LMS", "Internal", "MOOC", "Other"], sortOrder: 7, marker: "CATEGORY_FIELD" },
  { key: "reviewStatus", label: "Review / Validation Status", type: "SELECT", required: false, options: ["Self Developed", "Peer Reviewed", "Institution Validated", "Other"], sortOrder: 8, marker: "CATEGORY_FIELD" },
  { key: "supportingProofLink", label: "Approval / Screenshot / Proof", type: "URL", required: true, sortOrder: 9 },
];

const consultancyFields: AchievementFieldConfig[] = [
  ...cloneFields(ACHIEVEMENT_TEMPLATES.CONSULTANCY.fields),
  { key: "engagementType", label: "Engagement Type", type: "SELECT", required: true, options: ["Consultancy", "Corporate Training", "MDP", "EDP", "Expert Service", "Other"], sortOrder: 9, marker: "CATEGORY_FIELD" },
  { key: "beneficiaryCount", label: "Beneficiary Count", type: "NUMBER", required: false, sortOrder: 10 },
  { key: "status", label: "Status", type: "SELECT", required: false, options: ["Ongoing", "Completed", "Closed"], sortOrder: 11, marker: "CATEGORY_FIELD" },
  { key: "completionReportLink", label: "Completion Report / Evidence", type: "URL", required: false, sortOrder: 12 },
];

const extensionActivityFields: AchievementFieldConfig[] = [
  { key: "activityTitle", label: "Activity Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "activityType", label: "Activity Type", type: "SELECT", required: true, options: ["NSS", "NCC", "Red Cross", "YRC", "Swachh Bharat", "AIDS Awareness", "Gender Sensitization", "Community Development", "Environment", "Health", "Other"], sortOrder: 1, marker: "CATEGORY_FIELD" },
  { key: "organizingUnit", label: "Organizing Unit / Cell", type: "TEXT", required: true, sortOrder: 2 },
  { key: "collaborationPartner", label: "Collaboration Partner", type: "TEXT", required: false, sortOrder: 3 },
  { key: "startDate", label: "Start Date", type: "DATE", required: true, sortOrder: 4, marker: "POLICY_DATE_FIELD" },
  { key: "endDate", label: "End Date", type: "DATE", required: false, sortOrder: 5 },
  { key: "location", label: "Location", type: "TEXT", required: false, sortOrder: 6 },
  { key: "studentParticipantCount", label: "Student Participant Count", type: "NUMBER", required: false, sortOrder: 7, marker: "VALUE_FIELD" },
  { key: "facultyParticipantCount", label: "Faculty Participant Count", type: "NUMBER", required: false, sortOrder: 8 },
  { key: "beneficiaryCount", label: "Beneficiary Count", type: "NUMBER", required: false, sortOrder: 9 },
  { key: "recurring", label: "Recurring Program", type: "BOOLEAN", required: false, sortOrder: 10 },
  { key: "activityReportLink", label: "Activity Report", type: "URL", required: true, sortOrder: 11 },
  { key: "supportingProofLink", label: "Supporting Proof", type: "URL", required: false, sortOrder: 12 },
];

const extensionAwardFields: AchievementFieldConfig[] = [
  { key: "awardTitle", label: "Recognition Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "activityLinkedTo", label: "Linked Extension Activity", type: "TEXT", required: false, sortOrder: 1 },
  { key: "awardingBody", label: "Awarding Body", type: "TEXT", required: true, sortOrder: 2 },
  { key: "level", label: "Level", type: "SELECT", required: true, options: ["International", "National", "State", "District", "Institution"], sortOrder: 3, marker: "CATEGORY_FIELD" },
  { key: "awardDate", label: "Award Date", type: "DATE", required: true, sortOrder: 4, marker: "POLICY_DATE_FIELD" },
  { key: "certificateNumber", label: "Certificate Number", type: "TEXT", required: false, sortOrder: 5, marker: "UNIQUE_CHECK" },
  { key: "proofLink", label: "Certificate / Citation", type: "URL", required: true, sortOrder: 6 },
];

const collaborativeActivityFields: AchievementFieldConfig[] = [
  { key: "activityTitle", label: "Collaborative Activity Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "collaborationType", label: "Collaboration Type", type: "SELECT", required: true, options: ["Research", "Academic", "Internship", "Fieldwork", "Training", "Publication", "Event", "Resource Sharing", "Other"], sortOrder: 1, marker: "CATEGORY_FIELD" },
  { key: "partnerOrganization", label: "Partner Organization", type: "TEXT", required: true, sortOrder: 2 },
  { key: "agreementReference", label: "Agreement / MoU Reference", type: "TEXT", required: false, sortOrder: 3, marker: "UNIQUE_CHECK" },
  { key: "startDate", label: "Start Date", type: "DATE", required: true, sortOrder: 4, marker: "POLICY_DATE_FIELD" },
  { key: "endDate", label: "End Date", type: "DATE", required: false, sortOrder: 5 },
  { key: "outputType", label: "Primary Output", type: "SELECT", required: false, options: ["Joint Publication", "Internship", "Training", "Event", "Project", "Coursework", "Other"], sortOrder: 6, marker: "CATEGORY_FIELD" },
  { key: "participantCount", label: "Participant Count", type: "NUMBER", required: false, sortOrder: 7 },
  { key: "outcomeSummary", label: "Outcome Summary", type: "TEXTAREA", required: false, sortOrder: 8 },
  { key: "proofLink", label: "Supporting Proof", type: "URL", required: true, sortOrder: 9 },
];

const functionalMouFields: AchievementFieldConfig[] = [
  { key: "partnerOrg", label: "Partner Organization", type: "TEXT", required: true, sortOrder: 0 },
  { key: "scope", label: "Scope of MoU / Linkage", type: "TEXTAREA", required: true, sortOrder: 1 },
  { key: "mouCategory", label: "MoU Category", type: "SELECT", required: true, options: ["Industry", "Academic", "Research", "International", "Government", "NGO", "Other"], sortOrder: 2, marker: "CATEGORY_FIELD" },
  { key: "signedDate", label: "Signed Date", type: "DATE", required: true, sortOrder: 3, marker: "POLICY_DATE_FIELD" },
  { key: "validUntil", label: "Valid Until", type: "DATE", required: false, sortOrder: 4 },
  { key: "currentStatus", label: "Status", type: "SELECT", required: true, options: ["Active", "Renewed", "Expired", "Inactive"], sortOrder: 5, marker: "CATEGORY_FIELD" },
  { key: "activityCount", label: "Number of Activities Executed", type: "NUMBER", required: false, sortOrder: 6, marker: "VALUE_FIELD" },
  { key: "signedCopyLink", label: "Signed Copy", type: "URL", required: true, sortOrder: 7 },
  { key: "outcomeProofLink", label: "Outcome Proof", type: "URL", required: false, sortOrder: 8 },
];

const facultyDevelopmentFields: AchievementFieldConfig[] = [
  { key: "programName", label: "Program / Support Name", type: "TEXT", required: true, sortOrder: 0 },
  { key: "supportType", label: "Development Type", type: "SELECT", required: true, options: ["FDP", "Refresher Course", "Orientation Program", "Workshop", "Conference Support", "Professional Membership", "Training", "Other"], sortOrder: 1, marker: "CATEGORY_FIELD" },
  { key: "organizer", label: "Organizer / Body", type: "TEXT", required: true, sortOrder: 2 },
  { key: "role", label: "Role", type: "SELECT", required: true, options: ["Participant", "Resource Person", "Invited Speaker", "Member"], sortOrder: 3, marker: "CATEGORY_FIELD" },
  { key: "startDate", label: "Start Date", type: "DATE", required: true, sortOrder: 4, marker: "POLICY_DATE_FIELD" },
  { key: "endDate", label: "End Date", type: "DATE", required: false, sortOrder: 5 },
  { key: "durationDays", label: "Duration (Days)", type: "NUMBER", required: false, sortOrder: 6, marker: "UNIT_FIELD" },
  { key: "financialSupportAmount", label: "Financial Support Amount (INR)", type: "NUMBER", required: false, sortOrder: 7, marker: "VALUE_FIELD" },
  { key: "membershipBody", label: "Professional Body", type: "TEXT", required: false, sortOrder: 8 },
  { key: "certificateLink", label: "Certificate / Proof", type: "URL", required: true, sortOrder: 9 },
  { key: "supportLetterLink", label: "Financial Support Letter", type: "URL", required: false, sortOrder: 10 },
];

const researchEventFields: AchievementFieldConfig[] = [
  { key: "programName", label: "Program Name", type: "TEXT", required: true, sortOrder: 0 },
  { key: "programType", label: "Program Type", type: "SELECT", required: true, options: ["Research Methodology", "IPR", "Entrepreneurship", "Skill Development", "Faculty Development", "Administrative Training", "Workshop", "Seminar", "Other"], sortOrder: 1, marker: "CATEGORY_FIELD" },
  { key: "organizerUnit", label: "Organizer Unit / Cell", type: "TEXT", required: true, sortOrder: 2 },
  { key: "sponsoringAgency", label: "Sponsoring Agency", type: "TEXT", required: false, sortOrder: 3 },
  { key: "startDate", label: "Start Date", type: "DATE", required: true, sortOrder: 4, marker: "POLICY_DATE_FIELD" },
  { key: "endDate", label: "End Date", type: "DATE", required: false, sortOrder: 5 },
  { key: "totalHours", label: "Total Hours", type: "NUMBER", required: false, sortOrder: 6, marker: "UNIT_FIELD" },
  { key: "participantCount", label: "Participant Count", type: "NUMBER", required: false, sortOrder: 7 },
  { key: "targetAudience", label: "Target Audience", type: "SELECT", required: false, options: ["Faculty", "Students", "Staff", "Mixed"], sortOrder: 8, marker: "CATEGORY_FIELD" },
  { key: "programReportLink", label: "Program Report", type: "URL", required: true, sortOrder: 9 },
  { key: "supportDocLink", label: "Brochure / Approval", type: "URL", required: false, sortOrder: 10 },
];

export const NAAC_KPI_TEMPLATES: KpiTemplateWriteDraft[] = [
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_RESEARCH_PUBLICATION",
    name: "NAAC Research Publication",
    description: "NAAC starter KPI for faculty research publications with richer bibliographic proof fields.",
    sortOrder: 200,
    definition: {
      title: "NAAC Research Publication",
      description: "Collects publication records that can feed NAAC research publication metrics.",
      measurementType: "NUMERIC",
      unitLabel: "publications",
      achievementTemplateKey: "PUBLICATION",
      fields: publicationFields,
      guidanceNotes: buildNaacGuidance(["3.4.5"], "Use this as the standard faculty publication capture form and set target counts later at department or faculty level."),
      evidenceInstructions: "Attach the paper URL or PDF, indexing proof, and any institutional affiliation evidence.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "publicationDate",
      sortOrder: 0,
    },
    applicableRoles: [
      { roleCode: "LEAD_AUTHOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
      { roleCode: "CORRESPONDING", isDefault: false, sortOrder: 2 },
    ],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: true, duplicateCheckFields: ["doi", "paperTitle"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.4.5", "3.4.5")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_BOOK_OUTPUT",
    name: "NAAC Book / Chapter Output",
    description: "NAAC starter KPI for books, edited volumes, chapters, and proceedings.",
    sortOrder: 201,
    definition: {
      title: "NAAC Book / Chapter Output",
      description: "Collects books, chapters, and proceedings for NAAC book-output tracking.",
      measurementType: "NUMERIC",
      unitLabel: "outputs",
      achievementTemplateKey: "BOOK",
      fields: bookOutputFields,
      guidanceNotes: buildNaacGuidance(["3.4.6"], "Use this when the institution wants one consolidated template for authored books, edited volumes, chapters, and proceedings."),
      evidenceInstructions: "Attach publisher listing, ISBN proof, and supporting publication evidence.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "publicationDate",
      sortOrder: 1,
    },
    applicableRoles: [
      { roleCode: "AUTHOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: true, duplicateCheckFields: ["isbn", "outputTitle"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.4.6", "3.4.6")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_PATENT_IPR",
    name: "NAAC Patent / IPR Output",
    description: "NAAC starter KPI for patent and IPR filings, publications, and grants.",
    sortOrder: 202,
    definition: {
      title: "NAAC Patent / IPR Output",
      description: "Collects patent and IPR outputs for NAAC reporting.",
      measurementType: "NUMERIC",
      unitLabel: "iprs",
      achievementTemplateKey: "PATENT",
      fields: patentFields,
      guidanceNotes: buildNaacGuidance(["3.4.3"], "Capture filings, publications, grants, and commercialization context here so accreditation and innovation reports can reuse the same record."),
      evidenceInstructions: "Attach filing acknowledgement, publication notice, grant certificate, or licensing proof as applicable.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "filingDate",
      sortOrder: 2,
    },
    applicableRoles: [{ roleCode: "INVENTOR", isDefault: true, sortOrder: 0 }],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: true, duplicateCheckFields: ["applicationNumber"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.4.3", "3.4.3")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_RESEARCH_GRANT_PROJECT",
    name: "NAAC Research Grant / Project",
    description: "NAAC starter KPI for externally funded projects and grants.",
    sortOrder: 203,
    definition: {
      title: "NAAC Research Grant / Project",
      description: "Collects sanctioned research grants and project outputs relevant to NAAC research funding metrics.",
      measurementType: "NUMERIC",
      unitLabel: "projects",
      achievementTemplateKey: "GRANT",
      fields: grantFields,
      guidanceNotes: buildNaacGuidance(["3.2.1", "3.2.2", "3.2.3"], "Treat this as the institution-wide starter form for funded projects. Capture amount, sanction details, and duration even if the KPI target is set as a simple project count."),
      evidenceInstructions: "Attach sanction letter, funding confirmation, and any public project listing.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      sortOrder: 3,
    },
    applicableRoles: [
      { roleCode: "PI", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_PI", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: true, duplicateCheckFields: ["sanctionNumber", "projectTitle"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.2.1", "3.2.1"), accreditationRef("METRIC_3.2.2", "3.2.2"), accreditationRef("METRIC_3.2.3", "3.2.3")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_AWARD_RECOGNITION",
    name: "NAAC Academic Award / Recognition",
    description: "NAAC starter KPI for faculty awards, recognitions, and professional honors.",
    sortOrder: 204,
    definition: {
      title: "NAAC Academic Award / Recognition",
      description: "Collects faculty awards, recognitions, and honors for NAAC reporting.",
      measurementType: "NUMERIC",
      unitLabel: "awards",
      achievementTemplateKey: NAAC_AWARD_TEMPLATE_KEY,
      fields: awardFields,
      guidanceNotes: buildNaacGuidance(["2.4.4", "3.3.3"], "Use this for faculty awards and recognitions. Keep the support or fellowship form separate when the main output is funding rather than an honor."),
      evidenceInstructions: "Attach certificate, citation, notification, or official recognition link.",
      isTeamKpi: false,
      teamCreditMethod: "PRIMARY_ONLY",
      participantMode: "SINGLE_OWNER",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "awardDate",
      allocationType: "INDIVIDUAL",
      sortOrder: 4,
    },
    applicableRoles: [{ roleCode: "MEMBER", isDefault: true, sortOrder: 0 }],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: false, duplicateCheckFields: ["certificateNumber", "awardTitle"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_2.4.4", "2.4.4"), accreditationRef("METRIC_3.3.3", "3.3.3")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_FELLOWSHIP_SUPPORT",
    name: "NAAC Fellowship / Financial Support",
    description: "NAAC starter KPI for faculty fellowships and funded academic support.",
    sortOrder: 205,
    definition: {
      title: "NAAC Fellowship / Financial Support",
      description: "Collects faculty fellowships, study leave support, travel grants, and research support.",
      measurementType: "NUMERIC",
      unitLabel: "supports",
      achievementTemplateKey: NAAC_FELLOWSHIP_TEMPLATE_KEY,
      fields: fellowshipFields,
      guidanceNotes: buildNaacGuidance(["3.1.3"], "Use this for advanced study, post-doctoral, fellowship, and similar support cases. Capture amount even if the KPI target is configured as a count."),
      evidenceInstructions: "Attach sanction letter, support order, or official funding proof.",
      isTeamKpi: false,
      teamCreditMethod: "PRIMARY_ONLY",
      participantMode: "SINGLE_OWNER",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "sanctionDate",
      allocationType: "INDIVIDUAL",
      sortOrder: 5,
    },
    applicableRoles: [{ roleCode: "MEMBER", isDefault: true, sortOrder: 0 }],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: false, duplicateCheckFields: ["referenceNumber", "supportTitle"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.1.3", "3.1.3")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_PHD_SUPERVISION_OUTCOME",
    name: "NAAC PhD Supervision Outcome",
    description: "NAAC starter KPI for PhDs awarded under faculty supervision.",
    sortOrder: 206,
    definition: {
      title: "NAAC PhD Supervision Outcome",
      description: "Collects awarded PhD outcomes for faculty supervision tracking.",
      measurementType: "NUMERIC",
      unitLabel: "degrees",
      achievementTemplateKey: "PHD_SUPERVISION",
      fields: phdFields,
      guidanceNotes: buildNaacGuidance(["3.4.4"], "Record one scholar outcome per awarded PhD and capture enough documentary proof for NAAC and institutional research office verification."),
      evidenceInstructions: "Attach degree award notification, thesis approval, or university confirmation proof.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "awardDate",
      allocationType: "INDIVIDUAL",
      sortOrder: 6,
    },
    applicableRoles: [
      { roleCode: "SUPERVISOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_SUPERVISOR", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: false, duplicateCheckFields: ["enrollmentNumber"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.4.4", "3.4.4")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_ECONTENT_DEVELOPMENT",
    name: "NAAC E-Content Development",
    description: "NAAC starter KPI for digital learning content developed by teachers.",
    sortOrder: 207,
    definition: {
      title: "NAAC E-Content Development",
      description: "Collects teacher-developed e-content outputs.",
      measurementType: "NUMERIC",
      unitLabel: "resources",
      achievementTemplateKey: NAAC_ECONTENT_TEMPLATE_KEY,
      fields: econtentFields,
      guidanceNotes: buildNaacGuidance(["3.4.7"], "Capture platform, access mode, and course mapping so the same record can support teaching, accreditation, and LMS reviews."),
      evidenceInstructions: "Attach the content URL plus approval, screenshot, or repository evidence.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "publicationDate",
      sortOrder: 7,
    },
    applicableRoles: [
      { roleCode: "AUTHOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: false, duplicateCheckFields: ["contentLink", "contentTitle"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.4.7", "3.4.7")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_CONSULTANCY_TRAINING",
    name: "NAAC Consultancy / Corporate Training",
    description: "NAAC starter KPI for consultancy and corporate training engagements.",
    sortOrder: 208,
    definition: {
      title: "NAAC Consultancy / Corporate Training",
      description: "Collects consultancy, expert service, and corporate training engagements.",
      measurementType: "NUMERIC",
      unitLabel: "engagements",
      achievementTemplateKey: "CONSULTANCY",
      fields: consultancyFields,
      guidanceNotes: buildNaacGuidance(["3.5.2"], "Use this as the standard capture form for consultancy and corporate training. Amount and expenditure fields allow central teams to derive revenue later."),
      evidenceInstructions: "Attach agreement, approval, invoice, or completion evidence.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      sortOrder: 8,
    },
    applicableRoles: [
      { roleCode: "LEAD_CONSULTANT", isDefault: true, sortOrder: 0 },
      { roleCode: "CONSULTANT", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: true, duplicateCheckFields: ["referenceNumber", "projectTitle"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.5.2", "3.5.2")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_EXTENSION_ACTIVITY",
    name: "NAAC Extension / Outreach Activity",
    description: "NAAC starter KPI for extension programmes and student participation records.",
    sortOrder: 209,
    definition: {
      title: "NAAC Extension / Outreach Activity",
      description: "Collects extension and outreach activities, including student participation evidence.",
      measurementType: "NUMERIC",
      unitLabel: "activities",
      achievementTemplateKey: NAAC_EXTENSION_ACTIVITY_TEMPLATE_KEY,
      fields: extensionActivityFields,
      guidanceNotes: buildNaacGuidance(["3.6.3", "3.6.4"], "Use this form for outreach events run through NSS, NCC, extension cells, or other institutional initiatives. Student and beneficiary counts are intentionally captured even if the KPI target is configured as activity count."),
      evidenceInstructions: "Attach activity report, circular, attendance proof, and supporting media or partner proof.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      sortOrder: 9,
    },
    applicableRoles: [
      { roleCode: "COORDINATOR", isDefault: true, sortOrder: 0 },
      { roleCode: "TEAM_MEMBER", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: false, duplicateCheckFields: ["activityTitle", "startDate"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.6.3", "3.6.3"), accreditationRef("METRIC_3.6.4", "3.6.4")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_EXTENSION_AWARD",
    name: "NAAC Extension Award / Recognition",
    description: "NAAC starter KPI for recognitions received for extension and outreach work.",
    sortOrder: 210,
    definition: {
      title: "NAAC Extension Award / Recognition",
      description: "Collects awards and recognitions tied to extension and outreach activities.",
      measurementType: "NUMERIC",
      unitLabel: "recognitions",
      achievementTemplateKey: NAAC_EXTENSION_AWARD_TEMPLATE_KEY,
      fields: extensionAwardFields,
      guidanceNotes: buildNaacGuidance(["3.6.2"], "Use this only for recognitions tied to extension or outreach work. General academic awards should use the academic award template instead."),
      evidenceInstructions: "Attach certificate, citation, or official recognition link.",
      isTeamKpi: false,
      teamCreditMethod: "PRIMARY_ONLY",
      participantMode: "SINGLE_OWNER",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "awardDate",
      allocationType: "INDIVIDUAL",
      sortOrder: 10,
    },
    applicableRoles: [{ roleCode: "MEMBER", isDefault: true, sortOrder: 0 }],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: false, duplicateCheckFields: ["certificateNumber", "awardTitle"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.6.2", "3.6.2")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_COLLAB_ACTIVITY",
    name: "NAAC Collaborative Activity",
    description: "NAAC starter KPI for collaborative academic, research, and training activities.",
    sortOrder: 211,
    definition: {
      title: "NAAC Collaborative Activity",
      description: "Collects collaborative activities with academic, industry, and community partners.",
      measurementType: "NUMERIC",
      unitLabel: "activities",
      achievementTemplateKey: NAAC_COLLAB_ACTIVITY_TEMPLATE_KEY,
      fields: collaborativeActivityFields,
      guidanceNotes: buildNaacGuidance(["3.7.1"], "Capture the partner, activity type, and output so the institution can reuse this record for NAAC, collaboration dashboards, and MoU monitoring."),
      evidenceInstructions: "Attach collaboration proof, event report, joint output, or supporting partner communication.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      sortOrder: 11,
    },
    applicableRoles: [
      { roleCode: "COORDINATOR", isDefault: true, sortOrder: 0 },
      { roleCode: "TEAM_MEMBER", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: true, duplicateCheckFields: ["activityTitle", "partnerOrganization"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.7.1", "3.7.1")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_FUNCTIONAL_MOU",
    name: "NAAC Functional MoU / Linkage",
    description: "NAAC starter KPI for active MoUs and executed linkages.",
    sortOrder: 212,
    definition: {
      title: "NAAC Functional MoU / Linkage",
      description: "Collects active MoUs and the activities executed under them.",
      measurementType: "NUMERIC",
      unitLabel: "mous",
      achievementTemplateKey: "MOU",
      fields: functionalMouFields,
      guidanceNotes: buildNaacGuidance(["3.7.2"], "Use this when the institution wants a dedicated starter KPI for functional MoUs or linkages. Activity count is captured separately so central teams can validate functional status."),
      evidenceInstructions: "Attach signed copy, renewal proof, and evidence of executed activities.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "signedDate",
      sortOrder: 12,
    },
    applicableRoles: [
      { roleCode: "COORDINATOR", isDefault: true, sortOrder: 0 },
      { roleCode: "TEAM_MEMBER", isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: false, duplicateCheckFields: ["partnerOrg", "signedDate"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.7.2", "3.7.2")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_FACULTY_DEVELOPMENT",
    name: "NAAC Faculty Development Participation / Support",
    description: "NAAC starter KPI for faculty FDP participation and support received.",
    sortOrder: 213,
    definition: {
      title: "NAAC Faculty Development Participation / Support",
      description: "Collects faculty development participation, conference support, and professional-body support.",
      measurementType: "NUMERIC",
      unitLabel: "programmes",
      achievementTemplateKey: "TRAINING",
      fields: facultyDevelopmentFields,
      guidanceNotes: buildNaacGuidance(["6.3.2", "6.3.4"], "Use this for faculty participation and financial support cases. Keep organizer-side programme records separate under the organised-programme template."),
      evidenceInstructions: "Attach certificate, membership proof, or sanction letter for support received.",
      isTeamKpi: false,
      teamCreditMethod: "PRIMARY_ONLY",
      participantMode: "SINGLE_OWNER",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      allocationType: "INDIVIDUAL",
      sortOrder: 13,
    },
    applicableRoles: [{ roleCode: "MEMBER", isDefault: true, sortOrder: 0 }],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: false, duplicateCheckFields: ["programName", "startDate"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_6.3.2", "6.3.2"), accreditationRef("METRIC_6.3.4", "6.3.4")],
  }),
  buildTemplate({
    code: "SYSTEM_NAAC_UNIV_RESEARCH_EVENT",
    name: "NAAC Research / IPR / Skill Development Program",
    description: "NAAC starter KPI for research-methodology, IPR, entrepreneurship, skill, and training programmes organised.",
    sortOrder: 214,
    definition: {
      title: "NAAC Research / IPR / Skill Development Program",
      description: "Collects organized programmes relevant to research culture and faculty/staff development.",
      measurementType: "NUMERIC",
      unitLabel: "programmes",
      achievementTemplateKey: NAAC_RESEARCH_EVENT_TEMPLATE_KEY,
      fields: researchEventFields,
      guidanceNotes: buildNaacGuidance(["3.3.2", "6.3.3"], "Use this for programmes organized by the institution or its units. Participation-only records should stay on the faculty development template."),
      evidenceInstructions: "Attach brochure, approval, report, participant proof, and any sponsor communication.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "startDate",
      sortOrder: 14,
    },
    applicableRoles: [
      { roleCode: "CONVENOR", isDefault: true, sortOrder: 0 },
      { roleCode: "CO_COORDINATOR", isDefault: false, sortOrder: 1 },
      { roleCode: "TEAM_MEMBER", isDefault: false, sortOrder: 2 },
    ],
    contributorConfig: { externalContribTemplateId: null, allowExternalContributors: false, duplicateCheckFields: ["programName", "startDate"], creditSumMode: "MUST_EQUAL_100" },
    accreditationRefs: [accreditationRef("METRIC_3.3.2", "3.3.2"), accreditationRef("METRIC_6.3.3", "6.3.3")],
  }),
];
