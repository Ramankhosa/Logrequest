import fs from "node:fs";
import path from "node:path";

const defaultInputPath = "C:/Users/raman/Downloads/naac_university_115_metrics_full.json";
const defaultCheckedPath = "C:/Users/raman/Downloads/naac_university_115_metrics_checked.json";
const defaultImportPath = "C:/Users/raman/Downloads/naac_university_template_import_final.json";

const titleOverrides = {
  "1.1.1":
    "Curricula developed and implemented have relevance to the local, national, regional and global developmental needs which is reflected in Programme Outcomes (POs), Programme Specific Outcomes (PSOs) and Course Outcomes (COs) of the Programmes offered by the University",
  "1.1.3":
    "Average percentage of courses having focus on employability/ entrepreneurship/ skill development offered by the University",
  "1.2.1":
    "Percentage of new courses introduced of the total number of courses across all programmes offered during the last five years",
  "1.2.2":
    "Percentage of Programmes in which Choice Based Credit System (CBCS)/ elective course system has been implemented (Data for the latest completed academic year)",
  "1.3.1":
    "Institution integrates crosscutting issues relevant to Professional Ethics, Gender, Human Values, Environment and Sustainability into the Curriculum",
  "1.3.2":
    "Number of value-added courses for imparting transferable and life skills offered during the last five years",
  "1.3.4":
    "Percentage of students undertaking field projects / research projects / internships (Data for the latest completed academic year)",
  "1.4.1":
    "Structured feedback for design and review of syllabus - semester wise / year wise is received from 1) Students, 2) Teachers, 3) Employers, 4) Alumni",
  "1.4.2": "Feedback processes of the institution may be classified as follows",
  "2.1.2":
    "Average percentage of seats filled against reserved categories (SC, ST, OBC, Divyangjan, etc.) as per applicable reservation policy during the last five years (Excluding Supernumerary Seats)",
  "2.2.1":
    "The institution assesses the learning levels of the students and organises special Programmes for advanced learners and slow learners.",
  "2.2.2": "Student - Full time teacher ratio (Data for the latest completed academic year)",
  "2.3.1":
    "Student centric methods, such as experiential learning, participative learning and problem solving methodologies are used for enhancing learning experiences",
  "2.3.2":
    "Teachers use ICT enabled tools including online resources for effective teaching and learning processes",
  "2.3.3": "Ratio of students to mentor for academic and other related issues (Data for the latest completed academic year data)",
  "2.4.1": "Average percentage of full time teachers against sanctioned posts during the last five years",
  "2.4.2":
    "Average percentage of full time teachers with Ph.D./D.M/M.Ch./D.N.B Superspeciality/D.Sc./D'Lit. during the last five years",
  "2.4.3":
    "Average teaching experience of full time teachers in the same institution (Data for the latest completed academic year in number of years)",
  "2.4.4":
    "Average percentage of full time teachers who received awards, recognition, fellowships at State, National, International level from Government/Govt. recognised bodies during the last five years",
  "2.5.1":
    "Average number of days from the date of last semester-end/ year-end examination till the declaration of results during the last five years",
  "2.5.2":
    "Average percentage of student complaints/grievances about evaluation against total number appeared in the examinations during the last five years",
  "2.5.3":
    "IT integration and reforms in the examination procedures and processes (continuous internal assessment and end-semester assessment) have brought in considerable improvement in examination management system of the institution",
  "2.5.4": "Status of automation of Examination division along with approved Examination Manual",
  "2.6.1":
    "The institution has stated learning outcomes (generic and programme specific)/graduate attributes which are integrated into the assessment process and widely publicized through the website and other documents",
  "2.6.2": "Attainment of Programme outcomes, Programme specific outcomes and course outcomes are evaluated by the institution",
  "2.7.1": "Online student satisfaction survey regarding teaching learning process. (Online survey to be conducted)",
  "3.1.1":
    "The institution research facilities are frequently updated and there is well defined policy for promotion of research which is uploaded on the institutional website and implemented",
  "3.1.2": "The institution provides seed money to its teachers for research (average per year INR in Lakhs)",
  "3.1.3":
    "Percentage of teachers receiving national/ international fellowship/ financial support by various agencies for advanced studies / research during the last five years",
  "3.1.4":
    "Number of JRFs, SRFs, Post Doctoral Fellows, Research Associates and other research fellows enrolled in the institution during the last five years",
  "3.1.5": "Institution has the following facilities to support research",
  "3.1.6":
    "Percentage of departments with UGC-SAP, CAS, DST-FIST, DBT, ICSSR and other recognitions by national and international agencies (Data for the latest completed academic year)",
  "3.2.1":
    "Extramural funding for Research (Grants sponsored by the non-government sources such as industry, corporate houses, international bodies for research projects), endowments, Chairs in the University during the last five years (INR in Lakhs)",
  "3.2.2": "Grants for research projects sponsored by the government agencies during the last five years (INR in Lakhs)",
  "3.2.3": "Number of research projects per teacher funded by government and non-government agencies during the last five years",
  "3.3.1":
    "Institution has created an ecosystem for innovations including incubation centre and other initiatives for creation and transfer of knowledge",
  "3.3.2":
    "Number of workshops/seminars conducted on Research Methodology, Intellectual Property Rights (IPR), entrepreneurship, skill development during the last five years",
  "3.3.3":
    "Number of awards / recognitions received for research/ innovations by the institution/ teachers/ research scholars/ students during the last five years",
  "3.4.1": "The institution ensures implementation of its stated Code of Ethics for research",
  "3.4.2": "The institution provides incentives to teachers who receive state, national and international recognitions/ awards",
  "3.4.5": "Number of research papers per teacher in the Journals notified on UGC website during the last five years",
  "3.4.6": "Number of books and chapters in edited volumes published per teacher during the last five years",
  "3.4.7": "E-content is developed by teachers",
  "3.4.8": "Bibliometrics of the publications during the last five years based on average Citation Index in Scopus / Web of Science / PubMed",
  "3.4.9": "Bibliometrics of the publications during the last five years based on Scopus / Web of Science - h-index of the University",
  "3.5.1":
    "Institution has a policy on consultancy including revenue sharing between the institution and the individual and encourages its faculty to undertake consultancy",
  "3.5.2": "Revenue generated from consultancy and corporate training during the last five years (INR in Lakhs)",
  "3.6.1":
    "Extension activities in the neighbourhood community in terms of impact and sensitising students to social issues and holistic development during the last five years",
  "3.6.2":
    "Number of awards received by the Institution, its teachers and students from Government / Government recognised bodies in recognition of the extension activities carried out during the last five years",
  "3.6.3":
    "Number of extension and outreach programs conducted by the institution including those through NSS / NCC / Red Cross / YRC during the last five years (including Government initiated programs such as Swachh Bharat, Aids Awareness, Gender Issue, etc. and those organised in collaboration with industry, community and NGOs)",
  "3.6.4": "Average percentage of students participating in extension activities listed at 3.6.3 above during the last five years",
  "3.7.1": "Number of collaborative activities with other institutions / research establishments / industry for research and academic development of faculty and students per year",
  "3.7.2":
    "Number of functional MoUs with institutions/ industries in India and abroad for internship, on-the-job training, project work, student / faculty exchange and collaborative research during the last five years",
  "4.1.1": "The institution has adequate facilities for teaching-learning. viz., classrooms, laboratories, computing equipment, etc.",
  "4.1.2": "The institution has adequate facilities for cultural activities, yoga, games (indoor, outdoor) and sports. (gymnasium, yoga centre, auditorium, etc.)",
  "4.1.4": "Average percentage of expenditure excluding salary for infrastructure augmentation during the last five years (INR in Lakhs)",
  "4.2.1": "Library is automated using Integrated Library Management System (ILMS) and has digitisation facility",
  "4.2.2": "Institution has subscription for e-Library resources",
  "4.2.3": "Average annual expenditure for purchase of books/ e-books and subscription to journals/ e-journals during the last five years (INR in Lakhs)",
  "4.2.4": "Percentage per day usage of library by teachers and students (foot falls and login data for online access) (Data for the latest completed academic year)",
  "4.3.1":
    "Percentage of classrooms and seminar halls with ICT-enabled facilities such as LCD, smart board, Wi-Fi/LAN, audio video recording facilities (Data for the latest completed academic year)",
  "4.3.2":
    "Institution has an IT policy, makes appropriate budgetary provision and updates its IT facilities including Wi-Fi facility",
  "4.3.3": "Student - Computer ratio (Data for the latest completed academic year)",
  "4.3.4": "Available bandwidth of internet connection in the Institution (Leased line)",
  "4.3.5": "Institution has the following facilities for e-content development",
  "4.4.1":
    "Average percentage expenditure incurred on maintenance of physical facilities and academic support facilities excluding salary component during the last five years",
  "4.4.2":
    "There are established systems and procedures for maintaining and utilizing physical, academic and support facilities - laboratory, library, sports complex, computers, classrooms etc.",
  "5.1.1":
    "Average percentage of students benefited by scholarships and freeships provided by the institution, Government and non-government agencies (NGOs) during the last five years (other than the students receiving scholarships under the government schemes for reserved categories)",
  "5.1.2":
    "Average percentage of students benefited by career counseling and guidance for competitive examinations offered by the Institution during the last five years",
  "5.1.3": "Following capacity development and skills enhancement initiatives are taken by the institution",
  "5.1.4":
    "The Institution adopts the following for redressal of student grievances including sexual harassment and ragging cases",
  "5.2.1":
    "Average percentage of students qualifying in state/ national/ international level examinations during the last five years (eg: NET/SLET/GATE/GMAT/CAT/GRE/TOEFL/Civil Services/State government examinations)",
  "5.2.3": "Percentage of recently graduated students who have progressed to higher education (previous graduating batch)",
  "5.3.1":
    "Number of awards/ medals won by students for outstanding performance in sports/ cultural activities at inter-university/ state/ national/ international events (award for a team event should be counted as one) during the last five years",
  "5.3.2": "Presence of Student Council and its activities for institutional development and student welfare.",
  "5.3.3": "Average number of sports and cultural events / competitions organised by the institution per year",
  "5.4.1":
    "The Alumni Association / Chapters (registered and functional) contributes significantly to the development of the institution through financial and other support services during the last five years",
  "5.4.2": "Alumni contribution during the last five years (INR in Lakhs)",
};

