"use client";

import { useState } from "react";
import { Plus, MessageSquare, CheckCircle } from "lucide-react";
import { TooltipHint } from "@/components/tenant/kra-kpi/tooltip-hint";
import { SlideOver, EmptyState } from "@/components/dashboard/shared";
import { TOOLTIP_DISCUSSION_SCOPE, inputClassName, labelClassName } from "./constants";
import type { WorkspaceThread, WorkspaceSection, WorkspaceCollaborator, WorkspaceHubHook } from "./use-workspace-hub";

type Props = {
  threads: WorkspaceThread[];
  sections: WorkspaceSection[];
  collaborators: WorkspaceCollaborator[];
  saving: boolean;
  createThread: WorkspaceHubHook["createThread"];
  replyToThread: WorkspaceHubHook["replyToThread"];
};

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DiscussionsPanel({ threads, sections, collaborators, saving, createThread, replyToThread }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [draft, setDraft] = useState({
    title: "",
    body: "",
    scope: "WORKSPACE",
    sectionBlockId: "",
    mentionedUserIds: [] as string[],
  });

  const openThreads = threads.filter((t) => !t.isResolved);
  const resolvedThreads = threads.filter((t) => t.isResolved);

  function handleCreate() {
    void createThread({
      title: draft.title,
      body: draft.body,
      scope: draft.scope,
      sectionBlockId: draft.scope === "SECTION" ? draft.sectionBlockId || null : null,
      mentionedUserIds: draft.mentionedUserIds,
    }).then(() => {
      setShowCreate(false);
      setDraft({ title: "", body: "", scope: "WORKSPACE", sectionBlockId: "", mentionedUserIds: [] });
    });
  }

  function handleReply() {
    if (!replyTarget || !replyText.trim()) return;
    void replyToThread(replyTarget, replyText).then(() => {
      setReplyTarget(null);
      setReplyText("");
    });
  }

  return (
    <>
      <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Discussions</h3>
            <p className="mt-1 text-xs text-slate-400">{threads.length} thread{threads.length !== 1 ? "s" : ""} &middot; {openThreads.length} open</p>
          </div>
          <button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" />
            New Discussion
          </button>
        </div>

        {threads.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<MessageSquare className="h-7 w-7" />}
              title="No discussions yet"
              description="Start a discussion thread to collaborate with your team on this workspace."
              actionLabel="Start First Discussion"
              onAction={() => setShowCreate(true)}
            />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {/* Open threads first */}
            {openThreads.map((thread) => (
              <ThreadCard key={thread.id} thread={thread} sections={sections} onReply={(id) => { setReplyTarget(id); setReplyText(""); }} />
            ))}
            {/* Resolved threads */}
            {resolvedThreads.length > 0 ? (
              <>
                <div className="flex items-center gap-2 pt-2">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Resolved</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                {resolvedThreads.map((thread) => (
                  <ThreadCard key={thread.id} thread={thread} sections={sections} onReply={(id) => { setReplyTarget(id); setReplyText(""); }} />
                ))}
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Create Thread SlideOver */}
      <SlideOver open={showCreate} onClose={() => setShowCreate(false)} title="New Discussion" subtitle="Start a conversation with your team.">
        <div className="space-y-5">
          <div>
            <label className={labelClassName}>Title</label>
            <input className={inputClassName} placeholder="e.g. Clarification on Criterion 2.3" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <label className={labelClassName}>Scope</label>
              <TooltipHint text={TOOLTIP_DISCUSSION_SCOPE} />
            </div>
            <select className={inputClassName} value={draft.scope} onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value }))}>
              <option value="WORKSPACE">Workspace-wide</option>
              <option value="SECTION">Specific section</option>
            </select>
          </div>
          {draft.scope === "SECTION" ? (
            <div>
              <label className={labelClassName}>Section</label>
              <select className={inputClassName} value={draft.sectionBlockId} onChange={(e) => setDraft((d) => ({ ...d, sectionBlockId: e.target.value }))}>
                <option value="">Select a section</option>
                {sections.map((s) => <option key={s.sectionBlockId} value={s.sectionBlockId}>{s.sectionCode} &middot; {s.title}</option>)}
              </select>
            </div>
          ) : null}
          {collaborators.length > 0 ? (
            <div>
              <label className={labelClassName}>Mention collaborators (optional)</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {collaborators.map((c) => {
                  const selected = draft.mentionedUserIds.includes(c.userId);
                  return (
                    <button
                      key={c.userId}
                      type="button"
                      onClick={() => setDraft((d) => ({
                        ...d,
                        mentionedUserIds: selected
                          ? d.mentionedUserIds.filter((id) => id !== c.userId)
                          : [...d.mentionedUserIds, c.userId],
                      }))}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        selected
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div>
            <label className={labelClassName}>Message</label>
            <textarea className={`${inputClassName} min-h-[8rem]`} placeholder="Share your thoughts, questions, or feedback..." value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleCreate} disabled={saving || !draft.title.trim() || !draft.body.trim()} className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">
              {saving ? "Creating..." : "Create Discussion"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </SlideOver>

      {/* Reply SlideOver */}
      <SlideOver open={!!replyTarget} onClose={() => setReplyTarget(null)} title="Reply" subtitle="Add a message to this discussion thread.">
        <div className="space-y-5">
          <div>
            <label className={labelClassName}>Your reply</label>
            <textarea className={`${inputClassName} min-h-[8rem]`} placeholder="Type your reply..." value={replyText} onChange={(e) => setReplyText(e.target.value)} autoFocus />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleReply} disabled={saving || !replyText.trim()} className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">
              {saving ? "Posting..." : "Post Reply"}
            </button>
            <button type="button" onClick={() => setReplyTarget(null)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </SlideOver>
    </>
  );
}

// ── Thread card ──

function ThreadCard({
  thread,
  sections,
  onReply,
}: {
  thread: WorkspaceThread;
  sections: WorkspaceSection[];
  onReply: (threadId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const latestMessage = thread.messages[thread.messages.length - 1];
  const sectionName = thread.sectionBlockId
    ? sections.find((s) => s.sectionBlockId === thread.sectionBlockId)?.title ?? null
    : null;

  return (
    <div className={`rounded-2xl border ${thread.isResolved ? "border-slate-100 bg-slate-50/50" : "border-slate-200 bg-white"} overflow-hidden`}>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <div className="mt-0.5">
          {thread.isResolved
            ? <CheckCircle className="h-4 w-4 text-emerald-500" />
            : <MessageSquare className="h-4 w-4 text-indigo-500" />
          }
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${thread.isResolved ? "text-slate-500" : "text-slate-900"}`}>{thread.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            <span className={`rounded-full border px-2 py-0.5 ${thread.scope === "SECTION" ? "border-indigo-200 bg-indigo-50 text-indigo-600" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
              {thread.scope === "SECTION" && sectionName ? sectionName : "Workspace"}
            </span>
            <span>{thread.messages.length} message{thread.messages.length !== 1 ? "s" : ""}</span>
            {latestMessage ? <span>&middot; {formatDate(latestMessage.createdAt)}</span> : null}
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2">
          {thread.messages.map((msg) => (
            <div key={msg.id} className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-sm text-slate-700">{msg.body}</p>
              <p className="mt-1 text-[11px] text-slate-400">
                {formatDate(msg.createdAt)}
                {msg.isPostApproval ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-600">post-approval</span> : null}
              </p>
            </div>
          ))}
          <button type="button" onClick={() => onReply(thread.id)} className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
            Reply to this thread
          </button>
        </div>
      ) : null}
    </div>
  );
}
