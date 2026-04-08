type TemplateVariant = "MINIMAL" | "STANDARD" | "FULL" | "SUMMARY_FALLBACK";
type RequiredLevel = "CORE" | "RECOMMENDED" | "OPTIONAL";

export type DatasetTemplateColumnDefinition = {
  key: string;
  label: string;
  description: string;
  type: "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "CURRENCY" | "ENUM";
  sample?: string | number | boolean | null;
  requiredLevel?: RequiredLevel;
  aliases?: string[];
  enumValues?: string[];
  semanticRole?: string;
  usedByMetrics?: string[];
  usedByBodies?: string[];
  validationRules?: Record<string, unknown>;
  normalizers?: string[];
};

export type DatasetTemplateSchemaDefinition = {
  templateKey: string;
  templateVersion: string;
  rowIdentityKeys?: string[];
  fallbackIdentityKeys?: string[];
  dimensionKeys?: string[];
  coverageByBody?: Record<string, string[]>;
  availableVariants?: TemplateVariant[];
  guide?: {
    ownerOffice: string;
    summary: string;
    minimumDataHint: string;
    supportsPartialUpload: boolean;
    supportedMetrics: readonly string[];
  };
  columns: DatasetTemplateColumnDefinition[];
};

export type CuratedSourcePackDefinition = {
  domainCode: string;
  code: string;
  name: string;
  description: string;
  kind: "CSV_IMPORT" | "MANUAL" | "INTERNAL_ADAPTER" | "DOCUMENT" | "NARRATIVE";
  shape: "DATASET" | "SCALAR" | "NARRATIVE" | "DOCUMENT_REF";
  supportsScopeBreakdown: boolean;
  sortOrder: number;
  datasetSchema?: DatasetTemplateSchemaDefinition;
  adapterKey?: string;
};

function col(
  key: string,
  label: string,
  description: string,
  options: Partial<DatasetTemplateColumnDefinition> = {},
): DatasetTemplateColumnDefinition {
  return {
    key,
    label,
    description,
    type: options.type ?? "TEXT",
    sample: options.sample ?? null,
    requiredLevel: options.requiredLevel ?? "OPTIONAL",
    aliases: options.aliases ?? [],
    enumValues: options.enumValues ?? [],
    semanticRole: options.semanticRole,
    usedByMetrics: options.usedByMetrics ?? [],
    usedByBodies: options.usedByBodies ?? ["NAAC"],
    validationRules: options.validationRules,
    normalizers: options.normalizers ?? [],
  };
}

function schema(
  templateKey: string,
  guide: NonNullable<DatasetTemplateSchemaDefinition["guide"]>,
  columns: DatasetTemplateColumnDefinition[],
  extra: Partial<DatasetTemplateSchemaDefinition> = {},
): DatasetTemplateSchemaDefinition {
  return {
    templateKey,
    templateVersion: "2026.04.v1",
    rowIdentityKeys: extra.rowIdentityKeys ?? [],
    fallbackIdentityKeys: extra.fallbackIdentityKeys ?? [],
    dimensionKeys: extra.dimensionKeys ?? [],
    coverageByBody: extra.coverageByBody ?? { NAAC: [...guide.supportedMetrics] },
    availableVariants: extra.availableVariants ?? ["MINIMAL", "STANDARD", "FULL"],
    guide,
    columns,
  };
}

const hrGuide = {
  ownerOffice: "HR / Registrar Office",
  summary: "Use this for full-time teaching staff, qualifications, experience, and department mapping.",
  minimumDataHint: "At minimum upload one row per faculty member with an employee code, name, department, and qualification.",
  supportsPartialUpload: true,
  supportedMetrics: ["2.2.2", "2.4.1", "2.4.2", "2.4.3", "NAAC faculty readiness"],
} as const;

const studentGuide = {
  ownerOffice: "Admissions / Academic Office",
  summary: "Use this for student enrolment, progression, and graduating-batch denominators.",
  minimumDataHint: "At minimum upload student ID, programme, department, year, and enrolment or outgoing status.",
  supportsPartialUpload: true,
  supportedMetrics: ["2.1.1", "2.1.2", "2.2.2", "5.2.2", "5.2.3"],
} as const;

const placementGuide = {
  ownerOffice: "Placement Cell",
  summary: "Use this for outgoing students, placements, higher studies, and related outcomes.",
  minimumDataHint: "At minimum upload student ID, graduating batch, outgoing flag, and placed flag.",
  supportsPartialUpload: true,
  supportedMetrics: ["5.2.2", "5.2.3", "NAAC placement outcomes"],
} as const;

