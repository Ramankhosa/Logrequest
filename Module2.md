# Module 2

## Name

Organization Structure and Scoped Role Management

## Purpose

This module will allow each tenant to define, validate, publish, and govern its internal organizational structure in a generic way that works for universities, companies, research institutes, and other institutions.

## Core design decisions

- Structure and governance stay separate
- App roles stay separate from business or hierarchy roles
- Hierarchy roles such as `Unit Head` or `Unit Admin` should be modeled as scoped role assignments, not direct unit fields
- Structure, user mappings, and scoped roles must be tied to a hierarchy version
- Reporting lines must be separate from the structural tree so matrix and dotted-line models are possible
- Tenant-facing labels can vary, but internal unit categories should stay standardized

## Draft and versioning rule

- exactly one editable draft is allowed per tenant at a time
- published versions are preserved historically and remain read-only
- a tenant cannot create parallel editable drafts in the first version
- a new draft may be opened only from the current published state or after the existing draft is discarded or published
- branch drafts can be added later if they are truly required

## Recommended core models

- `OrgStructureVersion`
- `OrgUnitType`
- `OrgUnit`
- `ReportingLine`
- `UserOrgAssignment`
- `OrgRoleAssignment`

## Recommended unit principles

- `unit_code` should be tenant-unique and stable
- unit names may repeat across different branches if needed
- each unit belongs to one hierarchy version
- each unit may have zero or one parent, except root

## What tenant admin should manage

- choose or configure hierarchy schema
- define allowed unit types and labels
- create and edit units manually
- validate hierarchy draft
- publish hierarchy
- assign users to units
- assign scoped hierarchy roles

## First implementation scope

Phase 1 should include:

- hierarchy version entity
- unit type entity
- unit entity with parent-child structure
- reporting line entity
- user-to-unit mapping
- scoped role assignment
- one active draft workflow
- validation before publish
- tenant-admin UI for tree building and publishing
- publish history with archived published versions

## Deferred for later

- bulk hierarchy upload
- future-dated hierarchy versions
- branch drafts
- advanced approval workflows
- descendant-scope exceptions
