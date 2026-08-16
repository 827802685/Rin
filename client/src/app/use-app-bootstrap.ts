import { useEffect, useRef, useState } from "react";
import { ConfigWrapper } from "@rin/config";
import type { Profile } from "../state/profile";
import { defaultClientConfig } from "../state/config";
import { applyThemeColor } from "../utils/theme-color";
import { readBootstrappedClientConfig } from "./bootstrap-config";
import { client } from "./runtime";

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
      applyThemeColor(typeof nextConfig["theme.color"] === "string" ? nextConfig["theme.color"] : undefined);
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
      applyThemeColor(typeof cachedConfig["theme.color"] === "string" ? cachedConfig["theme.color"] : undefined);
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
      applyThemeColor(typeof configObject["theme.color"] === "string" ? configObject["theme.color"] : undefined);
    };

    window.addEventListener("storage", handleConfigUpdate);
    return () => window.removeEventListener("storage", handleConfigUpdate);
  }, []);

  return { config, profile };
}
