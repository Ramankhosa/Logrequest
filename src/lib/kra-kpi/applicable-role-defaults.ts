import {
  GALGOTIA_BOOK_CHAPTER_TEMPLATE_KEY,
  GALGOTIA_EDITED_BOOK_TEMPLATE_KEY,
} from "./galgotia-template-constants";
import {
  NAAC_AWARD_TEMPLATE_KEY,
  NAAC_COLLAB_ACTIVITY_TEMPLATE_KEY,
  NAAC_ECONTENT_TEMPLATE_KEY,
  NAAC_EXTENSION_ACTIVITY_TEMPLATE_KEY,
  NAAC_EXTENSION_AWARD_TEMPLATE_KEY,
  NAAC_FELLOWSHIP_TEMPLATE_KEY,
  NAAC_RESEARCH_EVENT_TEMPLATE_KEY,
} from "./naac-template-constants";

export type TemplateApplicableRoleBaseline = {
  roleCode: string;
  isDefault: boolean;
  sortOrder: number;
};

const APPLICABLE_ROLE_BASELINES_BY_TEMPLATE_KEY: Record<
  string,
  TemplateApplicableRoleBaseline[]
> = {
  PUBLICATION: [
    { roleCode: "LEAD_AUTHOR", isDefault: true, sortOrder: 0 },
    { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
    { roleCode: "CORRESPONDING", isDefault: false, sortOrder: 2 },
  ],
  GRANT: [
    { roleCode: "PI", isDefault: true, sortOrder: 0 },
    { roleCode: "CO_PI", isDefault: false, sortOrder: 1 },
  ],
  PATENT: [
    { roleCode: "PI", isDefault: true, sortOrder: 0 },
    { roleCode: "CO_PI", isDefault: false, sortOrder: 1 },
  ],
  GU_JOURNAL_PUB: [
    { roleCode: "FIRST_AUTHOR", isDefault: true, sortOrder: 0 },
    { roleCode: "CORRESPONDING_AUTHOR", isDefault: false, sortOrder: 1 },
    { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 2 },
  ],
  GU_TEXTBOOK: [
    { roleCode: "AUTHOR", isDefault: true, sortOrder: 0 },
    { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
  ],
  [GALGOTIA_EDITED_BOOK_TEMPLATE_KEY]: [
    { roleCode: "CHIEF_EDITOR", isDefault: true, sortOrder: 0 },
    { roleCode: "CO_EDITOR", isDefault: false, sortOrder: 1 },
  ],
  [GALGOTIA_BOOK_CHAPTER_TEMPLATE_KEY]: [
    { roleCode: "AUTHOR", isDefault: true, sortOrder: 0 },
    { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
  ],
  GU_PHD_AWARDED: [
    { roleCode: "SUPERVISOR", isDefault: true, sortOrder: 0 },
    { roleCode: "CO_SUPERVISOR", isDefault: false, sortOrder: 1 },
  ],
  GU_RESEARCH_GRANT: [
    { roleCode: "PI", isDefault: true, sortOrder: 0 },
    { roleCode: "CO_PI", isDefault: false, sortOrder: 1 },
  ],
  GU_CONSULTANCY: [
    { roleCode: "LEAD_CONSULTANT", isDefault: true, sortOrder: 0 },
    { roleCode: "CONSULTANT", isDefault: false, sortOrder: 1 },
  ],
  GU_PATENT_FILING: [{ roleCode: "INVENTOR", isDefault: true, sortOrder: 0 }],
  GU_INTL_CONF_CONV: [{ roleCode: "CONVENOR", isDefault: true, sortOrder: 0 }],
  GU_FDP_WORKSHOP: [{ roleCode: "CONVENOR", isDefault: true, sortOrder: 0 }],
  GU_CONFERENCE_PAPER: [
    { roleCode: "AUTHOR", isDefault: true, sortOrder: 0 },
    { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
  ],
  GU_EDP_MDP: [
    { roleCode: "CONVENOR", isDefault: true, sortOrder: 0 },
    { roleCode: "TEAM_MEMBER", isDefault: false, sortOrder: 1 },
  ],
  [NAAC_AWARD_TEMPLATE_KEY]: [{ roleCode: "MEMBER", isDefault: true, sortOrder: 0 }],
  [NAAC_FELLOWSHIP_TEMPLATE_KEY]: [{ roleCode: "MEMBER", isDefault: true, sortOrder: 0 }],
  [NAAC_ECONTENT_TEMPLATE_KEY]: [
    { roleCode: "AUTHOR", isDefault: true, sortOrder: 0 },
    { roleCode: "CO_AUTHOR", isDefault: false, sortOrder: 1 },
  ],
  [NAAC_EXTENSION_ACTIVITY_TEMPLATE_KEY]: [
    { roleCode: "COORDINATOR", isDefault: true, sortOrder: 0 },
    { roleCode: "TEAM_MEMBER", isDefault: false, sortOrder: 1 },
  ],
  [NAAC_EXTENSION_AWARD_TEMPLATE_KEY]: [{ roleCode: "MEMBER", isDefault: true, sortOrder: 0 }],
  [NAAC_COLLAB_ACTIVITY_TEMPLATE_KEY]: [
    { roleCode: "COORDINATOR", isDefault: true, sortOrder: 0 },
    { roleCode: "TEAM_MEMBER", isDefault: false, sortOrder: 1 },
  ],
  [NAAC_RESEARCH_EVENT_TEMPLATE_KEY]: [
    { roleCode: "CONVENOR", isDefault: true, sortOrder: 0 },
    { roleCode: "TEAM_MEMBER", isDefault: false, sortOrder: 1 },
  ],
};

export function getTemplateApplicableRoleBaseline(
  achievementTemplateKey: string | null | undefined,
): TemplateApplicableRoleBaseline[] {
  if (!achievementTemplateKey) return [];
  return APPLICABLE_ROLE_BASELINES_BY_TEMPLATE_KEY[achievementTemplateKey] ?? [];
}
