import type { ReactNode } from "react";
import { lazy, Suspense, useContext } from "react";
import type { DefaultParams, PathPattern } from "wouter";
import { Route, Switch } from "wouter";
import ReactLoading from "react-loading";
import { AdminLayout } from "../components/admin-layout";
import Footer from "../components/footer";
import { Header } from "../components/header";
import { Padding } from "../components/padding";
import { Waiting } from "../components/loading";
import { getHeaderLayoutDefinition } from "../components/site-header/layout-registry";
import { Tips, TipsPage } from "../components/tips";
import useTableOfContents from "../hooks/useTableOfContents";
import { useSiteConfig } from "../hooks/useSiteConfig";
const AIPage = lazy(() => import("../page/ai").then((m) => ({ default: m.AIPage })));
const CallbackPage = lazy(() => import("../page/callback").then((m) => ({ default: m.CallbackPage })));
const CompatTasksPage = lazy(() => import("../page/compat-tasks").then((m) => ({ default: m.CompatTasksPage })));
import { ErrorPage } from "../page/error";
import { FeedPage, TOCHeader } from "../page/feed";
import { FeedsPage } from "../page/feeds";
import { FriendsPage } from "../page/friends";
const HealthPage = lazy(() => import("../page/health").then((m) => ({ default: m.HealthPage })));
import { HashtagPage } from "../page/hashtag";
import { HashtagsPage } from "../page/hashtags";
const LoginPage = lazy(() => import("../page/login").then((m) => ({ default: m.LoginPage })));
import { MomentsPage } from "../page/moments";
const ProfilePage = lazy(() => import("../page/profile").then((m) => ({ default: m.ProfilePage })));
const QueueStatusPage = lazy(() => import("../page/queue-status").then((m) => ({ default: m.QueueStatusPage })));
import { SearchPage } from "../page/search";
const Settings = lazy(() => import("../page/settings").then((m) => ({ default: m.Settings })));
const SettingsTheme = lazy(() => import("../page/settings-theme").then((m) => ({ default: m.SettingsTheme })));
import { TimelinePage } from "../page/timeline";
import { ToolsPage } from "../page/tools";
const ToolsAdminPage = lazy(() => import("../page/tools-admin").then((m) => ({ default: m.ToolsAdminPage })));
const WritingPage = lazy(() => import("../page/writing").then((m) => ({ default: m.WritingPage })));
import { ProfileContext } from "../state/profile";
import { permissionGateState } from "./permission-gate";
import { tryInt } from "../utils/int";
import { useTranslation } from "react-i18next";

export function AppRoutes() {
  const { t } = useTranslation();

  return (
    <Switch>
      <AppRoute path="/">
        <FeedsPage />
      </AppRoute>

      <AppRoute path="/timeline">
        <TimelinePage />
      </AppRoute>

      <AppRoute path="/moments">
        <MomentsPage />
      </AppRoute>

      <AppRoute path="/friends">
        <FriendsPage />
      </AppRoute>

      <AppRoute path="/ai">
        <AIPage />
      </AppRoute>

      <AppRoute path="/tools">
        <ToolsPage />
      </AppRoute>

      <AppRoute path="/hashtags">
        <HashtagsPage />
      </AppRoute>

      <AppRoute path="/hashtag/:name">
        {(params) => <HashtagPage name={params.name || ""} />}
      </AppRoute>

      <AppRoute path="/search/:keyword">
        {(params) => <SearchPage keyword={params.keyword || ""} />}
      </AppRoute>

      <AdminRoute path="/admin/settings" requirePermission title={t("settings.title")} description={t("admin.settings_description")}>
        <Settings />
      </AdminRoute>

      <AdminRoute path="/admin/theme" requirePermission title={t("theme.title")} description={t("admin.theme_description")}>
        <SettingsTheme />
      </AdminRoute>

      <AdminRoute path="/admin/health" requirePermission title={t("health.title")} description={t("admin.health_description")}>
        <HealthPage />
      </AdminRoute>

      <AdminRoute path="/admin/tools" requirePermission title={t("tools.title")} description={t("admin.tools_description")}>
        <ToolsAdminPage />
      </AdminRoute>

      <AdminRoute path="/admin/queue-status" requirePermission title={t("queue_status.title")} description={t("admin.queue_status_description")}>
        <QueueStatusPage />
      </AdminRoute>

      <AdminRoute path="/admin/compat-tasks" requirePermission title={t("compat_tasks.title")} description={t("admin.compat_tasks_description")}>
        <CompatTasksPage />
      </AdminRoute>

      <AdminRoute path="/admin/writing" requirePermission title={t("writing")} description={t("admin.writing_description")}>
        <WritingPage />
      </AdminRoute>

      <AdminRoute path="/admin/writing/:id" requirePermission title={t("writing")} description={t("admin.writing_description")}>
        {({ id }) => <WritingPage id={tryInt(0, id)} />}
      </AdminRoute>

      <AppRoute path="/writing" requirePermission>
        <WritingPage />
      </AppRoute>

      <AppRoute path="/writing/:id" requirePermission>
        {({ id }) => <WritingPage id={tryInt(0, id)} />}
      </AppRoute>

      <AppRoute path="/callback">
        <CallbackPage />
      </AppRoute>

      <AppRoute path="/login">
        <LoginPage />
      </AppRoute>

      <AppRoute path="/profile">
        <ProfilePage />
      </AppRoute>

      <TocRoute path="/feed/:id">
        {(params, toc, cleanup) => <FeedPage id={params.id || ""} TOC={toc} clean={cleanup} />}
      </TocRoute>

      <TocRoute path="/:alias">
        {(params, toc, cleanup) => <FeedPage id={params.alias || ""} TOC={toc} clean={cleanup} />}
      </TocRoute>

      <AppRoute path="/user/github">
        <TipsPage>
          <Tips value={t("error.api_url")} type="error" />
        </TipsPage>
      </AppRoute>

      <AppRoute path="/*/user/github">
        <TipsPage>
          <Tips value={t("error.api_url_slash")} type="error" />
        </TipsPage>
      </AppRoute>

      <AppRoute path="/user/github/callback">
        <TipsPage>
          <Tips value={t("error.github_callback")} type="error" />
        </TipsPage>
      </AppRoute>

      <AppRoute>
        <ErrorPage error={t("error.not_found")} />
      </AppRoute>
    </Switch>
  );
}

