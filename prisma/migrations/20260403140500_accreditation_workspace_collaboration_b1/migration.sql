-- CreateEnum
CREATE TYPE "WorkspaceSectionAssignmentRole" AS ENUM ('SECTION_LEAD', 'RESPONSIBLE', 'REVIEWER', 'APPROVER', 'VIEWER');

-- CreateEnum
CREATE TYPE "WorkspaceSectionReviewStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'OWNER_SUBMITTED', 'CHANGES_REQUESTED', 'REVIEW_CONFIRMED', 'APPROVED');

-- CreateEnum
CREATE TYPE "WorkspaceSectionReviewerDecisionStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "WorkspaceDiscussionScope" AS ENUM ('WORKSPACE', 'SECTION', 'ENTRY');

-- CreateEnum
CREATE TYPE "WorkspaceGuestInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "WorkspaceGuestRole" AS ENUM ('RESPONSIBLE', 'REVIEWER', 'VIEWER');

-- AlterTable
ALTER TABLE "TenantPermissionAssignment" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WorkspaceCollaborator" ADD COLUMN "lastVisitedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkspaceSectionAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sectionCriterionId" TEXT NOT NULL,
    "userId" TEXT,
    "guestParticipantId" TEXT,
    "role" "WorkspaceSectionAssignmentRole" NOT NULL,
    "deadline" TIMESTAMP(3),
    "assignedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSectionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSectionReview" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sectionCriterionId" TEXT NOT NULL,
    "status" "WorkspaceSectionReviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "submittedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lastChangedByUserId" TEXT,
    "lastChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSectionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSectionReviewerDecision" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "status" "WorkspaceSectionReviewerDecisionStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSectionReviewerDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSectionReviewEvent" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "fromStatus" "WorkspaceSectionReviewStatus",
    "toStatus" "WorkspaceSectionReviewStatus" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "comment" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceSectionReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceDiscussionThread" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" "WorkspaceDiscussionScope" NOT NULL,
    "sectionCriterionId" TEXT,
    "entryId" TEXT,
    "createdByUserId" TEXT,
    "guestParticipantId" TEXT,
    "title" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceDiscussionThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceDiscussionMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "guestParticipantId" TEXT,
    "parentMessageId" TEXT,
    "body" TEXT NOT NULL,
    "mentionedUserIds" TEXT[],
    "isPostApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceDiscussionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceGuestInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sectionCriterionId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" "WorkspaceGuestRole" NOT NULL,
    "status" "WorkspaceGuestInviteStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceGuestInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceGuestParticipant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inviteId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" "WorkspaceGuestRole" NOT NULL,
    "accessRevokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceGuestParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceFreezeLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "frozenAt" TIMESTAMP(3) NOT NULL,
    "frozenByUserId" TEXT NOT NULL,
    "warningAcknowledgments" JSONB,
    "changesSummary" JSONB,
    "unfrozenAt" TIMESTAMP(3),
    "unfrozenByUserId" TEXT,
    "unfreezeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceFreezeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceSectionAssignment_workspaceId_sectionCriterionId_r_idx" ON "WorkspaceSectionAssignment"("workspaceId", "sectionCriterionId", "role");

