"use client";

import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { SlideOver, EmptyState } from "@/components/dashboard/shared";
import { inputClassName, labelClassName } from "./constants";
import type { AccreditationManagerHook } from "./use-accreditation-manager";

type Props = Pick<
  AccreditationManagerHook,
  | "submitting"
  | "selectedVersion"
  | "profiles" | "selectedProfileId" | "setSelectedProfileId" | "selectedProfile" | "selectedProfileWeightMap"
  | "leafCriteria"
  | "canEditSelectedBody"
  | "createProfile" | "saveProfileWeights"
>;

function toNullableNumber(val: FormDataEntryValue | null): number | null {
  if (typeof val !== "string" || !val.trim()) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export function ProfilesTab(props: Props) {
  const {
    submitting,
    selectedVersion,
    profiles, selectedProfileId, setSelectedProfileId, selectedProfile, selectedProfileWeightMap,
    leafCriteria,
    canEditSelectedBody,
    createProfile, saveProfileWeights,
  } = props;

  const [showCreateProfile, setShowCreateProfile] = useState(false);

  if (!selectedVersion) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center">
        <p className="text-sm text-slate-500">Select a framework version from the Frameworks tab to manage profiles.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[20rem,1fr]">
        {/* Profile list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">{profiles.length} Profile{profiles.length !== 1 ? "s" : ""}</h3>
            {canEditSelectedBody ? (
              <button
                type="button"
                onClick={() => setShowCreateProfile(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Profile
              </button>
            ) : null}
          </div>

          {profiles.length === 0 ? (
            <EmptyState
              icon={<Users className="h-7 w-7" />}
              title="No profiles yet"
              description="Profiles let you define different weight distributions for the same framework. For example, different institution types."
              actionLabel={canEditSelectedBody ? "Add First Profile" : undefined}
              onAction={canEditSelectedBody ? () => setShowCreateProfile(true) : undefined}
            />
          ) : (
            <div className="space-y-2">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedProfileId === profile.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-semibold">{profile.profileName}</p>
                  <p className="mt-1 text-xs opacity-75">
                    {profile.profileCode} &middot; {profile.isDefault ? "Default" : "Optional"} &middot; {profile.weightOverrideCount} weight{profile.weightOverrideCount !== 1 ? "s" : ""}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Weight overrides */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          {!selectedProfile ? (
            <p className="py-8 text-center text-sm text-slate-500">Select a profile to manage weight overrides.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Weight Overrides for {selectedProfile.profileName}</h4>
                <p className="text-xs text-slate-500">Set max score and optional weight percentage for each leaf criterion.</p>
              </div>

              {leafCriteria.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Add leaf criteria in the Template Blocks tab first.</p>
              ) : canEditSelectedBody ? (
                <form className="space-y-3" onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const weights = leafCriteria
                    .map((c) => {
                      const maxScore = toNullableNumber(fd.get(`maxScore_${c.id}`));
                      if (maxScore === null) return null;
                      return { blockId: c.id, maxScore, weightPercent: toNullableNumber(fd.get(`weightPercent_${c.id}`)) };
                    })
                    .filter((w): w is NonNullable<typeof w> => w !== null);
                  void saveProfileWeights(selectedProfile.id, weights);
                }}>
                  <div className="space-y-2">
                    {leafCriteria.map((criterion) => {
                      const weight = selectedProfileWeightMap.get(criterion.id);
                      return (
                        <div key={criterion.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-[1.3fr_0.7fr_0.7fr]">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{criterion.blockCode} &middot; {criterion.title}</p>
                            <p className="text-xs text-slate-500">Level {criterion.depth + 1}</p>
                          </div>
                          <div>
                            <label className={labelClassName}>Max Score</label>
                            <input name={`maxScore_${criterion.id}`} type="number" step="0.01" defaultValue={weight?.maxScore ?? ""} placeholder="Max" className={inputClassName} />
                          </div>
                          <div>
                            <label className={labelClassName}>Weight %</label>
                            <input name={`weightPercent_${criterion.id}`} type="number" step="0.01" defaultValue={weight?.weightPercent ?? ""} placeholder="%" className={inputClassName} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button type="submit" disabled={submitting} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300">
                    {submitting ? "Saving..." : "Save Weights"}
                  </button>
                </form>
              ) : (
                <div className="space-y-2">
                  {leafCriteria.map((criterion) => {
                    const weight = selectedProfileWeightMap.get(criterion.id);
                    return (
                      <div key={criterion.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                        <p className="font-semibold text-slate-900">{criterion.blockCode} &middot; {criterion.title}</p>
                        <p className="mt-1 text-xs text-slate-500">Max: {weight?.maxScore ?? "Not set"} &middot; Weight: {weight?.weightPercent != null ? `${weight.weightPercent}%` : "Not set"}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create Profile SlideOver */}
      <SlideOver open={showCreateProfile} onClose={() => setShowCreateProfile(false)} title="Add Profile" subtitle="Create a new weight profile for this version.">
        <form className="space-y-5" onSubmit={(e) => {
          e.preventDefault();
          if (!selectedVersion) return;
          const fd = new FormData(e.currentTarget);
          void createProfile(selectedVersion.id, {
            profileCode: String(fd.get("profileCode") ?? ""),
            profileName: String(fd.get("profileName") ?? ""),
            description: String(fd.get("description") ?? "") || null,
            isDefault: fd.get("isDefault") === "on",
          }).then(() => setShowCreateProfile(false));
        }}>
          <div><label className={labelClassName} htmlFor="cp-code">Profile Code</label><input id="cp-code" name="profileCode" className={inputClassName} placeholder="e.g. UNIVERSITY" required /></div>
          <div><label className={labelClassName} htmlFor="cp-name">Profile Name</label><input id="cp-name" name="profileName" className={inputClassName} placeholder="e.g. University Profile" required /></div>
          <div><label className={labelClassName} htmlFor="cp-desc">Description (optional)</label><textarea id="cp-desc" name="description" className={`${inputClassName} min-h-[5rem]`} placeholder="Profile description" /></div>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input name="isDefault" type="checkbox" className="h-4 w-4 rounded" />Set as default profile</label>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={submitting} className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">{submitting ? "Creating..." : "Create Profile"}</button>
            <button type="button" onClick={() => setShowCreateProfile(false)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </form>
      </SlideOver>
    </>
  );
}