const publicationGuide = {
  ownerOffice: "Research Cell / Library",
  summary: "Use this for faculty publications, indexing, citations, and journal quality fields.",
  minimumDataHint: "At minimum upload publication title, year, publication type, and one faculty author identifier.",
  supportsPartialUpload: true,
  supportedMetrics: ["3.4.5", "3.4.6", "3.4.8", "3.4.9"],
} as const;

const financeGuide = {
  ownerOffice: "Finance Office",
  summary: "Use this for year-wise income, expenditure, grants, and category-level spending.",
  minimumDataHint: "At minimum upload a year, transaction ID, category, amount, and salary flag.",
  supportsPartialUpload: true,
  supportedMetrics: ["4.1.4", "4.2.3", "4.4.1", "6.4.2", "6.4.3"],
} as const;

const programGuide = {
  ownerOffice: "Academic Planning / Dean Office",
  summary: "Use this for programmes, courses, CBCS status, new courses, and revision tracking.",
  minimumDataHint: "At minimum upload programme code, programme name, course code, course name, and active year.",
  supportsPartialUpload: true,
  supportedMetrics: ["1.1.2", "1.1.3", "1.2.1", "1.2.2", "1.3.2"],
} as const;

const examGuide = {
  ownerOffice: "Examination Cell",
  summary: "Use this for appeared, passed, complaints, and result-declaration timelines.",
  minimumDataHint: "At minimum upload student ID, exam term, exam end date, result date, and pass status.",
  supportsPartialUpload: true,
  supportedMetrics: ["2.5.1", "2.5.2", "2.6.3"],
} as const;

const infraGuide = {
  ownerOffice: "IT / Estate / Facilities",
  summary: "Use this for classrooms, computers, ICT-enabled rooms, bandwidth, and infrastructure assets.",
  minimumDataHint: "At minimum upload asset or room ID, asset type, department or campus, and working status.",
  supportsPartialUpload: true,
  supportedMetrics: ["4.1.1", "4.3.1", "4.3.3", "4.3.4"],
} as const;

const libraryGuide = {
  ownerOffice: "Library",
  summary: "Use this for subscriptions, spending, resource availability, and library usage.",
  minimumDataHint: "At minimum upload resource type, subscription or purchase amount, and usage or login counts.",
  supportsPartialUpload: true,
  supportedMetrics: ["4.2.2", "4.2.3", "4.2.4"],
} as const;

const supportGuide = {
  ownerOffice: "Student Affairs / Scholarships Office",
  summary: "Use this for scholarships, counselling, capacity building, and support interventions.",
  minimumDataHint: "At minimum upload student ID, support type, provider, year, and amount or participation flag.",
  supportsPartialUpload: true,
  supportedMetrics: ["5.1.1", "5.1.2", "5.1.3", "5.1.4"],
} as const;

const achievementGuide = {
  ownerOffice: "IQAC / Research / Extension Cell",
  summary: "Use this for awards, workshops, extension, collaborations, FDPs, consultancy, and MoUs.",
  minimumDataHint: "At minimum upload activity type, title, start date, and organizing unit or participant info.",
  supportsPartialUpload: true,
  supportedMetrics: ["3.1.3", "3.3.2", "3.3.3", "3.6.2", "3.6.3", "3.7.1", "3.7.2", "6.3.2", "6.3.3", "6.3.4"],
} as const;

