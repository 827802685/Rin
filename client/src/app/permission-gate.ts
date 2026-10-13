import type { Profile } from "../state/profile";

export type PermissionGateState = "open" | "pending" | "login_required" | "denied";

/**
 * 受限路由该显示哪一档：不拦（open）、登录状态还没取到（pending）、
 * 没登录（login_required）、登录了但没权限（denied）。
 *
 * ProfileContext 用 undefined 表示"请求还在路上"、null 表示"没取到用户"，
 * 两者都 falsy；如果只看 !profile?.permission 就会在慢网络/冷启动时先把
 * 正常用户判成"权限不足"（本地 dev 实测：直接进入 /admin/theme 会先闪错误页，
 * profile 返回后再翻成表单），也会把"没登录"说成"权限不足"。
 */
export function permissionGateState(
  requirePermission: boolean | undefined,
  profile: Profile | undefined | null,
): PermissionGateState {
  if (!requirePermission) {
    return "open";
  }
  if (profile === undefined) {
    return "pending";
  }
  if (profile === null) {
    return "login_required";
  }
  return profile.permission ? "open" : "denied";
}