const metricKindOverrides = {
  "5.3.2": "QlM",
};

const dataTypeOverrides = {
  "5.3.2": "QUALITATIVE",
};

const replacements = [
  [/Ther e/g, "There"],
  [/establishe d/g, "established"],
  [/s y s t e m s/g, "systems"],
  [/a n d/g, "and"],
  [/procedure s/g, "procedures"],
  [/ensu res/g, "ensures"],
  [/implem entation/g, "implementation"],
  [/ind ustry/g, "industry"],
  [/competitiv e/g, "competitive"],
  [/experientia l/g, "experiential"],
  [/participativ e/g, "participative"],
  [/nationa l/g, "national"],
  [/internationa l/g, "international"],
  [/recognitio ns/g, "recognitions"],
  [/non - government/g, "non-government"],
  [/non- government/g, "non-government"],
  [/end - semester/g, "end-semester"],
  [/Red cross/g, "Red Cross"],
  [/Confernces/g, "Conferences"],
  [/Q1M/g, "QlM"],
  [/Opt\s+one/gi, ""],
  [/1of/g, "1 of"],
  [/\u2013/g, "-"],
  [/\u2014/g, "-"],
  [/\s+/g, " "],
];

Object.assign(titleOverrides, {
  "6.1.1": "The institution has a clearly stated vision and mission which are reflected in its academic and administrative governance",
  "6.1.2": "The effective leadership is reflected in various institutional practices such as decentralization and participative management.",
  "6.2.2":
    "The functioning of the institutional bodies is effective and efficient as visible from policies, administrative setup, appointment and service rules, procedures, etc.",
  "6.2.3": "Institution implements e-governance in its areas of operations",
  "6.3.1": "The institution has a performance appraisal system, promotional avenues and effective welfare measures for teaching and non-teaching staff",
  "6.3.2":
    "Average percentage of teachers provided with financial support to attend conferences / workshops and towards membership fee of professional bodies during the last five years",
  "6.3.3":
    "Average number of professional development / administrative training Programmes organized by the institution for teaching and non-teaching staff during the last five years",
  "6.3.4":
    "Average percentage of teachers undergoing online / face-to-face Faculty Development Programmes (FDP) during the last five years (Professional Development Programmes, Orientation / Induction Programmes, Refresher Course, Short Term Course)",
  "6.4.1": "Institutional strategies for mobilisation of funds and the optimal utilisation of resources",
  "6.4.2":
    "Funds / Grants received from government bodies during the last five years for development and maintenance of infrastructure (not covered under Criteria III and V) (INR in Lakhs)",
  "6.4.3":
    "Funds / Grants received from non-government bodies, individuals, philanthropists during the last five years for development and maintenance of infrastructure (not covered under Criteria III and V) (INR in Lakhs)",
  "6.4.4": "Institution conducts internal and external financial audits regularly",
  "6.5.1":
    "Internal Quality Assurance Cell (IQAC) has contributed significantly for institutionalizing the quality assurance strategies and processes by constantly reviewing the teaching-learning process, structures & methodologies of operations and learning outcomes at periodic intervals",
  "6.5.2": "Institution has adopted the following for Quality assurance",
  "6.5.3":
    "Incremental improvements made for the preceding five years with regard to quality (in case of first cycle) / post accreditation quality initiatives (second and subsequent cycles)",
  "7.1.1": "Measures initiated by the Institution for the promotion of gender equity during the last five years.",
  "7.1.2": "The Institution has facilities for alternate sources of energy and energy conservation measures",
  "7.1.4": "Water conservation facilities available in the Institution",
  "7.1.5": "Green campus initiatives include",
  "7.1.6": "Quality audits on environment and energy are regularly undertaken by the institution",
  "7.1.7": "The Institution has disabled-friendly, barrier free environment",
  "7.1.9": "Sensitization of students and employees of the Institution to the constitutional obligations: values, rights, duties and responsibilities of citizens",
  "7.1.10": "The Institution has a prescribed code of conduct for students, teachers, administrators and other staff and conducts periodic programmes in this regard.",
  "7.1.11": "Institution celebrates / organizes national and international commemorative days, events and festivals",
  "7.3.1": "Portray the performance of the Institution in one area distinctive to its priority and thrust within 1000 words",
});

