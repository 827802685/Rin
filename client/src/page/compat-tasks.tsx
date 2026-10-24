import { SettingsBadge, SettingsCard, SettingsCardBody, SettingsCardHeader } from "@rin/ui";
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { client } from "../app/runtime";
import { Button } from "../components/button";
import { useAlert } from "../components/dialog";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { enrichMarkdownImageMetadata } from "../utils/image-upload";

export function CompatTasksPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState("");
  const [status, setStatus] = useState<{
    aiSummary: { enabled: boolean; queueConfigured: boolean; eligible: number; forceEligible: number };
    blurhash: { eligible: number };
    githubImage: { configured: boolean; total: number; mirrored: number; pending: number };
  }>({
    aiSummary: { enabled: false, queueConfigured: false, eligible: 0, forceEligible: 0 },
    blurhash: { eligible: 0 },
    githubImage: { configured: false, total: 0, mirrored: 0, pending: 0 },
  });
  const [runningTask, setRunningTask] = useState<"ai-summary" | "blurhash" | "github" | null>(null);
  const [blurhashProgress, setBlurhashProgress] = useState({ total: 0, processed: 0, updated: 0, failed: 0 });
  const { showAlert, AlertUI } = useAlert();

  const loadStatus = () => {
    setLoading(true);
    client.config.getCompatTasks().then(({ data, error }) => {
      if (error) {
        showAlert(error.value);
        return;
      }
      if (data) {
        setGeneratedAt(data.generatedAt);
        setStatus(data);
      }
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const runAISummaryBackfill = async (force = false) => {
    setRunningTask("ai-summary");
    try {
      const { data, error } = await client.config.runCompatAISummary(force);
      if (error) {
        showAlert(error.value);
        return;
      }
      if (data) {
        showAlert(t(
          data.forced ? "compat_tasks.ai_summary.result_force" : "compat_tasks.ai_summary.result",
          { queued: data.queued, skipped: data.skipped },
        ));
        loadStatus();
      }
    } finally {
      setRunningTask(null);
    }
  };

  const runBlurhashBackfill = async () => {
    setRunningTask("blurhash");
    setBlurhashProgress({ total: 0, processed: 0, updated: 0, failed: 0 });

    try {
      const { data, error } = await client.config.getCompatBlurhashCandidates();
      if (error) {
        showAlert(error.value);
        return;
      }

      const items = Array.isArray(data?.items) ? data.items : [];
      setBlurhashProgress({ total: items.length, processed: 0, updated: 0, failed: 0 });

      let processed = 0;
      let updated = 0;
      let failed = 0;

      for (const item of items) {
        try {
          const result = await enrichMarkdownImageMetadata(item.content);
          if (result.updated > 0 && result.content !== item.content) {
            const response = await client.config.applyCompatBlurhash(item.id, result.content);
            if (response.error) {
              failed += 1;
            } else {
              updated += 1;
            }
          }
          failed += result.failed > 0 ? 1 : 0;
        } catch {
          failed += 1;
        } finally {
          processed += 1;
          setBlurhashProgress({ total: items.length, processed, updated, failed });
        }
      }

      showAlert(t("compat_tasks.blurhash.result", { updated, failed, total: items.length }));
      loadStatus();
    } finally {
      setRunningTask(null);
    }
  };

  const runGithubSyncTask = async () => {
    setRunningTask("github");
    try {
      const { data, error } = await client.config.runGithubSync();
      if (error) {
        showAlert(error.value);
        return;
      }
      const stats = data?.stats;
      if (!stats) {
        showAlert(data?.error ?? t("compat_tasks.github_image.unconfigured"));
        return;
      }
      showAlert(
        t("compat_tasks.github_image.result", {
          postsDone: stats.feeds.success,
          postsTotal: stats.feeds.total,
          postsUnchanged: stats.feeds.unchanged,
          postsFailed: stats.feeds.failed,
          momentsDone: stats.moments.success,
          momentsTotal: stats.moments.total,
          momentsUnchanged: stats.moments.unchanged,
          momentsFailed: stats.moments.failed,
          media: stats.media.success,
          mediaPresent: stats.media.alreadyPresent,
          mediaLarge: stats.media.deferredToActions,
          mediaSkipped: stats.media.skipped,
          images: stats.images.total,
          mirrored: stats.images.success,
          present: stats.images.alreadyPresent,
          deferred: stats.images.deferredToActions,
        }) + (stats.partial ? `\n${t("compat_tasks.github_image.partial")}` : ""),
      );
      loadStatus();
    } finally {
      setRunningTask(null);
    }
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <Helmet>
        <title>{`${t("compat_tasks.title")} - ${siteConfig.name}`}</title>
      </Helmet>

      <AlertUI />

      {generatedAt ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t("compat_tasks.generated_at", { date: new Date(generatedAt).toLocaleString() })}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-3 py-8 text-sm text-neutral-500 dark:text-neutral-400">
          <ReactLoading width="1.25em" height="1.25em" type="spin" color="rgb(var(--theme-rgb))" />
          <span>{t("compat_tasks.loading")}</span>
        </div>
      ) : null}

      {!loading ? (
        <div className="space-y-4">
          <SettingsCard tone={status.aiSummary.eligible > 0 ? "warning" : "success"}>
            <SettingsCardHeader
              title={t("compat_tasks.ai_summary.title")}
              description={t("compat_tasks.ai_summary.description")}
              badge={
                <SettingsBadge tone={status.aiSummary.eligible > 0 ? "warning" : "success"}>
                  {t("compat_tasks.ai_summary.eligible", { count: status.aiSummary.eligible })}
                </SettingsBadge>
              }
            />
            <SettingsCardBody>
              <div className="space-y-3 text-sm text-neutral-600 dark:text-neutral-300">
                <p>{t("compat_tasks.ai_summary.enabled", { value: status.aiSummary.enabled ? t("compat_tasks.yes") : t("compat_tasks.no") })}</p>
                <p>{t("compat_tasks.ai_summary.queue_configured", { value: status.aiSummary.queueConfigured ? t("compat_tasks.yes") : t("compat_tasks.no") })}</p>
                <p>{t("compat_tasks.ai_summary.force_eligible", { count: status.aiSummary.forceEligible })}</p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    title={runningTask === "ai-summary" ? t("compat_tasks.running") : t("compat_tasks.ai_summary.run")}
                    disabled={runningTask !== null || status.aiSummary.eligible === 0}
                    onClick={() => runAISummaryBackfill(false)}
                  />
                  <Button
                    title={runningTask === "ai-summary" ? t("compat_tasks.running") : t("compat_tasks.ai_summary.run_force")}
                    disabled={runningTask !== null || status.aiSummary.forceEligible === 0}
                    onClick={() => runAISummaryBackfill(true)}
                  />
                </div>
              </div>
            </SettingsCardBody>
          </SettingsCard>

          <SettingsCard tone={status.blurhash.eligible > 0 ? "warning" : "success"}>
            <SettingsCardHeader
              title={t("compat_tasks.blurhash.title")}
              description={t("compat_tasks.blurhash.description")}
              badge={
                <SettingsBadge tone={status.blurhash.eligible > 0 ? "warning" : "success"}>
                  {t("compat_tasks.blurhash.eligible", { count: status.blurhash.eligible })}
                </SettingsBadge>
              }
            />
            <SettingsCardBody>
              <div className="space-y-3 text-sm text-neutral-600 dark:text-neutral-300">
                <p>{t("compat_tasks.blurhash.note")}</p>
                {runningTask === "blurhash" ? (
                  <p>
                    {t("compat_tasks.blurhash.progress", {
                      processed: blurhashProgress.processed,
                      total: blurhashProgress.total,
                      updated: blurhashProgress.updated,
                      failed: blurhashProgress.failed,
                    })}
                  </p>
                ) : null}
                <Button
                  title={runningTask === "blurhash" ? t("compat_tasks.running") : t("compat_tasks.blurhash.run")}
                  disabled={runningTask !== null || status.blurhash.eligible === 0}
                  onClick={runBlurhashBackfill}
                />
              </div>
            </SettingsCardBody>
          </SettingsCard>

          <SettingsCard
            tone={!status.githubImage.configured ? "default" : status.githubImage.pending > 0 ? "warning" : "success"}
          >
            <SettingsCardHeader
              title={t("compat_tasks.github_image.title")}
              description={t("compat_tasks.github_image.description")}
              badge={
                <SettingsBadge
                  tone={!status.githubImage.configured ? "neutral" : status.githubImage.pending > 0 ? "warning" : "success"}
                >
                  {status.githubImage.configured
                    ? t("compat_tasks.github_image.pending", { count: status.githubImage.pending })
                    : t("compat_tasks.github_image.unconfigured_badge")}
                </SettingsBadge>
              }
            />
            <SettingsCardBody>
              <div className="space-y-3 text-sm text-neutral-600 dark:text-neutral-300">
                {status.githubImage.configured ? (
                  <p>
                    {t("compat_tasks.github_image.counts", {
                      mirrored: status.githubImage.mirrored,
                      total: status.githubImage.total,
                    })}
                  </p>
                ) : (
                  <p>{t("compat_tasks.github_image.unconfigured")}</p>
                )}
                <p>{t("compat_tasks.github_image.note")}</p>
                <Button
                  title={runningTask === "github" ? t("compat_tasks.running") : t("compat_tasks.github_image.run")}
                  disabled={runningTask !== null || !status.githubImage.configured}
                  onClick={runGithubSyncTask}
                />
              </div>
            </SettingsCardBody>
          </SettingsCard>
        </div>
      ) : null}
    </div>
  );
}