-- CreateIndex
CREATE INDEX "WorkspaceSectionAssignment_workspaceId_userId_idx" ON "WorkspaceSectionAssignment"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "WorkspaceSectionAssignment_workspaceId_guestParticipantId_idx" ON "WorkspaceSectionAssignment"("workspaceId", "guestParticipantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSectionAssignment_workspaceId_sectionCriterionId_u_key" ON "WorkspaceSectionAssignment"("workspaceId", "sectionCriterionId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSectionAssignment_workspaceId_sectionCriterionId_g_key" ON "WorkspaceSectionAssignment"("workspaceId", "sectionCriterionId", "guestParticipantId", "role");

-- CreateIndex
CREATE INDEX "WorkspaceSectionReview_workspaceId_status_idx" ON "WorkspaceSectionReview"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSectionReview_workspaceId_sectionCriterionId_key" ON "WorkspaceSectionReview"("workspaceId", "sectionCriterionId");

-- CreateIndex
CREATE INDEX "WorkspaceSectionReviewerDecision_reviewId_status_idx" ON "WorkspaceSectionReviewerDecision"("reviewId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSectionReviewerDecision_reviewId_reviewerUserId_key" ON "WorkspaceSectionReviewerDecision"("reviewId", "reviewerUserId");

-- CreateIndex
CREATE INDEX "WorkspaceSectionReviewEvent_reviewId_createdAt_idx" ON "WorkspaceSectionReviewEvent"("reviewId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceDiscussionThread_workspaceId_scope_updatedAt_idx" ON "WorkspaceDiscussionThread"("workspaceId", "scope", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkspaceDiscussionThread_workspaceId_sectionCriterionId_idx" ON "WorkspaceDiscussionThread"("workspaceId", "sectionCriterionId");

-- CreateIndex
CREATE INDEX "WorkspaceDiscussionThread_workspaceId_entryId_idx" ON "WorkspaceDiscussionThread"("workspaceId", "entryId");

-- CreateIndex
CREATE INDEX "WorkspaceDiscussionMessage_threadId_createdAt_idx" ON "WorkspaceDiscussionMessage"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceGuestInvite_tokenHash_key" ON "WorkspaceGuestInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceGuestInvite_workspaceId_status_expiresAt_idx" ON "WorkspaceGuestInvite"("workspaceId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceGuestInvite_workspaceId_email_status_key" ON "WorkspaceGuestInvite"("workspaceId", "email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceGuestParticipant_inviteId_key" ON "WorkspaceGuestParticipant"("inviteId");

-- CreateIndex
CREATE INDEX "WorkspaceGuestParticipant_workspaceId_role_idx" ON "WorkspaceGuestParticipant"("workspaceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceGuestParticipant_workspaceId_email_key" ON "WorkspaceGuestParticipant"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "WorkspaceFreezeLog_workspaceId_frozenAt_idx" ON "WorkspaceFreezeLog"("workspaceId", "frozenAt");

-- AddForeignKey
ALTER TABLE "WorkspaceSectionAssignment" ADD CONSTRAINT "WorkspaceSectionAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionAssignment" ADD CONSTRAINT "WorkspaceSectionAssignment_sectionCriterionId_fkey" FOREIGN KEY ("sectionCriterionId") REFERENCES "AccreditationCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionAssignment" ADD CONSTRAINT "WorkspaceSectionAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionAssignment" ADD CONSTRAINT "WorkspaceSectionAssignment_guestParticipantId_fkey" FOREIGN KEY ("guestParticipantId") REFERENCES "WorkspaceGuestParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionReview" ADD CONSTRAINT "WorkspaceSectionReview_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionReview" ADD CONSTRAINT "WorkspaceSectionReview_sectionCriterionId_fkey" FOREIGN KEY ("sectionCriterionId") REFERENCES "AccreditationCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionReview" ADD CONSTRAINT "WorkspaceSectionReview_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionReview" ADD CONSTRAINT "WorkspaceSectionReview_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionReviewerDecision" ADD CONSTRAINT "WorkspaceSectionReviewerDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "WorkspaceSectionReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionReviewerDecision" ADD CONSTRAINT "WorkspaceSectionReviewerDecision_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionReviewEvent" ADD CONSTRAINT "WorkspaceSectionReviewEvent_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "WorkspaceSectionReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSectionReviewEvent" ADD CONSTRAINT "WorkspaceSectionReviewEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDiscussionThread" ADD CONSTRAINT "WorkspaceDiscussionThread_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDiscussionThread" ADD CONSTRAINT "WorkspaceDiscussionThread_sectionCriterionId_fkey" FOREIGN KEY ("sectionCriterionId") REFERENCES "AccreditationCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDiscussionThread" ADD CONSTRAINT "WorkspaceDiscussionThread_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CriterionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDiscussionThread" ADD CONSTRAINT "WorkspaceDiscussionThread_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDiscussionThread" ADD CONSTRAINT "WorkspaceDiscussionThread_guestParticipantId_fkey" FOREIGN KEY ("guestParticipantId") REFERENCES "WorkspaceGuestParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDiscussionThread" ADD CONSTRAINT "WorkspaceDiscussionThread_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDiscussionMessage" ADD CONSTRAINT "WorkspaceDiscussionMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WorkspaceDiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDiscussionMessage" ADD CONSTRAINT "WorkspaceDiscussionMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDiscussionMessage" ADD CONSTRAINT "WorkspaceDiscussionMessage_guestParticipantId_fkey" FOREIGN KEY ("guestParticipantId") REFERENCES "WorkspaceGuestParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDiscussionMessage" ADD CONSTRAINT "WorkspaceDiscussionMessage_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "WorkspaceDiscussionMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceGuestInvite" ADD CONSTRAINT "WorkspaceGuestInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceGuestInvite" ADD CONSTRAINT "WorkspaceGuestInvite_sectionCriterionId_fkey" FOREIGN KEY ("sectionCriterionId") REFERENCES "AccreditationCriterion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceGuestInvite" ADD CONSTRAINT "WorkspaceGuestInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceGuestParticipant" ADD CONSTRAINT "WorkspaceGuestParticipant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceGuestParticipant" ADD CONSTRAINT "WorkspaceGuestParticipant_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "WorkspaceGuestInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceFreezeLog" ADD CONSTRAINT "WorkspaceFreezeLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceFreezeLog" ADD CONSTRAINT "WorkspaceFreezeLog_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ScoreSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceFreezeLog" ADD CONSTRAINT "WorkspaceFreezeLog_frozenByUserId_fkey" FOREIGN KEY ("frozenByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceFreezeLog" ADD CONSTRAINT "WorkspaceFreezeLog_unfrozenByUserId_fkey" FOREIGN KEY ("unfrozenByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