function cleanText(value) {
  if (typeof value !== "string") {
    return value;
  }

  let next = value;
  for (const [pattern, replacement] of replacements) {
    next = next.replace(pattern, replacement);
  }

  return next
    .replace(/^\s*\d\.\d\.\d\s+Q\s*[lLnN1]\s*M\s*/i, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\b\d+\s+Manual for Universities NAAC for Quality and Excellence in Higher Education\s+\d+\b/g, "")
    .trim();
}

function cleanList(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  const cleaned = [];
  for (const item of list) {
    const text = cleanText(item);
    if (!text) {
      continue;
    }
    if (/^File Description(?: \(Upload\))?$/i.test(text)) {
      continue;
    }
    if (/^Opt one$/i.test(text)) {
      continue;
    }
    if (/^Template\)$/i.test(text)) {
      continue;
    }
    if (/^Upload$/i.test(text)) {
      continue;
    }
    if (/^Documents?$/i.test(text)) {
      continue;
    }
    if (/^Manual for Universities /i.test(text)) {
      continue;
    }
    if (!cleaned.includes(text)) {
      cleaned.push(text);
    }
  }

  return cleaned;
}

function officialMetricCode(blockCode) {
  return String(blockCode).replace(/^METRIC_/, "");
}

function mapYearAggregation(block) {
  const mode = String(block.yearPolicy?.mode || "").toUpperCase();
  const text = `${block.title || ""} ${block.description || ""} ${block.yearPolicy?.details || ""}`;

  if (/latest completed academic year/i.test(text) || mode === "LATEST_ONLY" || mode === "SINGLE_YEAR" || mode === "NONE") {
    return "LATEST";
  }
  if (mode === "AVERAGE" || /average/i.test(text)) {
    return "AVERAGE";
  }
  if (mode === "MULTI_YEAR") {
    return /average/i.test(text) ? "AVERAGE" : "SUM";
  }
  return "LATEST";
}

