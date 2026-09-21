"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { getSubmitDuringRunBehavior, setSubmitDuringRunBehavior, type SubmitDuringRunBehavior } from "@/lib/composer-prefs";
import dynamic from "next/dynamic";
import { ArrowLeft, Copy, Download, ExternalLink, RefreshCw, RotateCcw, Search, Monitor, Play, Square, Trash2, X } from "lucide-react";
import { Alert } from "@/components/ui/field";
import { GlideSelect } from "@/components/ui/glide-select";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { SettingsTabs, type SettingsTab, SETTINGS_CATEGORIES, getNormalizedActive } from "./SettingsTabs";
import { copyText } from "@/lib/clipboard";
import type { AppUpdateInfo } from "./AppUpdateDialog";
import { useFontSize, type FontSizePreference } from "@/hooks/useFontSize";
import { useUiScale, type UiScalePreference } from "@/hooks/useUiScale";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
const SettingsTabLoading = () => {
  const { t } = useI18n();
  return <div role="status" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.loadingSettings")}</div>;
};
const ModelsConfig = dynamic(() => import("./ModelsConfig").then((module) => module.ModelsConfig), { loading: SettingsTabLoading, ssr: false });
const SkillsConfig = dynamic(() => import("./SkillsConfig").then((module) => module.SkillsConfig), { loading: SettingsTabLoading, ssr: false });
const PluginsConfig = dynamic(() => import("./PluginsConfig").then((module) => module.PluginsConfig), { loading: SettingsTabLoading, ssr: false });
const McpConfig = dynamic(() => import("./McpConfig").then((module) => module.McpConfig), { loading: SettingsTabLoading, ssr: false });
const AgentsConfig = dynamic(() => import("./AgentsConfig").then((module) => module.AgentsConfig), { loading: SettingsTabLoading, ssr: false });
const UsageConfig = dynamic(() => import("./UsageConfig").then((module) => module.UsageConfig), { loading: SettingsTabLoading, ssr: false });

type UpdateState = AppUpdateInfo;
type WindowsServiceStatus = {
  isWindows: boolean;
  isInstalled: boolean;
  autostart: boolean;
  isRunning: boolean;
  port: number;
  hostname: string;
  mode: "start" | "dev";
  desktopShortcutExists: boolean;
  startMenuShortcutExists: boolean;
  startupShortcutExists: boolean;
  logFile: string;
  configFile: string;
  serviceUrl: string;
  version: string;
};

type NativeSettings = {
  defaultThinkingLevel?: "auto" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  hideThinkingBlock?: boolean;
  externalThinking?: boolean;
  textVerbosity?: "low" | "medium" | "high";
  personality?: "default" | "friendly" | "pragmatic" | "none";
  advisor?: { enabled?: boolean; subagents?: boolean; syncBacklog?: "off" | "1" | "3" | "5"; immuneTurns?: number };
  tools?: { approvalMode?: "always-ask" | "write" | "yolo"; approval?: { bash?: "allow" | "prompt" | "deny"; extension?: "allow" | "prompt" } };
  compaction?: { enabled?: boolean; midTurnEnabled?: boolean; strategy?: "snapcompact" | "handoff" | "context-full" | "shake" | "off"; autoContinue?: boolean; remoteEnabled?: boolean; keepRecentTokens?: number };
  memory?: { backend?: "off" | "local" | "mnemopi" | "hindsight" };
  autolearn?: { enabled?: boolean; autoContinue?: boolean; minToolCalls?: number };
  mnemopi?: { scoping?: "global" | "per-project" | "per-project-tagged"; autoRecall?: boolean; autoRetain?: boolean; noEmbeddings?: boolean };
  mcp?: { enableProjectConfig?: boolean; renderMarkdownResults?: boolean; notifications?: boolean; notificationDebounceMs?: number };
  retry?: { enabled?: boolean; maxRetries?: number; modelFallback?: boolean };
};

const chipStyle = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 4,
  background: "var(--bg-subtle)",
  color: "var(--text-muted)",
  fontWeight: 500,
} as const;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const SettingsHighlightContext = createContext<string | null>(null);

type EnhancedChildProps = {
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
};

type SearchResult = {
  id: string;
  kind: "category" | "setting";
  tab: SettingsTab;
  label: string;
  description: string;
  scope?: string;
  section?: string;
};

type SettingIndexEntry = {
  id: string;
  tab: SettingsTab;
  sectionKey: string;
  labelKey: string;
  descKey: string;
  fallbackSection: string;
  fallbackLabel: string;
  fallbackDesc: string;
  scope?: "UI" | "Native OMP" | "Workspace";
};

