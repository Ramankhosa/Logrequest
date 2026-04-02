# Galgotias University Demo Platform Overview

## Purpose

This platform is designed to help Galgotias University manage academic, research, and administrative performance through a structured KRA and KPI workflow. It enables the institution to define performance goals, assign targets, collect achievement requests, review submissions, track progress through dashboards, and apply reward or incentive policies in a transparent and auditable way.

The demo environment has been prepared with Galgotias-specific KPI templates, sample users, a seeded organization structure, sample target allocations, and in-process achievement requests so that the end-to-end workflow can be reviewed in a realistic setting.

## Seeded Demo Logins

The following demo accounts are available in the seeded Galgotias environment. All demo users currently use the same password:

**Password:** `Demo@12345`

- `owner@galgotias-demo.local.test`
  Role: Tenant Owner / institutional leadership view
- `admin@galgotias-demo.local.test`
  Role: Tenant Admin / setup and administration
- `faculty1@galgotias-demo.local.test`
  Role: Faculty user with seeded publication and book-related requests
- `faculty2@galgotias-demo.local.test`
  Role: Faculty user with seeded grant and conference-paper workflows
- `employee@galgotias-demo.local.test`
  Role: Faculty/staff user with seeded consultancy and patent workflows
- `scse.director@galgotias-demo.local.test`
  Role: School reviewer for seeded research workflows
- `soe.director@galgotias-demo.local.test`
  Role: School reviewer for seeded engineering and grant workflows
- `sob.director@galgotias-demo.local.test`
  Role: Academic outreach / executive education review scenario

## Main Functional Areas

### 1. Workspace

This page confirms that the user is logged in correctly and shows the active organization and role context.

Use this section to confirm:
- the current signed-in user
- the active tenant or institution
- the role with which the user is accessing the system

### 2. My KPIs

This is the main working area for faculty and assignees.

It includes:
- **My Targets**
  Shows the KPIs assigned to the logged-in user.
- **Review Queue**
  Shows pending achievement requests for users with review authority.
- **My Dashboard**
  Shows individual progress, target status, and workflow indicators.
- **Additional Achievements**
  Allows recording of achievements outside standard assigned targets, where applicable.

### 3. Performance Hub

This is the consolidated KPI dashboard area for viewing personal, review, unit, and organization-level performance.

It helps management and reviewers monitor:
- assigned targets
- completed achievements
- pending verification cases
- departmental and institutional progress patterns

### 4. Tenant Admin: KRA/KPI Management

This area is used for institutional setup and ongoing administration.

The tenant administration section allows users to manage:
- assessment periods
- KRA categories
- KRAs
- KPI definitions
- target allocations
- achievement reviews
- contributor roles
- benefit types
- reward configurations
- dashboards

### 5. Journal Catalog

The journal module supports journal data import and institution-level journal governance.

It allows the institution to:
- upload journal master data
- search by journal title, ISSN, year, quartile, publisher, and related filters
- edit institution-specific values where needed
- maintain tenant-specific overrides
- disable or blacklist journals according to internal policy

If a faculty member submits a publication linked to a disabled or blacklisted journal, the system shows an institutional warning inside the KPI workflow.

## Key Features Demonstrated In The Seeded Environment

### Galgotias-Specific KPI Templates

The demo includes seeded KPI templates aligned to Galgotias-oriented research and academic incentive use cases, including:
- Scopus/WoS Journal Publication
- Textbook Authorship
- Edited Book
- Book Chapter
- PhD Awarded
- Research Grant
- Consultancy Project
- Patent Filing
- International Conference Convenor
- FDP/STC/VAC/Training Convenor
- Conference Paper
- EDP/MDP Convenor

### Multi-Request Submission Under One KPI

For publication-style KPIs, a user can submit more than one achievement request under the same KPI allocation. Each request is tracked separately, reviewed separately, and reflected independently in the workflow.

Example:
- A faculty member may already have one paper under review.
- The same faculty member can still submit another paper under the same KPI.
- Both requests will travel separately through the verification process.

### DOI-Based Publication Assistance

For journal publication achievements, the platform supports DOI-based data enrichment.

This means that when a faculty member enters a DOI:
- the system can fetch paper metadata
- publication details can be auto-filled
- contributor information can be suggested
- journal quartile and related journal details can be linked where catalog data is available

This reduces manual effort and improves data consistency.

### Journal Governance And Policy Control

The journal catalog helps the institution apply internal quality controls.

The institution can:
- upload SCImago-based journal data
- maintain tenant-specific journal corrections
- disable journals not to be encouraged
- blacklist journals that should not be considered for policy benefits

### Review Workflow Visibility

The seeded demo data includes requests in multiple states, so the full review pipeline can be demonstrated:
- Draft
- Submitted
- Recommended
- Verified
- Rejected

This is useful for showing how the same system supports both faculty submission and institutional oversight.

### Dashboard-Based Monitoring

The demo environment includes seeded targets, progress, and achievement requests so that dashboards are not empty.

This allows management to review:
- how targets are assigned
- how many requests are in process
- what has been approved
- what is pending review
- where the institution stands against research and performance objectives

## Suggested Demo Walkthrough

### A. Faculty Submission Flow

Log in as `faculty1@galgotias-demo.local.test`.

Use this account to demonstrate:
- viewing assigned KPIs in **My Targets**
- opening a publication KPI
- reviewing seeded requests already in the system
- showing how a faculty member records an achievement
- showing DOI-based publication assistance

### B. Reviewer Flow

Log in as `scse.director@galgotias-demo.local.test` or `soe.director@galgotias-demo.local.test`.

Use this account to demonstrate:
- the **Review Queue**
- pending requests requiring action
- how recommendations and approvals are handled
- how request history and supporting information remain visible through the workflow

### C. Institutional Dashboard Flow

Log in as `owner@galgotias-demo.local.test` or `admin@galgotias-demo.local.test`.

Use this account to demonstrate:
- overall KPI dashboard visibility
- period, KRA, and KPI administration
- reward and benefit structures
- journal catalog governance
- institutional control over publication-related policy enforcement

## Example Use Cases

### Example 1: Journal Paper Submission

A faculty member opens **My KPIs**, selects a journal publication KPI, and clicks the DOI fetch option.

The system can:
- fetch available paper details
- populate relevant publication fields
- identify the journal by ISSN where possible
- show quartile or policy-related journal information

The faculty member can still edit the values before submission.

### Example 2: Journal Policy Warning

If the matched journal is marked as disabled or blacklisted in the institution’s journal catalog, the system displays a warning during the KPI process.

This helps the institution communicate publication policy directly within the user workflow rather than outside it.

### Example 3: Parallel Requests

A faculty member may have:
- one paper already submitted
- one consultancy request under review
- one book chapter saved in draft

All of these can be tracked separately inside the same system without losing clarity.

## Closing Note

This demo is intended to show how the platform can support Galgotias University in managing KPI-driven academic and research workflows in a structured, policy-aware, and scalable manner.

It demonstrates not only data entry, but also:
- governance
- review workflow control
- journal-quality handling
- reward policy alignment
- dashboard-based monitoring

The seeded environment is suitable for walkthrough discussions with academic leadership, research administration, and operational stakeholders.