function buildOptionLabels(description) {
  const text = cleanText(description || "");
  const positions = [...text.matchAll(/(?:^|\s)([A-E])\.\s*/g)];
  if (positions.length === 0) {
    return [];
  }

  const options = [];
  for (let index = 0; index < positions.length; index += 1) {
    const current = positions[index];
    const next = positions[index + 1];
    const start = (current.index ?? 0) + current[0].length;
    const end = next ? next.index : text.length;
    const key = current[1];
    const label = cleanText(text.slice(start, end));
    if (key && label) {
      options.push({ key, label });
    }
  }

  const unique = new Map();
  for (const option of options) {
    unique.set(`${option.key}:${option.label}`, option);
  }
  return [...unique.values()];
}

function metricKindForBlock(block) {
  const metricCode = block.blockCode.startsWith("METRIC_") ? officialMetricCode(block.blockCode) : null;
  return metricCode ? metricKindOverrides[metricCode] || block.inputSchema?.metricKind || null : null;
}

function mapDataType(block) {
  const metricCode = block.blockCode.startsWith("METRIC_") ? officialMetricCode(block.blockCode) : null;
  const explicit = metricCode ? dataTypeOverrides[metricCode] : null;
  const source = explicit || block.dataType;

  if (block.blockCode.startsWith("CRITERION_") || block.blockCode.startsWith("KI_")) {
    return "HYBRID";
  }
  if (source === "QUALITATIVE") {
    return "QUALITATIVE";
  }
  if (source === "MIXED") {
    return "HYBRID";
  }
  return "QUANTITATIVE";
}

