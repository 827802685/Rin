import { useEffect, useRef, useState } from "react";
import { ConfigWrapper } from "@rin/config";
import type { Profile } from "../state/profile";
import { defaultClientConfig } from "../state/config";
import { applyThemeConfig } from "../utils/theme-scheme";
import { readBootstrappedClientConfig } from "./bootstrap-config";
import { client } from "./runtime";

function applyThemeFromConfig(configObject: Record<string, unknown>) {
  const accent = typeof configObject["theme.color"] === "string" ? configObject["theme.color"] : undefined;
  // theme.color 未被用户显式改动时跟随色板默认主色
  applyThemeConfig({
    scheme: configObject["theme.scheme"],
    color: accent,
    customCss: configObject["theme.custom_css"],
  });
}

function applyViewportScaling() {
  const highResolutionThreshold = 2560;
  document.documentElement.style.fontSize = window.screen.width >= highResolutionThreshold ? "125%" : "100%";
}

function readCachedSessionConfig(): Record<string, unknown> | null {
  const cachedConfig = sessionStorage.getItem("config");
  if (!cachedConfig) {
    return null;
  }

  try {
    const parsed = JSON.parse(cachedConfig) as Record<string, unknown>;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function useAppBootstrap() {
  const initializedRef = useRef(false);
  const [profile, setProfile] = useState<Profile | undefined | null>(undefined);
  const [config, setConfig] = useState<ConfigWrapper>(new ConfigWrapper({}, new Map()));

  useEffect(() => {
    applyViewportScaling();

    if (initializedRef.current) {
      return;
    }

    const updateClientConfig = (nextConfig: Record<string, unknown>) => {
      sessionStorage.setItem("config", JSON.stringify(nextConfig));
      setConfig(new ConfigWrapper(nextConfig, defaultClientConfig));
      applyThemeFromConfig(nextConfig);
    };

    client.user.profile().then(({ data, error }) => {
      if (data) {
        setProfile({
          id: data.id,
          avatar: data.avatar || "",
          permission: data.permission,
          name: data.username,
        });
      } else if (error) {
        setProfile(null);
      }
    });

    const cachedConfig = readCachedSessionConfig();
    const bootstrappedConfig = readBootstrappedClientConfig();

    if (bootstrappedConfig) {
      updateClientConfig(bootstrappedConfig);
    } else if (cachedConfig) {
      setConfig(new ConfigWrapper(cachedConfig, defaultClientConfig));
      applyThemeFromConfig(cachedConfig);
    } else {
      // 兜底：bootstrap.js 注入失败（脚本 404 / 执行报错）且无会话缓存时，
      // 运行时拉一次 /api/config/client。否则前台会永远停留在默认配置——
      // 表现为「后台改什么布局/主题前台都没反应」。
      client.config
        .get("client")
        .then(({ data }) => {
          if (data && typeof data === "object") {
            updateClientConfig(data as Record<string, unknown>);
          }
        })
        .catch(() => undefined);
    }

    initializedRef.current = true;
  }, []);

  useEffect(() => {
    const handleConfigUpdate = () => {
      const configObject = readCachedSessionConfig();
      if (!configObject) {
        return;
      }

      setConfig(new ConfigWrapper(configObject, defaultClientConfig));
      applyThemeFromConfig(configObject);
    };

    window.addEventListener("storage", handleConfigUpdate);
    return () => window.removeEventListener("storage", handleConfigUpdate);
  }, []);

  return { config, profile };
}
