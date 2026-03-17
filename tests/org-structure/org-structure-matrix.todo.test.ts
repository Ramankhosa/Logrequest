type MatrixCase = {
  id: string;
  title: string;
};

const matrixCases: MatrixCase[] = `
1.1|Create a unit type with valid data (typeKey, displayLabel, category, allowRoot=true)
1.2|Create a unit type with duplicate typeKey in same draft
1.3|Create a second allowRoot=true type when one exists
1.4|Create unit type with invalid typeKey (lowercase, spaces, < 2 chars)
1.5|Create unit type without TENANT_OWNER or TENANT_ADMIN role
1.6|Verify creating a type resets draft validation
2.1|Create root unit with allowRoot type, no parent
2.2|Create second root unit (parentId=null)
2.3|Create root unit with non-allowRoot type
2.4|Create child unit under existing parent
2.5|Create unit with duplicate code in same draft
2.6|Create unit with invalid code (lowercase, < 2 chars, special chars)
2.7|Create unit with parentId pointing to non-existent unit
2.8|Delete a leaf unit
2.9|Delete a unit with children
2.10|Delete root unit (cascades everything)
2.11|Update unit name, code, typeId
2.12|Update unit code to one that already exists
2.13|Move unit to a new parent (reparenting)
2.14|Move unit under its own descendant (circular)
2.15|Toggle unit to INACTIVE
2.16|Reactivate unit whose parent is INACTIVE
2.17|Reactivate unit whose parent is ACTIVE
2.18|Verify all unit mutations reset draft validation state
3.1|Validate draft with no unit types
3.2|Validate draft with no units
3.3|Validate draft with valid structure
3.4|Publish validated draft
3.5|Publish draft with validation errors
3.6|Discard draft
3.7|Creating a new draft after publishing clones unit types and units
3.8|Verify cloned units preserve parent-child relationships (remapped IDs)
3.9|Get version history
3.10|Get version detail by ID
3.11|Get snapshot returns both draft and published data
4.1|Parse valid CSV with type_key, unit_code, unit_name, parent_code
4.2|Parse CSV with missing columns
4.3|Parse CSV with duplicate unit codes
4.4|Parse CSV with invalid code format
4.5|Parse CSV with multiple root units (empty parent_code)
4.6|Parse CSV where parent_code references code not in file
4.7|Parse XLSX file (Excel format)
4.8|Parse file with mixed-case column headers (Type_Key, UNIT_CODE)
4.9|Preview endpoint validates type_key against existing unit types
4.10|Confirm import creates units in correct topological order (parents before children)
4.11|Confirm import skips codes that already exist in draft
4.12|Download template CSV includes available type_keys
5.1|Create role with valid data (roleKey, displayLabel, isUnitHead, sortOrder)
5.2|Create role with duplicate roleKey for same tenant
5.3|Create role with invalid roleKey (lowercase, < 2 chars, > 50 chars)
5.4|Create role without TENANT_OWNER or TENANT_ADMIN role
5.5|List roles returns all definitions with assignment counts
5.6|Update role displayLabel
5.7|Update role displayLabel syncs denormalized roleName on existing assignments
5.8|Deactivate role that has active assignments
5.9|Deactivate role with no assignments
5.10|Remove isUnitHead flag when units rely on this as sole head
5.11|Remove isUnitHead flag when no assignments exist
5.12|Delete role that has assignments
5.13|Delete role with zero assignments
5.14|Create role with maxPerUnit=1
5.15|Create role with sortOrder=0 (highest authority)
6.1|Assign role to user at a valid unit
6.2|Assign same role to same user at same unit again
6.3|Assign role to user who is NOT a tenant member
6.4|Assign role at an INACTIVE unit
6.5|Assign role at an ARCHIVED unit
6.6|Assign deactivated role (isActive=false)
6.7|Assign role when no structure version exists
6.8|Assign role with maxPerUnit=1 when unit already has one
6.9|Assign isUnitHead role when unit already has a different head
6.10|Assign isUnitHead role to empty unit (no existing head)
6.11|Assign multiple non-head roles to same user at same unit
6.12|Assign same user to different units with different roles (multi-role)
6.13|Remove a role assignment
6.14|Remove last role assignment at unit - UserOrgAssignment also cleaned up
6.15|Remove one of multiple role assignments - UserOrgAssignment preserved
6.16|Remove assignment belonging to different tenant
6.17|Get unit members returns correct roles sorted by sortOrder
6.18|Get user assignments returns all units+roles for a user
7.1|Get approval chain from leaf dept with heads at every level
7.2|Get approval chain when intermediate unit has no head
7.3|Get approval chain when an intermediate unit is INACTIVE
7.4|Get approval chain from root unit
7.5|Get approval chain with no published version
7.6|Get approval chain with deeply nested structure (5+ levels)
7.7|Verify chain order: first element is immediate unit, last is root
8.1|Derive lines for structure where every unit has a head and members
8.2|Derive lines when a unit has no head but has members
8.3|Derive lines when a unit has a head but no other members
8.4|Derive lines when root unit head has no parent
8.5|Re-derive lines replaces all previous lines for the version
8.6|Derive lines with INACTIVE units
8.7|Derive lines where same user is head at two different units
8.8|Derive lines - no duplicate pairs (manager+member+unit)
8.9|Derive lines with empty structure (no assignments)
8.10|Audit log created after derivation with line count and warnings
9.1|Parse valid CSV with email, first_name, last_name, employee_id, unit_code, role_key
9.2|Parse CSV missing required columns (no email column)
9.3|Parse CSV with invalid email format
9.4|Parse CSV with missing first_name or last_name
9.5|Parse CSV with duplicate email+unit_code+role_key within file
9.6|Parse CSV with empty rows (all blank)
9.7|Parse CSV with flexible column names ("Email Address", "First Name")
9.8|Preview validates unit_code against published structure
9.9|Preview validates role_key against role definitions
9.10|Confirm import - user doesn't exist - creates User record
9.11|Confirm import - user already exists - reuses existing user
9.12|Confirm import - membership doesn't exist - creates Membership
9.13|Confirm import - membership already exists - skips membership creation
9.14|Confirm import - backfills employeeId if membership exists without one
9.15|Confirm import - same user appears twice with different unit+role
9.16|Confirm import - maxPerUnit=1 exceeded during batch
9.17|Confirm import - isUnitHead conflict during batch
9.18|Confirm import - assignment already exists
9.19|Download template includes available role keys and unit codes
9.20|Audit log created after bulk import with counts
10.1|All role endpoints - no session
10.2|All role endpoints - session but no tenantId
10.3|Role create/update/delete - TENANT_USER role
10.4|Role create/update/delete - TENANT_ADMIN role
10.5|Role create/update/delete - TENANT_OWNER role
10.6|Role list - TENANT_USER role
10.7|Unit members GET - TENANT_USER role
10.8|User import - TENANT_USER role
10.9|User import - no file in form data
10.10|User import - invalid action parameter
11.1|Full flow: create types -> create units -> define roles -> assign roles -> derive reporting lines
11.2|Publish structure, then create new draft - role assignments on old version are not affected
11.3|Role assignments reference correct versionId (active version at time of assignment)
11.4|Delete a unit that has role assignments
11.5|Discard draft that has role assignments
11.6|Two tenants with same roleKey ("DEPT_HEAD") - no cross-contamination
11.7|Concurrent role assignments to same unit (race condition on maxPerUnit)
11.8|Import 100+ rows in a single file - performance acceptable
11.9|Structure with 500+ units - approval chain traversal doesn't time out
11.10|Audit logs created for all mutations (role CRUD, assignments, imports, reporting line derivation)
`
  .trim()
  .split("\n")
  .map((line) => {
    const [id, ...titleParts] = line.split("|");
    return {
      id: id.trim(),
      title: titleParts.join("|").trim(),
    };
  });