function blockTypeForBlock(block) {
  if (!block.isLeaf) {
    return "GROUP";
  }
  return metricKindForBlock(block) === "QlM" ? "QUALITATIVE" : "METRIC";
}

function wordLimitForMetric(metricCode) {
  if (metricCode === "7.3.1") {
    return 1000;
  }
  if (metricCode) {
    return 500;
  }
  return null;
}

function repairCheckedSpec(input) {
  const body = {
    ...input.body,
    versionCode: "UNIVERSITY_MANUAL_DEC_2019",
    versionName: "Manual for Self Study Report - Universities",
    effectiveDate: "2019-12",
    sourceDocument: {
      ...input.body.sourceDocument,
      title: "Manual for Self Study Report - Universities",
      uploadedFileName: "Revised-University-Manual_1.pdf",
      pageCount: 144,
    },
  };

  const profiles = (input.profiles || []).map((profile) => ({
    ...profile,
    profileCode: profile.profileCode || "UNIVERSITY",
    name: cleanText(profile.name || profile.profileName || "University"),
    status: "CONFIRMED",
  }));

  const blocks = (input.blocks || []).map((originalBlock) => {
    const block = JSON.parse(JSON.stringify(originalBlock));
    block.title = cleanText(block.title);
    block.description = cleanText(block.description);
    block.expectedEvidence = cleanList(block.expectedEvidence);
    block.notes = cleanList(block.notes);

    if (block.inputSchema && typeof block.inputSchema === "object") {
      block.inputSchema.dataRequirements = cleanList(block.inputSchema.dataRequirements);
      if (Array.isArray(block.inputSchema.subMetricFields)) {
        block.inputSchema.subMetricFields = block.inputSchema.subMetricFields.map((field) => ({
          ...field,
          code: cleanText(field.code),
          label: cleanText(field.label),
        }));
      }
    }

    if (block.yearPolicy) {
      block.yearPolicy.details = cleanText(block.yearPolicy.details || "");
    }

    if (block.blockCode === "METRIC_1.2.3") {
      block.blockCode = "METRIC_1.1.3";
      block.parentBlockCode = "KI_1.1";
      block.status = "CONFIRMED";
      block.notes = [];
      block.description = cleanText(block.description.replace(/1\.2\.3\.1/g, "1.1.3.1"));
      if (block.inputSchema) {
        block.inputSchema.metricKind = "QnM";
        if (Array.isArray(block.inputSchema.subMetricFields)) {
          block.inputSchema.subMetricFields = block.inputSchema.subMetricFields.map((field) => ({
            ...field,
            code: field.code === "1.2.3.1" ? "1.1.3.1" : field.code,
            label: cleanText(field.label),
          }));
        }
      }
    }

    const metricCode = block.blockCode.startsWith("METRIC_") ? officialMetricCode(block.blockCode) : null;
    if (metricCode && titleOverrides[metricCode]) {
      block.title = titleOverrides[metricCode];
    }
    if (metricCode && metricKindOverrides[metricCode] && block.inputSchema) {
      block.inputSchema.metricKind = metricKindOverrides[metricCode];
    }
    if (metricCode && dataTypeOverrides[metricCode]) {
      block.dataType = dataTypeOverrides[metricCode];
    }

    return block;
  });

  return {
    ...input,
    body,
    profiles,
    blocks,
    gradeBands: [],
    thresholdRules: [
      {
        rule: "Pre-qualifier for peer team visit is at least 25% in Quantitative Metrics (QnM) after the DVV process.",
        status: "CONFIRMED",
        pageRefs: [29],
      },
      {
        rule: "In case of HEIs exercising the weightage of <= 3% of Non Applicable Metrics, the total score will vary accordingly.",
        status: "CONFIRMED",
        pageRefs: [25],
      },
    ],
    notes: [
      "Corrected against the NAAC Manual for Self Study Report - Universities (December 2019).",
      "Metric code 1.1.3 was mis-modeled as 1.2.3 in the original draft and has been corrected.",
      "Metric titles damaged by OCR truncation were repaired using the manual text.",
      "This checked spec preserves research-oriented fields such as pageRefs and status for auditability.",
    ],
    openQuestions: [
      "The SSR manual gives metric weightage, formulas, qualitative prompts, and evidence expectations, but it does not fully disclose the automated SGS benchmark algorithm needed for direct machine scoring of QnM metrics.",
    ],
  };
}