const SETTING_INDEX: SettingIndexEntry[] = [
  // Interface & Behavior
  { id: "completion-sound", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.completionSound", descKey: "settingsConfig.completionSoundDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Completion sound", fallbackDesc: "Play a tone when the agent completes a run.", scope: "UI" },
  { id: "keep-tool-calls-collapsed", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.keepToolCallsCollapsed", descKey: "settingsConfig.keepToolCallsCollapsedDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Keep tool calls collapsed", fallbackDesc: "Show only compact headers while tools execute.", scope: "UI" },
  { id: "scope-native-select-all", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.scopeNativeSelectAll", descKey: "settingsConfig.scopeNativeSelectAllDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Scope native Select All (experimental)", fallbackDesc: "Limit whole-page selections from browser or touch menus to the active message, chat, or file. May also narrow deliberate whole-page selections. Turn off if selection handles or menus misbehave. Keyboard shortcuts are unaffected.", scope: "UI" },
  { id: "tts-autoplay", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.ttsAutoplay", descKey: "settingsConfig.ttsAutoplayDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Auto-read assistant responses", fallbackDesc: "Automatically read aloud new assistant replies when completed.", scope: "UI" },
  { id: "tts-voice", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.ttsVoice", descKey: "settingsConfig.ttsVoiceDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Speech Voice", fallbackDesc: "Select the browser voice for text-to-speech reading.", scope: "UI" },
  { id: "provider-usage", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.providerUsage", descKey: "settingsConfig.providerUsageDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Provider usage limits", fallbackDesc: "Show provider usage in the sidebar, above Settings.", scope: "UI" },
  { id: "chat-font-size", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.chatFontSize", descKey: "settingsConfig.chatFontSizeDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Chat Font Size", fallbackDesc: "Adjust text size for conversation messages, code blocks, and markdown output.", scope: "UI" },
  { id: "ui-scale", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.uiScale", descKey: "settingsConfig.uiScaleDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Interface Scale", fallbackDesc: "Adjust overall UI zoom and display density across sidebars, dialogs, buttons, and toolbars.", scope: "UI" },
  { id: "message-during-active-run", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.messageDuringActiveRun", descKey: "settingsConfig.messageDuringActiveRunDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Message during active run", fallbackDesc: "What composer does on submit while agent runs. Steer interrupts; Queue follow-up delivers after finish.", scope: "UI" },
  // Tool Safety & Approvals
  { id: "approval-mode", tab: "safety", sectionKey: "settingsConfig.toolSafetyApprovals", labelKey: "settingsConfig.approvalMode", descKey: "settingsConfig.approvalModeDesc", fallbackSection: "Tool Safety & Approvals", fallbackLabel: "Approval Mode", fallbackDesc: "Choose when OMP asks before tool calls.", scope: "Native OMP" },
  { id: "bash-override", tab: "safety", sectionKey: "settingsConfig.toolSafetyApprovals", labelKey: "settingsConfig.bashOverride", descKey: "settingsConfig.bashOverrideDesc", fallbackSection: "Tool Safety & Approvals", fallbackLabel: "Bash Override", fallbackDesc: "Override default approval policy specifically for terminal commands.", scope: "Native OMP" },
  { id: "extension-tool-requests", tab: "safety", sectionKey: "settingsConfig.toolSafetyApprovals", labelKey: "settingsConfig.extensionToolRequests", descKey: "settingsConfig.extensionToolRequestsDesc", fallbackSection: "Tool Safety & Approvals", fallbackLabel: "Extension Tool Requests", fallbackDesc: "Automatically approve extension tool authorization requests.", scope: "Native OMP" },
  // AI Model Defaults
  { id: "reasoning", tab: "models", sectionKey: "settingsConfig.modelDefaults", labelKey: "settingsConfig.reasoning", descKey: "settingsConfig.reasoningDesc", fallbackSection: "AI Model Defaults", fallbackLabel: "Reasoning", fallbackDesc: "Default effort level for thinking-capable models.", scope: "Native OMP" },
  { id: "verbosity", tab: "models", sectionKey: "settingsConfig.modelDefaults", labelKey: "settingsConfig.verbosity", descKey: "settingsConfig.verbosityDesc", fallbackSection: "AI Model Defaults", fallbackLabel: "Verbosity", fallbackDesc: "Response detail level for supporting providers.", scope: "Native OMP" },
  { id: "personality", tab: "models", sectionKey: "settingsConfig.modelDefaults", labelKey: "settingsConfig.personality", descKey: "settingsConfig.personalityDesc", fallbackSection: "AI Model Defaults", fallbackLabel: "Personality", fallbackDesc: "Style included in OMP's system prompt.", scope: "Native OMP" },
  { id: "thinking-blocks", tab: "models", sectionKey: "settingsConfig.modelDefaults", labelKey: "settingsConfig.thinkingBlocks", descKey: "settingsConfig.thinkingBlocksDesc", fallbackSection: "AI Model Defaults", fallbackLabel: "Thinking Blocks", fallbackDesc: "Hide model reasoning from output view.", scope: "Native OMP" },
  { id: "external-thinking", tab: "models", sectionKey: "settingsConfig.modelDefaults", labelKey: "settingsConfig.externalThinking", descKey: "settingsConfig.externalThinkingDesc", fallbackSection: "AI Model Defaults", fallbackLabel: "External Thinking", fallbackDesc: "Private scratchpad reasoning via think tool.", scope: "Native OMP" },
  // Context Compaction
  { id: "automatic-compaction", tab: "intelligence", sectionKey: "settingsConfig.contextCompaction", labelKey: "settingsConfig.automaticCompaction", descKey: "settingsConfig.automaticCompactionDesc", fallbackSection: "Context Compaction", fallbackLabel: "Automatic Compaction", fallbackDesc: "Compact context before model context limit is hit.", scope: "Native OMP" },
  { id: "continue-after-compaction", tab: "intelligence", sectionKey: "settingsConfig.contextCompaction", labelKey: "settingsConfig.continueAfterCompaction", descKey: "settingsConfig.continueAfterCompactionDesc", fallbackSection: "Context Compaction", fallbackLabel: "Continue After Compaction", fallbackDesc: "Resume task execution after compaction completes.", scope: "Native OMP" },
  { id: "maintenance-strategy", tab: "intelligence", sectionKey: "settingsConfig.contextCompaction", labelKey: "settingsConfig.maintenanceStrategy", descKey: "settingsConfig.maintenanceStrategyDesc", fallbackSection: "Context Compaction", fallbackLabel: "Maintenance Strategy", fallbackDesc: "Select algorithm used to reduce context pressure.", scope: "Native OMP" },
  { id: "compact-mid-turn", tab: "intelligence", sectionKey: "settingsConfig.contextCompaction", labelKey: "settingsConfig.compactMidTurn", descKey: "settingsConfig.compactMidTurnDesc", fallbackSection: "Context Compaction", fallbackLabel: "Compact Mid-Turn", fallbackDesc: "Check context limits between tool execution steps.", scope: "Native OMP" },
  // Memory & Auto-Learn
  { id: "memory-backend", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.memoryBackend", descKey: "settingsConfig.memoryBackendDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Memory Backend", fallbackDesc: "Where durable knowledge is stored across sessions.", scope: "Native OMP" },
  { id: "enable-auto-learn", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.enableAutoLearn", descKey: "settingsConfig.enableAutoLearnDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Enable Auto-Learn", fallbackDesc: "Capture reusable lessons after completed runs.", scope: "Native OMP" },
  { id: "private-capture-turn", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.privateCaptureTurn", descKey: "settingsConfig.privateCaptureTurnDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Private Capture Turn", fallbackDesc: "Run private lesson-capture turn at completion.", scope: "Native OMP" },
  { id: "memory-scope", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.memoryScope", descKey: "settingsConfig.memoryScopeDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Memory Scope", fallbackDesc: "Scoping for Mnemopi knowledge storage.", scope: "Native OMP" },
  { id: "recall-on-session-start", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.recallOnSessionStart", descKey: "settingsConfig.recallOnSessionStartDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Recall on Session Start", fallbackDesc: "Load relevant memories into first turn.", scope: "Native OMP" },
  { id: "retain-completed-turns", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.retainCompletedTurns", descKey: "settingsConfig.retainCompletedTurnsDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Retain Completed Turns", fallbackDesc: "Store completed conversation turns in memory.", scope: "Native OMP" },
  // Automatic Retry
  { id: "automatic-retry", tab: "intelligence", sectionKey: "settingsConfig.automaticRetry", labelKey: "settingsConfig.retryToggle", descKey: "settingsConfig.retryToggleDesc", fallbackSection: "Automatic Retry", fallbackLabel: "Automatic Retry", fallbackDesc: "Retry failed turns automatically.", scope: "Native OMP" },
  { id: "max-attempts", tab: "intelligence", sectionKey: "settingsConfig.automaticRetry", labelKey: "settingsConfig.maxAttempts", descKey: "settingsConfig.maxAttemptsDesc", fallbackSection: "Automatic Retry", fallbackLabel: "Max Attempts", fallbackDesc: "Retry limit before giving up.", scope: "Native OMP" },
  { id: "model-fallback", tab: "intelligence", sectionKey: "settingsConfig.automaticRetry", labelKey: "settingsConfig.modelFallback", descKey: "settingsConfig.modelFallbackDesc", fallbackSection: "Automatic Retry", fallbackLabel: "Model Fallback", fallbackDesc: "Fall back to alternative model when retries exhaust.", scope: "Native OMP" },
  // Agents
  { id: "agent-roster", tab: "agents", sectionKey: "settingsConfig.agentsTitle", labelKey: "settingsTabs.agents.label", descKey: "settingsTabs.agents.description", fallbackSection: "Agents", fallbackLabel: "Agent roster", fallbackDesc: "Browse enabled agents filtered by name and source.", scope: "Native OMP" },
  { id: "agent-model", tab: "agents", sectionKey: "settingsConfig.agentsTitle", labelKey: "agentsConfig.modelRoles", descKey: "modelsConfig.modelRolesDesc", fallbackSection: "Agents", fallbackLabel: "Agent model", fallbackDesc: "Model mapping and reasoning effort per agent role.", scope: "Native OMP" },
  { id: "agent-tools", tab: "agents", sectionKey: "settingsConfig.agentsTitle", labelKey: "agentsConfig.tools", descKey: "settingsTabs.agents.description", fallbackSection: "Agents", fallbackLabel: "Agent tools", fallbackDesc: "Allowed tools and delegated task prompt per agent.", scope: "Native OMP" },
  // Extensions & Tools
  { id: "load-project-mcp-servers", tab: "mcp", sectionKey: "settingsConfig.extensionsTools", labelKey: "settingsConfig.loadProjectMcp", descKey: "settingsConfig.loadProjectMcpDesc", fallbackSection: "Extensions & Tools", fallbackLabel: "Load Project MCP Servers", fallbackDesc: "Allow project-root MCP configuration to be discovered.", scope: "Native OMP" },
  { id: "render-mcp-markdown", tab: "mcp", sectionKey: "settingsConfig.extensionsTools", labelKey: "settingsConfig.renderMcpMarkdown", descKey: "settingsConfig.renderMcpMarkdownDesc", fallbackSection: "Extensions & Tools", fallbackLabel: "Render MCP Markdown", fallbackDesc: "Render non-JSON MCP results as Markdown in transcript.", scope: "Native OMP" },
  { id: "mcp-resource-updates", tab: "mcp", sectionKey: "settingsConfig.extensionsTools", labelKey: "settingsConfig.mcpResourceUpdates", descKey: "settingsConfig.mcpResourceUpdatesDesc", fallbackSection: "Extensions & Tools", fallbackLabel: "MCP Resource Updates", fallbackDesc: "Inject server resource updates into conversation.", scope: "Native OMP" },
  // Usage & Analytics
  { id: "usage-summary", tab: "usage", sectionKey: "settingsTabs.usage.label", labelKey: "usageConfig.title", descKey: "settingsTabs.usage.description", fallbackSection: "Usage", fallbackLabel: "Usage & Analytics", fallbackDesc: "Tokens, costs, cache analytics, and model breakdown", scope: "UI" },
  { id: "token-cost", tab: "usage", sectionKey: "settingsTabs.usage.label", labelKey: "usageConfig.rawTokenCost", descKey: "usageConfig.billedAtFullRate", fallbackSection: "Usage", fallbackLabel: "Raw Token Cost", fallbackDesc: "Token expenditure across providers and models", scope: "UI" },
  { id: "cache-savings", tab: "usage", sectionKey: "settingsTabs.usage.label", labelKey: "usageConfig.cacheSavings", descKey: "usageConfig.costQuality", fallbackSection: "Usage", fallbackLabel: "Cache Savings", fallbackDesc: "Prompt caching savings and cost quality breakdown", scope: "UI" },
  { id: "model-breakdown", tab: "usage", sectionKey: "settingsTabs.usage.label", labelKey: "usageConfig.breakdown", descKey: "usageConfig.model", fallbackSection: "Usage", fallbackLabel: "Model Breakdown", fallbackDesc: "Historical token usage and cost per model, day, and project", scope: "UI" },
  // Windows Background Service & System Tray
  { id: "windows-service-autostart", tab: "system", sectionKey: "settingsConfig.windowsServiceTitle", labelKey: "settingsConfig.windowsServiceAutostart", descKey: "settingsConfig.windowsServiceAutostartDesc", fallbackSection: "Windows Background Service & System Tray", fallbackLabel: "Start with Windows", fallbackDesc: "Launch background service quietly in system tray when logging into Windows.", scope: "UI" },
  { id: "windows-service-shortcuts", tab: "system", sectionKey: "settingsConfig.windowsServiceTitle", labelKey: "settingsConfig.windowsServiceInstallBtn", descKey: "settingsConfig.windowsServiceDesc", fallbackSection: "Windows Background Service & System Tray", fallbackLabel: "Install Service & Shortcuts", fallbackDesc: "Manage background service execution, system tray monitor, Windows logon autostart, and Desktop shortcuts.", scope: "UI" },
];

function SearchResultsList({ results, query, onSelect }: { results: SearchResult[]; query: string; onSelect: (result: SearchResult) => void }) {
  const { t, tn } = useI18n();
  const isMobile = useIsMobile();
  const formatScope = (s?: string) => {
    if (s === "UI") return t("settingsConfig.chipUI");
    if (s === "Native OMP") return t("settingsConfig.chipNativeOMP");
    if (s === "Workspace") return t("settingsConfig.chipWorkspace");
    return s;
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--bg)", padding: isMobile ? "16px 14px 32px" : "32px 24px 64px" }}>
      <div className="settings-panel-inner" style={{ gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>
          {results.length === 0 ? t("settingsConfig.noSettingsMatch", { query }) : tn("settingsConfig.searchResults", results.length, { count: results.length, query })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => onSelect(result)}
              className="settings-card"
              onMouseMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                event.currentTarget.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
                event.currentTarget.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.removeProperty("--spot-x");
                event.currentTarget.style.removeProperty("--spot-y");
              }}
              style={{
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
                padding: "14px 18px",
                width: "100%",
                boxSizing: "border-box",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{result.label}</span>
                {result.kind === "category" && (
                  <span style={chipStyle}>{t("settingsConfig.chipSection")}</span>
                )}
                {result.scope && (
                  <span style={chipStyle}>{formatScope(result.scope)}</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{result.description}</div>
              {result.section && <div style={{ fontSize: 10.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{result.section}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="ui-focus-ring"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        width: 40,
        height: 24,
        borderRadius: 12,
        border: "none",
        background: checked ? "var(--accent-strong)" : "var(--border)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background var(--dur-fast)",
        padding: 2,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          background: "#fff",
          transform: checked ? "translateX(16px)" : "translateX(0px)",
          transition: "transform var(--dur-fast)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

function NativeSetting({ label, description, scope, searchId, children }: { label: string; description: string; scope?: "UI" | "Native OMP" | "Workspace"; searchId?: string; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const highlightId = useContext(SettingsHighlightContext);
  const settingSlug = searchId || slugify(label);
  const highlighted = highlightId !== null && (highlightId === settingSlug || highlightId === slugify(label));
  const settingId = 'setting-' + settingSlug;
  const labelId = 'setting-label-' + settingSlug;
  const descId = 'setting-desc-' + settingSlug;

  const formatScope = (s?: string) => {
    if (s === "UI") return t("settingsConfig.chipUI");
    if (s === "Native OMP") return t("settingsConfig.chipNativeOMP");
    if (s === "Workspace") return t("settingsConfig.chipWorkspace");
    return s;
  };

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  let enhancedChild = children;
  if (isValidElement(children)) {
    const childProps = children.props as EnhancedChildProps;
    enhancedChild = cloneElement(children as ReactElement<EnhancedChildProps>, {
      id: childProps.id || settingId,
      "aria-labelledby": childProps["aria-labelledby"] || labelId,
      "aria-describedby": childProps["aria-describedby"] || descId,
      "aria-label": childProps["aria-label"] || label,
    });
  }

  return (
    <div
      ref={ref}
      data-search-id={settingSlug}
      className="settings-card"
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
        event.currentTarget.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.removeProperty("--spot-x");
        event.currentTarget.style.removeProperty("--spot-y");
      }}
      style={{
        minWidth: 0,
        width: "100%",
        boxSizing: "border-box",
        marginBottom: 10,
        transition: "box-shadow var(--dur-fast), border-color var(--dur-fast)",
        ...(highlighted ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent)" } : {}),
      }}
    >
      <div className="settings-card-text">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <label id={labelId} htmlFor={settingId} className="settings-card-title" style={{ cursor: "pointer" }}>{label}</label>
          {scope && (
            <span style={chipStyle}>
              {formatScope(scope)}
            </span>
          )}
        </div>
        <span id={descId} className="settings-card-desc">{description}</span>
      </div>
      <span style={{ flexShrink: 0 }}>{enhancedChild}</span>
    </div>
  );
}

export function SettingsConfig({ activeTab, toolCallsDefaultCollapsed, onToolCallsDefaultCollapsedChange, providerUsageVisible, onProviderUsageVisibleChange, scopeNativeSelectAll, onScopeNativeSelectAllChange, emptyDotGridEnabled, onEmptyDotGridChange, cwd, sessionId, onModelsSaved, onPluginsReloaded, appUpdate, ompUpdateAvailable, onRefreshAppUpdate, onOmpUpdateAvailabilityChange, onRequestAppUpdate, onSelectTab, onClose }: {
  activeTab: SettingsTab;
  toolCallsDefaultCollapsed: boolean;
  onToolCallsDefaultCollapsedChange: (collapsed: boolean) => void;
  providerUsageVisible: boolean;
  onProviderUsageVisibleChange: (visible: boolean) => void;
  scopeNativeSelectAll: boolean;
  onScopeNativeSelectAllChange: (enabled: boolean) => void;
  emptyDotGridEnabled: boolean;
  onEmptyDotGridChange: (enabled: boolean) => void;
  cwd: string | null;
  sessionId: string | null;
  onModelsSaved: () => void;
  onPluginsReloaded: () => void;
  appUpdate: AppUpdateInfo | null;
  ompUpdateAvailable?: boolean;
  onRefreshAppUpdate: (force?: boolean) => Promise<AppUpdateInfo | null>;
  onOmpUpdateAvailabilityChange: (available: boolean) => void;
  onRequestAppUpdate: () => void;
  onSelectTab: (tab: SettingsTab) => void;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const workspaceReady = cwd !== null;
  const { fontSize, setFontSize } = useFontSize();
  const { uiScale, setUiScale } = useUiScale();
  const {
    isSupported: ttsSupported,
    autoPlayEnabled: ttsAutoPlay,
    setAutoPlay: setTtsAutoPlay,
    voices: ttsVoices,
    selectedVoiceURI: ttsVoiceURI,
    setSelectedVoiceURI: setTtsVoiceURI,
  } = useSpeechSynthesis();
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [submitBehavior, setSubmitBehavior] = useState<SubmitDuringRunBehavior>(() => getSubmitDuringRunBehavior());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const value = window.localStorage.getItem("omp-sound-enabled");
      return value === null ? true : value === "true";
    } catch {
      return true;
    }
  });
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  const [appUpdateMessage, setAppUpdateMessage] = useState<string | null>(null);
  const [hasCheckedUpdates, setHasCheckedUpdates] = useState(false);
  const [ompUpdating, setOmpUpdating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [windowsService, setWindowsService] = useState<WindowsServiceStatus | null>(null);
  const [loadingWindowsService, setLoadingWindowsService] = useState(false);
  const [windowsServiceActionPending, setWindowsServiceActionPending] = useState(false);

  const ompUpdateIsAvailable = Boolean(ompUpdateAvailable || update?.updateAvailable);
  const appUpdateIsAvailable = Boolean(appUpdate?.updateAvailable);
  const systemNeedsAttention = appUpdateIsAvailable || ompUpdateIsAvailable;

  const attentionTabs = useMemo<Partial<Record<SettingsTab, boolean | string>>>(() => {
    const tabs: Partial<Record<SettingsTab, boolean | string>> = {};
    if (systemNeedsAttention) {
      tabs.system = t("settingsTabs.updateAvailable");
    }
    return tabs;
  }, [systemNeedsAttention, t]);

  const fetchWindowsServiceStatus = useCallback(async () => {
    try {
      setLoadingWindowsService(true);
      const res = await fetch("/api/windows-service");
      if (res.ok) {
        const data = (await res.json()) as WindowsServiceStatus;
        setWindowsService(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingWindowsService(false);
    }
  }, []);

  const performWindowsServiceAction = useCallback(async (action: "install" | "uninstall" | "toggle-autostart" | "start" | "stop" | "restart", payload: object = {}) => {
    try {
      setWindowsServiceActionPending(true);
      setMessage(null);
      const res = await fetch("/api/windows-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string; status?: WindowsServiceStatus; message?: string };
      if (!res.ok || data.error) {
        setMessage(data.error || t("settingsConfig.windowsServiceActionFailed"));
      } else {
        if (data.status) setWindowsService(data.status);
        setMessage(data.message || t("settingsConfig.windowsServiceActionSuccess"));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("settingsConfig.windowsServiceActionFailed"));
    } finally {
      setWindowsServiceActionPending(false);
    }
  }, [t]);


  const [nativeSettings, setNativeSettings] = useState<NativeSettings | null>(null);
  const [nativeSettingsError, setNativeSettingsError] = useState<string | null>(null);
  const [nativeSavesInFlight, setNativeSavesInFlight] = useState(0);
  const [isPending, startTransition] = useTransition();
  const latestNativeSettingsRef = useRef<NativeSettings | null>(null);
  const nativeSaveDrainingRef = useRef(false);
  const nativeSettingsMutatedRef = useRef(false);

  useEffect(() => {
    fetch("/api/omp-settings")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: { settings?: NativeSettings }) => {
        if (!nativeSettingsMutatedRef.current) setNativeSettings(data.settings ?? {});
      })
      .catch((error) => setNativeSettingsError(error instanceof Error ? error.message : String(error)));
  }, []);

  const saveNativeSettings = useCallback((next: NativeSettings) => {
    nativeSettingsMutatedRef.current = true;
    setNativeSettings(next);
    setNativeSettingsError(null);
    latestNativeSettingsRef.current = next;
    if (nativeSaveDrainingRef.current) return;
    nativeSaveDrainingRef.current = true;
    setNativeSavesInFlight((count) => count + 1);

    void (async () => {
      try {
        while (latestNativeSettingsRef.current !== null) {
          const snapshot = latestNativeSettingsRef.current;
          latestNativeSettingsRef.current = null;
          try {
            const response = await fetch("/api/omp-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: snapshot }) });
            const data = (await response.json()) as { settings?: NativeSettings; error?: string };
            if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
            if (latestNativeSettingsRef.current === null) setNativeSettings(data.settings ?? snapshot);
          } catch (error) {
            setNativeSettingsError(error instanceof Error ? error.message : String(error));
            break;
          }
        }
      } finally {
        nativeSaveDrainingRef.current = false;
        setNativeSavesInFlight((count) => Math.max(0, count - 1));
      }
    })();
  }, []);

  const currentSettings = useCallback((): NativeSettings => latestNativeSettingsRef.current ?? nativeSettings ?? {}, [nativeSettings]);

  const patchSettings = useCallback((patch: Partial<NativeSettings>) => {
    void saveNativeSettings({ ...currentSettings(), ...patch });
  }, [currentSettings, saveNativeSettings]);

  const patchSection = useCallback(<K extends keyof NativeSettings,>(key: K, patch: Partial<NonNullable<NativeSettings[K]>>) => {
    const base = latestNativeSettingsRef.current;
    const section = (base ?? nativeSettings?.[key] ?? {}) as object;
    void saveNativeSettings({ ...currentSettings(), [key]: { ...section, ...patch } });
  }, [currentSettings, nativeSettings, saveNativeSettings]);

  const patchApproval = useCallback((patch: Partial<NonNullable<NonNullable<NativeSettings["tools"]>["approval"]>>) => {
    const base = latestNativeSettingsRef.current ?? nativeSettings ?? {};
    const tools = base.tools ?? {};
    void saveNativeSettings({ ...base, tools: { ...tools, approval: { ...(tools.approval ?? {}), ...patch } } });
  }, [nativeSettings, saveNativeSettings]);

  const checkForUpdate = useCallback(async (force = false) => {
    setChecking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", ...(force ? { force: true } : {}) }) });
      const data = (await response.json()) as UpdateState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setUpdate(data);
      onOmpUpdateAvailabilityChange(data.updateAvailable);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, [onOmpUpdateAvailabilityChange]);

  const checkForAppUpdate = useCallback(async (force = false) => {
    setCheckingAppUpdate(true);
    setAppUpdateMessage(null);
    try {
      await onRefreshAppUpdate(force);
    } catch (error) {
      setAppUpdateMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingAppUpdate(false);
    }
  }, [onRefreshAppUpdate]);

  const restartSessions = useCallback(async () => {
    setRestarting(true);
    try {
      const response = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restart" }) });
      const data = (await response.json()) as { error?: string; sessionsRestarted?: number };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(t("settingsConfig.restartSuccess", { count: data.sessionsRestarted ?? 0 }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRestarting(false);
    }
  }, [t]);
  const handleOmpUpdateNow = useCallback(async () => {
    if (ompUpdating) return;
    setOmpUpdating(true);
    setMessage(null);
    try {
      const prepRes = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update" }) });
      const prepData = (await prepRes.json()) as { attemptId?: string; error?: string; code?: string };
      if (!prepRes.ok || !prepData.attemptId) throw new Error(prepData.error || `HTTP ${prepRes.status}`);
      const commitRes = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit", attemptId: prepData.attemptId }) });
      const commitData = (await commitRes.json()) as { error?: string };
      if (!commitRes.ok) throw new Error(commitData.error || `HTTP ${commitRes.status}`);
      const deadline = Date.now() + 5 * 60 * 1000;
      while (true) {
        if (Date.now() > deadline) throw new Error(t("settingsConfig.ompUpdateFailed"));
        await new Promise((r) => setTimeout(r, 500));
        const statusRes = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) });
        const status = (await statusRes.json()) as { state?: string; error?: string } | null;
        if (!status) break;
        if (status.state === "succeeded") {
          setMessage(t("settingsConfig.ompUpdateSuccess"));
          await checkForUpdate(true);
          try { await restartSessions(); } catch {}
          break;
        }
        if (status.state === "failed") throw new Error(status.error || t("settingsConfig.ompUpdateFailed"));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOmpUpdating(false);
    }
  }, [ompUpdating, t, checkForUpdate, restartSessions]);


  const currentTab = getNormalizedActive(activeTab);
  useEffect(() => {
    if (currentTab === "system") {
      void fetchWindowsServiceStatus();
    }
  }, [currentTab, fetchWindowsServiceStatus]);

  useEffect(() => {
    if (currentTab !== "system" || hasCheckedUpdates) return;
    setHasCheckedUpdates(true);
    void checkForUpdate();
  }, [currentTab, hasCheckedUpdates, checkForUpdate]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const searchActive = trimmedQuery.length > 0;

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!trimmedQuery) return [];
    const results: SearchResult[] = [];
    for (const category of SETTINGS_CATEGORIES) {
      const labelKeyCat = `settingsTabs.${category.id}.label`;
      const descKeyCat = `settingsTabs.${category.id}.description`;
      const trLabelCat = t(labelKeyCat);
      const trDescCat = t(descKeyCat);
      const localizedLabel = trLabelCat !== labelKeyCat ? trLabelCat : category.label;
      const localizedDesc = trDescCat !== descKeyCat ? trDescCat : category.description;
      const haystack = `${localizedLabel} ${localizedDesc} ${category.label} ${category.description}`.toLowerCase();
      if (haystack.includes(trimmedQuery)) {
        results.push({ id: `tab-${category.id}`, kind: "category", tab: category.id, label: localizedLabel, description: localizedDesc });
      }
    }
    for (const setting of SETTING_INDEX) {
      const trLabel = t(setting.labelKey);
      const trDesc = t(setting.descKey);
      const trSection = t(setting.sectionKey);
      const localizedLabel = trLabel !== setting.labelKey ? trLabel : setting.fallbackLabel;
      const localizedDesc = trDesc !== setting.descKey ? trDesc : setting.fallbackDesc;
      const localizedSection = trSection !== setting.sectionKey ? trSection : setting.fallbackSection;
      const haystack = `${localizedLabel} ${localizedDesc} ${localizedSection} ${setting.fallbackLabel} ${setting.fallbackDesc} ${setting.fallbackSection}`.toLowerCase();
      if (haystack.includes(trimmedQuery)) {
        results.push({ id: setting.id, kind: "setting", tab: setting.tab, label: localizedLabel, description: localizedDesc, scope: setting.scope, section: localizedSection });
      }
    }
    return results;
  }, [trimmedQuery, t]);

  const openSearchResult = useCallback((result: SearchResult) => {
    startTransition(() => onSelectTab(result.tab));
    setHighlightId(result.kind === "setting" ? result.id : null);
    setSearchQuery("");
  }, [onSelectTab]);

  const handleSelectTab = useCallback((tab: SettingsTab) => {
    startTransition(() => onSelectTab(tab));
  }, [onSelectTab]);

  const contentStyle = useMemo(() => ({
    flex: 1 as const,
    minHeight: 0,
    display: "flex" as const,
    flexDirection: "column" as const,
    overflowY: "auto" as const,
    background: "var(--bg)" as const,
    opacity: isPending ? 0.92 : 1,
    transition: isPending ? "opacity 80ms ease-out" : "opacity 120ms ease-out",
  }), [isPending]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "INPUT" && (target as HTMLInputElement).value) return;
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="settings-view" role="region" aria-label={t("settingsConfig.title")}>
      <header className="settings-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            className="settings-back"
            onClick={onClose}
            aria-label={t("settingsConfig.back")}
            title={`${t("settingsConfig.back")} (Esc)`}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            <span>{t("settingsConfig.back")}</span>
          </button>
          <span style={{ width: 1, height: 18, background: "var(--border)", opacity: 0.8 }} aria-hidden="true" />
          <h1 style={{ fontSize: 15, margin: 0, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>
            {t("settingsConfig.title")}
          </h1>
          {nativeSavesInFlight > 0 ? (
            <span style={{ fontSize: 11, color: "var(--accent)", padding: "2px 8px", borderRadius: 10, background: "var(--bg-subtle)", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <RefreshCw size={11} className="spin" aria-hidden="true" /> {t("settingsConfig.saving")}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: "var(--text-dim)", padding: "2px 8px", borderRadius: 10, background: "var(--bg-subtle)" }}>
              {t("settingsConfig.autoSaved")}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, maxWidth: 380, justifyContent: "flex-end" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: 280 }}>
            <Search size={13} aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input
              type="text"
              aria-label={t("settingsConfig.searchPlaceholder")}
              placeholder={t("settingsConfig.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (searchQuery) {
                    e.stopPropagation();
                    setSearchQuery("");
                    setHighlightId(null);
                  } else {
                    onClose();
                  }
                  (e.target as HTMLInputElement).blur();
                }
              }}
              style={{ width: "100%", height: 30, padding: "0 28px 0 30px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(""); setHighlightId(null); }}
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex", alignItems: "center", justifyContent: "center" }}
                aria-label="Clear search"
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("settingsConfig.closeSettings")}
            title={`${t("settingsConfig.closeSettings")} (Esc)`}
            className="settings-close-btn ui-focus-ring"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="settings-body">
        {searchActive ? (
          <SearchResultsList results={searchResults} query={searchQuery.trim()} onSelect={openSearchResult} />
        ) : (
          <SettingsHighlightContext.Provider value={highlightId}>
            <SettingsTabs active={currentTab} onSelect={handleSelectTab} workspaceReady={workspaceReady} layout={isMobile ? "horizontal" : "vertical"} attentionTabs={attentionTabs} />

            <div className="settings-content" style={contentStyle}>
            {nativeSettingsError && (
              <div style={{ margin: 16 }}>
                <Alert variant="error" description={nativeSettingsError} onDismiss={() => setNativeSettingsError(null)} />
              </div>
            )}

            {/* GENERAL & UI TAB */}
            {currentTab === "general" && (
              <div role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general" className="settings-panel-inner" style={{ padding: isMobile ? "16px 14px 32px" : "32px 24px 64px", gap: 16 }}>
                <div style={{ marginBottom: 4 }}>
                  <h2 className="display-serif" style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--text)", letterSpacing: "-0.01em" }}>{t("settingsConfig.interfaceBehavior")}</h2>
                  <p className="settings-content-subtitle" style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>{t("settingsConfig.interfaceBehaviorDesc")}</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
                  <NativeSetting searchId="keep-tool-calls-collapsed" label={t("settingsConfig.keepToolCallsCollapsed")} description={t("settingsConfig.keepToolCallsCollapsedDesc")} scope="UI">
                    <ToggleSwitch checked={toolCallsDefaultCollapsed} onChange={onToolCallsDefaultCollapsedChange} />
                  </NativeSetting>
                  <NativeSetting searchId="scope-native-select-all" label={t("settingsConfig.scopeNativeSelectAll")} description={t("settingsConfig.scopeNativeSelectAllDesc")} scope="UI">
                    <ToggleSwitch checked={scopeNativeSelectAll} onChange={onScopeNativeSelectAllChange} />
                  </NativeSetting>
                  <NativeSetting searchId="empty-dot-grid" label={t("settingsConfig.emptyDotGrid")} description={t("settingsConfig.emptyDotGridDesc")} scope="UI">
                    <ToggleSwitch checked={emptyDotGridEnabled} onChange={onEmptyDotGridChange} />
                  </NativeSetting>
                  <NativeSetting searchId="completion-sound" label={t("settingsConfig.completionSound")} description={t("settingsConfig.completionSoundDesc")} scope="UI">
                    <ToggleSwitch
                      checked={soundEnabled}
                      onChange={(next) => {
                        setSoundEnabled(next);
                        try { localStorage.setItem("omp-sound-enabled", String(next)); } catch { /* storage fallback */ }
                        window.dispatchEvent(new CustomEvent("omp-sound-pref-change", { detail: next }));
                      }}
                    />
                  </NativeSetting>
                  <NativeSetting
                    searchId="tts-autoplay"
                    label={t("settingsConfig.ttsAutoplay") || "Auto-read assistant responses"}
                    description={ttsSupported ? (t("settingsConfig.ttsAutoplayDesc") || "Automatically read aloud new assistant replies when completed.") : `${t("settingsConfig.ttsAutoplayDesc") || "Automatically read aloud new assistant replies when completed."} (${t("settingsConfig.ttsNotSupported") || "Not supported in this browser"})`}
                    scope="UI"
                  >
                    <ToggleSwitch
                      checked={ttsSupported ? ttsAutoPlay : false}
                      disabled={!ttsSupported}
                      onChange={setTtsAutoPlay}
                    />
                  </NativeSetting>
                  <NativeSetting
                    searchId="tts-voice"
                    label={t("settingsConfig.ttsVoice") || "Speech Voice"}
                    description={ttsSupported ? (t("settingsConfig.ttsVoiceDesc") || "Select the browser voice for text-to-speech reading.") : `${t("settingsConfig.ttsVoiceDesc") || "Select the browser voice for text-to-speech reading."} (${t("settingsConfig.ttsNotSupported") || "Not supported in this browser"})`}
                    scope="UI"
                  >
                    <GlideSelect
                      value={ttsVoiceURI || ""}
                      onChange={(v) => setTtsVoiceURI(v || null)}
                      options={[{ value: "", label: t("settingsConfig.defaultVoice") || "Default system voice" }, ...ttsVoices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` }))]}
                      disabled={!ttsSupported || ttsVoices.length === 0}
                      menuWidth={260}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="provider-usage" label={t("settingsConfig.providerUsage")} description={t("settingsConfig.providerUsageDesc")} scope="UI">
                    <ToggleSwitch checked={providerUsageVisible} onChange={onProviderUsageVisibleChange} />
                  </NativeSetting>
                  <NativeSetting searchId="chat-font-size" label={t("settingsConfig.chatFontSize")} description={t("settingsConfig.chatFontSizeDesc")} scope="UI">
                    <GlideSelect
                      value={fontSize}
                      onChange={(v) => setFontSize(v as FontSizePreference)}
                      options={[{ value: "sm", label: t("settingsConfig.fontSizeSmall") }, { value: "md", label: t("settingsConfig.fontSizeMedium") }, { value: "lg", label: t("settingsConfig.fontSizeLarge") }, { value: "xl", label: t("settingsConfig.fontSizeXLarge") }]}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="ui-scale" label={t("settingsConfig.uiScale")} description={t("settingsConfig.uiScaleDesc")} scope="UI">
                    <GlideSelect
                      value={uiScale}
                      onChange={(v) => setUiScale(v as UiScalePreference)}
                      options={[{ value: "compact", label: t("settingsConfig.uiScaleCompact") }, { value: "standard", label: t("settingsConfig.uiScaleStandard") }, { value: "comfortable", label: t("settingsConfig.uiScaleComfortable") }, { value: "large", label: t("settingsConfig.uiScaleLarge") }]}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="message-during-active-run" label={t("settingsConfig.messageDuringActiveRun")} description={t("settingsConfig.messageDuringActiveRunDesc")} scope="UI">
                    <GlideSelect
                      value={submitBehavior}
                      onChange={(v) => { const next = v as SubmitDuringRunBehavior; setSubmitDuringRunBehavior(next); setSubmitBehavior(next); }}
                      options={[{ value: "steer", label: t("settingsConfig.steerCurrentRun") }, { value: "queue", label: t("settingsConfig.queueFollowUp") }]}
                    />
                  </NativeSetting>
                </div>
              </div>
            )}

            {/* SAFETY & APPROVALS TAB */}
            {currentTab === "safety" && (
              <div role="tabpanel" id="settings-panel-safety" aria-labelledby="settings-tab-safety" className="settings-panel-inner" style={{ padding: isMobile ? "16px 14px 32px" : "32px 24px 64px", gap: 16 }}>
                <div style={{ marginBottom: 4 }}>
                  <h2 className="display-serif" style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--text)", letterSpacing: "-0.01em" }}>{t("settingsConfig.toolSafetyApprovals")}</h2>
                  <p className="settings-content-subtitle" style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>{t("settingsConfig.toolSafetyApprovalsDesc")}</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
                  <NativeSetting searchId="approval-mode" label={t("settingsConfig.approvalMode")} description={t("settingsConfig.approvalModeDesc")} scope="Native OMP">
                    <GlideSelect
                      value={nativeSettings?.tools?.approvalMode ?? "yolo"}
                      onChange={(v) => patchSection("tools", { approvalMode: v as "always-ask" | "write" | "yolo" })}
                      options={[{ value: "always-ask", label: t("settingsConfig.alwaysAsk") }, { value: "write", label: t("settingsConfig.allowWrites") }, { value: "yolo", label: t("settingsConfig.autoApproveYolo") }]}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="bash-override" label={t("settingsConfig.bashOverride")} description={t("settingsConfig.bashOverrideDesc")} scope="Native OMP">
                    <GlideSelect
                      value={nativeSettings?.tools?.approval?.bash ?? "prompt"}
                      onChange={(v) => patchApproval({ bash: v as "allow" | "prompt" | "deny" })}
                      options={[{ value: "allow", label: t("settingsConfig.allow") }, { value: "prompt", label: t("settingsConfig.alwaysAsk") }, { value: "deny", label: t("settingsConfig.deny") }]}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="extension-tool-requests" label={t("settingsConfig.extensionToolRequests")} description={t("settingsConfig.extensionToolRequestsDesc")} scope="Native OMP">
                    <GlideSelect
                      value={nativeSettings?.tools?.approval?.extension ?? "prompt"}
                      onChange={(v) => patchApproval({ extension: v as "allow" | "prompt" })}
                      options={[{ value: "prompt", label: t("settingsConfig.askEveryTime") }, { value: "allow", label: t("settingsConfig.autoApprove") }]}
                    />
                  </NativeSetting>
                </div>
              </div>
            )}

            {/* AI MODEL DEFAULTS TAB */}
            {currentTab === "models" && (
              <div role="tabpanel" id="settings-panel-models" aria-labelledby="settings-tab-models" className="settings-panel-inner" style={{ padding: isMobile ? "16px 14px 32px" : "32px 24px 64px", gap: 16 }}>
                <div style={{ marginBottom: 4 }}>
                  <h2 className="display-serif" style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--text)", letterSpacing: "-0.01em" }}>{t("settingsConfig.modelDefaults")}</h2>
                  <p className="settings-content-subtitle" style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>{t("settingsConfig.modelDefaultsDesc")}</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
                  <NativeSetting searchId="reasoning" label={t("settingsConfig.reasoning")} description={t("settingsConfig.reasoningDesc")} scope="Native OMP">
                    <GlideSelect
                      value={nativeSettings?.defaultThinkingLevel ?? "high"}
                      onChange={(v) => patchSettings({ defaultThinkingLevel: v as NativeSettings["defaultThinkingLevel"] })}
                      options={["auto", "minimal", "low", "medium", "high", "xhigh", "max"]}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="verbosity" label={t("settingsConfig.verbosity")} description={t("settingsConfig.verbosityDesc")} scope="Native OMP">
                    <GlideSelect
                      value={nativeSettings?.textVerbosity ?? "medium"}
                      onChange={(v) => patchSettings({ textVerbosity: v as NativeSettings["textVerbosity"] })}
                      options={[{ value: "low", label: t("settingsConfig.verbosityLow") }, { value: "medium", label: t("settingsConfig.verbosityMedium") }, { value: "high", label: t("settingsConfig.verbosityHigh") }]}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="personality" label={t("settingsConfig.personality")} description={t("settingsConfig.personalityDesc")} scope="Native OMP">
                    <GlideSelect
                      value={nativeSettings?.personality ?? "default"}
                      onChange={(v) => patchSettings({ personality: v as NativeSettings["personality"] })}
                      options={[{ value: "default", label: t("settingsConfig.personalityDefault") }, { value: "friendly", label: t("settingsConfig.personalityFriendly") }, { value: "pragmatic", label: t("settingsConfig.personalityPragmatic") }, { value: "none", label: t("settingsConfig.personalityNone") }]}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="thinking-blocks" label={t("settingsConfig.thinkingBlocks")} description={t("settingsConfig.thinkingBlocksDesc")} scope="Native OMP">
                    <ToggleSwitch
                      checked={nativeSettings?.hideThinkingBlock ?? false}
                      onChange={(checked) => patchSettings({ hideThinkingBlock: checked })}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="external-thinking" label={t("settingsConfig.externalThinking")} description={t("settingsConfig.externalThinkingDesc")} scope="Native OMP">
                    <ToggleSwitch
                      checked={nativeSettings?.externalThinking ?? false}
                      onChange={(checked) => patchSettings({ externalThinking: checked })}
                    />
                  </NativeSetting>
                </div>
              </div>
            )}

            {/* API KEYS & PROVIDERS TAB */}
            {currentTab === "providers" && (
              <div role="tabpanel" id="settings-panel-providers" aria-labelledby="settings-tab-providers" className="settings-panel-inner" style={{ display: currentTab === "providers" ? "flex" : "none", width: "100%", maxWidth: 940, minHeight: 0, flexDirection: "column", padding: isMobile ? "16px 14px 32px" : "32px 24px 64px" }}>
                <div style={{ marginBottom: 12 }}>
                  <h2 className="display-serif" style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--text)", letterSpacing: "-0.01em" }}>{t("settingsTabs.providers.label")}</h2>
                  <p className="settings-content-subtitle" style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>{t("settingsTabs.providers.description")}</p>
                </div>
                <ModelsConfig embedded onClose={onClose} onSaved={onModelsSaved} />
              </div>
            )}

            {/* USAGE & ANALYTICS TAB */}
            {currentTab === "usage" && (
              <div
                role="tabpanel"
                id="settings-panel-usage"
                aria-labelledby="settings-tab-usage"
                className="settings-panel-inner"
                style={{
                  display: currentTab === "usage" ? "flex" : "none",
                  width: "100%",
                  maxWidth: 940,
                  minHeight: 0,
                  flexDirection: "column",
                  padding: isMobile ? "16px 14px 32px" : "32px 24px 64px",
                }}
              >
                <UsageConfig />
              </div>
            )}

            {/* AGENT INTELLIGENCE TAB */}
            {currentTab === "intelligence" && (
              <div role="tabpanel" id="settings-panel-intelligence" aria-labelledby="settings-tab-intelligence" className="settings-panel-inner" style={{ padding: isMobile ? "16px 14px 32px" : "32px 24px 64px", gap: 20 }}>
                <div style={{ marginBottom: 4 }}>
                  <h2 className="display-serif" style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--text)", letterSpacing: "-0.01em" }}>{t("settingsTabs.intelligence.label")}</h2>
                  <p className="settings-content-subtitle" style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>{t("settingsTabs.intelligence.description")}</p>
                </div>
                {/* Context Compaction Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 18, width: "100%" }}>
                  <div className="settings-section-title" style={{ fontSize: 13.5, fontWeight: 600, margin: 0 }}>{t("settingsConfig.contextCompaction")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.45 }}>{t("settingsConfig.contextCompactionDesc")}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4, width: "100%" }}>
                    <NativeSetting searchId="automatic-compaction" label={t("settingsConfig.automaticCompaction")} description={t("settingsConfig.automaticCompactionDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.enabled ?? true}
                        onChange={(checked) => patchSection("compaction", { enabled: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="continue-after-compaction" label={t("settingsConfig.continueAfterCompaction")} description={t("settingsConfig.continueAfterCompactionDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.autoContinue ?? true}
                        onChange={(checked) => patchSection("compaction", { autoContinue: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="maintenance-strategy" label={t("settingsConfig.maintenanceStrategy")} description={t("settingsConfig.maintenanceStrategyDesc")} scope="Native OMP">
                      <GlideSelect
                        value={nativeSettings?.compaction?.strategy ?? "snapcompact"}
                        onChange={(v) => patchSection("compaction", { strategy: v as NonNullable<NativeSettings["compaction"]>["strategy"] })}
                        options={[{ value: "snapcompact", label: t("settingsConfig.strategySnapcompact") }, { value: "handoff", label: t("settingsConfig.strategyHandoff") }, { value: "context-full", label: t("settingsConfig.strategyContextFull") }, { value: "shake", label: t("settingsConfig.strategyShake") }, { value: "off", label: t("settingsConfig.strategyOff") }]}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="compact-mid-turn" label={t("settingsConfig.compactMidTurn")} description={t("settingsConfig.compactMidTurnDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.midTurnEnabled ?? true}
                        onChange={(checked) => patchSection("compaction", { midTurnEnabled: checked })}
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* Memory & Auto-Learn Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 18, width: "100%" }}>
                  <div className="settings-section-title" style={{ fontSize: 13.5, fontWeight: 600, margin: 0 }}>{t("settingsConfig.memoryAutoLearn")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.45 }}>{t("settingsConfig.memoryAutoLearnDesc")}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4, width: "100%" }}>
                    <NativeSetting searchId="memory-backend" label={t("settingsConfig.memoryBackend")} description={t("settingsConfig.memoryBackendDesc")} scope="Native OMP">
                      <GlideSelect
                        value={nativeSettings?.memory?.backend ?? "mnemopi"}
                        onChange={(v) => patchSection("memory", { backend: v as NonNullable<NativeSettings["memory"]>["backend"] })}
                        options={[{ value: "off", label: t("settingsConfig.memoryBackendOff") }, { value: "local", label: t("settingsConfig.memoryBackendLocal") }, { value: "mnemopi", label: t("settingsConfig.memoryBackendMnemopi") }, { value: "hindsight", label: t("settingsConfig.memoryBackendHindsight") }]}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="enable-auto-learn" label={t("settingsConfig.enableAutoLearn")} description={t("settingsConfig.enableAutoLearnDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.autolearn?.enabled ?? true}
                        onChange={(checked) => patchSection("autolearn", { enabled: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="private-capture-turn" label={t("settingsConfig.privateCaptureTurn")} description={t("settingsConfig.privateCaptureTurnDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.autolearn?.autoContinue ?? true}
                        onChange={(checked) => patchSection("autolearn", { autoContinue: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="memory-scope" label={t("settingsConfig.memoryScope")} description={t("settingsConfig.memoryScopeDesc")} scope="Native OMP">
                      <GlideSelect
                        value={nativeSettings?.mnemopi?.scoping ?? "per-project"}
                        onChange={(v) => patchSection("mnemopi", { scoping: v as NonNullable<NativeSettings["mnemopi"]>["scoping"] })}
                        options={[{ value: "per-project", label: t("settingsConfig.memoryScopePerProject") }, { value: "per-project-tagged", label: t("settingsConfig.memoryScopePerProjectTagged") }, { value: "global", label: t("settingsConfig.memoryScopeGlobal") }]}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="recall-on-session-start" label={t("settingsConfig.recallOnSessionStart")} description={t("settingsConfig.recallOnSessionStartDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mnemopi?.autoRecall ?? true}
                        onChange={(checked) => patchSection("mnemopi", { autoRecall: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="retain-completed-turns" label={t("settingsConfig.retainCompletedTurns")} description={t("settingsConfig.retainCompletedTurnsDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mnemopi?.autoRetain ?? true}
                        onChange={(checked) => patchSection("mnemopi", { autoRetain: checked })}
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* Retry Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 18, width: "100%" }}>
                  <div className="settings-section-title" style={{ fontSize: 13.5, fontWeight: 600, margin: 0 }}>{t("settingsConfig.automaticRetry")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.45 }}>{t("settingsConfig.automaticRetryDesc")}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4, width: "100%" }}>
                    <NativeSetting searchId="automatic-retry" label={t("settingsConfig.retryToggle")} description={t("settingsConfig.retryToggleDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.retry?.enabled ?? true}
                        onChange={(checked) => patchSection("retry", { enabled: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="max-attempts" label={t("settingsConfig.maxAttempts")} description={t("settingsConfig.maxAttemptsDesc")} scope="Native OMP">
                      <GlideSelect
                        value={String(nativeSettings?.retry?.maxRetries ?? 2)}
                        onChange={(v) => patchSection("retry", { maxRetries: Number(v) })}
                        options={["0", "1", "2", "3", "4", "5"]}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="model-fallback" label={t("settingsConfig.modelFallback")} description={t("settingsConfig.modelFallbackDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.retry?.modelFallback ?? false}
                        onChange={(checked) => patchSection("retry", { modelFallback: checked })}
                      />
                    </NativeSetting>
                  </div>
                </section>
              </div>
            )}

            {/* EXTENSIONS & TOOLS TAB (MCP, SKILLS, PLUGINS) */}
            {currentTab === "mcp" && (
              <div role="tabpanel" id="settings-panel-mcp" aria-labelledby="settings-tab-mcp" className="settings-panel-inner" style={{ display: currentTab === "mcp" ? "flex" : "none", width: "100%", maxWidth: 940, minHeight: 0, flexDirection: "column", padding: isMobile ? "16px 14px 32px" : "32px 24px 64px", gap: 16 }}>
                <div style={{ marginBottom: 4 }}>
                  <h2 className="display-serif" style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--text)", letterSpacing: "-0.01em" }}>{t("settingsConfig.extensionsTools")}</h2>
                  <p className="settings-content-subtitle" style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>{t("settingsConfig.extensionsToolsDesc")}</p>
                </div>
                {cwd && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
                    <NativeSetting searchId="load-project-mcp-servers" label={t("settingsConfig.loadProjectMcp")} description={t("settingsConfig.loadProjectMcpDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mcp?.enableProjectConfig ?? true}
                        onChange={(checked) => patchSection("mcp", { enableProjectConfig: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="render-mcp-markdown" label={t("settingsConfig.renderMcpMarkdown")} description={t("settingsConfig.renderMcpMarkdownDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mcp?.renderMarkdownResults ?? true}
                        onChange={(checked) => patchSection("mcp", { renderMarkdownResults: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="mcp-resource-updates" label={t("settingsConfig.mcpResourceUpdates")} description={t("settingsConfig.mcpResourceUpdatesDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mcp?.notifications ?? false}
                        onChange={(checked) => patchSection("mcp", { notifications: checked })}
                      />
                    </NativeSetting>
                  </div>
                )}
                <McpConfig cwd={cwd} sessionId={sessionId} />
                {!cwd && <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.selectWorkspaceForMcp")}</p>}
              </div>
            )}

            {/* SKILLS SUB-PANEL CONTRACT MATCH */}
            {cwd && currentTab === "skills" && (
              <div role="tabpanel" id="settings-panel-skills" aria-labelledby="settings-tab-skills" className="settings-panel-inner" style={{ display: currentTab === "skills" ? "flex" : "none", width: "100%", maxWidth: 940, minHeight: isMobile ? undefined : 600, flexDirection: "column", padding: isMobile ? "16px 14px 32px" : "32px 24px 64px" }}>
                <SkillsConfig embedded cwd={cwd} onClose={onClose} />
              </div>
            )}

            {/* PLUGINS SUB-PANEL CONTRACT MATCH */}
            {cwd && currentTab === "plugins" && (
              <div role="tabpanel" id="settings-panel-plugins" aria-labelledby="settings-tab-plugins" className="settings-panel-inner" style={{ display: currentTab === "plugins" ? "flex" : "none", width: "100%", maxWidth: 940, minHeight: isMobile ? undefined : 600, flexDirection: "column", padding: isMobile ? "16px 14px 32px" : "32px 24px 64px" }}>
                <PluginsConfig embedded cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onPluginsReloaded} />
              </div>
            )}

            {/* AGENTS TAB */}
            {currentTab === "agents" && (
              <div
                role="tabpanel"
                id="settings-panel-agents"
                aria-labelledby="settings-tab-agents"
                className="settings-panel-inner"
                style={{
                  display: currentTab === "agents" ? "flex" : "none",
                  width: "100%",
                  maxWidth: 940,
                  minHeight: 0,
                  flexDirection: "column",
                  padding: isMobile ? "16px 14px 32px" : "32px 24px 64px",
                  gap: 16,
                  ...(highlightId && ["agent-roster", "agent-model", "agent-tools"].includes(highlightId)
                    ? { border: "1px solid var(--accent)", boxShadow: "0 0 0 2px var(--accent)" }
                    : {}),
                }}
              >
                <div style={{ marginBottom: 4 }}>
                  <h2 className="display-serif" style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--text)", letterSpacing: "-0.01em" }}>{t("settingsConfig.agentsTitle")}</h2>
                  <p className="settings-content-subtitle" style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>
                    {t("settingsConfig.agentsDesc")}
                  </p>
                </div>
                <AgentsConfig cwd={cwd} />
              </div>
            )}

            {/* SYSTEM & UPDATES TAB */}
            {currentTab === "system" && (
              <div role="tabpanel" id="settings-panel-system" aria-labelledby="settings-tab-system" className="settings-panel-inner" style={{ padding: isMobile ? "16px 14px 32px" : "32px 24px 64px", display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ marginBottom: 4 }}>
                  <h2 className="display-serif" style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--text)", letterSpacing: "-0.01em" }}>{t("settingsConfig.systemUpdates")}</h2>
                  <p className="settings-content-subtitle" style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>{t("settingsConfig.systemUpdatesDescription")}</p>
                </div>

                {/* omploom app update card */}
                <section style={{ padding: 14, border: appUpdateIsAvailable ? "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))" : "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.appLabel")}</span>
                        {appUpdateIsAvailable && (
                          <span
                            role="status"
                            aria-label={t("settingsTabs.updateAvailable")}
                            title={t("settingsTabs.updateAvailable")}
                            style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }}
                          />
                        )}
                      </div>
                      <div style={{ marginTop: 4, color: appUpdateIsAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {checkingAppUpdate ? t("settingsConfig.checkingUpdates") : appUpdate?.updateAvailable ? t("appShell.updateVersion", { current: appUpdate.currentVersion ?? "?", available: appUpdate.availableVersion ?? "?" }) : appUpdate?.currentVersion ? t("settingsConfig.upToDate", { version: appUpdate.currentVersion }) : t("settingsConfig.versionUnavailable")}
                      </div>
                    </div>
                    <button type="button" onClick={() => void checkForAppUpdate(true)} disabled={checkingAppUpdate} aria-label={t("settingsConfig.checkAppUpdates")} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: checkingAppUpdate ? "wait" : "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={13} aria-hidden="true" /> {t("settingsConfig.refresh")}
                    </button>
                  </div>
                  {appUpdate?.updateAvailable && (
                    <div style={{ marginTop: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 8 }}>
                      {appUpdate.selfUpdateSupported ? (
                        <button
                          type="button"
                          onClick={onRequestAppUpdate}
                          style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--accent-strong)", borderRadius: "var(--radius-control)", background: "var(--accent-strong)", color: "var(--on-accent)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                        >
                          <Download size={13} aria-hidden="true" />
                          {t("settingsConfig.appUpdateAction")}
                        </button>
                      ) : (
                        <>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {t("settingsConfig.runAppUpdateCommand")}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{appUpdate.updateCommand || "npm install -g omploom"}</code>
                            <button
                              type="button"
                              onClick={() => {
                                void copyText(appUpdate.updateCommand || "npm install -g omploom")
                                  .then(() => toast.success(t("appShell.commandCopied")))
                                  .catch(() => toast.error(t("appShell.commandCopyFailed")));
                              }}
                              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}
                            >
                              <Copy size={12} aria-hidden="true" /> {t("appShell.copyCommand")}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {appUpdateMessage && <Alert variant={appUpdateMessage.toLowerCase().includes("fail") || appUpdateMessage.toLowerCase().includes("error") ? "error" : "info"} description={appUpdateMessage} onDismiss={() => setAppUpdateMessage(null)} />}
                </section>

                {/* OMP runtime update card */}
                <section style={{ padding: 14, border: ompUpdateIsAvailable ? "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))" : "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.ompLabel")}</span>
                        {ompUpdateIsAvailable && (
                          <span
                            role="status"
                            aria-label={t("settingsTabs.updateAvailable")}
                            title={t("settingsTabs.updateAvailable")}
                            style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }}
                          />
                        )}
                      </div>
                      <div style={{ marginTop: 4, color: ompUpdateIsAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {checking || (!hasCheckedUpdates && !update) ? t("settingsConfig.checkingUpdates") : update?.updateAvailable ? t("appShell.updateVersion", { current: update.currentVersion ?? "?", available: update.availableVersion ?? "?" }) : update?.currentVersion ? t("settingsConfig.upToDate", { version: update.currentVersion }) : t("settingsConfig.versionUnavailable")}
                      </div>
                    </div>
                    <button type="button" onClick={() => void checkForUpdate(true)} disabled={checking} aria-label={t("settingsConfig.checkOmpUpdates")} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: checking ? "wait" : "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={13} aria-hidden="true" /> {t("settingsConfig.refresh")}
                    </button>
                  </div>
                  {update?.updateAvailable && (
                    <div style={{ marginTop: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.runOmpUpdateCommand")}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{update.updateCommand || "omp update"}</code>
                        <button
                          type="button"
                          onClick={() => void handleOmpUpdateNow()}
                          disabled={ompUpdating}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--accent-strong)", borderRadius: "var(--radius-control)", background: "var(--accent-strong)", color: "var(--on-accent)", cursor: ompUpdating ? "wait" : "pointer", fontSize: 11, fontWeight: 600 }}
                        >
                          <Download size={12} aria-hidden="true" /> {ompUpdating ? t("settingsConfig.updating") : t("settingsConfig.ompUpdateAction")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void copyText(update.updateCommand || "omp update")
                              .then(() => toast.success(t("appShell.commandCopied")))
                              .catch(() => toast.error(t("appShell.commandCopyFailed")));
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}
                        >
                          <Copy size={12} aria-hidden="true" /> {t("appShell.copyCommand")}
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => void restartSessions()}
                      disabled={restarting}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: restarting ? "wait" : "pointer", fontSize: 12 }}
                    >
                      <RotateCcw size={13} aria-hidden="true" /> {restarting ? t("settingsConfig.restarting") : t("settingsConfig.restartSessions")}
                    </button>
                    <a
                      href="https://github.com/can1357/oh-my-pi/releases"
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", color: "var(--text-muted)", textDecoration: "none", fontSize: 12 }}
                    >
                      <ExternalLink size={13} aria-hidden="true" /> {t("settingsConfig.changelog")}
                    </a>
                  </div>
                  {message && <Alert variant={message.toLowerCase().includes("fail") || message.toLowerCase().includes("error") ? "error" : "info"} description={message} onDismiss={() => setMessage(null)} />}
                </section>

                {/* Windows Background Service & System Tray card (Windows only) */}
                {windowsService?.isWindows && (
                  <section style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                          <Monitor size={15} aria-hidden="true" />
                          {t("settingsConfig.windowsServiceTitle")}
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                          {t("settingsConfig.windowsServiceDesc")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void fetchWindowsServiceStatus()}
                        disabled={loadingWindowsService}
                        aria-label={t("settingsConfig.refresh")}
                        style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: loadingWindowsService ? "wait" : "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}
                      >
                        <RefreshCw size={13} aria-hidden="true" /> {t("settingsConfig.refresh")}
                      </button>
                    </div>

                    {/* Status badges grid */}
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                      <div style={{ padding: 10, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          {t("settingsConfig.windowsServiceStatus")}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, color: windowsService.isRunning ? "var(--accent)" : "var(--text-muted)" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: windowsService.isRunning ? "var(--accent)" : "var(--border)" }} />
                          {windowsService.isRunning ? t("settingsConfig.windowsServiceRunning", { port: windowsService.port }) : t("settingsConfig.windowsServiceStopped")}
                        </div>
                      </div>

                      <div style={{ padding: 10, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          {t("settingsConfig.windowsServiceDesktopShortcut", { status: "" }).replace(/:\s*$/, "")}
                        </div>
                        <div style={{ fontSize: 12, color: windowsService.desktopShortcutExists ? "var(--text)" : "var(--text-muted)" }}>
                          {windowsService.desktopShortcutExists ? t("settingsConfig.windowsServicePresent") : t("settingsConfig.windowsServiceMissing")}
                        </div>
                      </div>
                    </div>

                    {/* Autostart Toggle */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)" }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{t("settingsConfig.windowsServiceAutostart")}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("settingsConfig.windowsServiceAutostartDesc")}</div>
                      </div>
                      <ToggleSwitch
                        id="windows-service-autostart-toggle"
                        checked={windowsService.autostart}
                        disabled={windowsServiceActionPending}
                        onChange={(checked) => void performWindowsServiceAction("toggle-autostart", { autostart: checked })}
                      />
                    </div>

                    {/* Action buttons toolbar */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => void performWindowsServiceAction("install", { startImmediately: false })}
                        disabled={windowsServiceActionPending}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: windowsServiceActionPending ? "wait" : "pointer", fontSize: 12 }}
                      >
                        <Monitor size={13} aria-hidden="true" />
                        {windowsService.isInstalled ? t("settingsConfig.windowsServiceReinstallBtn") : t("settingsConfig.windowsServiceInstallBtn")}
                      </button>

                      {windowsService.isRunning ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void performWindowsServiceAction("restart")}
                            disabled={windowsServiceActionPending}
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: windowsServiceActionPending ? "wait" : "pointer", fontSize: 12 }}
                          >
                            <RotateCcw size={13} aria-hidden="true" /> {t("settingsConfig.windowsServiceRestartBtn")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void performWindowsServiceAction("stop")}
                            disabled={windowsServiceActionPending}
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: windowsServiceActionPending ? "wait" : "pointer", fontSize: 12 }}
                          >
                            <Square size={13} aria-hidden="true" /> {t("settingsConfig.windowsServiceStopBtn")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void performWindowsServiceAction("start")}
                          disabled={windowsServiceActionPending}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: windowsServiceActionPending ? "wait" : "pointer", fontSize: 12 }}
                        >
                          <Play size={13} aria-hidden="true" /> {t("settingsConfig.windowsServiceStartBtn")}
                        </button>
                      )}

                      {windowsService.isInstalled && (
                        <button
                          type="button"
                          onClick={() => void performWindowsServiceAction("uninstall", { cleanConfig: false })}
                          disabled={windowsServiceActionPending}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text-muted)", cursor: windowsServiceActionPending ? "wait" : "pointer", fontSize: 12 }}
                        >
                          <Trash2 size={13} aria-hidden="true" /> {t("settingsConfig.windowsServiceUninstallBtn")}
                        </button>
                      )}
                    </div>
                  </section>
                )}
              </div>
            )}
              </div>
            </SettingsHighlightContext.Provider>
          )}
        </div>
      </div>
  );
}