const completedCaseIds = new Set<string>([
  "1.1",
  "1.2",
  "1.3",
  "1.4",
  "1.5",
  "1.6",
  "2.1",
  "2.2",
  "2.3",
  "2.4",
  "2.5",
  "2.6",
  "2.7",
  "2.8",
  "2.9",
  "2.10",
  "2.11",
  "2.12",
  "2.13",
  "2.14",
  "2.15",
  "2.16",
  "2.17",
  "2.18",
  "3.1",
  "3.2",
  "3.3",
  "3.4",
  "3.5",
  "3.6",
  "3.7",
  "3.8",
  "3.9",
  "3.10",
  "3.11",
  "4.1",
  "4.2",
  "4.3",
  "4.4",
  "4.5",
  "4.6",
  "4.7",
  "4.8",
  "4.9",
  "4.10",
  "4.11",
  "4.12",
  "5.1",
  "5.2",
  "5.3",
  "5.4",
  "5.5",
  "5.6",
  "5.7",
  "5.8",
  "5.9",
  "5.10",
  "5.11",
  "5.12",
  "5.13",
  "5.14",
  "5.15",
  "6.1",
  "6.2",
  "6.3",
  "6.4",
  "6.5",
  "6.6",
  "6.7",
  "6.8",
  "6.9",
  "6.10",
  "6.11",
  "6.12",
  "6.13",
  "6.14",
  "6.15",
  "6.16",
  "6.17",
  "6.18",
  "7.1",
  "7.2",
  "7.3",
  "7.4",
  "7.5",
  "7.6",
  "7.7",
  "8.1",
  "8.2",
  "8.3",
  "8.4",
  "8.5",
  "8.6",
  "8.7",
  "8.8",
  "8.9",
  "8.10",
  "9.1",
  "9.2",
  "9.3",
  "9.4",
  "9.5",
  "9.6",
  "9.7",
  "9.8",
  "9.9",
  "9.10",
  "9.11",
  "9.12",
  "9.13",
  "9.14",
  "9.15",
  "9.16",
  "9.17",
  "9.18",
  "9.19",
  "9.20",
  "10.1",
  "10.2",
  "10.3",
  "10.4",
  "10.5",
  "10.6",
  "10.7",
  "10.8",
  "10.9",
  "10.10",
  "11.1",
  "11.2",
  "11.3",
  "11.4",
  "11.5",
  "11.6",
  "11.7",
  "11.8",
  "11.9",
  "11.10",
]);

const pendingCases = matrixCases.filter((testCase) => !completedCaseIds.has(testCase.id));

describe("Org Structure Matrix", () => {
  test("tracks every listed scenario from the provided matrix", () => {
    expect(matrixCases).toHaveLength(137);
  });

  for (const testCase of pendingCases) {
    test.todo(`${testCase.id} ${testCase.title}`);
  }
});