function buildImportBundle(checked) {
  const blocks = checked.blocks
    .filter((block) => block.blockCode !== "SECTION_QIF")
    .map((block) => {
      const metricCode = block.blockCode.startsWith("METRIC_") ? officialMetricCode(block.blockCode) : null;
      const optionLabels = metricCode ? buildOptionLabels(`${block.description || ""} ${block.calculation || ""}`) : [];
      const blockType = blockTypeForBlock(block);
      const wordLimit = metricCode && blockType === "QUALITATIVE" ? wordLimitForMetric(metricCode) : null;
      const captureMode = blockType === "QUALITATIVE"
        ? "NARRATIVE"
        : optionLabels.length > 0
          ? "SINGLE_SELECT"
          : block.dataType === "TABLE"
            ? "TABLE_OR_STRUCTURED"
            : "STRUCTURED_NUMERIC";

      return {
        blockCode: block.blockCode,
        parentBlockCode: block.parentBlockCode === "SECTION_QIF" ? null : block.parentBlockCode,
        title: cleanText(block.title),
        description: cleanText(block.description) || null,
        blockType,
        dataType: mapDataType(block),
        yearAggregation: mapYearAggregation(block),
        yearAggregationConfig: {
          manualMode: block.yearPolicy?.mode || "NONE",
          manualDetails: cleanText(block.yearPolicy?.details || ""),
          windowYears: /last five years/i.test(`${block.title || ""} ${block.description || ""}`) ? 5 : undefined,
        },
        maxScore: typeof block.maxScore === "number" ? block.maxScore : null,
        sortOrder: block.sortOrder,
        unitOfMeasure: null,
        inputSchema: {
          nodeKind: block.blockCode.startsWith("CRITERION_")
            ? "CRITERION"
            : block.blockCode.startsWith("KI_")
              ? "KEY_INDICATOR"
              : "METRIC",
          officialMetricCode: metricCode,
          naacMetricKind: metricCode ? metricKindForBlock(block) : null,
          captureMode,
          pageRefs: block.pageRefs || [],
          sourceDocument: checked.body.sourceDocument.uploadedFileName,
          yearPolicy: block.yearPolicy || null,
          dataRequirements: cleanList(block.inputSchema?.dataRequirements),
          subMetricFields: Array.isArray(block.inputSchema?.subMetricFields)
            ? block.inputSchema.subMetricFields.map((field) => ({
                code: cleanText(field.code),
                label: cleanText(field.label),
              }))
            : [],
          optionLabels,
          formulaText: cleanText(block.calculation || ""),
          prompt: blockType === "QUALITATIVE" ? cleanText(block.description || "") : undefined,
          appliesToProfiles: block.appliesToProfiles || [],
        },
        outputSchema: null,
        calculationRule: null,
        scoringRule: block.isLeaf
          ? {
              type: "MANUAL_ONLY",
              reason:
                "NAAC SSR manual provides metric weightage, qualitative prompts, evidence expectations, and data formulas, but not the complete SGS / benchmark scoring algorithm needed for deterministic automation from the manual alone.",
            }
          : null,
        validationRules: {
          ...(wordLimit ? { manualWordLimit: wordLimit } : {}),
          metricKind: metricCode ? metricKindForBlock(block) : undefined,
          sourceStatus: block.status || "CONFIRMED",
        },
        evidenceSchema: {
          expectedEvidence: cleanList(block.expectedEvidence),
          pageRefs: block.pageRefs || [],
          sourceDocument: checked.body.sourceDocument.uploadedFileName,
        },
        dependencyRules: null,
        sourceLinks: null,
        isActive: true,
      };
    });

  const byParent = new Map();
  for (const block of blocks) {
    const key = block.parentBlockCode || "__ROOT__";
    const bucket = byParent.get(key) || [];
    bucket.push(block);
    byParent.set(key, bucket);
  }

  for (const bucket of byParent.values()) {
    bucket.sort((left, right) => left.sortOrder - right.sortOrder || left.blockCode.localeCompare(right.blockCode, undefined, { numeric: true }));
    bucket.forEach((block, index) => {
      block.sortOrder = index + 1;
    });
  }

  return {
    schemaVersion: "logrequest.accreditation-template-bundle.v1",
    bundleType: "accreditation-template",
    sourceArtifact: {
      checkedSpecFile: path.basename(defaultCheckedPath),
      sourcePdfFile: checked.body.sourceDocument.uploadedFileName,
      validatedAgainstPages: [24, 25, 29, 30, 47, 48, 49, 50, 51, 52, 53, 93, 95, 100, 101, 102, 103, 104],
      preparedAt: new Date().toISOString(),
    },
    body: {
      code: checked.body.code,
      name: checked.body.name,
      country: "IN",
      description: "NAAC Manual for Self Study Report - Universities (December 2019) compiled into a Logrequest accreditation template bundle.",
      websiteUrl: "https://www.naac.gov.in/",
      scope: "GLOBAL",
      isActive: true,
    },
    version: {
      versionCode: checked.body.versionCode,
      versionName: `${checked.body.versionName} (Checked Import Bundle)`,
      scoreBase: 1000,
      convertedScaleMax: null,
      conversionType: "NONE",
      conversionFactor: null,
      effectiveFrom: "2019-12-01",
      effectiveTo: null,
      lifecycleStatus: "DRAFT",
      isActive: true,
      sourceDocument: checked.body.sourceDocument,
      notes: [
        "Prepared from the official NAAC university SSR manual.",
        "Scoring rules for individual QnM metrics are intentionally marked MANUAL_ONLY because the manual does not disclose the full software benchmark logic used by NAAC SGS.",
        "Criteria, key indicators, metric codes, weightage, year policies, prompts, and evidence requirements are preserved for template authoring and guided data capture.",
      ],
    },
    profiles: [
      {
        profileCode: "UNIVERSITY",
        profileName: "University",
        description: "Applicable to the University manual variant of the NAAC SSR framework.",
        isDefault: true,
      },
    ],
    blocks,
    gradeBands: [],
    thresholdRules: [],
    importNotes: [
      "This bundle is aligned to the app block-template hierarchy: Criterion root -> Key Indicator -> Metric.",
      "The QIF wrapper section node was intentionally removed because the current template editor supports a maximum hierarchy depth of 3 levels total.",
      "Import this as a draft template version, then review and publish after any tenant-specific adjustments.",
      "If full NAAC grade-band automation is needed later, it should be added from an official NAAC scoring methodology source beyond the SSR manual.",
    ],
    validationSummary: {
      criterionCount: blocks.filter((block) => /^CRITERION_/.test(block.blockCode)).length,
      keyIndicatorCount: blocks.filter((block) => /^KI_/.test(block.blockCode)).length,
      metricCount: blocks.filter((block) => /^METRIC_/.test(block.blockCode)).length,
      totalBlocks: blocks.length,
      correctionsApplied: [
        "Corrected metric code 1.2.3 -> 1.1.3 and moved it under KI_1.1.",
        "Repaired OCR-damaged metric titles and normalized evidence/data requirement strings.",
        "Mapped research-spec block types/data types into app-supported GROUP/METRIC/QUALITATIVE and QUANTITATIVE/QUALITATIVE/HYBRID enums.",
      ],
    },
  };
}