/** Shown inside one route's content slot while its lazy chunk is being fetched. */
function ContentFallback() {
  return (
    <div className="flex min-h-[40vh] w-full items-center justify-center">
      <ReactLoading width="2em" height="2em" type="spin" color="rgb(var(--theme-rgb))" />
    </div>
  );
}

// 分档逻辑见 permission-gate.ts：把"还没取到登录状态"和"没权限"分开渲染，
// 否则慢网络下直接进入受限路由会先闪一次错误页。
function usePermissionGate(requirePermission?: boolean) {
  const profile = useContext(ProfileContext);
  const { t } = useTranslation();
  const state = permissionGateState(requirePermission, profile);

  return (node: ReactNode): ReactNode => {
    switch (state) {
      case "pending":
        return <Waiting />;
      case "login_required":
        return <ErrorPage error={t("error.login_required")} />;
      case "denied":
        return <ErrorPage error={t("error.permission_denied")} />;
      default:
        return node;
    }
  };
}

function AppRoute({
  path,
  children,
  headerComponent,
  paddingClassName,
  requirePermission,
}: {
  path?: PathPattern;
  children: ReactNode | ((params: DefaultParams) => ReactNode);
  headerComponent?: ReactNode;
  paddingClassName?: string;
  requirePermission?: boolean;
}) {
  const siteConfig = useSiteConfig();
  const gate = usePermissionGate(requirePermission);

  return (
    <Route path={path}>
      {(params) => {
        const page = typeof children === "function" ? children(params) : children;
        // Suspense 只包住内容槽：路由本身是懒加载的，若把 Suspense 提到 Switch 外层，
        // 切换任一页都会连侧栏/页脚一起卸载重挂，看起来就是"整页刷新了一下"。
        const resolvedContent = <Suspense fallback={<ContentFallback />}>{gate(page)}</Suspense>;
        const layoutDefinition = getHeaderLayoutDefinition(siteConfig.headerLayout);

        return layoutDefinition.renderRouteShell({
          header: <Header>{headerComponent}</Header>,
          content: <Padding className={paddingClassName}>{resolvedContent}</Padding>,
          rawContent: resolvedContent,
          footer: <Footer />,
          paddingClassName,
        });
      }}
    </Route>
  );
}

function AdminRoute({
  path,
  children,
  requirePermission,
  title,
  description,
}: {
  path: PathPattern;
  children: ReactNode | ((params: DefaultParams) => ReactNode);
  requirePermission?: boolean;
  title: string;
  description: string;
}) {
  const gate = usePermissionGate(requirePermission);

  return (
    <Route path={path}>
      {(params) => (
        <AdminLayout title={title} description={description}>
          <Suspense fallback={<ContentFallback />}>
            {gate(typeof children === "function" ? children(params) : children)}
          </Suspense>
        </AdminLayout>
      )}
    </Route>
  );
}

function TocRoute({
  path,
  children,
}: {
  path: PathPattern;
  children: (params: DefaultParams, toc: () => JSX.Element, cleanup: (id: string) => void) => ReactNode;
}) {
  const { TOC, cleanup } = useTableOfContents(".toc-content");

  return (
    <AppRoute path={path} headerComponent={TOCHeader({ TOC })} paddingClassName="mx-4">
      {(params) => children(params, TOC, cleanup)}
    </AppRoute>
  );
}