export const curatedSourcePacks: CuratedSourcePackDefinition[] = [
  {
    domainCode: "HUMAN_RESOURCES",
    code: "HR_FACULTY_ROSTER",
    name: "HR Faculty Roster",
    description: "Guided faculty roster for NAAC and other accreditation metrics.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: true,
    sortOrder: 0,
    datasetSchema: schema(
      "HR_FACULTY_ROSTER",
      hrGuide,
      [
        col("employeeCode", "Employee Code", "Unique faculty or employee code from HR.", { requiredLevel: "CORE", sample: "EMP-1001", aliases: ["employee_id", "faculty_id", "staff_code"], semanticRole: "ROW_ID", normalizers: ["trim", "upper"], usedByMetrics: ["2.4.1", "2.4.2", "2.4.3"] }),
        col("facultyName", "Faculty Name", "Full name of the faculty member.", { requiredLevel: "CORE", sample: "Dr Riya Sharma", aliases: ["employee_name", "name", "faculty_name"] }),
        col("departmentName", "Department", "Owning department or school.", { requiredLevel: "CORE", sample: "Computer Science", aliases: ["department", "dept_name", "school_name"], semanticRole: "DIMENSION" }),
        col("fullTimeFlag", "Full-time", "Whether the faculty member is full-time.", { type: "BOOLEAN", requiredLevel: "CORE", sample: true, aliases: ["is_full_time", "full_time", "fulltime"], normalizers: ["boolean"] }),
        col("highestQualification", "Highest Qualification", "Highest qualification as recorded by HR.", { requiredLevel: "RECOMMENDED", sample: "PhD", aliases: ["qualification", "highest_degree", "degree"] }),
        col("phdEquivalentFlag", "PhD or Equivalent", "Mark Yes if the qualification counts for doctorate-equivalent NAAC rules.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: true, aliases: ["phd_flag", "doctorate_flag"], normalizers: ["boolean"], usedByMetrics: ["2.4.2"] }),
        col("dateOfJoining", "Date of Joining", "Joining date in the institution.", { type: "DATE", requiredLevel: "RECOMMENDED", sample: "2018-07-01", aliases: ["joining_date", "doj"], normalizers: ["date"] }),
        col("experienceInInstitutionYears", "Experience in Institution (Years)", "Years served in the same institution.", { type: "NUMBER", requiredLevel: "RECOMMENDED", sample: 7, aliases: ["institution_experience", "years_in_institution"], normalizers: ["number"], usedByMetrics: ["2.4.3"] }),
        col("sanctionedPostCode", "Sanctioned Post Code", "Sanctioned post or position code, if available.", { requiredLevel: "OPTIONAL", sample: "POST-021", aliases: ["post_code", "sanctioned_post"] }),
        col("mentorFlag", "Mentor Assigned", "Whether the faculty member is acting as a mentor.", { type: "BOOLEAN", requiredLevel: "OPTIONAL", sample: true, aliases: ["mentor", "is_mentor"], normalizers: ["boolean"], usedByMetrics: ["2.3.3"] }),
      ],
      { rowIdentityKeys: ["employeeCode"], fallbackIdentityKeys: ["facultyName", "departmentName"] },
    ),
  },
  {
    domainCode: "STUDENT_AFFAIRS",
    code: "STUDENT_LIFECYCLE_REGISTER",
    name: "Student Lifecycle Register",
    description: "Student-level enrolment, batch, programme, and outgoing-status dataset.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: true,
    sortOrder: 10,
    datasetSchema: schema(
      "STUDENT_LIFECYCLE_REGISTER",
      studentGuide,
      [
        col("studentId", "Student ID", "Unique student identifier.", { requiredLevel: "CORE", sample: "STU-2001", aliases: ["roll_no", "registration_no", "enrollment_no"], semanticRole: "ROW_ID", usedByMetrics: ["2.2.2", "5.2.2", "5.2.3"] }),
        col("studentName", "Student Name", "Full student name.", { requiredLevel: "CORE", sample: "Aditi Singh", aliases: ["name", "student_name"] }),
        col("programCode", "Programme Code", "Programme or course code.", { requiredLevel: "CORE", sample: "BTECH-CSE", aliases: ["program_id", "programme_code", "course_code"], semanticRole: "DIMENSION" }),
        col("departmentName", "Department", "Department or school.", { requiredLevel: "CORE", sample: "Computer Science", aliases: ["department", "dept_name"], semanticRole: "DIMENSION" }),
        col("academicYearLabel", "Academic Year", "Academic year label such as 2024-25.", { requiredLevel: "CORE", sample: "2024-25", aliases: ["academic_year", "session"], semanticRole: "PERIOD" }),
        col("yearOfStudy", "Year of Study", "Current year or semester grouping.", { type: "NUMBER", requiredLevel: "RECOMMENDED", sample: 4, aliases: ["study_year", "semester_year"], normalizers: ["number"] }),
        col("enrolledFlag", "Currently Enrolled", "Whether the student was enrolled in the reported year.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: true, aliases: ["enrolled", "is_enrolled"], normalizers: ["boolean"] }),
        col("outgoingFlag", "Outgoing Student", "Whether the student belongs to the outgoing / graduating batch.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: true, aliases: ["graduating", "final_year", "outgoing"], normalizers: ["boolean"], usedByMetrics: ["5.2.2", "5.2.3"] }),
        col("graduationYear", "Graduation Year", "Expected or actual graduation year.", { type: "NUMBER", requiredLevel: "OPTIONAL", sample: 2025, aliases: ["passout_year", "completion_year"], normalizers: ["number"] }),
      ],
      { rowIdentityKeys: ["studentId"], fallbackIdentityKeys: ["studentName", "programCode", "academicYearLabel"] },
    ),
  },
  {
    domainCode: "STUDENT_AFFAIRS",
    code: "PLACEMENT_LIST",
    name: "Placement Outcomes Register",
    description: "Placement, higher-studies, and outgoing-student outcomes dataset.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: true,
    sortOrder: 20,
    datasetSchema: schema(
      "PLACEMENT_LIST",
      placementGuide,
      [
        col("studentId", "Student ID", "Unique student identifier.", { requiredLevel: "CORE", sample: "STU-2001", aliases: ["roll_no", "registration_no"], semanticRole: "ROW_ID", usedByMetrics: ["5.2.2", "5.2.3"] }),
        col("graduatingBatch", "Graduating Batch", "Graduating batch or year.", { requiredLevel: "CORE", sample: "2024", aliases: ["batch", "passout_batch", "graduation_batch"], semanticRole: "PERIOD" }),
        col("outgoingFlag", "Outgoing Student", "Whether this row belongs to an outgoing student.", { type: "BOOLEAN", requiredLevel: "CORE", sample: true, aliases: ["outgoing", "graduating"], normalizers: ["boolean"], usedByMetrics: ["5.2.2", "5.2.3"] }),
        col("placedFlag", "Placed", "Whether the student received and accepted a placement.", { type: "BOOLEAN", requiredLevel: "CORE", sample: true, aliases: ["placed", "placement_status"], normalizers: ["boolean"], usedByMetrics: ["5.2.2"] }),
        col("employerName", "Employer", "Employer or organization name.", { requiredLevel: "RECOMMENDED", sample: "TCS", aliases: ["company", "organization"] }),
        col("ctc", "Annual CTC", "Annual salary or package amount.", { type: "CURRENCY", requiredLevel: "OPTIONAL", sample: 650000, aliases: ["salary", "package", "annual_ctc"], normalizers: ["currency"] }),
        col("higherStudiesFlag", "Higher Studies", "Whether the student moved to higher education.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: false, aliases: ["higher_studies", "progressed_to_higher_education"], normalizers: ["boolean"], usedByMetrics: ["5.2.3"] }),
        col("higherStudiesInstitution", "Higher Studies Institution", "Institution joined for higher studies.", { requiredLevel: "OPTIONAL", sample: "IIT Delhi", aliases: ["higher_studies_institute", "pg_institution"] }),
      ],
      { rowIdentityKeys: ["studentId"], fallbackIdentityKeys: ["studentId", "graduatingBatch"] },
    ),
  },
  {
    domainCode: "RESEARCH_INNOVATION",
    code: "PUBLICATION_REGISTER",
    name: "Publication Register",
    description: "Research publication register with indexing and citation metadata.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: true,
    sortOrder: 30,
    datasetSchema: schema(
      "PUBLICATION_REGISTER",
      publicationGuide,
      [
        col("publicationId", "Publication ID", "Unique publication identifier if available.", { requiredLevel: "RECOMMENDED", sample: "PUB-001", aliases: ["record_id", "paper_id"], semanticRole: "ROW_ID" }),
        col("title", "Title", "Publication title.", { requiredLevel: "CORE", sample: "A Study on Learning Analytics", aliases: ["paper_title", "article_title"], usedByMetrics: ["3.4.5", "3.4.6"] }),
        col("publicationYear", "Publication Year", "Year of publication.", { type: "NUMBER", requiredLevel: "CORE", sample: 2024, aliases: ["year", "published_year"], normalizers: ["number"], semanticRole: "PERIOD" }),
        col("publicationType", "Publication Type", "Journal article, book chapter, book, conference paper, etc.", { type: "ENUM", requiredLevel: "CORE", sample: "Journal Article", aliases: ["type", "document_type"], enumValues: ["Journal Article", "Book", "Book Chapter", "Conference Paper"] }),
        col("facultyAuthorIds", "Faculty Author IDs", "Pipe or comma-separated faculty author identifiers.", { requiredLevel: "CORE", sample: "EMP-1001|EMP-1002", aliases: ["authors", "faculty_ids"], usedByMetrics: ["3.4.5", "3.4.6"] }),
        col("ugcCareFlag", "UGC-CARE Listed", "Whether the journal is UGC-CARE or equivalent accepted list.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: true, aliases: ["ugc_listed", "ugc_care"], normalizers: ["boolean"], usedByMetrics: ["3.4.5"] }),
        col("indexedScopusFlag", "Scopus Indexed", "Whether the publication is indexed in Scopus.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: true, aliases: ["scopus_indexed", "scopus"], normalizers: ["boolean"], usedByMetrics: ["3.4.8", "3.4.9"] }),
        col("citationCount", "Citation Count", "Current citation count.", { type: "NUMBER", requiredLevel: "OPTIONAL", sample: 12, aliases: ["citations", "total_citations"], normalizers: ["number"], usedByMetrics: ["3.4.8"] }),
        col("journalOrBookTitle", "Journal / Book Title", "Journal or book name.", { requiredLevel: "OPTIONAL", sample: "Journal of Educational Data" }),
      ],
      { rowIdentityKeys: ["publicationId"], fallbackIdentityKeys: ["title", "publicationYear"] },
    ),
  },
  {
    domainCode: "FINANCE",
    code: "FINANCE_LEDGER",
    name: "Finance Ledger",
    description: "Year-wise finance ledger for grants, expenditure, and budget categories.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: true,
    sortOrder: 40,
    datasetSchema: schema(
      "FINANCE_LEDGER",
      financeGuide,
      [
        col("transactionId", "Transaction ID", "Voucher or transaction identifier.", { requiredLevel: "CORE", sample: "FIN-0001", aliases: ["voucher_no", "entry_id"], semanticRole: "ROW_ID" }),
        col("fiscalYear", "Financial Year", "Financial or audit year label.", { requiredLevel: "CORE", sample: "2024-25", aliases: ["financial_year", "fy"], semanticRole: "PERIOD" }),
        col("ledgerCategory", "Ledger Category", "Broad category such as infrastructure, library, salary, or grant.", { requiredLevel: "CORE", sample: "Infrastructure", aliases: ["category", "head"], usedByMetrics: ["4.1.4", "4.2.3", "4.4.1", "6.4.2", "6.4.3"] }),
        col("amount", "Amount", "Transaction amount.", { type: "CURRENCY", requiredLevel: "CORE", sample: 1250000, aliases: ["value", "inr_amount"], normalizers: ["currency"], usedByMetrics: ["4.1.4", "4.2.3", "4.4.1", "6.4.2", "6.4.3"] }),
        col("salaryComponentFlag", "Salary Component", "Mark Yes if this line item is salary-related.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: false, aliases: ["salary_flag", "salary_component"], normalizers: ["boolean"], usedByMetrics: ["4.1.4", "4.4.1"] }),
        col("fundSourceType", "Fund Source Type", "Government, non-government, internal, or other funding source.", { type: "ENUM", requiredLevel: "RECOMMENDED", sample: "Government", aliases: ["fund_source", "grant_source"], enumValues: ["Government", "Non-Government", "Internal", "Other"], usedByMetrics: ["6.4.2", "6.4.3"] }),
        col("direction", "Direction", "Income or expenditure.", { type: "ENUM", requiredLevel: "RECOMMENDED", sample: "Expenditure", aliases: ["txn_type", "entry_type"], enumValues: ["Income", "Expenditure"] }),
        col("departmentName", "Department", "Department or cost center if available.", { requiredLevel: "OPTIONAL", sample: "Central Library", aliases: ["department", "cost_center"], semanticRole: "DIMENSION" }),
      ],
      { rowIdentityKeys: ["transactionId"], fallbackIdentityKeys: ["fiscalYear", "ledgerCategory", "amount"] },
    ),
  },
  {
    domainCode: "ACADEMIC_PROGRAMS",
    code: "PROGRAM_COURSE_CATALOG",
    name: "Academic Programs & Courses",
    description: "Programme and course catalog for CBCS, new courses, and revision tracking.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: true,
    sortOrder: 50,
    datasetSchema: schema(
      "PROGRAM_COURSE_CATALOG",
      programGuide,
      [
        col("programCode", "Programme Code", "Programme identifier.", { requiredLevel: "CORE", sample: "BTECH-CSE", aliases: ["programme_code", "program_id"], semanticRole: "DIMENSION", usedByMetrics: ["1.2.2"] }),
        col("programName", "Programme Name", "Programme name.", { requiredLevel: "CORE", sample: "B.Tech Computer Science", aliases: ["programme_name", "program_title"] }),
        col("courseCode", "Course Code", "Course identifier.", { requiredLevel: "CORE", sample: "CSE401", aliases: ["subject_code", "paper_code"], usedByMetrics: ["1.1.2", "1.2.1", "1.1.3"] }),
        col("courseName", "Course Name", "Course name.", { requiredLevel: "CORE", sample: "Machine Learning", aliases: ["subject_name", "paper_name"] }),
        col("academicYearLabel", "Academic Year", "Academic year label for which the course catalog applies.", { requiredLevel: "CORE", sample: "2024-25", aliases: ["academic_year", "session"], semanticRole: "PERIOD" }),
        col("cbcsFlag", "CBCS / Elective Enabled", "Mark Yes if CBCS or elective system is implemented for the programme.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: true, aliases: ["cbcs", "elective_system"], normalizers: ["boolean"], usedByMetrics: ["1.2.2"] }),
        col("newCourseFlag", "New Course Introduced", "Mark Yes for newly introduced courses in the year.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: true, aliases: ["new_course", "introduced_this_year"], normalizers: ["boolean"], usedByMetrics: ["1.2.1"] }),
        col("syllabusRevisionFlag", "Syllabus Revised", "Mark Yes if the syllabus was revised in the year.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: false, aliases: ["revised", "syllabus_updated"], normalizers: ["boolean"], usedByMetrics: ["1.1.2"] }),
        col("skillDevelopmentFlag", "Skill Development Focus", "Mark Yes if the course focuses on employability, entrepreneurship, or skill development.", { type: "BOOLEAN", requiredLevel: "OPTIONAL", sample: true, aliases: ["skill_focus", "employability_focus"], normalizers: ["boolean"], usedByMetrics: ["1.1.3"] }),
      ],
      { rowIdentityKeys: ["programCode", "courseCode", "academicYearLabel"] },
    ),
  },
  {
    domainCode: "ACADEMIC_PROGRAMS",
    code: "EXAM_RESULTS_REGISTER",
    name: "Exam Results Register",
    description: "Exam and result data for pass percentage, grievances, and declaration timelines.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: true,
    sortOrder: 60,
    datasetSchema: schema(
      "EXAM_RESULTS_REGISTER",
      examGuide,
      [
        col("studentId", "Student ID", "Unique student identifier.", { requiredLevel: "CORE", sample: "STU-2001", aliases: ["roll_no", "registration_no"], semanticRole: "ROW_ID", usedByMetrics: ["2.6.3"] }),
        col("examTerm", "Exam Term", "Term, semester, or exam cycle name.", { requiredLevel: "CORE", sample: "Semester 8", aliases: ["term", "semester"] }),
        col("examEndDate", "Exam End Date", "Last date of the exam cycle.", { type: "DATE", requiredLevel: "CORE", sample: "2025-05-10", aliases: ["last_exam_date"], normalizers: ["date"], usedByMetrics: ["2.5.1"] }),
        col("resultDeclaredDate", "Result Declared Date", "Date when the result was declared.", { type: "DATE", requiredLevel: "CORE", sample: "2025-06-01", aliases: ["result_date", "declaration_date"], normalizers: ["date"], usedByMetrics: ["2.5.1"] }),
        col("appearedFlag", "Appeared", "Whether the student appeared for the exam.", { type: "BOOLEAN", requiredLevel: "CORE", sample: true, aliases: ["appeared", "exam_appeared"], normalizers: ["boolean"], usedByMetrics: ["2.6.3"] }),
        col("passedFlag", "Passed", "Whether the student passed.", { type: "BOOLEAN", requiredLevel: "CORE", sample: true, aliases: ["passed", "result_status"], normalizers: ["boolean"], usedByMetrics: ["2.6.3"] }),
        col("complaintFlag", "Evaluation Complaint", "Whether the student filed an evaluation complaint.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: false, aliases: ["grievance", "complaint"], normalizers: ["boolean"], usedByMetrics: ["2.5.2"] }),
      ],
      { rowIdentityKeys: ["studentId", "examTerm"] },
    ),
  },
  {
    domainCode: "INFRASTRUCTURE",
    code: "INFRA_ICT_ASSET_REGISTER",
    name: "Infrastructure & ICT Register",
    description: "Room, computer, and ICT asset register for infrastructure metrics.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: true,
    sortOrder: 70,
    datasetSchema: schema(
      "INFRA_ICT_ASSET_REGISTER",
      infraGuide,
      [
        col("assetOrRoomId", "Asset / Room ID", "Unique asset or room identifier.", { requiredLevel: "CORE", sample: "ROOM-101", aliases: ["asset_id", "room_id"], semanticRole: "ROW_ID" }),
        col("assetType", "Asset Type", "Room, classroom, seminar hall, computer, router, etc.", { requiredLevel: "CORE", sample: "Classroom", aliases: ["type", "resource_type"], usedByMetrics: ["4.3.1", "4.3.3", "4.3.4"] }),
        col("departmentName", "Department / Campus", "Owning unit, department, or campus.", { requiredLevel: "CORE", sample: "Engineering Block", aliases: ["department", "campus", "location"], semanticRole: "DIMENSION" }),
        col("workingFlag", "Working", "Whether the asset is currently working.", { type: "BOOLEAN", requiredLevel: "CORE", sample: true, aliases: ["is_working", "active"], normalizers: ["boolean"] }),
        col("studentAccessibleFlag", "Student Accessible", "Whether students can directly use this resource.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: true, aliases: ["student_access", "accessible_to_students"], normalizers: ["boolean"], usedByMetrics: ["4.3.3"] }),
        col("ictEnabledFlag", "ICT Enabled", "Whether the room has ICT-enabled facilities.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: true, aliases: ["ict_enabled", "smart_class"], normalizers: ["boolean"], usedByMetrics: ["4.3.1"] }),
        col("bandwidthMbps", "Bandwidth (Mbps)", "Bandwidth available to the asset or location.", { type: "NUMBER", requiredLevel: "OPTIONAL", sample: 200, aliases: ["bandwidth", "internet_bandwidth"], normalizers: ["number"], usedByMetrics: ["4.3.4"] }),
      ],
      { rowIdentityKeys: ["assetOrRoomId"] },
    ),
  },
  {
    domainCode: "INFRASTRUCTURE",
    code: "LIBRARY_RESOURCE_USAGE_REGISTER",
    name: "Library Resources & Usage",
    description: "Library resource, subscription, spending, and usage log dataset.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: false,
    sortOrder: 80,
    datasetSchema: schema(
      "LIBRARY_RESOURCE_USAGE_REGISTER",
      libraryGuide,
      [
        col("recordId", "Record ID", "Unique record or log identifier.", { requiredLevel: "RECOMMENDED", sample: "LIB-0001", aliases: ["resource_id", "usage_id"], semanticRole: "ROW_ID" }),
        col("resourceType", "Resource Type", "Books, journals, e-books, e-journals, logins, or footfall.", { requiredLevel: "CORE", sample: "E-Journal", aliases: ["type", "library_resource_type"], usedByMetrics: ["4.2.2", "4.2.3", "4.2.4"] }),
        col("recordDate", "Record Date", "Date of purchase, subscription, or usage.", { type: "DATE", requiredLevel: "CORE", sample: "2025-01-10", aliases: ["date", "usage_date", "subscription_date"], normalizers: ["date"], semanticRole: "PERIOD" }),
        col("amount", "Amount", "Subscription or purchase amount.", { type: "CURRENCY", requiredLevel: "RECOMMENDED", sample: 54000, aliases: ["cost", "subscription_cost"], normalizers: ["currency"], usedByMetrics: ["4.2.3"] }),
        col("usageCount", "Usage Count", "Footfall count or online login count.", { type: "NUMBER", requiredLevel: "RECOMMENDED", sample: 180, aliases: ["logins", "footfall", "count"], normalizers: ["number"], usedByMetrics: ["4.2.4"] }),
        col("subscriptionActiveFlag", "Active Subscription", "Whether the subscription is active.", { type: "BOOLEAN", requiredLevel: "OPTIONAL", sample: true, aliases: ["active", "subscribed"], normalizers: ["boolean"], usedByMetrics: ["4.2.2"] }),
      ],
      { rowIdentityKeys: ["recordId"], fallbackIdentityKeys: ["resourceType", "recordDate"] },
    ),
  },
  {
    domainCode: "STUDENT_AFFAIRS",
    code: "STUDENT_SUPPORT_REGISTER",
    name: "Student Support Register",
    description: "Scholarships, counselling, capacity building, and support interventions.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: true,
    sortOrder: 90,
    datasetSchema: schema(
      "STUDENT_SUPPORT_REGISTER",
      supportGuide,
      [
        col("studentId", "Student ID", "Unique student identifier.", { requiredLevel: "CORE", sample: "STU-2001", aliases: ["roll_no", "registration_no"], semanticRole: "ROW_ID", usedByMetrics: ["5.1.1", "5.1.2", "5.1.3", "5.1.4"] }),
        col("academicYearLabel", "Academic Year", "Academic year of the support event.", { requiredLevel: "CORE", sample: "2024-25", aliases: ["academic_year", "session"], semanticRole: "PERIOD" }),
        col("supportType", "Support Type", "Scholarship, counselling, skill enhancement, grievance redressal, etc.", { requiredLevel: "CORE", sample: "Scholarship", aliases: ["scheme_type", "service_type"], usedByMetrics: ["5.1.1", "5.1.2", "5.1.3", "5.1.4"] }),
        col("providerType", "Provider", "Institution, Government, NGO, or other provider.", { requiredLevel: "RECOMMENDED", sample: "Government", aliases: ["provider", "agency"], usedByMetrics: ["5.1.1"] }),
        col("amount", "Amount", "Scholarship or financial support amount, if applicable.", { type: "CURRENCY", requiredLevel: "OPTIONAL", sample: 25000, aliases: ["value", "support_amount"], normalizers: ["currency"] }),
        col("participationFlag", "Participated / Benefited", "Whether the student benefited from the activity or scheme.", { type: "BOOLEAN", requiredLevel: "RECOMMENDED", sample: true, aliases: ["benefited", "participated"], normalizers: ["boolean"], usedByMetrics: ["5.1.1", "5.1.2"] }),
      ],
      { rowIdentityKeys: ["studentId", "supportType", "academicYearLabel"] },
    ),
  },
  {
    domainCode: "RESEARCH_INNOVATION",
    code: "VERIFIED_ACHIEVEMENT_REGISTRY",
    name: "Activities & Achievements Register",
    description: "Awards, workshops, extension, collaborations, FDPs, consultancy, and MoUs.",
    kind: "CSV_IMPORT",
    shape: "DATASET",
    supportsScopeBreakdown: true,
    sortOrder: 100,
    datasetSchema: schema(
      "VERIFIED_ACHIEVEMENT_REGISTRY",
      achievementGuide,
      [
        col("activityId", "Activity ID", "Unique activity or achievement identifier.", { requiredLevel: "RECOMMENDED", sample: "ACT-001", aliases: ["achievement_id", "event_id"], semanticRole: "ROW_ID" }),
        col("activityType", "Activity Type", "Workshop, Award, Outreach, FDP, MoU, Consultancy, Collaboration, etc.", { requiredLevel: "CORE", sample: "Workshop", aliases: ["type", "category"], usedByMetrics: ["3.3.2", "3.3.3", "3.6.2", "3.6.3", "3.7.1", "3.7.2", "6.3.2", "6.3.3", "6.3.4"] }),
        col("title", "Title", "Activity or achievement title.", { requiredLevel: "CORE", sample: "Research Methodology Workshop", aliases: ["activity_title", "event_title"] }),
        col("startDate", "Start Date", "Start date of the activity.", { type: "DATE", requiredLevel: "CORE", sample: "2025-02-10", aliases: ["event_date", "date"], normalizers: ["date"], semanticRole: "PERIOD" }),
        col("organizingUnit", "Organizing Unit", "Department, cell, or office that organized or owns the record.", { requiredLevel: "RECOMMENDED", sample: "IQAC", aliases: ["department", "unit"] }),
        col("recognitionLevel", "Recognition Level", "Institutional, State, National, or International.", { type: "ENUM", requiredLevel: "OPTIONAL", sample: "National", aliases: ["level"], enumValues: ["Institutional", "State", "National", "International"], usedByMetrics: ["3.3.3", "3.6.2"] }),
        col("participantCount", "Participant Count", "Total participant count, if known.", { type: "NUMBER", requiredLevel: "OPTIONAL", sample: 42, aliases: ["participants", "total_participants"], normalizers: ["number"], usedByMetrics: ["3.6.3", "6.3.3"] }),
        col("functionalFlag", "Functional / Active", "Whether the MoU, collaboration, or scheme is functional.", { type: "BOOLEAN", requiredLevel: "OPTIONAL", sample: true, aliases: ["active", "functional"], normalizers: ["boolean"], usedByMetrics: ["3.7.2"] }),
      ],
      { rowIdentityKeys: ["activityId"], fallbackIdentityKeys: ["activityType", "title", "startDate"] },
    ),
  },
];
