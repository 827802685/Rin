import { describe, expect, it } from "vitest";
import type { Profile } from "../../state/profile";
import { permissionGateState } from "../permission-gate";

const admin: Profile = { id: 1, avatar: "", permission: true, name: "a" };
const member: Profile = { id: 2, avatar: "", permission: false, name: "b" };

describe("permissionGateState", () => {
  it("不拦截的路由任何登录状态都直接放行", () => {
    expect(permissionGateState(undefined, undefined)).toBe("open");
    expect(permissionGateState(false, null)).toBe("open");
    expect(permissionGateState(undefined, member)).toBe("open");
  });

  it("profile 还没取到时判成 pending，不是 denied", () => {
    // undefined 只代表请求还在路上；旧写法 !profile?.permission 会在这里闪「权限不足」
    expect(permissionGateState(true, undefined)).toBe("pending");
  });

  it("取不到用户与没权限要分开", () => {
    expect(permissionGateState(true, null)).toBe("login_required");
    expect(permissionGateState(true, member)).toBe("denied");
  });

  it("有权限时放行", () => {
    expect(permissionGateState(true, admin)).toBe("open");
  });
});