function validateImportBundle(bundle) {
  const allowedBlockTypes = new Set(["GROUP", "METRIC", "QUALITATIVE", "COMPOSITE"]);
  const allowedDataTypes = new Set(["QUANTITATIVE", "QUALITATIVE", "HYBRID"]);
  const allowedYearAgg = new Set(["AVERAGE", "SUM", "LATEST", "MAX", "WEIGHTED_RECENT"]);

  const codes = new Set();
  const blockMap = new Map();

  for (const block of bundle.blocks) {
    if (codes.has(block.blockCode)) {
      throw new Error(`Duplicate blockCode ${block.blockCode}`);
    }
    codes.add(block.blockCode);
    blockMap.set(block.blockCode, block);
    if (!allowedBlockTypes.has(block.blockType)) {
      throw new Error(`Invalid blockType ${block.blockCode}: ${block.blockType}`);
    }
    if (!allowedDataTypes.has(block.dataType)) {
      throw new Error(`Invalid dataType ${block.blockCode}: ${block.dataType}`);
    }
    if (!allowedYearAgg.has(block.yearAggregation)) {
      throw new Error(`Invalid yearAggregation ${block.blockCode}: ${block.yearAggregation}`);
    }
  }

  for (const block of bundle.blocks) {
    if (block.parentBlockCode && !blockMap.has(block.parentBlockCode)) {
      throw new Error(`Missing parent ${block.parentBlockCode} for ${block.blockCode}`);
    }
  }

  const depthCache = new Map();
  function depth(blockCode, trail = new Set()) {
    if (depthCache.has(blockCode)) {
      return depthCache.get(blockCode);
    }
    const block = blockMap.get(blockCode);
    if (!block || !block.parentBlockCode) {
      depthCache.set(blockCode, 0);
      return 0;
    }
    if (trail.has(blockCode)) {
      throw new Error(`Cycle detected at ${blockCode}`);
    }
    const nextTrail = new Set(trail);
    nextTrail.add(blockCode);
    const value = depth(block.parentBlockCode, nextTrail) + 1;
    depthCache.set(blockCode, value);
    return value;
  }

  const maxDepth = Math.max(...bundle.blocks.map((block) => depth(block.blockCode)));
  if (maxDepth > 2) {
    throw new Error(`Hierarchy depth ${maxDepth} exceeds supported depth 2`);
  }

  const metricCodes = bundle.blocks
    .filter((block) => /^METRIC_/.test(block.blockCode))
    .map((block) => block.blockCode.replace(/^METRIC_/, ""));

  if (metricCodes.length !== 115) {
    throw new Error(`Expected 115 metrics, found ${metricCodes.length}`);
  }
  if (!metricCodes.includes("1.1.3")) {
    throw new Error("Corrected metric 1.1.3 is missing");
  }
  if (metricCodes.includes("1.2.3")) {
    throw new Error("Incorrect metric 1.2.3 is still present");
  }

  return {
    totalBlocks: bundle.blocks.length,
    maxDepth,
    rootBlocks: bundle.blocks.filter((block) => !block.parentBlockCode).length,
    criteria: bundle.blocks.filter((block) => /^CRITERION_/.test(block.blockCode)).length,
    keyIndicators: bundle.blocks.filter((block) => /^KI_/.test(block.blockCode)).length,
    metrics: metricCodes.length,
  };
}

function main() {
  const inputPath = process.argv[2] || defaultInputPath;
  const checkedPath = process.argv[3] || defaultCheckedPath;
  const importPath = process.argv[4] || defaultImportPath;

  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const checked = repairCheckedSpec(raw);
  const bundle = buildImportBundle(checked);
  const validation = validateImportBundle(bundle);

  fs.writeFileSync(checkedPath, `${JSON.stringify(checked, null, 2)}\n`);
  fs.writeFileSync(importPath, `${JSON.stringify(bundle, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        checkedPath,
        importPath,
        validation,
      },
      null,
      2,
    ),
  );
}

main();
